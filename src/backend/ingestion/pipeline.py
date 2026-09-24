"""Nightly ingestion pipeline: Sentinel-2 + Open-Meteo + citizen observations."""
import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from features.feature_store import wind_dir_circular_variance

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


async def ingest_waterbody(wb: dict, copernicus: CopernicusClient, meteo: OpenMeteoClient,
                           token: str, spectral_lookup=None) -> dict:
    """Feature row for one waterbody.

    ``spectral_lookup`` is an async callable ``(lat, lon) -> dict`` supplying the
    spectral block. It defaults to the Planetary Computer reader (v2 M-S1),
    which is fail-safe: when there is no scene, or the network is down, the
    block is explicitly flagged instead of silently carrying an invented NDCI.
    Tests inject a stub; nothing here requires credentials.
    """
    lon, lat = wb["properties"]["centroid"]  # GeoJSON stores [lon, lat]
    forecast = await meteo.fetch_forecast(lat, lon, days=14, past_days=3)
    historical = await meteo.fetch_historical(lat, lon, past_days=30)
    hourly_f = forecast.get("hourly", {})
    hourly_h = historical.get("hourly", {})
    daily_f = OpenMeteoClient.aggregate_daily(hourly_f)
    daily_h = OpenMeteoClient.aggregate_daily(hourly_h)

    if spectral_lookup is None:
        spectral_block = await default_spectral_lookup(lat, lon)
    else:
        spectral_block = await spectral_lookup(lat, lon)

    # Weather real; spectral either measured, forward-filled, or explicitly
    # unavailable. No constant NDCI is ever substituted.
    spectral = {
        "ndci_mean": float(spectral_block.get("ndci_mean") or 0.0),
        "ndci_trend_5d": float(spectral_block.get("ndci_trend_5d") or 0.0),
        "ndci_max": float(spectral_block.get("ndci_max") or 0.0),
        "chlorophyll_a_mean": float(spectral_block.get("chlorophyll_a_mean") or 0.0),
        "chlorophyll_a_trend_5d": float(spectral_block.get("chlorophyll_a_trend_5d") or 0.0),
        "ndvi_mean": float(spectral_block.get("ndvi_mean") or 0.0),
        "fai_mean": float(spectral_block.get("fai_mean") or 0.0),
        "ndci_std_7d": float(spectral_block.get("ndci_std_7d") or 0.0),
    }

    return {
        "waterbody_id": wb["properties"]["id"],
        "name": wb["properties"]["name"],
        "region": wb["properties"].get("region", ""),
        "country": wb["properties"].get("country", ""),
        "centroid": wb["properties"]["centroid"],
        "type": wb["type"],
        "spectral": {
            **spectral,
            **{k: spectral_block.get(k) for k in (
                "scene_id", "scene_date", "cloud_cover", "valid_pixel_fraction",
                "scl_masked", "lookback_days", "forward_filled", "reason",
            ) if spectral_block.get(k) is not None},
            "source": spectral_block.get("source", "unavailable"),
        },
        "ndci": round(spectral["ndci_mean"], 4),
        "chlorophyll_a": round(spectral["chlorophyll_a_mean"], 2),
        "ndvi": round(spectral["ndvi_mean"], 4),
        "fai": round(spectral["fai_mean"], 4),
        "ndci_trend_5d": round(spectral["ndci_trend_5d"], 4),
        "forecast": {
            "temp_mean_3d": round(daily_f.get("temperature_2m_mean", 20.0), 2),
            "temp_mean_7d": round(daily_f.get("temperature_2m_mean", 20.0), 2),
            "temp_anomaly_7d": round(daily_f.get("temperature_2m_mean", 20.0) - daily_h.get("temperature_2m_mean", 20.0), 2),
            "wind_speed_mean_3d": round(daily_f.get("wind_speed_10m_mean", 4.0), 2),
            "wind_speed_max_3d": round(daily_f.get("wind_speed_10m_max", 8.0), 2),
            "wind_dir_variance_3d": round(wind_dir_circular_variance(
                [v for v in (hourly_f.get("wind_direction_10m", []) or [])[-72:] if v is not None]
            ), 2),
            "precip_sum_7d": round(daily_f.get("precipitation_sum", 5.0), 2),
            "precip_sum_3d": round(daily_f.get("precipitation_sum", 2.0), 2),
            "dry_days_7d": round(compute_dry_days_antecedent(
                [p or 0.0 for p in (hourly_h.get("precipitation", []) or [])[-720:]]
            ), 1),
            "solar_mean_3d": round(daily_f.get("shortwave_radiation_mean", 150.0), 1),
            "cloud_cover_mean_3d": round(daily_f.get("cloud_cover_mean", 40.0), 1),
            "dewpoint_mean_3d": round(daily_f.get("dewpoint_2m_mean", 12.0), 1),
            "pressure_trend_3d": round(_pressure_trend(hourly_f), 2),
            "growing_degree_days": round(daily_f.get("temperature_2m_mean", 20.0) * 7, 0),
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


def _pressure_trend(hourly: dict) -> float:
    """3-day pressure change from the hourly block (0.0 when unavailable)."""
    press = [v for v in (hourly.get("pressure_msl", []) or []) if v is not None]
    if len(press) < 72:
        return 0.0
    return float(press[-1] - press[-72])


async def default_spectral_lookup(lat: float, lon: float) -> dict:
    """Planetary Computer NDCI read, gated by ``BLOOMCAST_SPECTRAL``.

    ``auto`` (default) attempts the read and degrades to an explicit
    ``unavailable`` status; ``on`` forces the attempt; ``off`` skips it. The
    nightly job therefore stays green with and without network access.
    """
    from shared.config import SPECTRAL_INGEST

    mode = (SPECTRAL_INGEST or "auto").lower()
    if mode == "off":
        return {"source": "disabled", "reason": "BLOOMCAST_SPECTRAL=off",
                "forward_filled": False}
    try:
        from .spectral_pc import fetch_ndci_async

        return await fetch_ndci_async(lat, lon)
    except Exception as exc:  # noqa: BLE001 - ingestion never fails the run
        return {"source": "unavailable", "reason": str(exc), "forward_filled": False}



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


async def run_pipeline(copernicus_token: str | None = None, client_id: str | None = None,
                       client_secret: str | None = None, spectral_lookup=None):
    """Run the nightly ingestion. Returns the raw feature rows per waterbody.

    Note: this performs REAL network calls (Open-Meteo always; Planetary
    Computer for spectral unless disabled). Callers must persist the result —
    this function deliberately does not write, so it stays usable as a library
    by tests.
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
    results = {
        "waterbodies": [],
        "streamflush": [],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "spectral_note": _spectral_note(),
    }
    previous = _previous_spectral_rows()
    for wb in waterbodies:
        row = await ingest_waterbody(wb, copernicus, meteo, token, spectral_lookup)
        block = row.get("spectral", {})
        if block.get("ndci_mean") in (None, 0.0) or block.get("source") in {
            "unavailable", "no-scene", "cloud-covered", "read-failed", "disabled",
        }:
            # No usable scene tonight: carry the last known block forward with
            # the flag set, instead of pretending a zero is a measurement.
            filled = forward_fill(previous.get(row["waterbody_id"]),
                                 block.get("reason") or block.get("source", "no scene"))
            if filled.get("ndci_mean") is not None:
                row["spectral"] = {**block, **filled}
                row["ndci"] = filled.get("ndci_mean")
                row["chlorophyll_a"] = filled.get("chlorophyll_a_mean")
                row["ndci_trend_5d"] = filled.get("ndci_trend_5d")
        results["waterbodies"].append(row)
        # Open-Meteo's free tier rate-limits hard; keep requests gentle and sequential.
        await asyncio.sleep(1.5)
    for seg in segments:
        results["streamflush"].append(await ingest_streamflush(seg, meteo))
    return results


def forward_fill(previous: dict | None, reason: str) -> dict:
    """Re-export of the spectral forward-fill, so ingestion has one definition."""
    from .spectral_pc import forward_fill as _ff

    return _ff(previous, reason)


def _previous_spectral_rows() -> dict:
    """Latest committed spectral blocks, keyed by waterbody (best effort)."""
    path = DATA_DIR / "ingested-features.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    rows = data.get("waterbodies") if isinstance(data, dict) else None
    out = {}
    for row in rows or []:
        if isinstance(row, dict) and isinstance(row.get("spectral"), dict):
            out[row.get("waterbody_id")] = row["spectral"]
    return out


def _spectral_note() -> str:
    from shared.config import SPECTRAL_INGEST

    return (
        "Spectral block from Sentinel-2 L2A via Planetary Computer (anonymous "
        "STAC + windowed COG reads); forward-filled with an explicit flag when "
        f"no usable scene exists. BLOOMCAST_SPECTRAL={SPECTRAL_INGEST}."
    )


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run_pipeline()), indent=2))
