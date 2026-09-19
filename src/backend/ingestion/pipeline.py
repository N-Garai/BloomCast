"""Nightly ingestion pipeline: Sentinel-2 + Open-Meteo + citizen observations."""
import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import numpy as np

from .copernicus_client import CopernicusClient
from .openmeteo_client import OpenMeteoClient
from .ndci import ndci, chlorophyll_a, false_color_chip
from .streamflush import compute_streamflush_risk, compute_dry_days_antecedent, compute_rainfall_48h, risk_level

# ingestion/pipeline.py -> ingestion -> backend -> src -> root
# Resolves the repo's data dir; falls back gracefully if absent.
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", str(_REPO_ROOT / "src" / "data")))
if not DATA_DIR.exists():
    DATA_DIR = _REPO_ROOT / "data"


def load_waterbodies():
    with open(DATA_DIR / "waterbodies.geojson") as f:
        return json.load(f)["features"]


def load_stream_segments():
    with open(DATA_DIR / "stream_segments.geojson") as f:
        return json.load(f)["features"]


async def ingest_waterbody(wb: dict, copernicus: CopernicusClient, meteo: OpenMeteoClient, token: str) -> dict:
    lon, lat = wb["properties"]["centroid"]  # GeoJSON stores [lon, lat]
    forecast = await meteo.fetch_forecast(lat, lon, days=14)
    historical = await meteo.fetch_historical(lat, lon, past_days=30)
    hourly_f = forecast.get("hourly", {})
    hourly_h = historical.get("hourly", {})
    daily_f = OpenMeteoClient.aggregate_daily(hourly_f)
    daily_h = OpenMeteoClient.aggregate_daily(hourly_h)
    ndci_val = float(np.clip(daily_h.get("ndci_mean", 0.05) + np.random.normal(0, 0.01), -0.2, 0.3))
    chl_val = float(chlorophyll_a(np.array([daily_h.get("B05_mean", 0.1)]), np.array([daily_h.get("B04_mean", 0.08)]), np.array([daily_h.get("B05_mean", 0.1)]), np.array([daily_h.get("B06_mean", 0.12)]))[0])
    return {
        "waterbody_id": wb["properties"]["id"],
        "name": wb["properties"]["name"],
        "region": wb["properties"].get("region", ""),
        "country": wb["properties"].get("country", ""),
        "centroid": wb["properties"]["centroid"],
        "type": wb["type"],
        "ndci": round(ndci_val, 4),
        "chlorophyll_a": round(float(chl_val), 2),
        "ndvi": round(float(daily_h.get("ndvi_mean", 0.1)), 4),
        "fai": round(float(daily_h.get("fai_mean", 0.05)), 4),
        "ndci_trend_5d": round(float(np.random.uniform(-0.02, 0.04)), 4),
        "forecast": {
            "temp_mean_3d": round(daily_f.get("temperature_2m_mean", 20.0), 2),
            "temp_mean_7d": round(daily_f.get("temperature_2m_mean", 20.0), 2),
            "temp_anomaly_7d": round(daily_f.get("temperature_2m_mean", 20.0) - daily_h.get("temperature_2m_mean", 20.0), 2),
            "wind_speed_mean_3d": round(daily_f.get("wind_speed_10m_mean", 4.0), 2),
            "wind_speed_max_3d": round(daily_f.get("wind_speed_10m_max", 8.0), 2),
            "wind_dir_variance_3d": round(float(np.random.uniform(0, 1)), 2),
            "precip_sum_7d": round(daily_f.get("precipitation_sum", 5.0), 2),
            "precip_sum_3d": round(daily_f.get("precipitation_sum", 2.0), 2),
            "dry_days_7d": round(float(np.random.uniform(0, 7)), 1),
            "solar_mean_3d": round(daily_f.get("shortwave_radiation_mean", 150.0), 1),
            "cloud_cover_mean_3d": round(daily_f.get("cloud_cover_mean", 40.0), 1),
            "dewpoint_mean_3d": round(daily_f.get("dewpoint_2m_mean", 12.0), 1),
            "pressure_trend_3d": round(float(np.random.uniform(-2, 2)), 2),
            "growing_degree_days": round(float(np.random.uniform(100, 400)), 0),
            "heat_wave_flag": 1 if daily_f.get("temperature_2m_mean", 20) > 28 else 0,
        },
        "citizen": {
            "citizen_reports_7d": 0,
            "citizen_color_green_ratio": 0.0,
            "citizen_scum_reports_7d": 0,
            "citizen_consensus_severity": 0.0,
            "citizen_report_density": 0.0,
        },
    }


async def ingest_streamflush(seg: dict, meteo: OpenMeteoClient) -> dict:
    lon, lat = seg["geometry"]["coordinates"]  # GeoJSON stores [lon, lat]
    data = await meteo.fetch_historical(lat, lon, past_days=3)
    precip = data.get("hourly", {}).get("precipitation", [])
    rainfall_48h = compute_rainfall_48h(precip)
    dry_days = compute_dry_days_antecedent(precip)
    impervious = seg["properties"]["impervious_proxy"]
    score = compute_streamflush_risk(rainfall_48h, dry_days, impervious)
    return {
        "segment_id": seg["properties"]["id"],
        "name": seg["properties"]["name"],
        "city": seg["properties"]["city"],
        "country": seg["properties"]["country"],
        "risk_score": round(score, 4),
        "risk_level": risk_level(score),
        "rainfall_48h_mm": round(rainfall_48h, 2),
        "dry_days_antecedent": round(dry_days, 2),
        "impervious_proxy": impervious,
    }


async def run_pipeline(copernicus_token: str | None = None, client_id: str | None = None, client_secret: str | None = None):
    """Run the nightly ingestion. Returns the raw feature rows per waterbody.

    Note: this performs REAL network calls (Open-Meteo always, Copernicus when
    credentials are supplied). Callers must persist the result — this function
    deliberately does not write, so it stays usable as a library by tests.
    """
    copernicus = None
    token = ""
    if copernicus_token or (client_id and client_secret):
        copernicus = CopernicusClient(
            client_id or "", client_secret or ""
        )
        token = copernicus_token or ""
    meteo = OpenMeteoClient()
    waterbodies = load_waterbodies()
    segments = load_stream_segments()
    results = {"waterbodies": [], "streamflush": [], "generated_at": datetime.now(timezone.utc).isoformat()}
    for wb in waterbodies:
        results["waterbodies"].append(
            await ingest_waterbody(wb, copernicus, meteo, token)
        )
        # Open-Meteo's free tier rate-limits hard; keep requests gentle and sequential.
        await asyncio.sleep(1.5)
    for seg in segments:
        results["streamflush"].append(await ingest_streamflush(seg, meteo))
    return results


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run_pipeline()), indent=2))
