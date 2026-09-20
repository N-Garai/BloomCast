"""Export serving artifacts after training (the Kaggle step).

Usage (local or Kaggle — see docs/kaggle-training.md):
    TICKTICKBLOOM_DIR=/path/to/csvs python scripts/export_artifacts.py [--allow-synthetic]

Trains via ml.inference.predict (_fit_all: real labels when present, else
synthetic) and writes src/backend/ml/artifacts/. Committed artifacts must be
real-label trained — refused for synthetic unless --allow-synthetic, and
enforced by test_committed_artifacts_are_real.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "src", "backend"))

from ml.inference.predict import _fit_all, _band  # noqa: E402
from ml.training.artifacts import save_artifacts  # noqa: E402
from features.feature_store import FEATURE_NAMES  # noqa: E402
from ml.training.tuning import train_quantiles  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--allow-synthetic", action="store_true",
                    help="export even when trained on the synthetic fallback")
    ap.add_argument("--out", default=os.path.join(
        _ROOT, "src", "backend", "ml", "artifacts"))
    args = ap.parse_args()

    bundle = _fit_all()
    source = bundle["frame"]["source"]
    if source != "tick-tick-bloom" and not args.allow_synthetic:
        print("REFUSED: training source is synthetic-seed.")
        print("Set TICKTICKBLOOM_DIR to the competition CSVs (docs/training-data.md),")
        print("or re-run with --allow-synthetic for a local-only smoke test.")
        return 2

    quantiles = train_quantiles(bundle["frame"]["X"], bundle["frame"]["y"])
    base = bundle["base"]
    raw_head = float(bundle["lgbm"].model.predict_proba(
        base.reshape(1, -1).astype(np.float64))[0][1])
    p_head = float(bundle["calibrator"].transform([raw_head])[0])
    lo_head, hi_head = _band(p_head, base, quantiles, bundle["ci_half"])

    meta = {
        "model_version": bundle["version"],
        "training_source": source,
        "training_note": bundle["frame"]["note"],
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "ci_half": bundle["ci_half"],
        "oof_auc": bundle["oof_auc"],
        "oof_brier": bundle["oof_brier"],
        "scorecard": json.loads(json.dumps(bundle["scorecard"], default=float)),
        "headline": {
            "p_bloom": p_head,
            "ci_lo": lo_head,
            "ci_hi": hi_head,
            "shap_top_features": bundle["top_features"],
            "baseline_climatology": round(float(bundle["clim"].predict(
                bundle["base"].reshape(1, -1),
                bundle["frame"]["doy"][:1],
                bundle["frame"]["wb_ids"][:1])[0]), 4),
        },
    }
    save_artifacts(
        args.out,
        lgbm_branch=bundle["lgbm"],
        calibrator=bundle["calibrator"],
        ensemble=bundle["ens"],
        cnn=bundle["cnn"],
        feature_names=FEATURE_NAMES,
        meta=meta,
        quantiles=quantiles,
    )
    print(f"artifacts exported to {args.out} (source={source})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
