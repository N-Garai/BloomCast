# Training on real labels (Tick Tick Bloom / CAML)

By default BloomCast trains on whatever labels it finds: real in-situ
labels when the files below are present (the committed state), a synthetic
stand-in (see `model-card.md`) only when they are absent.
To train on real in-situ cyanobacteria labels, provide **either** input —
they carry the same underlying labels:

## Option A — competition CSVs (exact competition schema)

1. Create a free account at https://www.drivendata.org/competitions/143/tick-tick-bloom/
2. Download `train_labels.csv` (`uid, severity 1–5, density`) and `metadata.csv`
   (`uid, latitude, longitude, date, split, region`).
3. Place both in `src/data/ticktickbloom/` (git-ignored), or anywhere and set:

```bash
export TICKTICKBLOOM_DIR=/path/to/csvs
```

## Option B — CAML SeaBASS file (same labels, one table)

The competition labels derive from the **CAML dataset** (23,570 in-situ points,
U.S. inland waters 2013–2021, doi:10.5067/SeaBASS/CAML/DATA001). If you have
the `.sb` data file (or a CAML csv), drop it in the data dir instead:

```bash
export CAML_DIR=/path/to/caml
# optional quality filter — drop samples taken far from water (CAML
# documentation, Table 4):
export CAML_MAX_DISTANCE_M=1000
```

Columns understood: `uid, data_provider, region, latitude, longitude, date,
density_cells_per_ml, severity, distance_to_water_m`. Missing severities are
derived from density via the same bands; when both formats are present, the
competition CSVs win.

Severity bands (cells/mL): 1:<20k · 2:20k–100k · 3:100k–1M · 4:1M–10M · 5:≥10M.
BloomCast binarizes at severity ≥ 3 (`ingestion/drivendata_loader.py`).

## 2. What happens automatically

- `ml/inference/predict.py` detects the CSVs and trains on the real frame instead
  of the synthetic generator — no code changes needed.
- Each labeled sample is joined with trailing-30-day Open-Meteo archive weather
  mapped onto the 32-dim feature space (`ml/training/real_labels.py`).
  Weather is cached to `weather_cache.csv` beside the CSVs, so reruns are free
  and CI-friendly.
- Training uses 5-fold time-series cross-validation (date-ordered); the
  scorecard reports out-of-fold AUC/Brier and the model version becomes
  `v2.x-real-labels` with `training_source: tick-tick-bloom`.
- Spectral features are zeros in this path (satellite TIFF join is future work) —
  the limitation is recorded in the training provenance, not hidden.

## 3. Known gaps vs the competition winners

- Winners used Landsat/Sentinel water-color statistics + elevation; this path
  uses weather + location only. Expect lower skill — honestly reported on the
  scorecard.
- Labels are U.S.-only; pilot waterbodies elsewhere extrapolate.

## 4. Nightly use

The nightly pipeline does **not** train — CI has no labels, and that is
deliberate (label CSVs stay out of git). It runs inference only against the
committed artifacts. Retraining is a manual, local event: point
`TICKTICKBLOOM_DIR` (or `CAML_DIR`) at the labels, run
`scripts/export_artifacts.py`, review the printed OOF metrics, and commit the
regenerated files. The honesty gate (`test_committed_artifacts_are_real`)
fails the build on any synthetic export, so a bad retrain cannot ship
quietly.
