# Training on Kaggle, serving from the repo

Training the full pipeline (weather join over thousands of labeled samples,
5-fold CV, CNN) is slow on a laptop and wasteful on every nightly run. The
intended flow: **train once on Kaggle's free compute, export artifacts, commit
them — the backend and nightly job then do pure inference.**

## Why this works

- Kaggle gives free CPUs/GPUs and free internet for the Open-Meteo join.
- The exported artifacts are tiny and dependency-light: LightGBM native
  `model.txt` (~600 KB), numpy CNN weights (~7 KB), isotonic knots (JSON),
  logistic coefficients (npz). No ONNX runtime, no torch, no extra deps.
- Serving needs only `lightgbm` + `numpy` + `scikit-learn` (already required).

## Steps

1. **Prepare the data** (one time, on your machine):
   - Download `train_labels.csv` + `metadata.csv` from the Tick Tick Bloom
     competition page (free DrivenData login; do not redistribute).
2. **Kaggle notebook** (or any machine with the CSVs):
   ```python
   # Cell 1 — get the code
   !git clone https://github.com/N-Garai/BloomCast.git
   %cd BloomCast
   !pip install -q lightgbm scikit-learn pandas numpy httpx scipy
   ```
   ```python
   # Cell 2 — point at the data (upload CSVs via Kaggle Datasets,
   # or attach them to the notebook as inputs)
   import os
   os.environ["TICKTICKBLOOM_DIR"] = "/kaggle/input/ticktickbloom"
   ```
   ```bash
   # Cell 3 (! shell) — train + export
   !python scripts/export_artifacts.py
   ```
   Expected output: `artifacts exported to src/backend/ml/artifacts
   (source=tick-tick-bloom)` plus OOF AUC/Brier printed by the trainer.
3. **Download** `src/backend/ml/artifacts/` (5 files) from the notebook output.
4. **Commit them** to the repo. CI enforces the honesty rule:
   `test_committed_artifacts_are_real` fails the build if committed artifacts
   claim anything but `tick-tick-bloom` provenance.
5. **Done.** The next nightly seed (and every deployment) loads the exported
   model and runs inference only — no training, no labels, no weather join.
   `train_and_predict()` falls back to in-process training automatically if
   the artifacts are ever removed or become feature-incompatible.

## Realtime prediction from live weather

With artifacts in place, any backend process can score live features without
training:

```python
from ml.inference.predict import _load_bundle  # or train_and_predict()
bundle = _load_bundle()  # artifacts preferred
p = bundle["lgbm"].predict_proba(live_row_32dim)  # + calibrator + ensemble
```

`/v1/explore` deliberately stays on the transparent heuristic (it has no
satellite block for arbitrary points — see the model card). A weather-only
model variant for arbitrary coordinates is the natural next step once
real-label artifacts exist.

## Environment knobs

| Variable | Purpose |
|---|---|
| `TICKTICKBLOOM_DIR` | Competition CSVs (training time only) |
| `BLOOMCAST_ARTIFACTS` | Override the artifacts directory (serving time) |
