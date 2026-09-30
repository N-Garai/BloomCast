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
# Browser-fetched variants: identical math and model, but the Open-Meteo
# calls were made by the visitor's browser (each IP gets its own fair-use
# quota) instead of the server's shared egress IP. The label matters because
# "live" then means "fresh from your connection", not "fresh from ours".
PROVENANCE_CLIENT_HEURISTIC = "client-fetched-heuristic"
PROVENANCE_CLIENT_MODEL = "client-fetched-model"

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


def _static_site_features(lat: float, lon: float) -> tuple[dict, str]:
    """Area and imperviousness for a point, from the committed pilot directory.

    V3-11: these two were hardcoded to 5.0 / 0.3 for every coordinate, so a dense
    urban stream and an alpine lake got identical static inputs. Real values
    already exist per pilot in ``waterbodies.geojson``; the fallback is unchanged
    so behaviour for arbitrary points stays exactly as before.
    """
    from shared.config import WATERBODY_FILE

    try:
        import json

        with open(WATERBODY_FILE, encoding="utf-8") as f:
            features = json.load(f).get("features", [])
    except Exception:  # noqa: BLE001 - a missing directory is not a 500
        return {"area_km2": 5.0, "latitude": lat, "longitude": lon,
                "impervious_proxy": 0.3}, "assumed"

    best, best_km = None, None
    for feature in features:
        props = feature.get("properties") or {}
        centroid = props.get("centroid")
        if not (isinstance(centroid, list) and len(centroid) == 2):
            continue
        km = _haversine_km(lat, lon, float(centroid[1]), float(centroid[0]))
        if best_km is None or km < best_km:
            best, best_km = props, km

    # Within ~25 km the pilot's own static attributes are a fair description of
    # the waterbody; beyond that the assumed values are the honest answer.
    if best is not None and best_km is not None and best_km <= 25.0:
        # Only area_km2 is actually committed per pilot. impervious_proxy is
        # not in waterbodies.geojson, so it stays at the documented assumed value
        # rather than being invented here — the PRD assumed both existed, and
        # guessing an urban-fraction would be a fabricated input the model would
        # then treat as measured.
        return {
            "area_km2": float(best.get("area_km2") or 5.0),
            "latitude": lat,
            "longitude": lon,
            "impervious_proxy": 0.3,
        }, f"pilot:{best.get('id')}"
    return {"area_km2": 5.0, "latitude": lat, "longitude": lon,
            "impervious_proxy": 0.3}, "assumed"


def _citizen_features(lat: float, lon: float, radius_km: float = 25.0) -> tuple[dict, str]:
    """Validated citizen signals for a point, or zeros flagged ``absent``.

    V3-11 / V3-4: these five features were permanently zero, so the citizen block
    of the trained model was dead weight at serving time. Only steward-approved
    reports count — the same gate the training weights use, so a pending report
    cannot reach a served forecast either. Zeros plus an ``absent`` flag is the
    honest encoding: the model still gets a well-formed row, and the response
    says the input was missing rather than implying no reports exist.
    """
    empty = {
        "citizen_reports_7d": 0.0,
        "citizen_color_green_ratio": 0.0,
        "citizen_scum_reports_7d": 0.0,
        "citizen_consensus_severity": 0.0,
        "citizen_report_density": 0.0,
    }
    try:
        from api.db import list_observations
        from datetime import datetime, timedelta, timezone

        approved = [
            o for o in (list_observations(limit=5000) or [])
            if str(o.get("validation_status") or "").lower() == "approved"
            and o.get("latitude") is not None and o.get("longitude") is not None
        ]
        if not approved:
            return empty, "absent"

        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        recent = []
        for obs in approved:
            if _haversine_km(lat, lon, float(obs["latitude"]), float(obs["longitude"])) > radius_km:
                continue
            try:
                seen = datetime.fromisoformat(str(obs.get("observed_at")).replace("Z", "+00:00"))
            except (TypeError, ValueError):
                continue
            if seen.tzinfo is None:
                seen = seen.replace(tzinfo=timezone.utc)
            if seen >= cutoff:
                recent.append(obs)
        if not recent:
            return empty, "absent"

        green = sum(1 for o in recent
                    if "green" in str(o.get("water_color") or "").lower())
        scum = sum(1 for o in recent if o.get("scum_visible"))
        severity_scores = [1.0 if (o.get("scum_visible") or "green" in str(o.get("water_color") or "").lower()) else 0.0
                           for o in recent]
        return {
            "citizen_reports_7d": float(len(recent)),
            "citizen_color_green_ratio": green / len(recent),
            "citizen_scum_reports_7d": float(scum),
            "citizen_consensus_severity": sum(severity_scores) / len(recent),
            "citizen_report_density": float(len(recent)) / max(1.0, radius_km),
        }, "live"
    except Exception:  # noqa: BLE001 - a missing DB must not break inference
        return empty, "absent"


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
    static, static_source = _static_site_features(lat, lon)
    citizen, citizen_source = _citizen_features(lat, lon)
    row = build_tabular_features(weather, spectral or {}, citizen, static)
    # The two sources travel with the row so the response can say which inputs
    # were real, which were assumed, and which were absent.
    return row, static_source, citizen_source


def _model_estimate(row, art, spectral_label: str | None = None,
                    static_source: str = "assumed",
                    citizen_source: str = "absent") -> dict | None:
    """Run the best available exported model on a live feature row.

    V3-11 — routing by data availability. The full 32-feature model trained on
    real Tick Tick Bloom labels was committed and then never served: every
    request went to the synthetic weather-only variant, so the real-label model
    reached zero users. The choice is now made per request from what the row
    actually contains:

    * **full** — used when the spectral block is a real measured prior or
      climatology fill *and* the artifacts carry a real-label training source.
      This is the genuine model the project claims to have built.
    * **weather_only** — used when the spectral block is missing/empty and the
      full model would be reading eight fabricated zero columns. Defined exactly
      where spectral input does not exist, which is the point of the variant.

    The response states which tier produced the number and what was missing, so
    a caller is never left guessing why two coordinates disagree.
    """
    if row is None or art is None:
        return None
    try:
        from ml.inference.predict import _band, _shap_top

        full_real = (
            art.get("weather_only") is None
            or str((art.get("meta") or {}).get("training_source", "")) == "tick-tick-bloom"
        )
        spectral_present = bool(spectral_label) and not str(spectral_label).startswith("empty")
        use_full = bool(art.get("lgbm")) and full_real and spectral_present
        tier = "full-32" if use_full else "weather-only"

        if use_full:
            booster = art["lgbm"]
            calibrator = art["calibrator"]
            meta = art.get("meta") or {}
        else:
            variant = art.get("weather_only")
            if variant is None:
                # No weather-only fallback and the full model is not usable for
                # this row: say so rather than serving zeros through it.
                return None
            booster = variant["lgbm"]
            calibrator = variant["calibrator"]
            meta = variant.get("meta") or {}

        r = row.reshape(1, -1)
        raw = float(booster.predict_proba(r)[0][1])
        p_iso = float(calibrator.transform([raw])[0])
        p = 0.5 * p_iso + 0.5 * raw
        ci_half = float(meta.get("ci_half", 0.3))
        lo, hi = _band(p, row, None, ci_half)
        drivers = _shap_top(booster, row)[:3]
        return {
            "experimental": True,
            "p_bloom": round(p, 4),
            "ci_lo": round(lo, 4),
            "ci_hi": round(hi, 4),
            "drivers": drivers,
            "model_version": meta.get("model_version"),
            "training_source": meta.get("training_source"),
            "provenance": PROVENANCE_MODEL,
            "spectral_input": spectral_label or "empty",
            "caveats": MODEL_CAVEAT,
            "tier": tier,
            "input_availability": {
                "spectral": "climatology-or-prior" if spectral_present else "absent",
                "static": static_source,
                "citizen": citizen_source,
                "weather": "live",
            },
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
    """Upstream rate-limited us. Message is written for a human, not a log.

    Status is 429, not 503, on purpose: 503 means "we are broken, try
    elsewhere", 429 means "slow down and retry" — browsers, proxies, and our
    own frontend backoff key off the difference (the auto-retry path only
    fires on 429 with a Retry-After header).
    """

    kind = "upstream-busy"
    status_code = 429


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


def _validate_client_windows(windows: dict) -> dict:
    """Validate browser-supplied Open-Meteo payloads and split them exactly
    like the server path. Raises :class:`InvalidLocation` (400) on junk —
    an empty or absurd payload must never score silent zeros."""
    from ingestion.openmeteo_client import OpenMeteoClient

    if not isinstance(windows, dict):
        raise InvalidLocation("Body must include a 'window' object.")
    window = windows.get("window")
    archive = windows.get("archive")
    if not isinstance(window, dict):
        raise InvalidLocation("Body must include a 'window' object.")
    hourly = window.get("hourly")
    if not isinstance(hourly, dict):
        raise InvalidLocation("window.hourly must be an object.")
    times = hourly.get("time")
    temps = hourly.get("temperature_2m")
    if not isinstance(times, list) or not 1 <= len(times) <= 1500:
        raise InvalidLocation("window.hourly.time must be a non-empty series.")
    if not isinstance(temps, list) or not temps:
        raise InvalidLocation("window.hourly.temperature_2m must be non-empty.")
    total = sum(len(v) for v in hourly.values() if isinstance(v, list))
    if total > 100_000:
        raise InvalidLocation("Weather payload is too large.")
    past, forecast = OpenMeteoClient.split_window(hourly)
    past_precip = [v for v in (past.get("precipitation") or []) if v is not None]
    fc_precip = [v for v in (forecast.get("precipitation") or []) if v is not None]
    if not past_precip and not fc_precip:
        raise InvalidLocation("Weather payload has no precipitation series.")
    if archive is None:
        return {"past": past, "forecast": forecast, "archive": {},
                "archive_status": "unavailable"}
    if not isinstance(archive, dict):
        raise InvalidLocation("'archive' must be an object or null.")
    arch_hourly = archive.get("hourly") or {}
    if not isinstance(arch_hourly, dict):
        raise InvalidLocation("'archive.hourly' must be an object.")
    return {"past": past, "forecast": forecast,
            "archive": archive if isinstance(archive, dict) else {},
            "archive_status": "ok"}


def _cache_block(cached_at: str, age_s: float | None) -> dict:
    """The staleness contract: never a number without its age."""
    return {
        "hit": age_s is not None,
        "ttl_s": int(_ASSESSMENT_CACHE.ttl_s),
        "cached_at": cached_at,
        "age_s": round(age_s, 1) if age_s is not None else 0.0,
    }


async def assess_location(lat: float, lon: float, *, use_cache: bool = True,
                          windows: dict | None = None,
                          weather_source: str = "server") -> dict:
    """Realtime assessment for one location.

    Returns the legacy ``/v1/explore`` shape (so existing clients keep working)
    plus the v2 additions: ``provenance``, ``cache``, ``caveats`` and
    ``spectral_prior``. Raises :class:`AssessError` subclasses on failure.

    ``windows`` carries caller-supplied Open-Meteo payloads
    (``{"window": <forecast-endpoint response>, "archive": <archive response>
    | None}``) — the ``POST /v1/infer/score`` escape hatch for shared-IP
    throttling. Scoring is byte-identical to the server-fetched path (same
    split, same row, same model); only ``provenance``/``weather_source``
    record the difference. Client payloads are validated before scoring —
    garbage in is a 400, never a scored zero.
    """
    from ingestion.climatology import prior_for
    from ingestion.openmeteo_client import OpenMeteoClient
    from ingestion.streamflush import (
        compute_dry_days_antecedent,
        compute_rainfall_48h,
        compute_streamflush_risk,
        risk_level,
    )

    lat = float(lat)
    lon = float(lon)
    validate_location(lat, lon)
    if weather_source not in ("server", "browser"):
        raise InvalidLocation("weather_source must be 'server' or 'browser'.")

    key = coord_key(lat, lon)
    validated = None
    if windows is not None:
        # Client payloads validate BEFORE the cache: a malformed body is a
        # 400 even when a cached assessment exists — the cache must never
        # mask a client bug with a stale-looking hit.
        validated = _validate_client_windows(windows)
    if use_cache:
        hit = _ASSESSMENT_CACHE.get(key)
        if hit is not None:
            value, age = hit
            out = dict(value)
            out["cache"] = _cache_block(out["fetched_at"], age)
            out["stale"] = age > _ASSESSMENT_CACHE.ttl_s / 2
            return out

    if windows is None:
        try:
            data = await _fetch_windows(lat, lon)
        except (UpstreamBusy, UpstreamUnavailable):
            # Throttled or down: serve a bounded-stale cached assessment,
            # loudly labelled, instead of failing. Fresh entries were already
            # returned above; only expired-but-recent ones reach here.
            if use_cache:
                stale = _ASSESSMENT_CACHE.get_stale(
                    key, 4 * _ASSESSMENT_CACHE.ttl_s)
                if stale is not None:
                    value, age = stale
                    out = dict(value)
                    out["cache"] = _cache_block(out["fetched_at"], age)
                    out["stale"] = True
                    out["caveats"] = list(out.get("caveats") or []) + [
                        "Live weather is throttled right now, so this shows the "
                        f"last good assessment from {int(age // 60)} min ago "
                        "instead of failing."
                    ]
                    return out
            raise
        upstream_calls = 2
    else:
        data = validated
        upstream_calls = 0
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
    built = _live_feature_row(lat, lon, {"hourly": fc_hourly}, archive, dry_days,
                              prior.get("values"))
    feature_row, static_source, citizen_source = (
        built if built is not None else (None, "absent", "absent")
    )
    estimate = _model_estimate(feature_row, artifacts,
                               spectral_label=f"{prior.get('source')} ({prior.get('method')})",
                               static_source=static_source,
                               citizen_source=citizen_source)
    feature_row_values = [float(value) for value in feature_row] if feature_row is not None else []
    # Self-diagnosis for the UI: when estimate is None the client can show
    # the backend's own reason instead of guessing (missing files, feature
    # mismatch, failed load — never a silent hole).
    from ml.training.artifacts import serving_model_status
    _model_status = serving_model_status(list(FEATURE_NAMES))
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
    from_browser = weather_source == "browser"
    result = {
        "latitude": lat,
        "longitude": lon,
        "provenance": (
            (PROVENANCE_CLIENT_MODEL if estimate else PROVENANCE_CLIENT_HEURISTIC)
            if from_browser
            else (PROVENANCE_MODEL if estimate else PROVENANCE_HEURISTIC)
        ),
        "weather_source": weather_source,
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
        "model_status": {
            "status": _model_status.get("status"),
            "reason": None if _model_status.get("status") == "loaded"
            else (_model_status.get("reason") or "unknown"),
        },
        "feature_names": list(FEATURE_NAMES) if feature_row is not None else [],
        "feature_row": feature_row_values,
        "signals": _signals(temp_mean, temp_max, wind_mean, past_temp_mean),
        "nearest_waterbody": nearest,
        "caveats": caveats + ([
            "Weather for this assessment was fetched by your browser, not "
            "our server (shared-IP throttling escape hatch) — same model, "
            "same math."
        ] if from_browser else []),
        "upstream_calls": upstream_calls,
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
            # NOTE: `except X as name` deletes `name` when the block exits,
            # so failures are copied to `err` first — reading `exc` below
            # the handlers would raise UnboundLocalError.
            try:
                results[i] = await assess_location(float(item["lat"]), float(item["lon"]))
                return
            except UpstreamBusy as busy_exc:
                # One delayed retry honoring the server's backoff: under a
                # shared-IP throttle the first attempt often loses a race
                # that the second wins. Capped so a hard throttle still
                # degrades fast instead of stalling the batch.
                wait = min(max(float(busy_exc.retry_after_s or 5), 1.0), 15.0)
                await _asyncio.sleep(wait)
                try:
                    results[i] = await assess_location(float(item["lat"]), float(item["lon"]))
                    return
                except (AssessError, KeyError, TypeError, ValueError) as retry_exc:
                    err = retry_exc
            except (AssessError, KeyError, TypeError, ValueError) as other_exc:
                err = other_exc
            body = err.to_body() if isinstance(err, AssessError) else {
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
