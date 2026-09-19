# `src/data/` — committed datasets and registries

This folder holds the static datasets the API serves. Everything here is
generated or curated — no live network call is needed to run the demo.

## Contents

| Path | What it is | Source |
|---|---|---|
| `waterbodies.geojson` | Pilot waterbody polygons with centroids, region, `has_replay` | curated |
| `stream_segments.geojson` | 5 urban stream segments with `impervious_proxy` | curated |
| `replay_events.json` | Index of documented historical blooms | curated |
| `seed/forecast-<WB>.json` | One forecast per waterbody: probability, CI, SHAP top features | `scripts/generate_seed.py` |
| `seed/sandbox-<WB>.json` | Counterfactual scenario grid (12 scenarios per waterbody) | `scripts/generate_seed.py` |
| `seed/replay-<EVENT>.json` | Day-by-day replay series for a historical event | `scripts/generate_seed.py` |
| `seed/scorecard.json` | Model integrity metrics + baseline comparisons | `scripts/generate_seed.py` |
| `seed/streamflush-<SEG>.json` | Urban stream nowcast per segment | `scripts/generate_seed.py` |
| `seed/fhir-alert-sample.json` | Sample FHIR R4 alert bundle (Communication + Observation + Location) | `scripts/generate_seed.py` |
| `copernicus-cache/` | Cached Sentinel-2 tiles for offline development | gitignored, empty by default |

## How to refresh

```bash
# Regenerate every seed artifact deterministically (no network needed):
python scripts/generate_seed.py

# Or run the full nightly pipeline (ingests real data when credentials exist):
cd src/backend && python -m ml.inference.pipeline_nightly --src <repo root> --out src/data/seed
```

The committed seed is **deterministic synthetic data** so the demo works
without satellite credentials. Real Sentinel-2 / Open-Meteo ingestion is wired
in `src/backend/ingestion/`, and the nightly GitHub Actions workflow calls it —
it degrades to the deterministic seed when `COPERNICUS_USERNAME` /
`COPERNICUS_PASSWORD` are not set.

## Notes

- `copernicus-cache/` is gitignored. Drop cached tiles there for offline work;
  the ingestion client prefers a cache hit over a network fetch.
- Sandbox files exist for a subset of waterbodies (the ones with enough
  baseline data to compute counterfactuals). `GET /v1/sandbox/:wbId` returns a
  clear empty result for the rest rather than failing.
