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

## Intro curtain

Before the hero, a full-bleed boot film plays once per browser session. It is a
client-side sequence only — no API call, no artwork fetch beyond the favicon
chip, and no layout shift — implemented in
`src/frontend/components/brand/Loader.tsx` with styling in
`src/frontend/app/globals.css` (`.bcl-*` rules) and driven by a single GSAP
timeline.

| Act | Time | Content |
|---|---|---|
| 1 · Deep | 0.0–0.55s | Abyss, film grain, two drifting chlorophyll caustics, a single cyan seed, HUD frame with the real `/favicon.svg` chip |
| 2 · Ignition | 0.55–0.95s | The mark blooms in (same geometry as `favicon.svg`), three echo rings expand, horizon hairlines grow out of the mark |
| 3 · Analysis | 0.95–3.15s | `BLOOMCAST` cascades glyph-by-glyph from masked line boxes while tracking settles; NDCI red-edge trace draws, scan sweep crosses the frame, four pipeline log lines stagger in, `000 → 100` counter and progress bar scrub |
| 4 · Type | 3.15–4.55s | The analysis column collapses; `SEE IT` / `COMING.` fills the frame in Bebas Neue with per-glyph rise, a travelling gradient, a chlorophyll bloom behind the type, and a warm flare for colour grading |
| 5 · Settle | 4.55–5.6s | Type collapses, white-cyan flash launders the cut, the mark + wordmark + serif slogan lockup resolves, the gate opens |

**The gate.** The film ends on `SCROLL TO ENTER` (with a looping chevron and,
after 8.4s, an `or press enter` hint) and does *not* dismiss itself. A wheel
gesture, upward swipe, `ArrowDown` / `PageDown` / `Space` / `Enter`, or a click
opens it. Then:

- the page underlay is revealed by a CSS transition (opacity, 1.045 → 1 scale,
  and a vertical aperture `inset(34% 0)` → `inset(0)`), so the reveal finishes
  even if the curtain unmounts mid-animation;
- the curtain itself plays an exit — stage scale + blur out, echo rings to 3.8×,
  a flash, then `clip-path: circle(150%) → circle(0%)`, a bloom closing to a
  point — and unmounts on completion.

**Skip behaviour.** A gesture before the gate does not cut the film. It sets
`timeScale(2.6)` so the remaining acts resolve in about a third of the time and
the exit fires automatically at the gate, so an impatient visitor scrolls once
and still lands on designed frames rather than a cut.

**Access and failure modes.**

- `prefers-reduced-motion: reduce` plays a **calm variant** of the same film
  rather than skipping it: identical beats and copy, cross-fades only, no
  parallax, no 3D glyph rotation, no blur, no scale, and a plain opacity
  cross-fade on exit instead of the iris. It still lands on the scroll gate, so
  the page is still entered deliberately. The curtain carries the loading state
  and the only "enter" affordance, so suppressing it removed information the
  visitor needs; an earlier version did exactly that and left reduce-motion
  visitors with a bare hero.
- Server HTML ships the page hidden, so the first paint before hydration is the
  abyss rather than a flash of the hero. A `<noscript>` rule forces the page
  visible when scripting is off.
- The boot decision happens in a layout effect, so SSR and the first client
  render always agree and hydration never mismatches.
- Scroll is locked (`html.bc-scroll-lock`) while the curtain covers the page, so
  the opening gesture cannot also drag the hero out of position; Lenis starts
  only after the gate opens.
- `gsap.ticker.lagSmoothing(0)` is set for the duration of the film. GSAP's
  default lag smoothing freezes the timeline clock whenever a frame exceeds
  500ms, which stretched the 5.6s film past 10s on a slow machine. Two
  wall-clock guarantees do not depend on the timeline: an arm deadline forces
  the gate open at 6.8s (3.55s calm), and a 22-second watchdog reveals the page
  even if the visitor never interacts.
- Anything the film reveals later starts hidden **in the markup**, not only in
  the animation code. The gate layer carries `opacity-0` because a layout effect
  can still land after the browser has painted the mount: without it, "Scroll to
  enter" flashed at full opacity over Act 1, measured at t=389ms with the counter
  still on 000 — an invitation to scroll before there was anything to scroll past.
- `sessionStorage["bc-booted"]` means the film plays once per session.
- `?intro=off` sets a sticky `localStorage` opt-out; `?intro=on` clears it and
  forces the film on. Useful for QA and for visitors who want to settle the
  question once for the machine.

The film is verified in real headless Chrome over CDP (`.agent/v2/probe.mjs`),
not just by inspecting build output. The default run screenshots each act,
measures the real time from curtain mount to gate arm, dispatches a genuine wheel
or touch gesture, and asserts the settled page state; it also reports any
selector the film animates that the markup never renders, which is how a dead
tween tweening a non-existent `.bcl-flare` was found and removed.

`PROBE_EDGE=1` adds the cases that only appear in the wild, each as a
PASS/FAIL line rather than a screenshot to squint at: a gesture during the film,
Enter, a click, a reload in the same session, `?intro=off` and its stickiness,
`?intro=on` overriding both, and the whole set again under
`prefers-reduced-motion`. `PROBE_TRACE=1` dumps the film's state every 150ms on
the page's own clock, which is how the gate flash was pinned to a specific
millisecond. All 21 edge assertions pass in both motion modes.

Two lessons the harness had to learn, both from false failures: hydration has
measured 2.3s under a software renderer, so nothing may be asserted a fixed
second after navigation; and a gesture sent in the same tick as the mount is
dropped, because the listeners are a passive effect. Waits are on the page's
state, and gestures are sent after the mount is observed.

Copy in the film is restricted to real pipeline stages ("aligning orbital
sensors", "fusing 14-day weather ensemble", "scoring stream wash-off risk",
"calibrating bloom probability") and to the real open-data stack (Sentinel-2,
Open-Meteo, no API key, free tier) — no claim appears that the boot film makes
about accuracy.

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
