"""
BloomCast test suite — runs from the repo root:  python -m pytest tests -q

These are import + data-integrity tests: they confirm the reorganized tree
wires up correctly and that every committed seed artifact the API depends on
is present and well-formed. They need no network and no model artifacts.
"""

import json
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
BACKEND = SRC / "backend"

# Make the backend importable from the test runner.
sys.path.insert(0, str(BACKEND))


# --- package wiring -------------------------------------------------------

def test_backend_package_imports():
    from api.main import app
    assert app is not None


def test_ml_package_imports():
    from features.feature_store import FEATURE_NAMES
    assert len(FEATURE_NAMES) == 32


def test_config_resolves_to_src_root():
    from shared.config import ROOT, SEED_DIR, WATERBODY_FILE, REPLAY_FILE
    assert ROOT == SRC.resolve() or ROOT.resolve() == SRC.resolve()
    assert SEED_DIR.exists(), f"seed dir missing: {SEED_DIR}"
    assert WATERBODY_FILE.exists(), "waterbodies.geojson missing"
    assert REPLAY_FILE.exists(), "replay_events.json missing"


# --- seed data integrity --------------------------------------------------

SEED = SRC / "data" / "seed"


def test_waterbody_forecasts_exist_and_are_banded():
    wbs = json.loads((SRC / "data" / "waterbodies.geojson").read_text())["features"]
    assert len(wbs) >= 19, "expected the pilot waterbody set"
    for f in wbs:
        wb_id = f["properties"]["id"]
        fc = json.loads((SEED / f"forecast-{wb_id}.json").read_text())
        assert 0.0 <= fc["p_bloom"] <= 1.0, f"{wb_id} probability out of range"
        assert fc["ci_lo"] <= fc["p_bloom"] <= fc["ci_hi"], f"{wb_id} CI does not bracket p"
        assert "shap_top_features" in fc


def test_replay_events_have_day_series():
    idx = json.loads((SRC / "data" / "replay_events.json").read_text())["events"]
    assert len(idx) >= 2, "PRD M2 requires at least 2 replay events"
    for ev in idx:
        full = json.loads((SEED / f"replay-{ev['event_id']}.json").read_text())
        days = full["days"]
        assert len(days) >= 7, f"{ev['event_id']} must show >= 7 days of lead time"
        for d in days:
            assert 0.0 <= d["forecast_probability"] <= 1.0
            assert d["ci_lo"] <= d["forecast_probability"] <= d["ci_hi"]


def test_sandbox_scenarios_cover_the_grid():
    wbs = json.loads((SRC / "data" / "waterbodies.geojson").read_text())["features"]
    sb = json.loads((SEED / f"sandbox-{wbs[0]['properties']['id']}.json").read_text())
    keys = set(sb["scenarios"])
    expected = {f"temp+{t}_nut-{n}" for t in (0, 1, 2, 3) for n in (0, 30, 50)}
    assert expected <= keys, f"missing scenarios: {expected - keys}"
    for v in sb["scenarios"].values():
        assert v["label"] == "planning scenario, not prediction"


def test_scorecard_publishes_baselines():
    sc = json.loads((SEED / "scorecard.json").read_text())
    for k in ("brier", "auc", "hit_rate", "false_alarm_rate", "baselines"):
        assert k in sc, f"scorecard missing {k}"
    assert 0.0 <= sc["brier"] <= 1.0
    assert 0.0 <= sc["auc"] <= 1.0


def test_streamflush_segments_present():
    segs = json.loads((SRC / "data" / "stream_segments.geojson").read_text())["features"]
    assert len(segs) == 5, "PRD M6 requires 5 urban stream segments"
    for s in segs:
        sid = s["properties"]["id"]
        assert (SEED / f"streamflush-{sid}.json").exists(), f"missing nowcast for {sid}"


def test_fhir_sample_is_a_valid_bundle():
    b = json.loads((SEED / "fhir-alert-sample.json").read_text())
    assert b["resourceType"] == "Bundle"
    types = sorted(e["resource"]["resourceType"] for e in b["entry"])
    assert types == ["Communication", "Location", "Observation"], types


# --- repo-level invariants ------------------------------------------------

def test_no_orphan_packages_dir():
    """packages/ was flattened into src/backend and src/frontend."""
    assert not (SRC / "packages").exists()


def test_render_yaml_targets_new_layout():
    ry = (ROOT / "render.yaml").read_text()
    assert "cd src/backend" in ry
    assert "cd src/frontend" in ry
    assert "staticPublishPath: src/frontend/out" in ry
    assert "packages/" not in ry


def test_no_card_required_anywhere():
    """Every referenced service must stay on a free tier."""
    import subprocess
    r = subprocess.run(
        ["bash", str(ROOT / "scripts" / "verify-no-card.sh")],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stdout + r.stderr


# --- live explorer (network-free: validation + math only) --------------------

def test_explore_rejects_bad_coordinates():
    from fastapi.testclient import TestClient
    from api.main import app

    client = TestClient(app, raise_server_exceptions=False)
    assert client.get("/v1/explore?lat=999&lon=8.5").status_code == 400
    assert client.get("/v1/explore?lat=47.3&lon=999").status_code == 400
    assert client.get("/v1/explore?lat=abc&lon=8.5").status_code == 422


def test_explore_math_is_consistent():
    from api.explore import _haversine_km, nearest_waterbody
    from ingestion.streamflush import compute_streamflush_risk, risk_level

    # Zurich is ~0 km from itself; Sydney is far from Zurich.
    assert _haversine_km(47.37, 8.54, 47.37, 8.54) == pytest.approx(0.0, abs=1e-6)
    assert _haversine_km(47.37, 8.54, -33.87, 151.21) > 15000

    nb = nearest_waterbody(47.37, 8.54)
    assert nb is not None and nb["id"] == "CH-ZUR-01"
    assert nb["distance_km"] < 50

    # Heuristic is monotone: more rain / more dry days => more risk.
    low = compute_streamflush_risk(0.0, 0.0, 0.5)
    high = compute_streamflush_risk(40.0, 10.0, 0.9)
    assert 0.0 <= low < high <= 1.0
    assert risk_level(low) == "low"


def test_explore_daily_outlook_shape():
    from api.explore import build_daily_outlook

    dry_hist = [0.0] * 72
    # Storm arrives mid-week: dry first 3 days, wet last 4.
    fc_precip = [0.0] * 72 + [2.0] * 96
    fc_times = [f"2026-09-{20 + d:02d}T{h:02d}:00" for d in range(7) for h in range(24)]
    fc_temps = [22.0] * 168
    fc_winds = [2.0] * 168

    days = build_daily_outlook(dry_hist, fc_precip, fc_times, fc_temps, fc_winds)
    assert len(days) == 7
    assert [d["date"] for d in days] == sorted(d["date"] for d in days)
    for d in days:
        assert 0.0 <= d["risk_score"] <= 1.0
        assert d["risk_level"] in ("low", "moderate", "high", "critical")
    # Risk must climb once the storm water arrives.
    assert days[6]["risk_score"] > days[0]["risk_score"]


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
