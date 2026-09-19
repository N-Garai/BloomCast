"""BloomCast FastAPI application — deployed on Render free tier."""
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, FileResponse
from fastapi.staticfiles import StaticFiles
import mimetypes

__version__ = "2.0.0"
from shared.config import ALLOWED_ORIGIN
from api import seed
from api.db import insert_observation, list_observations, subscribe, record_influence
from api.fhir import build_alert_bundle

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
    return {
        "status": "ok",
        "version": __version__,
        "model_sha": "v2.0.0-placeholder",
        "last_pipeline_run": "2026-09-18T02:00:00Z",
        "services": {"seed": "ok", "db": "ok"},
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
    return Response(content=b"", media_type="image/webp")


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


@app.post("/v1/citizen/report")
async def citizen_report(request: Request):
    try:
        obs = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    required = ["observation_id", "waterbody_id", "observed_at", "latitude", "longitude", "water_color"]
    if not all(k in obs for k in required):
        return JSONResponse({"error": "Missing required fields"}, status_code=400)
    insert_observation(obs)
    return JSONResponse({"status": "accepted", "observation_id": obs["observation_id"]}, status_code=202)


@app.post("/v1/alerts/subscribe")
async def alert_subscribe(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    if "email" not in body or "waterbody_id" not in body:
        return JSONResponse({"error": "email and waterbody_id required"}, status_code=400)
    token = subscribe(body)
    return JSONResponse({"status": "subscribed", "unsubscribe_token": token}, status_code=201)


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


# NOTE: no @app.get("/") route here. The StaticFiles mount at the bottom of
# this file serves the frontend's index.html for "/", and FastAPI matches in
# registration order — a route registered before the mount would shadow it
# and return the JSON API banner instead of the site.


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