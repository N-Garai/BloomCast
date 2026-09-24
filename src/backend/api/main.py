"""BloomCast FastAPI application — deployed on Render free tier."""
import inspect
import json
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, FileResponse, StreamingResponse
import mimetypes

__version__ = "2.0.0"
from shared.config import (
    ALLOWED_ORIGIN,
    BATCH_MAX_LOCATIONS,
    BATCH_THROTTLE_PER_10MIN,
    INFER_CACHE_TTL_S,
    SEED_DIR,
    UPSTREAM_TIMEOUT_S,
)
from api import seed
from api.db import (
    insert_observation,
    list_observations,
    list_pending_observations,
    list_influence,
    subscribe,
    subscriptions_for_email,
    unsubscribe,
    record_influence,
    validate_observation,
)
from api.explore import explore_location
from api.infer import (
    AssessError,
    assess_batch,
    assess_location,
    batch_throttle,
)
from api.fhir import build_alert_bundle
from api.report import NoKeyError as ReportNoKeyError, providers_configured
import api.report as report_api

# Next.js static export. Resolved by walking up from this file until a
# `frontend/out` directory is found, so it works regardless of how deeply the
# repo is nested in the deployment root — Render checks the project out one
# level deeper than local dev, which broke the old fixed-depth path.
_FRONTEND_DIR = None
_candidate = Path(__file__).resolve().parent
for _ in range(8):
    _probe = _candidate / "frontend" / "out"
    if _probe.is_dir():
        _FRONTEND_DIR = _probe
        break
    _candidate = _candidate.parent
if _FRONTEND_DIR is None:
    raise RuntimeError(
        "Could not find frontend/out directory — build the frontend first "
        "(npm run build in src/frontend) or check the deployment layout."
    )

app = FastAPI(
    title="BloomCast API",
    version=__version__,
    description="Predictive early warning for cyanobacteria blooms in urban freshwater.",
    openapi_url="/v1/openapi.json",
    docs_url="/v1/docs",
    redoc_url="/v1/redoc",
)

# Serve the Next.js static export from the same process. The export is flat
# HTML (output: "export"), so StaticFiles handles it directly — no SPA router
# config needed. Registered LAST so /v1/* routes win over the catch-all.
# (The mount is re-asserted at the bottom of the file after every route is
# defined, since FastAPI matches in registration order.)

# NOTE: this middleware must be added BEFORE CORSMiddleware. FastAPI's
# add_middleware inserts at the front of the stack, so later calls wrap
# earlier ones — a redirect middleware added after CORS is never reached,
# because CORS short-circuits the request before it arrives.
class _HtmlRedirectMiddleware:
    """Redirect clean URLs to the Next.js static export's `.html` files.

    `next.config.js` uses `output: "export"`, which emits both `dashboard.html`
    and a `dashboard/` directory. StaticFiles serves the `.html` files but
    returns 404 for the bare directory paths, so a browser visiting `/dashboard`
    lands on a 404 page instead of the dashboard. This rewrites the request
    before it reaches the mount.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope["path"]
        # Never touch API/docs/static asset paths.
        if path.startswith("/v1/") or path.startswith("/_next") or path in ("/", "/404.html"):
            await self.app(scope, receive, send)
            return
        # Already has an extension — let StaticFiles handle it.
        if "." in path.rsplit("/", 1)[-1]:
            await self.app(scope, receive, send)
            return
        # Clean URL for a route page → append .html.
        scope = dict(scope)
        scope["path"] = path + ".html"
        await self.app(scope, receive, send)


app.add_middleware(_HtmlRedirectMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if ALLOWED_ORIGIN == "*" else [ALLOWED_ORIGIN],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/_next/static/{path:path}")
async def serve_next_static(path: str):
    file_path = _FRONTEND_DIR / "_next" / "static" / path
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    if path.endswith(".css"):
        media_type = "text/css"
    elif path.endswith(".js"):
        media_type = "application/javascript"
    elif path.endswith(".svg"):
        media_type = "image/svg+xml"
    elif path.endswith(".html"):
        media_type = "text/html"
    else:
        media_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
    return FileResponse(file_path, media_type=media_type)


@app.get("/favicon.ico")
async def serve_favicon():
    file_path = _FRONTEND_DIR / "favicon.svg"
    if file_path.is_file():
        return FileResponse(file_path, media_type="image/svg+xml")
    raise HTTPException(status_code=404, detail="Not found")


@app.get("/v1/health")
async def health():
    """Liveness + honest model status (v2 M-K1).

    ``model.status`` is ``loaded`` only when the exported artifacts passed the
    feature-compatibility check; otherwise ``fallback`` with the reason. A
    green health check that hides a missing model is worse than a red one.
    """
    from ml.training.artifacts import serving_model_status

    model_status = serving_model_status()
    pipeline_run = None
    try:
        pipeline_run = json.loads((SEED_DIR / "pipeline_run.json").read_text(encoding="utf-8")).get("run_at")
    except (OSError, ValueError, AttributeError):
        pass

    return {
        "status": "ok",
        "version": __version__,
        "model_sha": model_status.get("model_sha"),
        "last_pipeline_run": pipeline_run,
        "services": {"seed": "ok", "db": "ok"},
        "model": model_status,
        "realtime": {
            "infer": "live",
            "cache_ttl_s": INFER_CACHE_TTL_S,
            "upstream_timeout_s": UPSTREAM_TIMEOUT_S,
            "upstream_calls_per_location": 2,
        },
    }


@app.get("/v1/waterbodies")
async def waterbodies(page: int = 1, limit: int = 25, region: str | None = None):
    all_wbs = seed.get_waterbodies()
    if region:
        all_wbs = [w for w in all_wbs if w["properties"].get("region") == region]
    offset = (page - 1) * limit
    page_data = all_wbs[offset:offset + limit]
    return {
        "data": page_data,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": len(all_wbs),
            "has_more": offset + limit < len(all_wbs),
        },
    }


@app.get("/v1/waterbodies/{wb_id}")
async def waterbody(wb_id: str):
    for wb in seed.get_waterbodies():
        if wb["properties"]["id"] == wb_id:
            return wb["properties"]
    raise HTTPException(status_code=404, detail="Not found")


@app.get("/v1/forecast/{wb_id}")
async def forecast(wb_id: str):
    fc = seed.get_forecast(wb_id)
    if not fc:
        raise HTTPException(status_code=404, detail="Not found")
    return fc


@app.get("/v1/forecast/{wb_id}/timeline")
async def forecast_timeline(wb_id: str):
    # The replay index carries waterbody_id but not the day series, so match
    # on the index and then load the full event file.
    for ev in seed.get_replay_events():
        if ev["waterbody_id"] == wb_id:
            full = seed.get_replay(ev["event_id"])
            return {"event_id": ev["event_id"], "days": full.get("days", [])}
    return {"days": []}


@app.get("/v1/forecast/{wb_id}/chip")
async def forecast_chip(wb_id: str):
    """NDCI snapshot chip: a data-driven SVG rendered from the latest replay
    day's satellite NDCI (or the current forecast probability when no replay
    exists). A stylized visualization, not satellite imagery."""
    ndci_val = 0.1
    label = "forecast"
    for ev in seed.get_replay_events():
        if ev["waterbody_id"] == wb_id:
            full = seed.get_replay(ev["event_id"])
            days = full.get("days", [])
            if days:
                last = days[-1]
                ndci_val = float(last.get("satellite_ndci", ndci_val))
                label = str(last.get("date", "satellite"))
            break
    else:
        fc = seed.get_forecast(wb_id) or {}
        ndci_val = float((fc.get("horizons") or {}).get("5d", {}).get("p_bloom", fc.get("p_bloom", 0.1)))
    green = int(120 + 135 * max(0.0, min(1.0, ndci_val)))
    svg = (
        "<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256' viewBox='0 0 256 256'>"
        f"<defs><radialGradient id='c' cx='45%' cy='40%' r='75%'>"
        f"<stop offset='0%' stop-color='rgb(20,{green},140)'/>"
        f"<stop offset='60%' stop-color='rgb(10,{green - 40},90)'/>"
        "<stop offset='100%' stop-color='#02060f'/></radialGradient></defs>"
        "<rect width='256' height='256' fill='#02060f'/>"
        "<rect width='256' height='256' fill='url(#c)'/>"
        f"<text x='12' y='240' font-family='monospace' font-size='13' fill='#9fb8c7'>NDCI {ndci_val:.2f} · {label}</text>"
        "</svg>"
    )
    return Response(content=svg.encode(), media_type="image/svg+xml")


@app.get("/v1/replay/events")
async def replay_events():
    return {"data": seed.get_replay_events()}


@app.get("/v1/replay/{event_id}")
async def replay_event(event_id: str):
    ev = seed.get_replay(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Not found")
    return ev


@app.get("/v1/sandbox/{wb_id}")
async def sandbox(wb_id: str):
    sb = seed.get_sandbox(wb_id)
    if not sb:
        raise HTTPException(status_code=404, detail="Not found")
    return sb


@app.get("/v1/scorecard")
async def scorecard():
    sc = seed.get_scorecard()
    if not sc:
        raise HTTPException(status_code=404, detail="Not found")
    return sc


@app.get("/v1/streamflush")
async def streamflush():
    return {"data": seed.get_all_streamflush()}


@app.get("/v1/streamflush/{seg_id}")
async def streamflush_segment(seg_id: str):
    sf = seed.get_streamflush(seg_id)
    if not sf:
        raise HTTPException(status_code=404, detail="Not found")
    return sf


@app.get("/v1/explore")
async def explore(lat: float, lon: float):
    """Live weather-only assessment for ANY coordinates.

    Fetches realtime Open-Meteo data at request time (no nightly job
    involved) and scores wash-off risk with the StreamFlush heuristic.
    This is a live nowcast, not a calibrated forecast — pilot waterbodies
    (see nearest_waterbody) carry the full 3–7 day model outlook.
    """
    return await explore_location(lat, lon)


def _assess_error_response(exc: AssessError) -> JSONResponse:
    """Structured, human-readable error; never a raw upstream URL."""
    headers = {}
    if exc.retry_after_s:
        headers["Retry-After"] = str(int(exc.retry_after_s))
    return JSONResponse(exc.to_body(), status_code=exc.status_code, headers=headers)


@app.get("/v1/infer")
async def infer(lat: float, lon: float):
    """Realtime assessment for any point on Earth (v2 M1).

    Live weather in 2–4 s, scored on the spot and cached for 15 minutes per
    ~110 m cell. Carries ``provenance``, ``cache`` and ``caveats`` so no number
    can be read without its origin and its staleness.
    """
    try:
        return await assess_location(lat, lon)
    except AssessError as exc:
        return _assess_error_response(exc)


@app.get("/v1/infer/stream")
async def infer_stream(lat: float, lon: float):
    """Server-sent progressive assessment: cached hit → immediate, else staged.

    First frame ("status") is written before any upstream call, so the UI can
    paint inside the 300 ms budget instead of waiting on the weather window.
    """
    import asyncio as _asyncio
    import json as _json

    async def _events():
        yield f"event: status\ndata: {_json.dumps({'stage': 'accepted', 'lat': lat, 'lon': lon})}\n\n"
        task = _asyncio.create_task(assess_location(lat, lon))
        while not task.done():
            await _asyncio.sleep(0.25)
            if task.done():
                break
            yield ": keep-alive\n\n"
        try:
            payload = task.result()
            yield f"event: assessment\ndata: {_json.dumps(payload)}\n\n"
        except AssessError as exc:
            yield f"event: error\ndata: {_json.dumps(exc.to_body())}\n\n"
        except Exception:  # noqa: BLE001 - never leak a stack trace to a browser
            yield ("event: error\ndata: "
                   f"{_json.dumps({'error': 'Assessment failed', 'kind': 'infer-error'})}\n\n")

    return StreamingResponse(_events(), media_type="text/event-stream")


@app.post("/v1/infer/batch")
async def infer_batch(request: Request):
    """Assess up to 50 points in one request (v2 M4).

    Per-IP budget keeps one client from spending the shared upstream quota;
    per-location failures come back in ``errors`` instead of failing the batch.
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    locations = body.get("locations") if isinstance(body, dict) else None
    if not isinstance(locations, list) or not locations:
        return JSONResponse(
            {"error": "Body must be {\"locations\": [{\"lat\": .., \"lon\": ..}, ...]}",
             "kind": "invalid-request"},
            status_code=400,
        )
    if len(locations) > BATCH_MAX_LOCATIONS:
        return JSONResponse(
            {"error": f"At most {BATCH_MAX_LOCATIONS} locations per request.",
             "kind": "invalid-request"},
            status_code=400,
        )

    identity = request.client.host if request.client else "unknown"
    allowed, retry_after = batch_throttle(BATCH_THROTTLE_PER_10MIN).check(identity)
    if not allowed:
        return JSONResponse(
            {"error": "Too many batch requests from this client. "
                      f"Please wait {int(retry_after)}s and try again.",
             "kind": "throttled", "retry_after_s": retry_after},
            status_code=429,
            headers={"Retry-After": str(int(retry_after))},
        )

    try:
        return await assess_batch(locations)
    except AssessError as exc:
        return _assess_error_response(exc)


@app.get("/v1/fhir/Communication/{alert_id}")
async def fhir_bundle(alert_id: str):
    # "sample" returns the committed example bundle; any other id resolves to
    # that waterbody's latest forecast, rendered as a FHIR R4 Communication.
    if alert_id == "sample":
        return seed.get_fhir_sample()
    forecast = seed.get_forecast(alert_id)
    if not forecast:
        raise HTTPException(status_code=404, detail=f"No forecast for {alert_id}")

    horizon_key = "5d"
    horizon = forecast.get("horizons", {}).get(horizon_key, {})
    shap = horizon.get("shap_top_features") or forecast.get("shap_top_features") or []
    p_bloom = float(horizon.get("p_bloom", forecast.get("p_bloom", 0.0)))
    ci_lo = float(horizon.get("ci_lo", forecast.get("ci_lo", p_bloom)))
    ci_hi = float(horizon.get("ci_hi", forecast.get("ci_hi", p_bloom)))
    centroid = forecast.get("centroid") or [0.0, 0.0, 0.0]

    return build_alert_bundle(
        alert_id=f"alert-{alert_id}",
        waterbody_id=alert_id,
        waterbody_name=forecast.get("name", alert_id),
        city="",
        country=forecast.get("country", ""),
        longitude=float(centroid[0]),
        latitude=float(centroid[1]),
        altitude=float(centroid[2]) if len(centroid) > 2 else 0.0,
        horizon_days=int(horizon_key.rstrip("d")),
        p_bloom=p_bloom,
        ci_lo=ci_lo,
        ci_hi=ci_hi,
        threshold=0.5,
        model_version=forecast.get("model_version", __version__),
        sent_at=datetime.now(timezone.utc).isoformat(),
        recipient="bloomcast-alerts@example.org",
        shap_top_features=shap,
    )


@app.get("/v1/citizen/recent")
async def citizen_recent(waterbody_id: str | None = None, limit: int = 20):
    return {"data": list_observations(waterbody_id, limit)}


@app.get("/v1/citizen/queue")
async def citizen_queue(limit: int = 50):
    """Steward moderation queue: reports awaiting validation."""
    return {"data": list_pending_observations(limit)}


@app.get("/v1/citizen/influence")
async def citizen_influence(waterbody_id: str | None = None, limit: int = 20):
    """Ground Truth Loop ledger: how validated reports moved forecasts."""
    return {"data": list_influence(waterbody_id, limit)}


@app.post("/v1/citizen/validate")
async def citizen_validate(request: Request):
    """Steward approve/reject a report. Approved bloom evidence is written to
    the influence log with its estimated probability delta."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    obs_id = body.get("observation_id")
    decision = body.get("decision")
    steward = body.get("steward", "steward")
    if not obs_id or decision not in ("approved", "rejected"):
        return JSONResponse(
            {"error": "observation_id and decision (approved|rejected) required"},
            status_code=400,
        )
    updated = validate_observation(obs_id, steward, decision)
    if updated is None:
        return JSONResponse({"error": "observation not found"}, status_code=404)
    influence = None
    if decision == "approved":
        fc = seed.get_forecast(updated["waterbody_id"]) or {}
        horizon = (fc.get("horizons") or {}).get("5d", {})
        prior = float(horizon.get("p_bloom", fc.get("p_bloom", 0.5)))
        delta = 0.0
        if updated["scum_visible"]:
            delta += 0.08
        if (updated["water_color"] or "") in ("green", "blue-green"):
            delta += 0.04
        if updated["wildlife_dead"]:
            delta += 0.02
        new = round(min(0.97, prior + delta), 4)
        record_influence(
            updated["waterbody_id"], prior, new,
            [obs_id], [updated["observer_id"] or "anonymous"],
        )
        influence = {
            "waterbody_id": updated["waterbody_id"],
            "prior_probability": prior,
            "new_probability": new,
            "probability_delta": round(new - prior, 4),
        }
    return {"status": decision, "observation": updated, "influence": influence}


@app.post("/v1/citizen/report")
async def citizen_report(request: Request):
    try:
        obs = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    required = ["observation_id", "waterbody_id", "observed_at", "latitude", "longitude", "water_color"]
    if not all(k in obs for k in required):
        return JSONResponse({"error": "Missing required fields"}, status_code=400)
    if obs.get("photo_url") and len(str(obs["photo_url"])) > 700 * 1024:
        return JSONResponse({"error": "photo must be under 500 KB"}, status_code=400)
    insert_observation(obs)
    return JSONResponse({"status": "accepted", "observation_id": obs["observation_id"]}, status_code=202)


@app.post("/v1/alerts/subscribe")
async def alert_subscribe(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    if "waterbody_id" not in body:
        return JSONResponse({"error": "waterbody_id required"}, status_code=400)
    try:
        token = subscribe(body)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    return JSONResponse({"status": "subscribed", "unsubscribe_token": token}, status_code=201)


@app.post("/v1/alerts/unsubscribe")
async def alert_unsubscribe(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    if not body.get("token") or not unsubscribe(body["token"]):
        return JSONResponse({"error": "unknown unsubscribe token"}, status_code=404)
    return {"status": "unsubscribed"}


@app.get("/v1/alerts/check")
async def alert_check(email: str | None = None, subscriber_key: str | None = None):
    """Evaluate a subscriber's thresholds against current forecasts.

    Free-tier dispatch: instead of an email service, subscribers (and the
    nightly job) read which thresholds are crossed right now. The identity
    key is anonymous (device ID); a legacy email works the same way.
    """
    identity = subscriber_key or email
    if not identity:
        raise HTTPException(status_code=422, detail="subscriber_key required")
    out = []
    for sub in subscriptions_for_email(identity):
        fc = seed.get_forecast(sub["waterbody_id"]) or {}
        horizon = (fc.get("horizons") or {}).get(f"{sub['horizon_days']}d", {})
        p = horizon.get("p_bloom", fc.get("p_bloom"))
        if p is None:
            continue
        out.append({
            "waterbody_id": sub["waterbody_id"],
            "threshold": sub["threshold"],
            "horizon_days": sub["horizon_days"],
            "current_probability": p,
            "crossed": bool(p >= sub["threshold"]),
        })
    return {"subscriber": identity, "email": identity, "alerts": out}


@app.post("/v1/fhir/bundle")
async def create_fhir_bundle(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    sent_at = datetime.now(timezone.utc).isoformat()
    bundle = build_alert_bundle(
        alert_id=body.get("alert_id", "ad-hoc"),
        waterbody_id=body["waterbody_id"],
        waterbody_name=body.get("waterbody_name", body["waterbody_id"]),
        city=body.get("city", ""),
        country=body.get("country", ""),
        longitude=body.get("longitude", 0),
        latitude=body.get("latitude", 0),
        altitude=body.get("altitude", 0),
        horizon_days=body.get("horizon_days", 5),
        p_bloom=body["p_bloom"],
        ci_lo=body.get("ci_lo", 0),
        ci_hi=body.get("ci_hi", 0),
        threshold=body.get("threshold", 0.6),
        model_version=body.get("model_version", __version__),
        sent_at=sent_at,
        recipient=body["recipient"],
        shap_top_features=body.get("shap_top_features", []),
    )
    return bundle


@app.post("/v1/report")
async def report(request: Request):
    """Generate a grounded report from a server-side assessment."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"error": "Body must be a JSON object"}, status_code=400)
    latitude = body.get("latitude", body.get("lat"))
    longitude = body.get("longitude", body.get("lon"))
    try:
        latitude = float(latitude)
        longitude = float(longitude)
    except (TypeError, ValueError):
        return JSONResponse({"error": "latitude and longitude are required"}, status_code=400)
    if not providers_configured():
        return JSONResponse(
            {"status": "unavailable", "message": "AI reports unavailable",
             "reason": "Set GEMINI_API_KEY or GROQ_API_KEY"},
            status_code=503,
        )
    try:
        assessment = report_api.assess_location(latitude, longitude)
        if inspect.isawaitable(assessment):
            assessment = await assessment
        text, provider, context, area_validation, degradation = await report_api.generate_report(body, assessment)
    except AssessError as exc:
        return _assess_error_response(exc)
    except ReportNoKeyError as exc:
        return JSONResponse({"status": "unavailable", "message": "AI reports unavailable",
                             "reason": str(exc)}, status_code=503)
    except Exception as exc:  # noqa: BLE001 - provider failure becomes a clear degraded response
        return JSONResponse({"status": "unavailable", "message": "AI reports unavailable",
                             "reason": f"report provider failed: {report_api.sanitize_error(exc)}"}, status_code=502)
    return {
        "status": "ok",
        "report": text,
        "provider": provider,
        "context": context,
        "area_validation": area_validation,
        "degraded": degradation,
    }


# NOTE: no @app.get("/") route here. The StaticFiles mount at the bottom of
# this file serves the frontend's index.html for "/", and FastAPI matches in
# registration order — a route registered before the mount would shadow it
# and return the JSON API banner instead of the site.


# Catch-all for frontend pages and static assets. Registered LAST so /v1/*
# routes win. The _HtmlRedirectMiddleware rewrites clean URLs to .html before
# this route sees the request.
@app.get("/{full_path:path}")
async def serve_frontend(request: Request, full_path: str):
    if full_path.startswith("v1/") or full_path.startswith("_next/") or full_path.startswith("docs/"):
        raise HTTPException(status_code=404, detail="Not found")
    file_path = _FRONTEND_DIR / full_path
    if full_path and file_path.is_file():
        return FileResponse(file_path)
    return FileResponse(_FRONTEND_DIR / "index.html")