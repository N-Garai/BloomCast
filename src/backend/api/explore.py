"""Live location explorer — realtime weather-only assessment for any coordinates.

Unlike the precomputed pilot-waterbody forecasts (nightly seed JSON served by
``api.seed``), this endpoint fetches LIVE Open-Meteo data at request time, on
every call. No satellite imagery and no calibrated model are involved, so the
output is a StreamFlush-style heuristic nowcast plus bloom-favorable weather
signals — clearly labeled as such, never as a calibrated probability.
"""
import asyncio
import math
from datetime import datetime, timezone

from fastapi import HTTPException

from api import seed
from ingestion.openmeteo_client import OpenMeteoClient
from ingestion.streamflush import (
    compute_dry_days_antecedent,
    compute_rainfall_48h,
    compute_streamflush_risk,
    risk_level,
)

# Land cover is unknown for an arbitrary point, so the wash-off score assumes
# a neutral value and says so in the response.
IMPERVIOUS_ASSUMED = 0.5

# Calm winds mean low mixing, which favors surface scum formation.
CALM_WIND_MS = 3.0
# Same heat-wave threshold the nightly pipeline uses for its feature rows.
HEAT_WAVE_C = 28.0


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def nearest_waterbody(lat: float, lon: float) -> dict | None:
    """Closest pilot waterbody with a calibrated forecast, if any."""
    best: dict | None = None
    best_d = float("inf")
    for f in seed.get_waterbodies():
        props = f.get("properties", {}) if isinstance(f, dict) else {}
        c = props.get("centroid") or []
        if len(c) != 2:
            continue
        try:
            # GeoJSON order: centroid is [lon, lat].
            d = _haversine_km(lat, lon, float(c[1]), float(c[0]))
        except (TypeError, ValueError):
            continue
        if d < best_d:
            best_d = d
            best = {
                "id": props.get("id"),
                "name": props.get("name"),
                "distance_km": round(d, 1),
            }
    return best


def _num_list(values: list) -> list:
    out = []
    for v in values or []:
        if v is None:
            continue
        try:
            out.append(float(v))
        except (TypeError, ValueError):
            continue
    return out


def build_daily_outlook(
    hist_precip: list,
    fc_precip: list,
    fc_times: list,
    fc_temps: list,
    fc_winds: list,
) -> list:
    """7-day risk trajectory from the forecast window.

    For each forecast day, wash-off risk is scored from the trailing 48 h of
    rainfall (history + forecast stitched together) and the antecedent dry
    days counted back through the same stitched series — the same formula as
    the nightly StreamFlush engine, rolled forward day by day. Pure function,
    no network: unit-testable.
    """
    hist_precip = [float(p) for p in hist_precip]
    fc_precip = [float(p) for p in fc_precip]
    combined = hist_precip + fc_precip
    hist_hours = len(hist_precip)
    days = []
    for d in range(7):
        end = hist_hours + (d + 1) * 24
        window = combined[max(0, end - 48):end]
        rain = float(sum(window))
        dry_h = 0
        for p in reversed(combined[: max(0, end - 48)]):
            if p < 0.1:
                dry_h += 1
            else:
                break
        dry_days = min(dry_h / 24.0, 14.0)
        score = compute_streamflush_risk(rain, dry_days, IMPERVIOUS_ASSUMED)
        day_slice = slice(d * 24, (d + 1) * 24)
        day_temps = _num_list(fc_temps[day_slice])
        day_winds = _num_list(fc_winds[day_slice])
        label = str(fc_times[d * 24])[:10] if len(fc_times) > d * 24 else f"+{d + 1}d"
        days.append(
            {
                "date": label,
                "risk_score": round(score, 4),
                "risk_level": risk_level(score),
                "rain_mm": round(sum(_num_list(fc_precip[day_slice])), 1),
                "temp_max_c": round(max(day_temps), 1) if day_temps else None,
                "wind_mean_ms": round(sum(day_winds) / len(day_winds), 2) if day_winds else None,
            }
        )
    return days


async def explore_location(lat: float, lon: float) -> dict:
    """Fetch live weather for any point and score it. Raises HTTPException."""
    if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
        raise HTTPException(
            status_code=400,
            detail="lat must be in [-90, 90] and lon in [-180, 180]",
        )

    meteo = OpenMeteoClient()
    try:
        hist, fc, arch = await asyncio.gather(
            meteo.fetch_historical(lat, lon, past_days=3),
            meteo.fetch_forecast(lat, lon, days=7),
            meteo.fetch_historical(lat, lon, past_days=30),
        )
    except Exception as exc:  # noqa: BLE001 - upstream outage becomes a 502
        raise HTTPException(
            status_code=502, detail=f"live weather unavailable: {exc}"
        ) from exc

    precip_hist = _num_list((hist.get("hourly", {})).get("precipitation", []))
    rainfall_48h = compute_rainfall_48h(precip_hist)
    dry_days = compute_dry_days_antecedent(precip_hist)
    score = compute_streamflush_risk(rainfall_48h, dry_days, IMPERVIOUS_ASSUMED)

    hourly = fc.get("hourly", {})
    fc_precip = _num_list(hourly.get("precipitation", []))
    fc_times = list(hourly.get("time", []) or [])
    fc_temps_raw = list(hourly.get("temperature_2m", []) or [])
    fc_winds_raw = list(hourly.get("wind_speed_10m", []) or [])
    temps = _num_list(fc_temps_raw)
    winds = _num_list(fc_winds_raw)
    solars = _num_list(hourly.get("shortwave_radiation", []))
    precip_7d = sum(fc_precip)

    daily_outlook = build_daily_outlook(
        precip_hist, fc_precip, fc_times, fc_temps_raw, fc_winds_raw
    )

    arch_hourly = arch.get("hourly", {})
    arch_temps = _num_list(arch_hourly.get("temperature_2m", []))
    arch_precip = _num_list(arch_hourly.get("precipitation", []))
    past_temp_mean = sum(arch_temps) / len(arch_temps) if arch_temps else None

    temp_mean = sum(temps) / len(temps) if temps else None
    temp_max = max(temps) if temps else None
    wind_mean = sum(winds) / len(winds) if winds else None
    solar_mean = sum(solars) / len(solars) if solars else None

    signals = []
    if temp_mean is not None and temp_mean > HEAT_WAVE_C:
        signals.append("Warm 7-day mean favors cyanobacteria growth")
    if temp_mean is not None and past_temp_mean is not None:
        delta = temp_mean - past_temp_mean
        if delta >= 2:
            signals.append(
                f"{round(delta, 1)}°C warmer than the past-30-day mean"
            )
        elif delta <= -2:
            signals.append(
                f"{round(-delta, 1)}°C cooler than the past-30-day mean"
            )
    if wind_mean is not None and wind_mean < CALM_WIND_MS:
        signals.append("Calm winds — low mixing favors surface scum")
    if temp_max is not None and temp_max > 30:
        signals.append(f"Peak {round(temp_max, 1)}°C in the 7-day window")
    if not signals:
        signals.append("No strong bloom-favorable weather signals right now")

    return {
        "latitude": lat,
        "longitude": lon,
        "provenance": "live-open-meteo",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "method": "weather-only heuristic — not a calibrated forecast",
        "wash_off": {
            "risk_score": round(score, 4),
            "risk_level": risk_level(score),
            "rainfall_48h_mm": round(rainfall_48h, 2),
            "dry_days_antecedent": round(dry_days, 2),
            "impervious_proxy": IMPERVIOUS_ASSUMED,
            "impervious_note": "assumed neutral — land cover unknown for arbitrary points",
        },
        "week_ahead": {
            "temp_mean_c": round(temp_mean, 1) if temp_mean is not None else None,
            "temp_max_c": round(temp_max, 1) if temp_max is not None else None,
            "wind_mean_ms": round(wind_mean, 2) if wind_mean is not None else None,
            "solar_mean_wm2": round(solar_mean, 1) if solar_mean is not None else None,
            "precip_sum_mm": round(precip_7d, 1),
        },
        "daily_outlook": daily_outlook,
        "past_30d": {
            "temp_mean_c": round(past_temp_mean, 1) if past_temp_mean is not None else None,
            "precip_sum_mm": round(sum(arch_precip), 1),
        },
        "signals": signals,
        "nearest_waterbody": nearest_waterbody(lat, lon),
    }
