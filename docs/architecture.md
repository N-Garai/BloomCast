# BloomCast — Architecture

> **Hybrid serving, not predict-once/serve-static.** Open-Meteo weather is
> fetched at request time and scored with a transparent StreamFlush heuristic.
> Optional exported model artifacts can add a weather-only estimate. Satellite
> spectral observations are ingested on a schedule; request-time spectral input
> is a labelled climatology prior.

## Repository layout

```text
bloomcast/                         <- git root
├── .github/workflows/             nightly scheduled ingestion and refresh
├── docs/                          architecture, model card, API spec
├── fhir/                          FHIR R4 profile + example bundle
├── scripts/                       seed and climatology generators
├── tests/                         import and data-integrity tests
├── src/
│   ├── backend/                   FastAPI + ML pipeline
│   │   ├── api/                   routes, inference, SQLite, FHIR
│   │   ├── ml/                    ingestion, training, inference, artifacts
│   │   └── {features,ingestion,shared}
│   ├── frontend/                  Next.js static export
│   └── data/                      curated data, seed, spectral history/prior
├── render.yaml                    single Docker service blueprint
├── package.json                   npm workspace root
├── pyproject.toml                 uv workspace root
└── turbo.json                     task orchestration
```

## Serving boundary

The request path never calls Copernicus, Planetary Computer, or another
satellite service. This keeps the free-tier container from depending on
seconds-to-minutes raster work and makes cloud/no-scene behavior deterministic.

For one location, `/v1/infer` performs two concurrent Open-Meteo requests:

1. a forecast request containing the trailing 72 hours and seven forecast
   days; and
2. a 30-day archive request for the anomaly baseline.

The response is cached in process for 15 minutes by a rounded coordinate key
(nominal ~110 m grid resolution). A cache hit exposes `cache.age_s`; expired
entries are recomputed. Batch requests use bounded concurrency and a separate
per-identity throttle.

The assessment always produces the StreamFlush wash-off score and seven-day
weather trajectory. If compatible exported artifacts exist, the same live
feature row is also scored by the exported model and returned as
`model_estimate`. Artifact loading is lazy and mtime-checked once per process;
there is no training on the request path. If artifacts are absent, incomplete,
or feature-incompatible, the response contains only the heuristic and an
explicit caveat.

## Data flow

```text
Scheduled: GitHub Actions · 02:00 UTC · free for public repositories
    │
    ├── Open-Meteo forecast/archive → weather feature rows
    ├── Planetary Computer Sentinel-2 (optional) → measured spectral rows
    ▼
src/data/ingested-features.json
    ├── scripts/generate_climatology.py
    │      └── src/data/climatology.json
    └── scripts/generate_seed.py
           └── src/data/seed/*.json
    ▼
FastAPI serves committed seed data for pilot records, scorecards, replay, and
sandbox content.

Request path:
    viewer lat/lon
      → GET /v1/infer or GET /v1/explore
      → Open-Meteo (2 calls)
      → live weather + committed climatology prior + static defaults
      → StreamFlush heuristic
      → optional exported model estimate
      → response with provenance, cache, spectral_prior, and caveats
```

The nightly workflow is reduced rather than deleted: it maintains scheduled
ingestion, seed regeneration, and spectral-prior refresh. It does not provide
the request-time weather window or claim live satellite input.

## Component inventory

| Component | Choice | Cost | Notes |
|---|---|---|---|
| Weather | Open-Meteo | $0 | keyless; forecast/archive; CC-BY 4.0 |
| Satellite | Planetary Computer Sentinel-2 L2A | $0 | anonymous STAC + bounded windowed reads; optional and scheduled |
| Spectral prior | committed `climatology.json` | $0 | measured seasonal means when available, otherwise modelled fallback |
| Backend | FastAPI in one Render Docker service | $0 | serves API and built Next.js frontend |
| Frontend | Next.js static export | $0 | built during image build; no server router required |
| Scheduler | GitHub Actions cron | $0 | public-repository free tier; Render Cron is not required |
| Cache | in-process TTL dictionary | $0 | 15-minute default; never presented without age metadata |
| Model artifacts | optional committed files under `ml/artifacts/` | $0 | lazy singleton; absent/incompatible artifacts trigger heuristic fallback |

## Reliability and failure modes

- Upstream 429 responses honor `Retry-After` with jittered backoff. Persistent
  rate limiting becomes a friendly `upstream-busy` response.
- The 30-day archive is time-boxed to three seconds during request-time
  inference; its status is included in `past_30d.status` and caveats.
- Spectral ingestion is fail-safe. Missing scenes, clouds, or raster errors are
  labelled and may be forward-filled with an explicit flag; they are never
  presented as fresh measurements.
- Local SQLite is process-local and rebuilt from committed seed data on deploy.
  It is suitable for the demo, not durable multi-instance storage.
- `/v1/health` reports model status as `loaded` or `fallback` with the reason,
  so a green liveness check cannot hide a missing model.

## Feature-track coverage

BloomCast targets Track 6 — Resilience Informatics — while retaining the other
tracks' evidence as first-class features:

| Track | Feature |
|---|---|
| Track 6 (primary) | Replay Theatre, Resilience Sandbox, FHIR alerts, subscriptions, integrity scorecard |
| Track 2 — Data-to-Insight | Forecast dashboard, trend timelines, citizen overlays, One Health summary card |
| Track 3 — AI-Supported Assessment | Driver evidence, Ground Truth Loop, public model card, provenance-labelled assessments |

## Responsible AI

BloomCast outputs are advisory support for environmental decision-makers and
do not constitute a safety determination. Always verify with in-situ toxin
testing before issuing swimming, drinking, or recreation advisories.

See `model-card.md` and the in-app **About & Model Card** page.
