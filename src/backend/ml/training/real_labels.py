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


def _default_fetch(lat: float, lon: float, start: str, end: str,
                   retries: int = 4) -> dict:
    """Live Open-Meteo archive fetch (network) with polite retries.

    A 23k-sample join makes thousands of calls. Lessons from a throttled
    10-hour run: honor Retry-After on 429/503, add jitter so parallel
    workers don't retry in lockstep, and back off exponentially. Without
    this, throttling turns into mass skips.
    """
    import random
    import time

    import httpx

    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start,
        "end_date": end,
        "hourly": "temperature_2m,wind_speed_10m,wind_direction_10m,precipitation,shortwave_radiation,cloud_cover,dewpoint_2m,pressure_msl",
        "timezone": "UTC",
        "wind_speed_unit": "ms",
        "precipitation_unit": "mm",
    }
    last: Exception | None = None
    for attempt in range(retries + 1):
        try:
            r = httpx.get(
                "https://archive-api.open-meteo.com/v1/archive",
                params=params,
                # 30-day archive payloads are small; 30s bounds a hung socket
                # so one bad connection cannot stall a whole worker pool.
                timeout=30.0,
            )
            r.raise_for_status()
            return r.json()
        except httpx.HTTPStatusError as exc:
            last = exc
            if exc.response.status_code not in (429, 500, 502, 503, 504):
                raise
            wait = _retry_wait(exc.response, attempt)
            time.sleep(wait)
        except Exception as exc:  # noqa: BLE001 - timeouts/transports retry too
            last = exc
            time.sleep(2.0 * (attempt + 1) + random.uniform(0, 1))
    raise last  # type: ignore[misc]


def _retry_wait(response, attempt: int) -> float:
    """Honor the server's Retry-After header when present, else backoff+jitter."""
    import random

    try:
        asked = float(response.headers.get("retry-after", ""))
        return max(0.0, min(asked, 120.0))
    except (TypeError, ValueError):
        pass
    return min(2.0 * (2 ** attempt), 60.0) + random.uniform(0, 1)


def _cache_key(lat: float, lon: float, date: str) -> str:
    return hashlib.sha1(f"{round(lat, 4)},{round(lon, 4)},{date}".encode()).hexdigest()[:16]


def build_weather_frame(rows: list, cache_path: str | Path | None = None,
                        fetch_fn=None, max_workers: int = 4,
                        progress_every: int = 500) -> dict:
    """Build (X_tab, X_seq, y, doy, wb_ids, dates) from labeled rows.

    Skips rows whose weather cannot be fetched (logged count in meta).
    Spectral/citizen blocks are zeros; static block carries lat/lon.
    Uncached fetches run in a thread pool (network-bound) while result order
    follows the input rows, so date-sorted training output is preserved.
    Concurrency defaults to 4: higher rates get throttled by the upstream
    API, which costs more time than it saves. Progress prints keep
    long Kaggle runs observable.
    """
    import json as _json
    from concurrent.futures import ThreadPoolExecutor, as_completed

    fetch_fn = fetch_fn or _default_fetch
    cache: dict = {}
    cache_path = Path(cache_path) if cache_path else None
    if cache_path and cache_path.exists():
        try:
            with open(cache_path, newline="") as f:
                for r in csv.DictReader(f):
                    if r.get("key"):
                        cache[r["key"]] = r
        except Exception:
            cache = {}  # corrupt cache file: refetch rather than crash

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

    # Chunked fetch-assemble-flush: a crash or timeout keeps everything
    # flushed so far, and a rerun resumes from the on-disk cache instead of
    # starting over. Final output order always follows the input rows,
    # regardless of fetch completion order.
    FLUSH_EVERY = 500

    def assemble_parts(r, w, seq):
        static = {"area_km2": 5.0, "latitude": r["lat"], "longitude": r["lon"],
                  "impervious_proxy": 0.3}
        x = build_tabular_features(w, {}, {}, static)
        chans = np.zeros((SEQ_DAYS, 6), dtype=np.float32)
        chans[:, 2] = np.asarray(seq["temp"][:SEQ_DAYS], dtype=np.float32)
        chans[:, 3] = np.asarray(seq["wind"][:SEQ_DAYS], dtype=np.float32)
        chans[:, 4] = np.asarray(seq["precip"][:SEQ_DAYS], dtype=np.float32)
        chans[:, 5] = np.asarray(seq["solar"][:SEQ_DAYS], dtype=np.float32)
        try:
            sev = int(float(r.get("severity", 3)))
        except (TypeError, ValueError):
            sev = 3
        dt = datetime.fromisoformat(r["date"])
        return (x, chans, r["y"], sev, dt.timetuple().tm_yday,
                reg_id[r["region"]], r["date"])

    X, S, y, doy, wids, dates = [], [], [], [], [], []
    sev_list = []
    skipped = 0

    def safe_assemble(r, w, seq):
        """Assemble one row, returning None instead of raising.

        A single malformed row (bad date, short series, odd region) must
        degrade to a skip — never abort a 23k-row join at 3am.
        """
        try:
            return assemble_parts(r, w, seq)
        except Exception:
            return None

    todo_idx = [i for i, r in enumerate(rows)
                if _cache_key(r["lat"], r["lon"], r["date"]) not in cache]
    if todo_idx:
        print(f"weather join: {len(todo_idx)}/{len(rows)} to fetch "
              f"({len(rows) - len(todo_idx)} cached)", flush=True)
    fetched_parts: dict = {}
    fetched_so_far = len(rows) - len(todo_idx)
    printed_marks = fetched_so_far // max(1, progress_every)
    for c in range(0, len(todo_idx), FLUSH_EVERY):
        chunk = todo_idx[c:c + FLUSH_EVERY]
        fresh_batch = []
        if chunk:
            # submit/as_completed (not pool.map): on KeyboardInterrupt the
            # pending futures are cancelled instead of lingering as zombie
            # threads that double upstream load on the next run.
            with ThreadPoolExecutor(max_workers=max(1, max_workers)) as pool:
                futs = {pool.submit(_one, rows[i]): i for i in chunk}
                try:
                    for fut in as_completed(futs):
                        i = futs[fut]
                        res = fut.result()
                        status, _, w, seq, fresh = res
                        if status != "ok":
                            fetched_parts[i] = None
                            continue
                        fetched_parts[i] = safe_assemble(rows[i], w, seq)
                        if fresh:
                            fresh_batch.append(fresh)
                except BaseException:
                    for f in futs:
                        f.cancel()
                    pool.shutdown(wait=False, cancel_futures=True)
                    raise
        if cache_path and fresh_batch:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            header = not cache_path.exists() or cache_path.stat().st_size == 0
            with open(cache_path, "a", newline="") as f:
                dw = csv.DictWriter(f, fieldnames=["key", "weather", "sequence"])
                if header:
                    dw.writeheader()
                dw.writerows(fresh_batch)
        fetched_so_far += len(chunk)
        if progress_every and fetched_so_far // progress_every > printed_marks:
            printed_marks = fetched_so_far // progress_every
            n_skip = sum(1 for v in fetched_parts.values() if v is None)
            print(f"weather join: {fetched_so_far}/{len(rows)} "
                  f"({n_skip} skipped so far)", flush=True)

    for i, r in enumerate(rows):
        if i in fetched_parts:
            parts = fetched_parts[i]
            if parts is None:
                skipped += 1
                continue
            x, s_row, yy, sev, dd, wid, date = parts
        else:
            status, _, w, seq, _ = _one(r)  # cache-hit path, no network
            if status != "ok":
                skipped += 1
                continue
            parts = safe_assemble(r, w, seq)
            if parts is None:
                skipped += 1
                continue
            x, s_row, yy, sev, dd, wid, date = parts
        X.append(x)
        S.append(s_row)
        y.append(yy)
        sev_list.append(sev)
        doy.append(dd)
        wids.append(wid)
        dates.append(date)

    if not y:
        raise ValueError(
            f"no usable rows: {len(rows)} input, {skipped} skipped "
            "(upstream outage? check network, then rerun — cache resumes)"
        )

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
