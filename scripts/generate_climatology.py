"""Generate the spectral climatology prior table (v2 M2, refreshed nightly).

Inputs:
  ``src/data/spectral_history.json``   rolling per-waterbody spectral records
                                       appended by every ingestion run
  ``src/data/ingested-features.json``  the latest run (seeds the history)

Output:
  ``src/data/climatology.json``

Two honest outcomes, never mixed:

* **Measured** (``method: seasonal-mean-of-ingested-observations``) — at least
  three waterbodies have real satellite readings in the history file. Monthly
  means are computed from those records and carry their sample count.
* **Modelled** (``method: latitude-season-fallback``) — no usable satellite
  record exists yet, so the file ships the documented latitude × month rule and
  says so in ``method_note``. The API renders that note next to every prior it
  serves, so a modelled prior can never be mistaken for an observation.

Usage (repo root):  python scripts/generate_climatology.py
"""
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SRC = os.path.join(_ROOT, "src")
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
sys.path.insert(0, os.path.join(_SRC, "backend"))

from ingestion.climatology import SPECTRAL_KEYS  # noqa: E402

DATA_DIR = os.path.join(_SRC, "data")
HISTORY_FILE = os.path.join(DATA_DIR, "spectral_history.json")
INGESTED_FILE = os.path.join(DATA_DIR, "ingested-features.json")
OUT_FILE = os.path.join(DATA_DIR, "climatology.json")

MAX_RECORDS = 4000
MIN_MEASURED_WATERBODIES = 3
MEASURED_SOURCES = {"planetary-computer-s2l2a", "copernicus-s2l2a"}

FALLBACK_RULE = {
    "method": "latitude-season-fallback",
    "ndci_base": 0.02,
    "ndci_amplitude": 0.10,
    "belt_centroid_deg": 45.0,
    "belt_width_deg": 25.0,
    "north_peak_month": 8,
    "south_peak_month": 2,
    "chlorophyll_at_ndci": 10.0,
    "trend_fraction": 0.25,
    "max_offset": 0.04,
    "chl_trend_fraction": 0.12,
    "ndvi_base": 0.08,
    "fai_base": 0.01,
    "std_base": 0.012,
}

FALLBACK_NOTE = (
    "Modelled seasonal prior (mid-latitude summer maximum × coarse latitude "
    "belt) — not a satellite measurement. It is replaced automatically once "
    "three or more waterbodies have real spectral records in "
    "src/data/spectral_history.json."
)

MEASURED_NOTE = (
    "Seasonal means of ingested Sentinel-2 L2A spectral observations. Sample "
    "counts are carried per month; thin months stay flagged in the API "
    "response."
)


def _read_json(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def _spectral_of(row: dict) -> tuple[dict, str]:
    """Pull the spectral block from an ingested row (new or legacy shape)."""
    block = row.get("spectral") if isinstance(row.get("spectral"), dict) else None
    if block:
        values = {k: block[k] for k in SPECTRAL_KEYS if isinstance(block.get(k), (int, float))}
        return values, str(block.get("source") or "unknown")
    legacy = {
        "ndci_mean": row.get("ndci"),
        "ndci_trend_5d": row.get("ndci_trend_5d"),
        "chlorophyll_a_mean": row.get("chlorophyll_a"),
        "ndvi_mean": row.get("ndvi"),
        "fai_mean": row.get("fai"),
    }
    values = {k: v for k, v in legacy.items() if isinstance(v, (int, float))}
    return values, ("placeholder-constant" if values else "unknown")


def _load_history() -> list:
    data = _read_json(HISTORY_FILE)
    recs = data.get("records")
    return recs if isinstance(recs, list) else []


def _append_history(history: list, ingested: dict) -> list:
    """Merge the latest ingestion run into the rolling history (deduped)."""
    seen = {(r.get("waterbody_id"), r.get("date")) for r in history}
    rows = ingested.get("waterbodies") if isinstance(ingested, dict) else None
    stamp = str(ingested.get("generated_at", ""))[:10] if isinstance(ingested, dict) else ""
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        values, source = _spectral_of(row)
        if source not in MEASURED_SOURCES or not values:
            continue
        key = (row.get("waterbody_id"), stamp)
        if key in seen:
            continue
        history.append({
            "waterbody_id": row.get("waterbody_id"),
            "date": stamp,
            "values": values,
            "source": source,
        })
        seen.add(key)
    return history[-MAX_RECORDS:]


def _measured_bodies(history: list) -> dict:
    """Per-waterbody monthly + annual means over real observations only."""
    by_body: dict = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    names: dict = {}
    for rec in history:
        if rec.get("source") not in MEASURED_SOURCES:
            continue
        wid = rec.get("waterbody_id")
        values = rec.get("values") or {}
        if not wid or not values:
            continue
        month = str(int(str(rec.get("date", "2026-01-01"))[5:7] or 1))
        for k in SPECTRAL_KEYS:
            if isinstance(values.get(k), (int, float)):
                by_body[wid][month][k].append(float(values[k]))
                by_body[wid]["annual"][k].append(float(values[k]))
        names[wid] = rec.get("name") or names.get(wid, wid)

    def _means(bucket: dict) -> dict:
        return {k: round(sum(v) / len(v), 4) for k, v in bucket.items() if v}

    out = {}
    for wid, months in by_body.items():
        entry = {"name": names.get(wid, wid), "monthly": {}, "annual": {}}
        for month, keys in months.items():
            entry["monthly" if month != "annual" else "annual"] = _means(keys)
        counts = defaultdict(int)
        for rec in history:
            if rec.get("waterbody_id") == wid and rec.get("source") in MEASURED_SOURCES:
                counts[str(int(str(rec.get("date", "2026-01-01"))[5:7] or 1))] += 1
        entry["sample_counts"] = dict(counts)
        out[wid] = entry
    return out


def build() -> dict:
    ingested = _read_json(INGESTED_FILE)
    history = _append_history(_load_history(), ingested)
    bodies = _measured_bodies(history)
    measured = len(bodies) >= MIN_MEASURED_WATERBODIES
    stamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    if measured:
        method = "seasonal-mean-of-ingested-observations"
        note = MEASURED_NOTE
    else:
        method = "latitude-season-fallback"
        note = FALLBACK_NOTE

    return history, {
        "generated_at": stamp,
        "method": method,
        "method_note": note,
        "measured_waterbodies": sorted(bodies) if measured else [],
        "history_records": len(history),
        "waterbodies": bodies,
        "fallback_rule": FALLBACK_RULE,
    }


def main() -> int:
    history, table = build()
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump({"updated_at": table["generated_at"], "records": history}, f, indent=1)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(table, f, indent=2)
    print(f"climatology: method={table['method']} "
          f"waterbodies={len(table['waterbodies'])} history={len(history)}")
    print(f"  -> {OUT_FILE}")
    print(f"  -> {HISTORY_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
