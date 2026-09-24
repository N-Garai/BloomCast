"""Model artifact save/load for the Kaggle training flow.

Training is heavy (labels + weather join + CV + CNN) and belongs on Kaggle's
free compute — see docs/kaggle-training.md. This module serializes everything
the backend needs for inference-only serving:

  model.txt      LightGBM native booster (no sklearn wrapper needed to serve)
  calibrator.json  isotonic knots (X_thresholds_, y_thresholds_) — re-fit on
                   load, which reproduces the identical stepwise function
  ensemble.npz   logistic meta-learner coef_/intercept_/classes_
  cnn.npz        numpy CNN weights
  meta.json      feature names, training source, metrics, CI half-width

Artifacts commit to the repo ONLY when trained on real labels — enforced by
test_committed_artifacts_are_real. The backend prefers artifacts when valid
and falls back to in-process training otherwise.
"""
import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

MODEL_FILE = "model.txt"
CALIBRATOR_FILE = "calibrator.json"
ENSEMBLE_FILE = "ensemble.npz"
CNN_FILE = "cnn.npz"
META_FILE = "meta.json"
Q05_FILE = "quantile_q05.txt"
Q95_FILE = "quantile_q95.txt"

# Optional weather-only variant (v2 M3). Exported by the same notebook when
# enabled; absent on deployments that only trained the full model. Serving
# degrades cleanly rather than assuming it exists.
WEATHER_MODEL_FILE = "model_weather_only.txt"
WEATHER_CALIBRATOR_FILE = "calibrator_weather_only.json"
WEATHER_META_FILE = "weather_only_meta.json"

# Features the weather-only variant is allowed to see (weather block + static
# block). Spectral and citizen blocks are zeroed — that is the whole point of
# the variant: a model that works where no satellite pixels exist.
WEATHER_ONLY_FEATURE_NAMES = (
    "temp_mean_3d", "temp_mean_7d", "temp_anomaly_7d",
    "wind_speed_mean_3d", "wind_speed_max_3d", "wind_dir_variance_3d",
    "precip_sum_7d", "precip_sum_3d", "dry_days_7d",
    "solar_mean_3d", "cloud_cover_mean_3d", "dewpoint_mean_3d",
    "pressure_trend_3d", "growing_degree_days", "heat_wave_flag",
    "area_km2", "latitude", "longitude", "impervious_proxy",
)


def weather_only_mask(feature_names) -> np.ndarray:
    """Boolean mask selecting the weather + static columns of a feature matrix."""
    allowed = set(WEATHER_ONLY_FEATURE_NAMES)
    return np.array([n in allowed for n in feature_names], dtype=bool)


def apply_weather_only_mask(X, feature_names):
    """Zero every non-weather column — the training-time definition of the
    weather-only variant. Applied to *training* data too, so the variant can
    never learn from spectral or citizen inputs by accident."""
    X = np.array(X, dtype=np.float32, copy=True)
    X[:, ~weather_only_mask(feature_names)] = 0.0
    return X



def default_dir() -> Path:
    env = os.environ.get("BLOOMCAST_ARTIFACTS")
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    for parent in [here, *here.parents]:
        cand = parent / "ml" / "artifacts"
        if cand.is_dir() or (parent / "ml" / "training").is_dir():
            return parent / "ml" / "artifacts"
    return Path("ml-artifacts")


def _as_booster(model):
    """Unwrap sklearn wrappers to the native booster (native passes through)."""
    model = getattr(model, "model", model)
    if hasattr(model, "booster_"):
        return model.booster_
    return model


def save_artifacts(path: str | Path, *, lgbm_branch, calibrator, ensemble, cnn,
                   feature_names: list, meta: dict, quantiles: dict | None = None,
                   weather_only=None) -> Path:
    """Persist every file serving needs. ``weather_only`` is optional.

    ``weather_only`` accepts a dict ``{"booster": booster,
    "calibrator": calibrator, "meta": {...}}`` and writes the three extra files
    the optional variant needs (v2 M3). Deployments that did not train it simply
    omit the argument and the serving loader reports
    ``weather_only_variant: false``.
    """
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    _as_booster(lgbm_branch.model).save_model(str(path / MODEL_FILE))
    if quantiles:
        _as_booster(quantiles["q05"]).save_model(str(path / Q05_FILE))
        _as_booster(quantiles["q95"]).save_model(str(path / Q95_FILE))
        meta = {**meta, "has_quantiles": True}
    else:
        meta = {**meta, "has_quantiles": False}
    if weather_only:
        _as_booster(weather_only["booster"]).save_model(str(path / WEATHER_MODEL_FILE))
        with open(path / WEATHER_CALIBRATOR_FILE, "w") as f:
            json.dump({
                "x": [float(v) for v in np.asarray(weather_only["calibrator"].X_thresholds_).ravel()],
                "y": [float(v) for v in np.asarray(weather_only["calibrator"].y_thresholds_).ravel()],
            }, f)
        with open(path / WEATHER_META_FILE, "w") as f:
            json.dump(weather_only.get("meta", {}), f, indent=2)
        meta = {**meta, "has_weather_only": True}
    else:
        meta = {**meta, "has_weather_only": False}
    meta = {**meta, "trained_at": meta.get("trained_at") or datetime.now(timezone.utc).isoformat()}
    with open(path / CALIBRATOR_FILE, "w") as f:
        json.dump({
            "x": [float(v) for v in np.asarray(calibrator.X_thresholds_).ravel()],
            "y": [float(v) for v in np.asarray(calibrator.y_thresholds_).ravel()],
        }, f)
    m = ensemble.meta
    np.savez(str(path / ENSEMBLE_FILE),
             coef_=np.asarray(m.coef_), intercept_=np.asarray(m.intercept_),
             classes_=np.asarray(m.classes_), n_features_in_=np.asarray([m.n_features_in_]))
    np.savez(str(path / CNN_FILE),
             W1=cnn.W1, W2=cnn.W2, W3=cnn.W3, b1=cnn.b1, b2=cnn.b2, b3=cnn.b3,
             Wo=cnn.Wo, bo=cnn.bo)
    with open(path / META_FILE, "w") as f:
        json.dump({"feature_names": list(feature_names), **meta}, f, indent=2)
    return path


class _BoosterShim:
    """Sklearn-shaped wrapper around a native LightGBM booster.

    Slots into the existing inference code (predict_proba + booster_ for
    SHAP/gain attribution) without requiring the sklearn wrapper at serve time.
    """

    def __init__(self, booster):
        self._booster = booster
        self.model = self

    @property
    def booster_(self):
        return self._booster

    def predict_proba(self, X):
        p = np.asarray(self._booster.predict(np.asarray(X, dtype=np.float64))).ravel()
        return np.vstack([1.0 - p, p]).T


def _load_calibrator(payload: dict):
    from sklearn.isotonic import IsotonicRegression

    x = np.asarray(payload["x"], dtype=float)
    y = np.asarray(payload["y"], dtype=float)
    cal = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    cal.fit(x, y)  # refit on own knots reproduces the identical function
    return cal


def load_artifacts(path: str | Path, expected_features: list) -> dict | None:
    """Load serving artifacts. Returns None (with reason printed) if absent,
    incomplete, or feature-incompatible — the caller then trains in-process."""
    import lightgbm as lgb

    path = Path(path)
    needed = [MODEL_FILE, CALIBRATOR_FILE, ENSEMBLE_FILE, CNN_FILE, META_FILE]
    missing = [f for f in needed if not (path / f).exists()]
    if missing:
        return None
    try:
        with open(path / META_FILE) as f:
            meta = json.load(f)
        if list(meta.get("feature_names", [])) != list(expected_features):
            print("[artifacts] feature mismatch — ignoring committed artifacts")
            return None
        booster = lgb.Booster(model_file=str(path / MODEL_FILE))
        with open(path / CALIBRATOR_FILE) as f:
            calibrator = _load_calibrator(json.load(f))
        z = np.load(str(path / ENSEMBLE_FILE))
        from sklearn.linear_model import LogisticRegression
        meta_lr = LogisticRegression()
        meta_lr.coef_ = z["coef_"]
        meta_lr.intercept_ = z["intercept_"]
        meta_lr.classes_ = z["classes_"]
        meta_lr.n_features_in_ = int(z["n_features_in_"].ravel()[0])
        w = np.load(str(path / CNN_FILE))
        from ml.training.cnn_branch import BloomCNN
        cnn = BloomCNN.__new__(BloomCNN)
        for k in ("W1", "W2", "W3", "b1", "b2", "b3", "Wo", "bo"):
            setattr(cnn, k, np.asarray(w[k], dtype=np.float32))
        cnn.n_timesteps, cnn.n_channels, cnn.embedding_dim = 30, 6, 16
        quantiles = None
        if meta.get("has_quantiles") and (path / Q05_FILE).exists() and (path / Q95_FILE).exists():
            quantiles = {
                "q05": lgb.Booster(model_file=str(path / Q05_FILE)),
                "q95": lgb.Booster(model_file=str(path / Q95_FILE)),
            }
        return {
            "lgbm": _BoosterShim(booster),
            "calibrator": calibrator,
            "ensemble_meta": meta_lr,
            "cnn": cnn,
            "quantiles": quantiles,
            "meta": meta,
        }
    except Exception as exc:  # noqa: BLE001 - corrupt artifacts must not break serving
        print(f"[artifacts] load failed ({exc}) — falling back to in-process training")
        return None


# --- serving singleton (v2 M-K1) --------------------------------------------
# One load per process, re-checked against file mtimes instead of re-read on
# every request. The previous shape called load_artifacts() per request, which
# re-parsed a ~1 MB LightGBM text model and re-fit the isotonic calibrator on
# every single explore call.
_SERVING: dict = {
    "path": None,
    "signature": None,
    "artifacts": None,
    "reason": "not loaded yet",
    "loaded_at": None,
    "load_ms": None,
    "loads": 0,
}

# Guards the check-then-load in get_serving_artifacts: without it, a burst of
# concurrent first requests each parses the booster and each bumps "loads".
# Double-checked inside the lock so hot-path cache hits never block.
_SERVING_LOCK = threading.Lock()

_SERVING_FILES = (
    MODEL_FILE, CALIBRATOR_FILE, ENSEMBLE_FILE, CNN_FILE, META_FILE,
    Q05_FILE, Q95_FILE, WEATHER_MODEL_FILE, WEATHER_CALIBRATOR_FILE,
    WEATHER_META_FILE,
)


def _artifact_sha256(path: Path) -> str | None:
    try:
        return hashlib.sha256((path / META_FILE).read_bytes()).hexdigest()
    except OSError:
        return None


def _signature(path: Path) -> tuple:
    """Cheap change detector: (name, mtime_ns, size) per known artifact."""
    sig = []
    for name in _SERVING_FILES:
        f = path / name
        try:
            st = f.stat()
            sig.append((name, st.st_mtime_ns, st.st_size))
        except OSError:
            sig.append((name, None, None))
    return tuple(sig)


def get_serving_artifacts(expected_features: list, path: str | Path | None = None,
                          force: bool = False) -> dict | None:
    """Load serving artifacts once per process, re-checked by mtime.

    Returns the same dict shape as :func:`load_artifacts` (optionally with a
    ``"weather_only"`` entry), or ``None`` when the deployment has no usable
    artifacts — the caller then serves the honest fallback.
    """
    import time

    path = Path(path) if path is not None else default_dir()
    sig = _signature(path)
    if not force and _SERVING["loaded_at"] is not None and sig == _SERVING["signature"]:
        return _SERVING["artifacts"]

    with _SERVING_LOCK:
        sig = _signature(path)
        if not force and _SERVING["loaded_at"] is not None and sig == _SERVING["signature"]:
            return _SERVING["artifacts"]
        started = time.perf_counter()
        art = load_artifacts(path, expected_features)
        if art is not None:
            variant = load_weather_only(path, expected_features)
            if variant is not None:
                art = {**art, "weather_only": variant}
        _SERVING.update({
            "path": str(path),
            "signature": sig,
            "artifacts": art,
            "reason": "ok" if art else "artifacts absent, incomplete, or feature-incompatible",
            "loaded_at": datetime.now(timezone.utc).isoformat(),
            "load_ms": round((time.perf_counter() - started) * 1000, 1),
            "loads": _SERVING["loads"] + 1,
        })
        return art


def load_weather_only(path: str | Path, expected_features: list) -> dict | None:
    """Load the optional weather-only variant. ``None`` when not exported."""
    import lightgbm as lgb

    path = Path(path)
    if not (path / WEATHER_MODEL_FILE).exists():
        return None
    try:
        with open(path / WEATHER_META_FILE) as f:
            meta = json.load(f)
        with open(path / WEATHER_CALIBRATOR_FILE) as f:
            calibrator = _load_calibrator(json.load(f))
        booster = lgb.Booster(model_file=str(path / WEATHER_MODEL_FILE))
        if booster.num_feature() != len(expected_features):
            print("[artifacts] weather-only feature count mismatch — ignoring variant")
            return None
        return {
            "lgbm": _BoosterShim(booster),
            "calibrator": calibrator,
            "meta": meta,
        }
    except Exception as exc:  # noqa: BLE001 - optional artifact, never fatal
        print(f"[artifacts] weather-only variant unreadable ({exc}) — ignored")
        return None


def serving_model_status(expected_features: list | None = None) -> dict:
    """Model status for ``/v1/health`` — loaded / fallback, never a guess."""
    if expected_features is None:
        try:
            from features.feature_store import FEATURE_NAMES as expected_features  # noqa: N813
        except Exception:  # noqa: BLE001
            return {"status": "unknown", "reason": "feature names unavailable"}
    art = get_serving_artifacts(expected_features)
    if art is None:
        return {
            "status": "fallback",
            "reason": _SERVING["reason"],
            "artifacts_dir": _SERVING["path"],
        }
    meta = art.get("meta", {})
    return {
        "status": "loaded",
        "model_version": meta.get("model_version"),
        "training_source": meta.get("training_source"),
        "trained_at": meta.get("trained_at"),
        "model_sha": _artifact_sha256(Path(_SERVING["path"])) if _SERVING["path"] else None,
        "has_quantiles": bool(meta.get("has_quantiles")),
        "weather_only_variant": "weather_only" in art,
        "artifacts_dir": _SERVING["path"],
        "loaded_at": _SERVING["loaded_at"],
        "load_ms": _SERVING["load_ms"],
        "load_count": _SERVING["loads"],
    }


def reset_serving_cache() -> None:
    """Drop the singleton (tests, or a deployment that re-exports artifacts)."""
    _SERVING.update({
        "path": None, "signature": None, "artifacts": None,
        "reason": "not loaded yet", "loaded_at": None, "load_ms": None,
        "loads": 0,
    })
