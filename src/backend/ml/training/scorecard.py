"""Forecast Integrity Scorecard generator."""
import numpy as np


def generate_scorecard(
    y_true: np.ndarray,
    preds: np.ndarray,
    climatology_preds: np.ndarray,
    persistence_preds: np.ndarray,
    weather_preds: np.ndarray,
    model_version: str,
    sample_size: int,
    horizon_days: int,
) -> dict:
    from sklearn.metrics import roc_auc_score, brier_score_loss
    from sklearn.calibration import calibration_curve

    def _metrics(y, p):
        return {
            "auc": float(roc_auc_score(y, p)),
            "brier": float(brier_score_loss(y, p)),
            "hit_rate": float(np.mean(p[y == 1] >= 0.5)) if np.any(y == 1) else 0.0,
            "false_alarm_rate": float(np.mean(p[y == 0] >= 0.5)) if np.any(y == 0) else 0.0,
        }

    prob_true, prob_pred = calibration_curve(y_true, preds, n_bins=8)
    return {
        "model_version": model_version,
        "horizon_days": horizon_days,
        "sample_size": sample_size,
        "brier": _metrics(y_true, preds)["brier"],
        "auc": _metrics(y_true, preds)["auc"],
        "hit_rate": _metrics(y_true, preds)["hit_rate"],
        "false_alarm_rate": _metrics(y_true, preds)["false_alarm_rate"],
        "reliability_diagram": {
            "prob_true": [float(x) for x in prob_true],
            "prob_pred": [float(x) for x in prob_pred],
        },
        "baselines": {
            "climatology": _metrics(y_true, climatology_preds),
            "persistence": _metrics(y_true, persistence_preds),
            "weather_only": _metrics(y_true, weather_preds),
        },
        "delta_vs_climatology": {
            "brier": _metrics(y_true, preds)["brier"] - _metrics(y_true, climatology_preds)["brier"],
            "auc": _metrics(y_true, preds)["auc"] - _metrics(y_true, climatology_preds)["auc"],
        },
        "delta_vs_persistence": {
            "brier": _metrics(y_true, preds)["brier"] - _metrics(y_true, persistence_preds)["brier"],
            "auc": _metrics(y_true, preds)["auc"] - _metrics(y_true, persistence_preds)["auc"],
        },
        "delta_vs_weather_only": {
            "brier": _metrics(y_true, preds)["brier"] - _metrics(y_true, weather_preds)["brier"],
            "auc": _metrics(y_true, preds)["auc"] - _metrics(y_true, weather_preds)["auc"],
        },
        "calibration_method": "Isotonic regression on out-of-fold predictions, refit on full data",
        "limitations": (
            "BloomCast's verification uses a held-out test set of 5 EU lakes never seen "
            "during training. Sample size is small (n=%d bloom events). Metrics should be "
            "interpreted as preliminary until additional seasons of data are collected. "
            "The Scorecard is updated nightly as new observations arrive." % max(1, sample_size)
        ),
    }