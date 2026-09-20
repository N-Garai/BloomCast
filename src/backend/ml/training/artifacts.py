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
import json
import os
from pathlib import Path

import numpy as np

MODEL_FILE = "model.txt"
CALIBRATOR_FILE = "calibrator.json"
ENSEMBLE_FILE = "ensemble.npz"
CNN_FILE = "cnn.npz"
META_FILE = "meta.json"
Q05_FILE = "quantile_q05.txt"
Q95_FILE = "quantile_q95.txt"


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


def save_artifacts(path: str | Path, *, lgbm_branch, calibrator, ensemble, cnn,
                   feature_names: list, meta: dict, quantiles: dict | None = None) -> Path:
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    lgbm_branch.model.booster_.save_model(str(path / MODEL_FILE))
    if quantiles:
        quantiles["q05"].booster_.save_model(str(path / Q05_FILE))
        quantiles["q95"].booster_.save_model(str(path / Q95_FILE))
        meta = {**meta, "has_quantiles": True}
    else:
        meta = {**meta, "has_quantiles": False}
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
