# `src/data/` — committed datasets and registries

This folder holds curated datasets and generated artifacts used by the API.
The demo does not need live satellite credentials, but scheduled ingestion can
append measured spectral records and rebuild the committed outputs.

## Contents

| Path | What it is | Source |
|---|---|---|
| `waterbodies.geojson` | Pilot waterbody polygons with centroids, region, `has_replay` | curated |
| `stream_segments.geojson` | 5 urban stream segments with `impervious_proxy` | curated |
| `replay_events.json` | Index of documented historical blooms | curated |
| `seed/forecast-<WB>.json` | Pilot probability, CI, and driver output | `scripts/generate_seed.py` |
| `seed/sandbox-<WB>.json` | Counterfactual scenario grid | `scripts/generate_seed.py` |
| `seed/replay-<EVENT>.json` | Day-by-day replay series | `scripts/generate_seed.py` |
| `seed/scorecard.json` | Model integrity metrics and baselines | `scripts/generate_seed.py` |
| `seed/streamflush-<SEG>.json` | Urban-stream heuristic nowcast | `scripts/generate_seed.py` |
| `seed/fhir-alert-sample.json` | Sample FHIR R4 alert bundle | `scripts/generate_seed.py` |
| `ingested-features.json` | Latest scheduled weather/spectral feature rows | nightly pipeline |
| `spectral_history.json` | Rolling measured spectral records | scheduled Planetary Computer ingestion |
| `climatology.json` | Request-time spectral prior table | `scripts/generate_climatology.py` |
| `copernicus-cache/` | Cached Sentinel-2 tiles for offline development | gitignored, empty by default |

## How to refresh

```bash
# Regenerate deterministic pilot seed artifacts without network access:
python scripts/generate_seed.py

# Run scheduled weather/spectral ingestion, then regenerate seed and prior:
python -m ml.inference.pipeline_nightly --src <repo root> --out src/data/seed
python scripts/generate_climatology.py
```

`pipeline_nightly.py` writes the latest rows to `src/data/ingested-features.json`
and invokes `scripts/generate_seed.py`. The GitHub Actions workflow runs the
same refresh at 02:00 UTC and commits only meaningful payload changes.

The committed seed is **deterministic synthetic data** unless compatible
real-label artifacts are present. Open-Meteo is used for scheduled weather
ingestion; Planetary Computer Sentinel-2 ingestion is optional and fail-safe.
Without usable credentials or network access, ingestion records an explicit
status instead of inventing satellite values.

The current `spectral_history.json` has no measured records. Therefore
`climatology.json` contains the documented `latitude-season-fallback` model,
not observations. Once three or more waterbodies have measured records, the
generator can publish measured seasonal means while retaining sample counts
and thin-month caveats.

## Notes

- `copernicus-cache/` is gitignored. Drop cached tiles there for offline work;
  ingestion prefers a cache hit over a network fetch.
- Request-time inference reads `climatology.json`; it never performs a live
  satellite read.
- Sandbox files exist for a subset of waterbodies. `GET /v1/sandbox/:wbId`
  returns an explicit empty result for the rest rather than failing.
