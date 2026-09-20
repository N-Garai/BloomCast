"""Feature frame builder for real Tick Tick Bloom labels.

For each labeled in-situ sample (lat, lon, date) this pulls the trailing
Open-Meteo archive weather and maps it onto BloomCast's 32-dim feature space
(see features/feature_store.py). Spectral and citizen blocks are zeros here:
satellite TIFFs are out of scope for the weather-join path, and the gap is
recorded in the training provenance instead of being silently filled.

Results are cached to CSV (one row per uid) so reruns and CI never hammer the
upstream API. Pass fetch_fn to inject canned weather in tests.
"""
import csv
import hashlib
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

from features.feature_store import (
    WEATHER_FEATURES,
    build_tabular_features,
    wind_dir_circular_variance,
)

CACHE_NAME = "weather_cache.csv"

# 30 daily means of (temp, wind, precip, solar) per sample → CNN channels.
SEQ_DAYS = 30


def _daily_means(hourly: dict, var: str, days: int) -> list:
    vals = [v for v in (hourly.get(var) or []) if v is not None]
    out = []
    for d in range(days):
        chunk = vals[d * 24:(d + 1) * 24]
        out.append(sum(chunk) / len(chunk) if chunk else 0.0)
    return out


def _sample_weather(lat: float, lon: float, date: str, fetch_fn) -> dict:
    """Trailing-30-day archive weather ending on the sample date."""
    end = datetime.fromisoformat(date).date()
    start = end - timedelta(days=SEQ_DAYS)
    data = fetch_fn(lat, lon, start.isoformat(), end.isoformat())
    hourly = data.get("hourly", {}) if isinstance(data, dict) else {}
    temps = _daily_means(hourly, "temperature_2m", SEQ_DAYS)
    winds = _daily_means(hourly, "wind_speed_10m", SEQ_DAYS)
    precs = _daily_means(hourly, "precipitation", SEQ_DAYS)
    solars = _daily_means(hourly, "shortwave_radiation", SEQ_DAYS)
    clouds = _daily_means(hourly, "cloud_cover", SEQ_DAYS)
    dews = _daily_means(hourly, "dewpoint_2m", SEQ_DAYS)
    press = _daily_means(hourly, "pressure_msl", SEQ_DAYS)

    def mean(a):
        return sum(a) / len(a) if a else 0.0

    last7, last3 = temps[-7:], temps[-3:]
    past30 = temps[:-7] or temps
    dry = 0
    for p in reversed(precs[-7:]):
        if p < 0.1:
            dry += 1
        else:
            break
    gdd = sum(max(0.0, t - 10.0) for t in last7)
    wdir = [v for v in (hourly.get("wind_direction_10m") or []) if v is not None]
    dir_var = wind_dir_circular_variance(wdir[-72:]) if wdir else 0.5
    return {
        "weather": {
            "temp_mean_3d": mean(last3),
            "temp_mean_7d": mean(last7),
            "temp_anomaly_7d": mean(last7) - mean(past30),
            "wind_speed_mean_3d": mean(winds[-3:]),
            "wind_speed_max_3d": max(winds[-3:] or [0.0]),
            "wind_dir_variance_3d": dir_var,
            "precip_sum_7d": sum(precs[-7:]),
            "precip_sum_3d": sum(precs[-3:]),
            "dry_days_7d": float(dry),
            "solar_mean_3d": mean(solars[-3:]),
            "cloud_cover_mean_3d": mean(clouds[-3:]),
            "dewpoint_mean_3d": mean(dews[-3:]),
            "pressure_trend_3d": (press[-1] - press[-3]) if len(press) >= 3 else 0.0,
            "growing_degree_days": gdd,
            "heat_wave_flag": 1.0 if mean(last7) > 28 else 0.0,
        },
        "sequence": {
            "temp": temps,
            "wind": winds,
            "precip": precs,
            "solar": solars,
        },
    }


def _default_fetch(lat: float, lon: float, start: str, end: str) -> dict:
    """Live Open-Meteo archive fetch (network)."""
    import httpx

    r = httpx.get(
        "https://archive-api.open-meteo.com/v1/archive",
        params={
            "latitude": lat,
            "longitude": lon,
            "start_date": start,
            "end_date": end,
            "hourly": "temperature_2m,wind_speed_10m,wind_direction_10m,precipitation,shortwave_radiation,cloud_cover,dewpoint_2m,pressure_msl",
            "timezone": "UTC",
            "wind_speed_unit": "ms",
            "precipitation_unit": "mm",
        },
        timeout=45.0,
    )
    r.raise_for_status()
    return r.json()


def _cache_key(lat: float, lon: float, date: str) -> str:
    return hashlib.sha1(f"{round(lat, 4)},{round(lon, 4)},{date}".encode()).hexdigest()[:16]


def build_weather_frame(rows: list, cache_path: str | Path | None = None,
                        fetch_fn=None, max_workers: int = 8) -> dict:
    """Build (X_tab, X_seq, y, doy, wb_ids, dates) from labeled rows.

    Skips rows whose weather cannot be fetched (logged count in meta).
    Spectral/citizen blocks are zeros; static block carries lat/lon.
    Uncached fetches run in a thread pool (network-bound) while result order
    follows the input rows, so date-sorted training output is preserved.
    """
    import json as _json
    from concurrent.futures import ThreadPoolExecutor

    fetch_fn = fetch_fn or _default_fetch
    cache: dict = {}
    cache_path = Path(cache_path) if cache_path else None
    if cache_path and cache_path.exists():
        with open(cache_path, newline="") as f:
            for r in csv.DictReader(f):
                cache[r["key"]] = r

    regions = sorted({r["region"] for r in rows})
    reg_id = {name: i for i, name in enumerate(regions)}

    def _one(r: dict):
        key = _cache_key(r["lat"], r["lon"], r["date"])
        hit = cache.get(key)
        try:
            if hit:
                w = {k: float(v) for k, v in _json.loads(hit["weather"]).items()}
                seq = {k: [float(v) for v in vals]
                       for k, vals in _json.loads(hit["sequence"]).items()}
                return ("ok", r, w, seq, None)
            got = _sample_weather(r["lat"], r["lon"], r["date"], fetch_fn)
            return ("ok", r, got["weather"], got["sequence"], {
                "key": key,
                "weather": _json.dumps(got["weather"]),
                "sequence": _json.dumps(got["sequence"]),
            })
        except Exception:
            return ("skip", r, None, None, None)

    todo = [(i, r) for i, r in enumerate(rows)
            if _cache_key(r["lat"], r["lon"], r["date"]) not in cache]
    fetched: dict = {}
    if todo:
        with ThreadPoolExecutor(max_workers=max(1, max_workers)) as pool:
            for i, res in zip([i for i, _ in todo],
                              pool.map(lambda t: _one(t[1]), todo)):
                fetched[i] = res

    X, S, y, doy, wids, dates = [], [], [], [], [], []
    sev_list = []
    skipped, new_cache_rows = 0, []
    for i, r in enumerate(rows):
        if i in fetched:
            status, _, w, seq, fresh = fetched[i]
        else:
            status, _, w, seq, fresh = _one(r)  # cache hit path
        if status != "ok":
            skipped += 1
            continue
        if fresh:
            new_cache_rows.append(fresh)
        static = {"area_km2": 5.0, "latitude": r["lat"], "longitude": r["lon"],
                  "impervious_proxy": 0.3}
        X.append(build_tabular_features(w, {}, {}, static))
        chans = np.zeros((SEQ_DAYS, 6), dtype=np.float32)
        chans[:, 2] = np.asarray(seq["temp"][:SEQ_DAYS], dtype=np.float32)
        chans[:, 3] = np.asarray(seq["wind"][:SEQ_DAYS], dtype=np.float32)
        chans[:, 4] = np.asarray(seq["precip"][:SEQ_DAYS], dtype=np.float32)
        chans[:, 5] = np.asarray(seq["solar"][:SEQ_DAYS], dtype=np.float32)
        S.append(chans)
        y.append(r["y"])
        try:
            sev_list.append(int(float(r.get("severity", 3))))
        except (TypeError, ValueError):
            sev_list.append(3)
        dt = datetime.fromisoformat(r["date"])
        doy.append(dt.timetuple().tm_yday)
        wids.append(reg_id[r["region"]])
        dates.append(r["date"])

    if cache_path and new_cache_rows:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        write_header = not cache_path.exists()
        with open(cache_path, "a", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["key", "weather", "sequence"])
            if write_header:
                w.writeheader()
            w.writerows(new_cache_rows)

    return {
        "X": np.asarray(X, dtype=np.float32),
        "S": np.asarray(S, dtype=np.float32),
        "y": np.asarray(y, dtype=int),
        "severity": np.asarray(sev_list, dtype=int),
        "doy": np.asarray(doy, dtype=int),
        "wb_ids": np.asarray(wids, dtype=int),
        "dates": dates,
        "skipped": skipped,
        "regions": regions,
    }
