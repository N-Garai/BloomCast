# Training on real labels (Tick Tick Bloom)

By default BloomCast trains on a synthetic stand-in (see `model-card.md`).
To train on real in-situ cyanobacteria labels:

## 1. Download the competition data (login required, do not redistribute)

1. Create a free account at https://www.drivendata.org/competitions/143/tick-tick-bloom/
2. Download `train_labels.csv` (`uid, severity 1–5, density`) and `metadata.csv`
   (`uid, latitude, longitude, date, split, region`).
3. Place both in `src/data/ticktickbloom/` (git-ignored), or anywhere and set:

```bash
export TICKTICKBLOOM_DIR=/path/to/ticktickbloom
```

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

Set `TICKTICKBLOOM_DIR` as a GitHub Actions secret-variable (the CSVs stay out
of git) and the nightly pipeline trains on real labels every refresh. Without
it, the pipeline keeps the synthetic fallback and says so in the scorecard.
