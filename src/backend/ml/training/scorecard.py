"""Forecast Integrity Scorecard generator."""
import numpy as np

# The label source (Tick Tick Bloom) covers four U.S. regions only. A literal
# EU hold-out is therefore impossible today, and saying otherwise — which an
# earlier revision of this file did — is a ship-blocker under v2 §3/§7.
EU_HOLDOUT_BLOCK = {
    "status": "data-blocked",
    "reason": (
        "Tick Tick Bloom labels cover four U.S. regions only, so no EU-lake "
        "hold-out can be computed. Unlocked by citizen Ground Truth Loop "
        "labels in the identical row format — region IDs already flow "
        "end-to-end, so no code change is needed, only data."
    ),
}

HONEST_LIMITATIONS = (
    "Metrics are out-of-fold on the training distribution described by "
    "training_source — they are not an independent hold-out. Region skill is "
    "published two ways: per-region (per_region) and by rotating region "
    "hold-out (holdout_region), which trains on three regions and evaluates "
    "the fourth. No EU validation exists; see eu_holdout for why, and do not "
    "quote these numbers as European skill. The scorecard refreshes with every "
    "nightly seed run."
)


def eu_holdout_block() -> dict:
    return dict(EU_HOLDOUT_BLOCK)


def generate_scorecard(
    y_true: np.ndarray,
    preds: np.ndarray,
    climatology_preds: np.ndarray,
    persistence_preds: np.ndarray,
    weather_preds: np.ndarray,
    model_version: str,
    sample_size: int,
    horizon_days: int,
    per_region: dict | None = None,
    holdout_region: dict | None = None,
    variants: dict | None = None,
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
    out = {
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
        "limitations": HONEST_LIMITATIONS,
        "eu_holdout": eu_holdout_block(),
    }
    if per_region:
        out["per_region"] = per_region
    if holdout_region:
        out["holdout_region"] = holdout_region
    else:
        out["holdout_region"] = {
            "status": "unavailable",
            "reason": "no region labels in the training frame",
        }
    if variants:
        out["variants"] = variants
    return out


def citizen_weights_block(scorecard: dict | None) -> dict:
    """The citizen-influence record, re-derived rather than trusted.

    Artifacts exported before v3 M-V4 predate the field entirely. Backfilling a
    zero share with a reason is the honest reading: the Ground Truth Loop was
    not connected to training at export time, so its contribution *was* zero.
    Claiming it was connected would be a false provenance claim, and omitting
    the key would leave the UI implying the feature does not exist.
    """
    block = (scorecard or {}).get("citizen_weights")
    if isinstance(block, dict) and block.get("final_citizen_share") is not None:
        return dict(block)
    return {
        "status": "not-recorded",
        "final_citizen_share": 0.0,
        "reason": (
            "These artifacts were exported before citizen observations were wired "
            "into training, so they carry no citizen weight. Re-export from the "
            "training notebook to publish the live share."
        ),
    }


def sanitize_loaded_scorecard(scorecard: dict, training_source: str | None = None) -> dict:
    """Repair a scorecard baked into a committed artifact at training time.

    Artifacts are immutable records of a training run — but the *narration*
    inside them can go stale or, worse, wrong. The old baked text claimed a
    hold-out on five EU lakes that never existed. Numbers are kept; claims are
    re-derived from what we can actually compute.
    """
    sc = dict(scorecard)
    sc["limitations"] = HONEST_LIMITATIONS
    if training_source and not sc.get("training_source"):
        sc["training_source"] = training_source
    sc.setdefault("eu_holdout", eu_holdout_block())
    sc["citizen_weights"] = citizen_weights_block(sc)
    if "holdout_region" not in sc:
        sc["holdout_region"] = {
            "status": "not-recorded",
            "reason": (
                "The committed artifacts predate region hold-out rotation; "
                "re-export from the training notebook to publish it."
            ),
        }
    return sc
