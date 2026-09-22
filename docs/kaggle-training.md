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

1. **Get the labels** (one time) — either:
   - competition CSVs (`train_labels.csv` + `metadata.csv`, free DrivenData
     login at drivendata.org/competitions/143, do not redistribute), or
   - the CAML SeaBASS `.sb` data file (doi:10.5067/SeaBASS/CAML/DATA001 —
     same underlying labels, public, no login). Optional: `CAML_MAX_DISTANCE_M=1000`
     drops samples taken far from water.
2. **Attach the data** as a Kaggle input dataset — the notebook finds
   competition CSVs or `.sb` at any depth under `/kaggle/input`.
3. **Training code access** — pick one:
   - *Repo public:* nothing to do, the notebook clones it.
   - *Repo private:* set a `GITHUB_TOKEN` secret (classic PAT, scope `repo` —
     `public_repo` does NOT cover private clones; fine-grained PATs: contents
     read-only on this repo), or upload `src/backend/{ml,features,ingestion,shared}`
     once as a second input dataset — the notebook detects and uses it, no
     git involved. **Revoke the token when done** — it exists only for the clone.
4. **Run the notebook** `src/backend/ml/training/bloomcast-model.ipynb` —
   same file on both platforms (it detects Colab vs Kaggle itself):
   - *Kaggle:* GPU accelerator, internet ON.
   - *Colab:* GPU runtime (Runtime → Change runtime type → T4), **mount Drive
     when asked** (run cells top to bottom — the auth popup is mandatory),
     add the `GITHUB_TOKEN` secret via the key icon only if the repo is
     private, and put the dataset in Drive `bloomcast/data/` or upload it to
     the session `/content/` (Drive survives disconnects, session files don't).
   It trains, exports, and self-verifies. Expected final line: `reload OK …`
   plus OOF AUC/Brier printed by the trainer.
3. **Download** `bloomcast_artifacts/` (7 files) from the notebook output.
4. **Commit them** to the repo. CI enforces the honesty rule:
   `test_committed_artifacts_are_real` fails the build if committed artifacts
   claim anything but `tick-tick-bloom` provenance.
5. **Done.** The next nightly seed (and every deployment) loads the exported
   model and runs inference only — no training, no labels, no weather join.
   `train_and_predict()` falls back to in-process training automatically if
   the artifacts are ever removed or become feature-incompatible.

## Background runs: Kaggle vs Colab (read this before a 2-hour run)

- **Kaggle:** *Save & Run All* executes headless as a committed version —
  closing the laptop is safe.
- **Colab free: no background execution.** The tab must stay open; an idle
  timeout (tens of minutes, varies) kills the kernel. Mitigations, all built
  in: progress lines print continuously (activity helps), the weather cache
  flushes every 500 rows, Optuna resumes its study — a re-run continues where
  the dead one stopped as long as Drive files persist. Colab Pro ($10/mo) is
  the only way to close the tab.
- **Never re-download work already done:** cache (`weather_cache.csv`),
  Optuna DB (`optuna.db`), and artifacts all live in the platform work dir
  (`/kaggle/working` or Drive `bloomcast/`). Delete those files only to force
  a clean rerun.

## Realtime prediction from live weather

With artifacts in place, any backend process can score live features without
training:

```python
from ml.inference.predict import _load_bundle  # or train_and_predict()
bundle = _load_bundle()  # artifacts preferred
p = bundle["lgbm"].predict_proba(live_row_32dim)  # + calibrator + ensemble
```

`/v1/explore` always returns the transparent heuristic, and adds a
`model_estimate` block whenever committed artifacts exist — the exported model
scored on the live 32-dim row, labeled experimental (weather-only input,
empty spectral block, outside pilot calibration).

## Environment knobs

| Variable | Purpose |
|---|---|
| `TICKTICKBLOOM_DIR` | Competition CSVs (training time only) |
| `CAML_DIR` | CAML `.sb` file location (alternative to the above) |
| `CAML_MAX_DISTANCE_M` | Drop samples taken farther than this from water |
| `N_SAMPLES` | Stratified (label × region) subsample cap — e.g. 8000 finishes the join in ~1/3 the time with the same mix. Unset trains on everything |
| `BLOOMCAST_WEATHER_CACHE` | Override the weather-join cache path (training time) |
| `BLOOMCAST_ARTIFACTS` | Override the artifacts directory (serving time) |
