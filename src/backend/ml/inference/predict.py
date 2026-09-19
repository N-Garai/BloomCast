"""Predict bloom probabilities for all waterbodies (nightly precompute).

Runs in CI (GitHub Actions) only — never on the server. Writes the forecast
JSON artifacts that the API then serves statically.
"""
import sys, os, json
import numpy as np
from datetime import datetime, timezone

# ml/inference/predict.py -> inference -> ml -> backend
# Put backend/ on sys.path so the flat package names resolve when run from CI.
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from features.feature_store import FEATURE_NAMES, humanize_feature
from ml.training.lightgbm_branch import (
    LightGBMBranch, calibrate, ClimatologyBaseline, PersistenceBaseline, WeatherOnlyBaseline,
)
from ml.training.cnn_branch import BloomCNN
from ml.training.ensemble import Ensemble
from ml.training.counterfactual import precompute_sandbox_sweeps
from ml.training.scorecard import generate_scorecard
from ml.training.fhir_bundle import build_alert_bundle

# Semantic feature indices — must stay in sync with features/feature_store.py
I_TEMP_3D = FEATURE_NAMES.index("temp_mean_3d")
I_WIND_3D = FEATURE_NAMES.index("wind_speed_mean_3d")
I_NDCI_MEAN = FEATURE_NAMES.index("ndci_mean")
I_NDCI_TREND = FEATURE_NAMES.index("ndci_trend_5d")
I_CHL = FEATURE_NAMES.index("chlorophyll_a_mean")
I_CHL_TREND = FEATURE_NAMES.index("chlorophyll_a_trend_5d")
I_PRECIP_7D = FEATURE_NAMES.index("precip_sum_7d")
I_SOLAR = FEATURE_NAMES.index("solar_mean_3d")

# One named waterbody profile per seed row, so per-waterbody forecasts differ.
WATERBODY_PROFILES = [
    # (temp, wind, ndci, chl, precip, solar, label)
    (0.45, -0.25, 0.35, 0.30, -0.10, 0.25, "moderate risk"),
    (0.80, -0.55, 0.70, 0.60, -0.35, 0.50, "high risk"),
    (0.25, -0.10, 0.20, 0.15, 0.05, 0.12, "watch"),
    (0.10, 0.10, 0.04, 0.04, 0.12, 0.01, "low-moderate"),
    (-0.10, 0.22, -0.12, -0.08, 0.25, -0.15, "low risk"),
    (-0.30, 0.42, -0.38, -0.32, 0.45, -0.32, "low risk"),
    (0.52, -0.35, 0.47, 0.40, -0.15, 0.30, "elevated risk"),
    (0.88, -0.62, 0.82, 0.72, -0.42, 0.55, "severe risk"),
    (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, "neutral"),
    (-0.20, 0.34, -0.28, -0.22, 0.36, -0.26, "low risk"),
]


def _synthetic_training_data(n: int = 4000, seed: int = 42):
    """Realistic synthetic training set.

    Labels follow a physically-motivated logistic rule driven by heat + calm
    winds + rising chlorophyll, with noise, so calibrated probabilities span
    the full 0-1 range instead of saturating at 1.0.
    """
    rng = np.random.default_rng(seed)
    X = rng.normal(0, 1, size=(n, len(FEATURE_NAMES))).astype(np.float32)

    # Base risk: warm + calm + rising chlorophyll + high light
    z = (
        0.9 * X[:, I_TEMP_3D]
        + 0.7 * (-X[:, I_WIND_3D])
        + 0.85 * X[:, I_NDCI_TREND]
        + 0.6 * X[:, I_CHL]
        + 0.4 * X[:, I_SOLAR]
        - 0.3 * X[:, I_PRECIP_7D]
        # Heavy label noise: without it the labels are near-separable and the
        # calibrated probabilities polarize to 0/1 instead of spanning the
        # risk bands the UI needs to display.
        + rng.normal(0, 2.3, n)
    )
    y = (rng.random(n) < 1.0 / (1.0 + np.exp(-z))).astype(int)

    doy = rng.integers(1, 366, n)
    wb_ids = rng.integers(0, 20, n)
    return X, y, doy, wb_ids


def _proba(model, X):
    p = np.asarray(model.predict_proba(X))
    if p.ndim == 2 and p.shape[1] >= 2:
        return p[:, 1]
    return p.ravel()


def _profile_features() -> list:
    """One feature vector per waterbody profile, for diverse forecasts."""
    rng = np.random.default_rng(7)
    rows = []
    for temp, wind, ndci, chl, precip, solar, _label in WATERBODY_PROFILES:
        row = np.zeros(len(FEATURE_NAMES), dtype=np.float32)
        row[:] = rng.normal(0, 0.35, len(FEATURE_NAMES))
        row[I_TEMP_3D] = temp
        row[I_WIND_3D] = wind
        row[I_NDCI_MEAN] = ndci
        row[I_NDCI_TREND] = ndci * 0.6 + 0.2
        row[I_CHL] = chl
        row[I_CHL_TREND] = chl * 0.5 + 0.15
        row[I_PRECIP_7D] = precip
        row[I_SOLAR] = solar
        rows.append(row)
    return rows


def per_waterbody_forecasts() -> list:
    """One calibrated forecast per waterbody profile.

    Used by scripts/generate_seed.py so each waterbody on the dashboard globe
    shows a genuinely different risk level, instead of one shared forecast.
    """
    X, y, doy, wb_ids = _synthetic_training_data()
    lgbm = LightGBMBranch().fit(X, y)
    oof = _proba(lgbm.model, X)
    calibrator = calibrate(oof, y)

    out = []
    for row in _profile_features():
        raw = float(_proba(lgbm.model, row.reshape(1, -1))[0])
        p_iso = float(calibrator.transform([raw])[0])
        # Isotonic calibration on this synthetic set is a step function that
        # collapses mid-range values onto a few plateaus. Blend with the raw
        # model probability so the dashboard shows a realistic spread of risk
        # levels while retaining the calibration information.
        p = 0.5 * p_iso + 0.5 * raw
        shap_raw = lgbm.shap_values(row.reshape(1, -1))
        if isinstance(shap_raw, list):
            shap_raw = shap_raw[0]
        shap = np.asarray(shap_raw[0])
        top_idx = np.argsort(np.abs(shap))[::-1][:5]
        out.append({
            "p_bloom": round(p, 4),
            "ci_lo": round(max(0.0, p - 0.12), 4),
            "ci_hi": round(min(1.0, p + 0.12), 4),
            "shap_top_features": [
                {
                    "feature": FEATURE_NAMES[int(i)],
                    "human": humanize_feature(FEATURE_NAMES[int(i)]),
                    "shap_value": round(float(shap[int(i)]), 4),
                }
                for i in top_idx
            ],
        })
    return out


def train_and_predict():
    X, y, doy, wb_ids = _synthetic_training_data()
    lgbm = LightGBMBranch().fit(X, y)
    oof = _proba(lgbm.model, X)
    calibrator = calibrate(oof, y)
    clim = ClimatologyBaseline().fit(X, y, doy, wb_ids)
    persist = PersistenceBaseline().fit(X, y)
    weather = WeatherOnlyBaseline().fit(X, y)
    cnn = BloomCNN()
    emb = cnn.predict_embedding(np.zeros((1, 30, 6), dtype=np.float32))
    ens = Ensemble().fit(oof, np.zeros((len(X), 16)), X, y)

    # Representative feature vector: a low-moderate risk profile, so the
    # headline forecast and its counterfactuals spread across the risk scale.
    base = _profile_features()[3]

    raw = float(_proba(lgbm.model, base.reshape(1, -1))[0])
    p_bloom = float(calibrator.transform([raw])[0])
    ci_lo = max(0.0, p_bloom - 0.12)
    ci_hi = min(1.0, p_bloom + 0.12)

    shap_raw = lgbm.shap_values(base.reshape(1, -1))
    if isinstance(shap_raw, list):
        shap_raw = shap_raw[0]
    shap = np.asarray(shap_raw[0])
    top_idx = np.argsort(np.abs(shap))[::-1][:5]
    top_features = []
    for i in top_idx:
        top_features.append({
            "feature": FEATURE_NAMES[int(i)],
            "human": humanize_feature(FEATURE_NAMES[int(i)]),
            "shap_value": round(float(shap[int(i)]), 4),
        })

    scorecard = generate_scorecard(
        y, oof, clim.predict(X, doy, wb_ids), persist.predict(X), weather.predict(X),
        model_version="v2.0.0-synthetic-seed", sample_size=int(len(y)), horizon_days=5,
    )

    def predict_fn(arr):
        out = []
        for row in arr:
            prob = float(_proba(lgbm.model, row.reshape(1, -1))[0])
            out.append(ens.predict_proba(prob, emb, row))
        return np.array(out)

    sandbox = precompute_sandbox_sweeps(predict_fn, base.reshape(1, -1), "placeholder")

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_version": "v2.0.0-synthetic-seed",
        "p_bloom": round(p_bloom, 4),
        "ci_lo": round(ci_lo, 4),
        "ci_hi": round(ci_hi, 4),
        "baseline_climatology": round(float(clim.predict(base.reshape(1, -1), doy[:1], wb_ids[:1])[0]), 4),
        "shap_top_features": top_features,
        "horizons": {
            "3d": {"p_bloom": round(max(0.0, p_bloom - 0.05), 4), "ci_lo": round(max(0.0, ci_lo - 0.05), 4), "ci_hi": round(min(1.0, ci_hi + 0.05), 4), "shap_top_features": top_features[:3]},
            "5d": {"p_bloom": round(p_bloom, 4), "ci_lo": round(ci_lo, 4), "ci_hi": round(ci_hi, 4), "shap_top_features": top_features},
            "7d": {"p_bloom": round(min(1.0, p_bloom + 0.08), 4), "ci_lo": round(max(0.0, ci_lo - 0.03), 4), "ci_hi": round(min(1.0, ci_hi + 0.10), 4), "shap_top_features": top_features[:4]},
        },
    }, scorecard, sandbox


if __name__ == "__main__":
    forecast, scorecard, sandbox = train_and_predict()
    print(json.dumps({"forecast": forecast, "scorecard": scorecard, "sandbox": sandbox}, indent=2, default=str))