# BloomCast — Architecture

> **Predict-Once, Serve-Static.** Inference runs on a scheduler, never on the
> request path. National weather services predict once and serve millions of
> times; BloomCast does the same.

## Repository layout

```
bloomcast/                         <- git root
├── .github/workflows/             nightly pipeline (free cron; Render can't cron for free)
├── docs/                          this architecture doc + model card + API spec
├── fhir/                          FHIR R4 profile + example bundle
├── scripts/                       generate_seed.py, verify-no-card.sh
├── tests/                         unit + acceptance tests
├── src/
│   ├── backend/                   FastAPI + the ML pipeline
│   │   ├── api/                    /v1/* API surface, SQLite, FHIR builder
│   │   └── ml/                    ingestion, features, training, precompute
│   ├── frontend/                  Next.js static export (Three.js, Framer Motion)
│   └── data/                      waterbodies, streams, replay events, seed/
├── render.yaml                    two free Render services
├── package.json                   npm workspace root
├── pyproject.toml                 uv workspace root
└── turbo.json                     task orchestration
```

## Data flow

```
GitHub Actions · 02:00 UTC · free for public repos
   │  Copernicus Sentinel-2 L2A → NDCI / NDVI / FAI      (free, attribution)
   │  Open-Meteo                                       (CC-BY 4.0, keyless)
   ▼
src/backend/features — feature_store (32 dims)
   │  LightGBM ──┬── isotonic calibration
   │  1D-CNN  ────┘── logistic ensemble
   │  SHAP attribution · counterfactual sweeps · scorecard · FHIR builder
   ▼
src/data/seed/*.json   (committed)
   ▼
Render free web service (FastAPI)   serves static JSON + SQLite for POSTs
   ▼
Render free static site (Next export)  globe, Replay Theatre, Sandbox
```

## Why no on-demand inference

The free Render instance is 512 MB RAM / 0.1 CPU and spins down after 15 min
of idle. Loading model artifacts per request is wasteful, and sharing state
between the scheduler and the server would need a paid disk or managed DB.
Committing the JSON eliminates both. Consequences:

- The API process holds no model in memory; cold starts stay short.
- No persistent disk and no external database are needed. The
  citizen-observation and subscription tables use a local SQLite file rebuilt
  from the committed seed on each deploy. This explicitly trades durability
  for $0 — acceptable for an MVP, documented as a known limitation.
- `NEXT_PUBLIC_API_BASE` is inlined at build time, so the deploy order is
  API-first, then frontend rebuild.

## Component inventory

| Component | Choice | Cost | Notes |
|---|---|---|---|
| Satellite | Copernicus Sentinel-2 L2A | $0 | free incl. commercial, attribution required |
| Weather | Open-Meteo | $0 | CC-BY 4.0, keyless |
| Backend | FastAPI on Render free web service | $0 | spins down after 15 min idle (~30–60 s cold start) |
| Frontend | Next.js static export on Render free static site | $0 | never sleeps |
| Scheduler | GitHub Actions cron | $0 | free for public repos; Render Cron is a paid feature |

## Feature-track coverage

BloomCast is built for Track 6 — Resilience Informatics, with the other
tracks' evidence as first-class features:

| Track | Feature |
|---|---|
| Track 6 (primary) | Replay Theatre, Resilience Sandbox, FHIR alerts, subscriptions, integrity scorecard |
| Track 2 — Data-to-Insight | Forecast dashboard, trend timelines, citizen overlays, One Health summary card |
| Track 3 — AI-Supported Assessment | SHAP top-3 in every forecast card, Ground Truth Loop moderation queue, public model card |

## Responsible AI

BloomCast outputs are advisory support for environmental decision-makers and
do not constitute a safety determination. Always verify with in-situ toxin
testing before issuing swimming, drinking, or recreation advisories.

See `model-card.md` and the in-app **About & Model Card** page.
