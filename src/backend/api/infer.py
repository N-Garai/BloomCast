"""Realtime inference core — one location in, one labelled assessment out.

This is the module that lets BloomCast retire the nightly job from the serving
path (v2 §0/§2.3). Model inference is milliseconds; the only real cost is the
live weather fetch, which is why every assessment carries:

  * ``provenance``      — where the number came from, in a machine-readable tag
  * ``cache``           — age/TTL of the weather window that produced it
  * ``caveats``         — the honest boundary of what the number can claim

Nothing here ever emits a calibrated-forecast claim for an arbitrary point.
Two shapes are defined and never blurred:

  ``live-heuristic-nowcast``  StreamFlush wash-off score + bloom-favourable
                              weather signals. Always available, never a
                              probability.
  ``weather-only-model`` a real model probability, but weather-only input
  outside the pilot calibration envelope.


``api.explore`` re-exports the pure helpers below so the existing
``/v1/explore`` contract and its tests keep working untouched.
"""
import math
from datetime import datetime, timezone

from features.feature_store import FEATURE_NAMES
from shared.cache import TTLCache, coord_key

# Land cover is unknown for an arbitrary point, so the wash-off score assumes
# a neutral value and says so in the response.
IMPERVIOUS_ASSUMED = 0.5

# Calm winds mean low mixing, which favors surface scum formation.
CALM_WIND_MS = 3.0
# Same heat-wave threshold the nightly pipeline uses for its feature rows.
HEAT_WAVE_C = 28.0

# Provenance tags — the display contract (v2 M5) keys off these strings.
PROVENANCE_HEURISTIC = "live-heuristic-nowcast"
PROVENANCE_MODEL = "weather-only-model"

HEURISTIC_CAVEAT = (
    "Heuristic nowcast from live weather and land-cover assumptions — "
    "not a calibrated probability."
)
MODEL_CAVEAT = (
    "Model probability from weather-only input: the spectral block is a "
    "climatology prior (or empty), and the point is outside pilot calibration. "
    "Indicative, not a forecast."
)

# 15-minute TTL by default (see shared.config.INFER_CACHE_TTL_S). Kept here as
# a module-level singleton so concurrent requests share one warm window.
_ASSESSMENT_CACHE = TTLCache(ttl_s=900, max_entries=512)


def configure_cache(ttl_s: float) -> None:
    """Re-point the module cache (used by config wiring and tests)."""
    global _ASSESSMENT_CACHE
    _ASSESSMENT_CACHE = TTLCache(ttl_s=ttl_s, max_entries=512)


def cache_length() -> int:  # pragma: no cover - diagnostics
    return len(_ASSESSMENT_CACHE)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def nearest_waterbody(lat: float, lon: float) -> dict | None:
    """Closest pilot waterbody with a calibrated forecast, if any."""
    from api import seed

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
    from ingestion.streamflush import compute_streamflush_risk, risk_level

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


def _live_feature_row(lat: float, lon: float, fc: dict, arch: dict,
                      dry_days_7d: float, spectral: dict | None = None):
    """32-dim model input built from the live fetch (pure function).

    Weather block is real. The spectral block is a **climatology prior** when
    one is available (v2 M2) and zeros otherwise — either way the caller is
    told which, via ``spectral_prior.source``. Static block carries the
    coordinates. Returns None when the forecast window has no temperatures.
    """
    from features.feature_store import build_tabular_features, wind_dir_circular_variance

    hourly = fc.get("hourly", {}) if isinstance(fc, dict) else {}
    temps = _num_list(hourly.get("temperature_2m", []))
    if not temps:
        return None
    winds = _num_list(hourly.get("wind_speed_10m", []))
    wdirs = [v for v in (hourly.get("wind_direction_10m", []) or []) if v is not None]
    precs = _num_list(hourly.get("precipitation", []))
    solars = _num_list(hourly.get("shortwave_radiation", []))
    clouds = _num_list(hourly.get("cloud_cover", []))
    dews = _num_list(hourly.get("dewpoint_2m", []))
    press = _num_list(hourly.get("pressure_msl", []))
    arch_t = _num_list((arch.get("hourly", {}) if isinstance(arch, dict) else {}).get("temperature_2m", []))

    def mean(a):
        return sum(a) / len(a) if a else 0.0

    last3, last7 = temps[-72:], temps[-168:]
    wmean3 = mean(winds[-72:])
    weather = {
        "temp_mean_3d": mean(last3),
        "temp_mean_7d": mean(last7),
        "temp_anomaly_7d": mean(last7) - (mean(arch_t) if arch_t else mean(last7)),
        "wind_speed_mean_3d": wmean3,
        "wind_speed_max_3d": max(winds[-72:] or [0.0]),
        "wind_dir_variance_3d": wind_dir_circular_variance(wdirs[-72:]) if wdirs else 0.5,
        "precip_sum_7d": sum(precs[-168:]),
        "precip_sum_3d": sum(precs[-72:]),
        "dry_days_7d": float(dry_days_7d),
        "solar_mean_3d": mean(solars[-72:]),
        "cloud_cover_mean_3d": mean(clouds[-72:]),
        "dewpoint_mean_3d": mean(dews[-72:]),
        "pressure_trend_3d": (press[-1] - press[-72]) if len(press) >= 72 else 0.0,
        "growing_degree_days": sum(max(0.0, t - 10.0) for t in last7),
        "heat_wave_flag": 1.0 if mean(last7) > HEAT_WAVE_C else 0.0,
    }
    static = {"area_km2": 5.0, "latitude": lat, "longitude": lon,
              "impervious_proxy": 0.3}
    return build_tabular_features(weather, spectral or {}, {}, static)


def _model_estimate(row, art, spectral_label: str | None = None) -> dict | None:
    """Run the exported model on a live feature row (pure function).

    Experimental by design: weather-only input, outside pilot calibration.
    Always labeled as such — never presented as a calibrated forecast.
    """
    if row is None or art is None:
        return None
    try:
        from ml.inference.predict import _band, _shap_top

        variant = art.get("weather_only")
        if variant is None:
            return None
        r = row.reshape(1, -1)
        raw = float(variant["lgbm"].predict_proba(r)[0][1])
        p_iso = float(variant["calibrator"].transform([raw])[0])
        p = 0.5 * p_iso + 0.5 * raw
        ci_half = float(variant["meta"].get("ci_half", 0.3))
        lo, hi = _band(p, row, None, ci_half)
        drivers = _shap_top(variant["lgbm"], row)[:3]
        return {
            "experimental": True,
            "p_bloom": round(p, 4),
            "ci_lo": round(lo, 4),
            "ci_hi": round(hi, 4),
            "drivers": drivers,
            "model_version": variant["meta"].get("model_version"),
            "training_source": variant["meta"].get("training_source"),
            "provenance": PROVENANCE_MODEL,
            "spectral_input": spectral_label or "empty",
            "caveats": MODEL_CAVEAT,
        }
    except Exception:
        return None


def _load_serving_artifacts():
    """Serving artifacts via the mtime-checked lazy singleton (v2 M-K1).

    Never trains on the request path, never reloads per request.
    """
    try:
        from features.feature_store import FEATURE_NAMES
        from ml.training.artifacts import get_serving_artifacts

        return get_serving_artifacts(FEATURE_NAMES)
    except Exception:
        return None


# Per-identity budget for the fan-out endpoint (M4/§2.4). The single-location
# path is already shielded by the weather cache; the batch path can fan out to
# 50 upstream calls in one request, so it needs its own budget.
_BATCH_THROTTLE = None


def batch_throttle(limit: int, window_s: float = 600.0):
    """Lazily build the process-wide batch throttle."""
    global _BATCH_THROTTLE
    if _BATCH_THROTTLE is None:
        from shared.cache import SlidingWindowThrottle

        _BATCH_THROTTLE = SlidingWindowThrottle(limit=limit, window_s=window_s)
    return _BATCH_THROTTLE


class AssessError(Exception):
    """Assessment failure with a client-safe message and an optional wait time."""

    kind = "infer-error"
    status_code = 500

    def __init__(self, message: str, retry_after_s: float | None = None):
        super().__init__(message)
        self.message = message
        self.retry_after_s = retry_after_s

    def to_body(self) -> dict:
        return {
            "error": self.message,
            "kind": self.kind,
            "retry_after_s": self.retry_after_s,
        }


class InvalidLocation(AssessError):
    kind = "invalid-location"
    status_code = 400


class UpstreamBusy(AssessError):
    """Upstream rate-limited us. Message is written for a human, not a log."""

    kind = "upstream-busy"
    status_code = 503


class UpstreamUnavailable(AssessError):
    kind = "upstream-unavailable"
    status_code = 503


def validate_location(lat: float, lon: float) -> None:
    if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
        raise InvalidLocation(
            "Latitude must be between -90 and 90 and longitude between -180 and 180."
        )


def _signals(temp_mean, temp_max, wind_mean, past_temp_mean) -> list:
    signals = []
    if temp_mean is not None and temp_mean > HEAT_WAVE_C:
        signals.append("Warm 7-day mean favors cyanobacteria growth")
    if temp_mean is not None and past_temp_mean is not None:
        delta = temp_mean - past_temp_mean
        if delta >= 2:
            signals.append(f"{round(delta, 1)}°C warmer than the past-30-day mean")
        elif delta <= -2:
            signals.append(f"{round(-delta, 1)}°C cooler than the past-30-day mean")
    if wind_mean is not None and wind_mean < CALM_WIND_MS:
        signals.append("Calm winds — low mixing favors surface scum")
    if temp_max is not None and temp_max > 30:
        signals.append(f"Peak {round(temp_max, 1)}°C in the 7-day window")
    if not signals:
        signals.append("No strong bloom-favorable weather signals right now")
    return signals


# The anomaly baseline (30-day archive) is a nice-to-have; the trailing 72 h +
# 7-day window is the assessment. Spending the whole request budget waiting for
# a slow archive call would blow the <3 s target for zero benefit, so it gets a
# short leash and reports itself as time-boxed when it loses the race.
ARCHIVE_BUDGET_S = 3.0


def _swallow(task) -> None:
    """Consume a background task's exception so it is never 'never retrieved'."""
    if task.cancelled():
        return
    try:
        task.exception()
    except Exception:  # noqa: BLE001 - already consumed
        pass


async def _fetch_windows(lat: float, lon: float) -> dict:
    """Exactly two upstream calls; rate limits become friendly errors."""
    import asyncio as _asyncio

    from ingestion.openmeteo_client import OpenMeteoClient, UpstreamRateLimited
    from shared.config import UPSTREAM_RETRIES, UPSTREAM_TIMEOUT_S

    meteo = OpenMeteoClient(timeout=UPSTREAM_TIMEOUT_S, retries=UPSTREAM_RETRIES)
    window_task = _asyncio.create_task(
        meteo.fetch_window(lat, lon, past_days=3, forecast_days=7)
    )
    archive_task = _asyncio.create_task(meteo.fetch_historical(lat, lon, past_days=30))
    archive_task.add_done_callback(_swallow)

    try:
        window = await window_task
    except UpstreamRateLimited as exc:
        raise UpstreamBusy(
            "The weather service is busy right now — BloomCast is being "
            "throttled upstream. Try again in a moment.",
            exc.retry_after,
        ) from exc
    except Exception as exc:  # noqa: BLE001 - upstream outage, not our bug
        raise UpstreamUnavailable(
            "Live weather could not be reached. This is usually temporary — "
            "try again shortly."
        ) from exc

    archive: dict = {}
    archive_status = "ok"
    try:
        archive = await _asyncio.wait_for(_asyncio.shield(archive_task),
                                          timeout=ARCHIVE_BUDGET_S)
    except UpstreamRateLimited:
        archive_status = "rate-limited"
    except _asyncio.TimeoutError:
        archive_status = "time-boxed"
    except Exception:  # noqa: BLE001 - degrade, never fail the assessment
        archive_status = "unavailable"

    hourly = window.get("hourly", {}) if isinstance(window, dict) else {}
    past, forecast = OpenMeteoClient.split_window(hourly)
    return {
        "past": past,
        "forecast": forecast,
        "archive": archive if isinstance(archive, dict) else {},
        "archive_status": archive_status,
    }


def _cache_block(cached_at: str, age_s: float | None) -> dict:
    """The staleness contract: never a number without its age."""
    return {
        "hit": age_s is not None,
        "ttl_s": int(_ASSESSMENT_CACHE.ttl_s),
        "cached_at": cached_at,
        "age_s": round(age_s, 1) if age_s is not None else 0.0,
    }


async def assess_location(lat: float, lon: float, *, use_cache: bool = True) -> dict:
    """Realtime assessment for one location.

    Returns the legacy ``/v1/explore`` shape (so existing clients keep working)
    plus the v2 additions: ``provenance``, ``cache``, ``caveats`` and
    ``spectral_prior``. Raises :class:`AssessError` subclasses on failure.
    """
    from ingestion.climatology import prior_for
    from ingestion.streamflush import (
        compute_dry_days_antecedent,
        compute_rainfall_48h,
        compute_streamflush_risk,
        risk_level,
    )

    lat = float(lat)
    lon = float(lon)
    validate_location(lat, lon)

    key = coord_key(lat, lon)
    if use_cache:
        hit = _ASSESSMENT_CACHE.get(key)
        if hit is not None:
            value, age = hit
            out = dict(value)
            out["cache"] = _cache_block(out["fetched_at"], age)
            out["stale"] = age > _ASSESSMENT_CACHE.ttl_s / 2
            return out

    data = await _fetch_windows(lat, lon)
    past = data["past"]
    fc_hourly = data["forecast"]
    archive = data["archive"]

    precip_hist = _num_list(past.get("precipitation", []))
    if not precip_hist:
        # No trailing window available (upstream shape change, or a stubbed
        # payload) — fall back to the archive so the score is still real.
        arch_h = archive.get("hourly", {}) if isinstance(archive, dict) else {}
        precip_hist = _num_list(arch_h.get("precipitation", []))[-72:]
    rainfall_48h = compute_rainfall_48h(precip_hist)
    dry_days = compute_dry_days_antecedent(precip_hist)
    score = compute_streamflush_risk(rainfall_48h, dry_days, IMPERVIOUS_ASSUMED)

    fc_precip = _num_list(fc_hourly.get("precipitation", []))
    fc_times = list(fc_hourly.get("time", []) or [])
    fc_temps_raw = list(fc_hourly.get("temperature_2m", []) or [])
    fc_winds_raw = list(fc_hourly.get("wind_speed_10m", []) or [])
    temps = _num_list(fc_temps_raw)
    winds = _num_list(fc_winds_raw)
    solars = _num_list(fc_hourly.get("shortwave_radiation", []))
    precip_7d = sum(fc_precip)

    daily_outlook = build_daily_outlook(
        precip_hist, fc_precip, fc_times, fc_temps_raw, fc_winds_raw
    )

    arch_hourly = archive.get("hourly", {}) if isinstance(archive, dict) else {}
    arch_temps = _num_list(arch_hourly.get("temperature_2m", []))
    arch_precip = _num_list(arch_hourly.get("precipitation", []))
    past_temp_mean = sum(arch_temps) / len(arch_temps) if arch_temps else None

    temp_mean = sum(temps) / len(temps) if temps else None
    temp_max = max(temps) if temps else None
    wind_mean = sum(winds) / len(winds) if winds else None
    solar_mean = sum(solars) / len(solars) if solars else None

    nearest = nearest_waterbody(lat, lon)
    near_id = None
    if nearest and nearest.get("distance_km", 999) < 25:
        near_id = nearest.get("id")
    prior = prior_for(lat, lon, waterbody_id=near_id)

    artifacts = _load_serving_artifacts()
    feature_row = _live_feature_row(lat, lon, {"hourly": fc_hourly}, archive, dry_days,
                                    prior.get("values"))
    estimate = _model_estimate(feature_row, artifacts,
                               spectral_label=f"{prior.get('source')} ({prior.get('method')})")
    feature_row_values = [float(value) for value in feature_row] if feature_row is not None else []

    caveats = [HEURISTIC_CAVEAT]
    if estimate:
        caveats.append(MODEL_CAVEAT)
        if prior.get("method_note"):
            caveats.append(prior["method_note"])
    else:
        caveats.append(
            "No exported model is present on this deployment, so only the "
            "weather heuristic is shown. The model estimate appears once "
            "real-label artifacts are committed."
        )
    if data["archive_status"] != "ok":
        caveats.append(
            f"The 30-day anomaly baseline was {data['archive_status']} "
            "for this request."
        )

    fetched_at = datetime.now(timezone.utc).isoformat()
    result = {
        "latitude": lat,
        "longitude": lon,
        "provenance": PROVENANCE_MODEL if estimate else PROVENANCE_HEURISTIC,
        "is_calibrated": False,
        "fetched_at": fetched_at,
        "method": (
            "weather-only model estimate — not a calibrated forecast"
            if estimate else "weather-only heuristic — not a calibrated forecast"
        ),
        "wash_off": {
            "risk_score": round(score, 4),
            "risk_level": risk_level(score),
            "rainfall_48h_mm": round(rainfall_48h, 2),
            "dry_days_antecedent": round(dry_days, 2),
            "impervious_proxy": IMPERVIOUS_ASSUMED,
            "impervious_note": "land cover unknown for arbitrary points",
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
            "status": data["archive_status"],
        },
        "spectral_prior": prior,
        "model_estimate": estimate,
        "feature_names": list(FEATURE_NAMES) if feature_row is not None else [],
        "feature_row": feature_row_values,
        "signals": _signals(temp_mean, temp_max, wind_mean, past_temp_mean),
        "nearest_waterbody": nearest,
        "caveats": caveats,
        "upstream_calls": 2,
    }

    _ASSESSMENT_CACHE.set(key, result)
    out = dict(result)
    out["cache"] = _cache_block(fetched_at, None)
    out["stale"] = False
    return out


async def assess_batch(locations: list[dict], *, max_locations: int | None = None,
                       concurrency: int | None = None) -> dict:
    """Assess up to ``max_locations`` points with bounded concurrency.

    Sequential fan-out is what got the deployment throttled in the first
    place; unbounded parallel fan-out would be worse. A 4-wide semaphore keeps
    the upstream happy while still finishing 50 points inside a browser's
    patience, and the shared TTL cache means repeat clicks cost nothing.

    Per-location failures are reported in ``errors`` next to their index — one
    bad point never fails the batch.
    """
    import asyncio as _asyncio

    from shared.config import BATCH_CONCURRENCY, BATCH_MAX_LOCATIONS

    max_locations = int(max_locations or BATCH_MAX_LOCATIONS)
    if len(locations) > max_locations:
        raise AssessError(
            f"Too many locations in one request ({len(locations)}). "
            f"The limit is {max_locations} — split the request.",
            None,
        )
    sem = _asyncio.Semaphore(int(concurrency or BATCH_CONCURRENCY))
    results: list[dict | None] = [None] * len(locations)
    errors: list[dict] = []

    async def _one(i: int, item: dict) -> None:
        async with sem:
            try:
                results[i] = await assess_location(float(item["lat"]), float(item["lon"]))
            except (AssessError, KeyError, TypeError, ValueError) as exc:
                body = exc.to_body() if isinstance(exc, AssessError) else {
                    "error": "invalid location entry", "kind": "invalid-location",
                }
                errors.append({**body, "index": i})

    await _asyncio.gather(*(_one(i, item) for i, item in enumerate(locations)))
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len([r for r in results if r is not None]),
        "results": [r for r in results if r is not None],
        "errors": errors,
        "cache_ttl_s": int(_ASSESSMENT_CACHE.ttl_s),
    }


def cached_count() -> int:  # pragma: no cover - diagnostics
    return len(_ASSESSMENT_CACHE)
