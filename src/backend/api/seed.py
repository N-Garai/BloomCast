"""JSON seed data loader — serves precomputed forecasts from local files."""
import json
from pathlib import Path
from typing import Any

from shared.config import SEED_DIR, WATERBODY_FILE, STREAM_FILE, REPLAY_FILE


def load_json(path: Path) -> Any:
    if not path.exists():
        return None
    with open(path) as f:
        return json.load(f)


def get_waterbodies() -> list:
    data = load_json(WATERBODY_FILE)
    return data["features"] if data else []


def get_forecast(wb_id: str) -> dict:
    return load_json(SEED_DIR / f"forecast-{wb_id}.json") or {}


def get_replay(event_id: str) -> dict:
    return load_json(SEED_DIR / f"replay-{event_id}.json") or {}


def get_replay_events() -> list:
    data = load_json(REPLAY_FILE)
    return data["events"] if data else []


def get_sandbox(wb_id: str) -> dict:
    return load_json(SEED_DIR / f"sandbox-{wb_id}.json") or {}


def get_scorecard() -> dict:
    return load_json(SEED_DIR / "scorecard.json") or {}


def get_streamflush(seg_id: str) -> dict:
    return load_json(SEED_DIR / f"streamflush-{seg_id}.json") or {}


def get_all_streamflush() -> list:
    data = load_json(STREAM_FILE)
    segs = data["features"] if data else []
    out = []
    for seg in segs:
        sid = seg["properties"]["id"]
        sf = get_streamflush(sid)
        if sf:
            sf["geometry"] = seg["geometry"]
            out.append(sf)
    return out


def get_fhir_sample() -> dict:
    return load_json(SEED_DIR / "fhir-alert-sample.json") or {}