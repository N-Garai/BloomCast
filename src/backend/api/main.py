"""BloomCast FastAPI application — deployed on Render free tier."""
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

__version__ = "2.0.0"
from shared.config import ALLOWED_ORIGIN
from api import seed
from api.db import insert_observation, list_observations, subscribe, record_influence
from api.fhir import build_alert_bundle

app = FastAPI(
    title="BloomCast API",
    version=__version__,
    description="Predictive early warning for cyanobacteria blooms in urban freshwater.",
    openapi_url="/v1/openapi.json",
    docs_url="/v1/docs",
    redoc_url="/v1/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if ALLOWED_ORIGIN == "*" else [ALLOWED_ORIGIN],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


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


@app.get("/")
async def root():
    return {"name": "BloomCast API", "version": __version__, "docs": "/docs"}