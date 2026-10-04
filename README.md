# BloomCast

**Algal bloom (cyanobacteria) early warning.** Advisory bloom-risk assessment,
3–7 day pilot forecasts, counterfactual intervention planning, and FHIR R4 alert
bundles for water utilities and public-health offices. The demo runs on free
tiers — **no credit card required anywhere**.

> Hybrid serving: request-time Open-Meteo weather powers a transparent
> StreamFlush heuristic for any coordinate. An exported model estimate is added
> only when compatible real-label artifacts are present. Satellite spectral data
> is ingested on a schedule; request-time spectral input is a labelled
> climatology prior, not a live satellite reading.

---

## Repository layout

```text
bloomcast/                        <- git root
├── .github/workflows/            nightly ingestion and seed refresh
├── docs/                         architecture, model card, API spec
├── fhir/                         FHIR R4 profile + example bundle
├── scripts/                      seed/climatology generators and audits
├── tests/                        import and data-integrity suite
├── src/
│   ├── backend/                  FastAPI app and ML pipeline
│   │   ├── api/                  API routes, inference, database, FHIR
│   │   ├── ml/{training,inference}
│   │   └── {shared,ingestion,features}
│   ├── frontend/                 Next.js static export
│   └── data/                     curated data, seed, and spectral priors
├── package.json                  npm workspace root
├── pyproject.toml                uv workspace root
├── turbo.json                    pipeline tasks
├── render.yaml                   single Docker deployment blueprint
└── .env.example                  optional environment variables
```

Render uses one Docker service: it builds the Next.js static export and runs
FastAPI in the same container. The backend serves the built frontend at runtime.

## Track alignment

**Primary: Track 6 — Resilience Informatics.** BloomCast is an early-warning
and resilience-planning system for a public-health hazard, which is what that
track asks for. Requirements it answers, one line each:

- **Predictive dashboard** — probabilistic 3–7 day bloom forecasts per pilot
  waterbody (`/dashboard`), with SHAP driver bars, confidence intervals, and a
  published scorecard comparing the model against climatology, persistence and
  weather-only baselines.
- **Alerts** — threshold subscriptions (`/alerts`) with FHIR R4 `Communication`
  bundles carrying model version, lead time and confidence interval, so an alert
  is actionable *and* auditable.
- **Resilience tools** — a counterfactual Resilience Sandbox (`/sandbox`) that
  projects high-risk days under temperature/nutrient scenarios, a Replay Theatre
  (`/replay`) for past confirmed blooms, and an urban-stream StreamFlush nowcast
  (`/streamflush`). These are planning tools, not predictions, and the UI says so.

**Secondary fit:**

- **Track 7 — Digital Health Standards.** `/fhir` emits and displays FHIR R4
  bundles against a committed `StructureDefinition` profile
  (`fhir/StructureDefinition-bloomcast-alert.json`), and every exported bundle
  self-validates its conformance.
- **Track 2 — Data-to-Insight.** The dashboard, vector map
  and globe render all pilot sites; the One Health summary sets live
  water-quality forecasts beside stream wash-off risk and alert readiness,
  so the human-facing risk reads next to the ecological signal.
- **Track 3 — AI-Supported Assessment.** Reports are generated only from a
  server-side assessment, every claim is checked against an area-validation
  step, SHAP drivers explain each estimate, and a steward queue approves or
  rejects each citizen observation — human judgment stays in the loop. The
  steward decision is not cosmetic: validated reports become training sample
  weights, capped at 15% of total weight, and the realised share is published on
  the scorecard.
- **Track 5 — Community & Gamification (partial).** No points, badges, or
  challenges — this is not claimed as gamification. The participation loop is
  real: report → steward validation → visible influence on the scorecard, plus a
  threshold watch with phone alerts that rewards coming back. Engagement
  mechanics, not game mechanics.

Copy this section verbatim into the Devpost description so both declare the same
thing.

## QA and demo notes

If you want to skip the intro film, append `?intro=off` to any URL:

```
http://localhost:8000/?intro=off          # sticky; stored on this device
http://localhost:8000/scorecard?intro=on  # force the film back, clearing the opt-out
```

The intro is session-gated on its own, so a normal reload in the same tab skips
it while a hard refresh (F5 / Ctrl+Shift+R) replays it. An early scroll or click
never cuts the film short — it compresses the remaining beats so you still see
every designed frame, and the skip affordance is advertised from the first act
so you know it is available.

`prefers-reduced-motion` is honoured by removing motion, not information: the
intro plays a shorter, opacity-only version of the same beats rather than
disappearing.

## Quick start (local, no services)

```bash
# backend ------------------------------------------------------------------
cd src/backend
uv venv .venv --python 3.11
uv pip install -r requirements.txt
./.venv/Scripts/python.exe -m uvicorn api.main:app --port 8000

# frontend -----------------------------------------------------------------
cd ../frontend
npm install --legacy-peer-deps
npm run build        # static export -> src/frontend/out
npm run dev          # or serve the static out/ directory

# verify nothing needs a credit card --------------------------------------
cd ../../..
bash scripts/verify-no-card.sh

# test suite ---------------------------------------------------------------
python -m pytest tests -q      # run from the repository root
```

The backend requires the frontend build to start because it serves the static
export. The committed data files keep the API usable without satellite
credentials; live weather calls are made only when an inference endpoint is
used.

## What's here

| Capability | Where | Current status |
|---|---|---|
| Realtime assessment for any coordinate | `src/backend/api/infer.py` | implemented; live weather + StreamFlush heuristic |
| Compatible `GET /v1/explore` | `src/backend/api/explore.py` | compatibility layer over realtime inference |
| Optional exported model estimate | `src/backend/ml/inference/predict.py` | artifact-gated; heuristic fallback when absent |
| Spectral climatology prior | `src/backend/ingestion/climatology.py`, `src/data/climatology.json` | measured seasonal means for 22 pilots (Sep 2026 scenes); 2 US pilots on modelled fallback until a clearer week |
| Nightly ingestion and seed refresh | `.github/workflows/pipeline.yml` | scheduled at 02:00 UTC; fail-safe |
| Probabilistic 3–7 day pilot forecast | `src/data/seed/forecast-*.json` | static snapshots regenerated by the nightly job from the committed real-label model |
| Counterfactual intervention planning | `src/backend/ml/training/counterfactual.py` | planning scenarios, not predictions |
| Replay Theatre | `src/frontend/app/replay/` | static replay data and UI |
| Resilience Sandbox | `src/frontend/app/sandbox/` | scenario grid, not a forecast |
| Model scorecard with baselines | `src/data/seed/scorecard.json` | real-label out-of-fold metrics vs climatology, persistence, weather-only (current values live in the file, not here) |
| StreamFlush urban-stream nowcast | `src/backend/ingestion/streamflush.py` | heuristic risk score, not a calibrated probability |
| FHIR R4 alert bundles | `fhir/`, `src/backend/api/fhir.py` | implemented, self-validating |
| Citizen ground-truth reporting | `src/backend/api/db.py` + citizen endpoints in `src/backend/api/main.py` | steward-approved reports become capped training weights |
| Alert subscriptions | `src/backend/api/main.py` | implemented; no email/push dispatch |

## Free-tier guarantee

Every external service used by the shipped workflow has a free tier and none
requires a payment card:

| Service | Purpose | Plan |
|---|---|---|
| Render | FastAPI and static frontend in one Docker service | free |
| GitHub Actions | nightly ML/ingestion pipeline | free for public repositories |
| Open-Meteo | keyless weather forecast and archive | free; CC-BY 4.0 |
| Planetary Computer / Sentinel-2 | optional scheduled spectral ingestion | anonymous STAC and range reads; attribution required |
| Copernicus Data Space | optional authenticated spectral workflow | free registration; no card |

`bash scripts/verify-no-card.sh` enforces this invariant in CI. Open-Meteo is
used by the request path for live weather and by scheduled ingestion. Planetary
Computer is scheduled only; BloomCast never performs a per-request satellite
read.

## Data and honesty boundaries

Seed files under `src/data/seed/*.json` are static snapshots regenerated by
the nightly job from the committed model — they are how the demo works
without live credentials, not live numbers. The spectral prior
(`src/data/climatology.json`) carries measured seasonal means for 22 pilots
from September 2026 Sentinel-2 scenes; 2 US pilots stay on the modelled
latitude × month fallback until a clearer week, and the file says which is
which. `scripts/generate_climatology.py` rebuilds the table from
`spectral_history.json` and `ingested-features.json`; re-run it before
judging week so scene dates stay fresh.

The realtime response always includes:

- `provenance`: `live-heuristic-nowcast`, `weather-only-model`, or the
  `full-32` pilot tier;
- `tier` + `input_availability`: which model scored and what each input
  block was (live, measured scene, seasonal prior, or absent);
- `cache`: fetch time, age, and TTL;
- `caveats`: including the distinction between heuristic and model output; and
- `spectral_prior`: measured, modelled, or unavailable.

The top-level `is_calibrated` field remains `false` for arbitrary-coordinate
assessments: outside pilot calibration no estimate is presented as a
calibrated forecast, whatever the tier.

## Deployment checklist

For a Render deployment:

1. Build the frontend with `npm run build` in `src/frontend`.
2. Keep `src/data/waterbodies.geojson`, `stream_segments.geojson`,
   `replay_events.json`, `seed/`, `climatology.json`, and
   `spectral_history.json` in the image.
3. Real-label model artifacts ship committed in
   `src/backend/ml/artifacts/` (`training_source: tick-tick-bloom`).
   `/v1/health` must report `loaded` and an inference request must return
   `model_estimate`; if artifacts are ever removed, the documented
   heuristic fallback is expected instead of a failure.
4. Confirm `/v1/health` is green and `/v1/infer?lat=...&lon=...` returns a
   labelled response. Do not treat a missing model as a deployment failure:
   the health response must explain the fallback.
5. Run the nightly workflow only when scheduled data refreshes are desired. It
   ingests weather and optional spectral data, regenerates seed artifacts, and
   rebuilds the spectral climatology prior.

## License

Apache License 2.0 — see `LICENSE`.
