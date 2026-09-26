"""
BloomCast test suite — runs from the repo root:  python -m pytest tests -q

These are import + data-integrity tests: they confirm the reorganized tree
wires up correctly and that every committed seed artifact the API depends on
is present and well-formed. They need no network and no model artifacts.
"""

import json
import shutil
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
    """Single Docker container on the free tier — no build.chdir layout."""
    ry = (ROOT / "render.yaml").read_text()
    assert "runtime: docker" in ry
    assert "plan: free" in ry
    assert "healthCheckPath: /v1/health" in ry
    assert "packages/" not in ry


@pytest.mark.skipif(shutil.which("bash") is None, reason="bash unavailable on this host")
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


# --- real-label training path (network-free via stubbed weather) ----------

FIXTURE_DIR = ROOT / "tests" / "fixtures" / "ticktickbloom_mini"


def _stub_archive(lat, lon, start, end):
    hours = 30 * 24
    ramp = [20.0 + 8.0 * (i / hours) for i in range(hours)]
    return {
        "hourly": {
            "temperature_2m": ramp,
            "wind_speed_10m": [3.0] * hours,
            "precipitation": [0.0] * hours,
            "shortwave_radiation": [200.0] * hours,
            "cloud_cover": [20.0] * hours,
            "dewpoint_2m": [12.0] * hours,
            "pressure_msl": [1013.0] * hours,
        }
    }


def test_ticktickbloom_loader_joins_and_binarizes():
    from ingestion.drivendata_loader import load_training_frame

    rows = load_training_frame(FIXTURE_DIR)
    assert len(rows) == 12, "test-split row must be excluded"
    assert [r["date"] for r in rows] == sorted(r["date"] for r in rows)
    by_uid = {r["uid"]: r for r in rows}
    assert by_uid["s001"]["y"] == 0
    assert by_uid["s005"]["y"] == 1
    assert sum(r["y"] for r in rows) == 7


def test_weather_frame_builder_shapes(monkeypatch, tmp_path):
    import ml.training.real_labels as rl

    monkeypatch.setattr(rl, "_default_fetch", _stub_archive)
    from ingestion.drivendata_loader import load_training_frame

    frame = rl.build_weather_frame(
        load_training_frame(FIXTURE_DIR), cache_path=tmp_path / "cache.csv"
    )
    assert frame["X"].shape == (12, 32)
    assert frame["S"].shape == (12, 30, 6)
    assert set(frame["y"].tolist()) == {0, 1}
    assert frame["skipped"] == 0
    assert (tmp_path / "cache.csv").exists()
    # Second build reads the cache without touching the network.
    monkeypatch.setattr(rl, "_default_fetch", lambda *a: (_ for _ in ()).throw(AssertionError("network used")))
    frame2 = rl.build_weather_frame(
        load_training_frame(FIXTURE_DIR), cache_path=tmp_path / "cache.csv"
    )
    assert frame2["X"].shape == (12, 32)


def test_train_selects_real_labels(monkeypatch, tmp_path):
    import ml.training.real_labels as rl
    from ml.inference import predict as P

    monkeypatch.setattr(rl, "_default_fetch", _stub_archive)
    monkeypatch.setenv("TICKTICKBLOOM_DIR", str(FIXTURE_DIR))
    monkeypatch.setenv("BLOOMCAST_WEATHER_CACHE", str(tmp_path / "wc.csv"))
    frame = P._load_training_frame()
    assert frame["source"] == "tick-tick-bloom"
    assert frame["n"] == 12


def test_train_falls_back_without_dataset(monkeypatch):
    from ml.inference import predict as P

    monkeypatch.setenv("TICKTICKBLOOM_DIR", "/nonexistent-dir-xyz")
    frame = P._load_training_frame()
    assert frame["source"] == "synthetic-seed"


# --- steward queue + alerts (isolated temp DB) ------------------------------

def _isolated_db(tmp_path, monkeypatch):
    import importlib
    import api.db as dbmod

    monkeypatch.setattr("shared.config.DATABASE_URL", f"sqlite:///{tmp_path}/t.db")
    return importlib.reload(dbmod)


def test_steward_validate_and_influence(tmp_path, monkeypatch):
    db = _isolated_db(tmp_path, monkeypatch)
    oid = db.insert_observation({
        "observation_id": "test-obs-1",
        "waterbody_id": "CH-ZUR-01",
        "observer_id": "tester",
        "observed_at": "2026-09-01T10:00:00Z",
        "latitude": 47.3,
        "longitude": 8.5,
        "water_color": "green",
        "scum_visible": True,
        "odor": "none",
        "wildlife_dead": False,
    })
    assert oid == "test-obs-1"
    assert len(db.list_pending_observations()) == 1
    updated = db.validate_observation("test-obs-1", "steward-a", "approved")
    assert updated["validation_status"] == "approved"
    assert db.validate_observation("test-obs-1", "s", "maybe") is None
    assert db.validate_observation("nope", "s", "approved") is None
    assert len(db.list_pending_observations()) == 0
    db.record_influence("CH-ZUR-01", 0.58, 0.71, ["test-obs-1"], ["tester"])
    log = db.list_influence("CH-ZUR-01")
    assert len(log) == 1 and log[0]["probability_delta"] == pytest.approx(0.13)


def test_alert_subscribe_check_unsubscribe(tmp_path, monkeypatch):
    db = _isolated_db(tmp_path, monkeypatch)
    token = db.subscribe({
        "email": "t@example.org", "waterbody_id": "CH-ZUR-01",
        "threshold": 0.6, "horizon_days": 5,
    })
    subs = db.subscriptions_for_email("t@example.org")
    assert len(subs) == 1 and subs[0]["threshold"] == 0.6
    assert db.unsubscribe("bad-token") is False
    assert db.unsubscribe(token) is True
    assert db.subscriptions_for_email("t@example.org") == []


def test_alert_routes_reject_bad_input():
    from fastapi.testclient import TestClient
    from api.main import app

    client = TestClient(app, raise_server_exceptions=False)
    assert client.get("/v1/alerts/check").status_code == 422
    assert client.post("/v1/alerts/unsubscribe", json={"token": "nope"}).status_code == 404
    assert client.post("/v1/citizen/validate", json={}).status_code == 400
    assert client.post("/v1/alerts/subscribe", json={"waterbody_id": "CH-ZUR-01"}).status_code == 400
    d = client.get("/v1/alerts/check?email=nobody@example.org").json()
    assert d["alerts"] == []


# --- artifact round-trip (Kaggle flow) --------------------------------------

def test_artifact_roundtrip_matches(tmp_path):
    import numpy as np
    from features.feature_store import FEATURE_NAMES
    from api.infer import _model_estimate
    from ml.inference.predict import _fit_all
    from ml.training import artifacts as A

    bundle = _fit_all()
    out = tmp_path / "art"
    A.save_artifacts(
        out,
        lgbm_branch=bundle["lgbm"],
        calibrator=bundle["calibrator"],
        ensemble=bundle["ens"],
        cnn=bundle["cnn"],
        feature_names=FEATURE_NAMES,
        meta={
            "model_version": bundle["version"],
            "training_source": bundle["frame"]["source"],
            "training_note": bundle["frame"]["note"],
            "ci_half": bundle["ci_half"],
            "oof_auc": bundle["oof_auc"],
            "oof_brier": bundle["oof_brier"],
            "scorecard": bundle["scorecard"],
            "headline": {
                "p_bloom": bundle["p_bloom"],
                "ci_lo": bundle["ci_lo"],
                "ci_hi": bundle["ci_hi"],
                "shap_top_features": bundle["top_features"],
                "baseline_climatology": 0.3,
            },
        },
        weather_only={
            "booster": bundle["weather_only"]["lgbm"],
            "calibrator": bundle["weather_only"]["calibrator"],
            "meta": bundle["weather_only"]["meta"],
        },
    )
    loaded = A.load_artifacts(out, FEATURE_NAMES)
    assert loaded is not None
    loaded_weather = A.load_weather_only(out, FEATURE_NAMES)
    assert loaded_weather is not None
    rng = np.random.default_rng(3)
    Xt = rng.normal(0, 1, (20, 32)).astype(np.float32)
    assert np.allclose(
        bundle["lgbm"].model.predict_proba(Xt)[:, 1],
        loaded["lgbm"].predict_proba(Xt)[:, 1],
        atol=1e-9,
    )
    assert np.allclose(
        bundle["calibrator"].transform([0.2, 0.5, 0.8]),
        loaded["calibrator"].transform([0.2, 0.5, 0.8]),
        atol=1e-12,
    )
    assert np.allclose(
        bundle["weather_only"]["lgbm"].model.predict_proba(Xt)[:, 1],
        loaded_weather["lgbm"].predict_proba(Xt)[:, 1],
        atol=1e-9,
    )
    assert np.allclose(
        bundle["weather_only"]["calibrator"].transform([0.2, 0.5, 0.8]),
        loaded_weather["calibrator"].transform([0.2, 0.5, 0.8]),
        atol=1e-12,
    )
    estimate = _model_estimate(
        np.zeros((1, 32), dtype=np.float32), {"weather_only": loaded_weather}
    )
    assert estimate is not None
    assert estimate["provenance"] == "weather-only-model"
    assert 0 <= estimate["ci_lo"] <= estimate["p_bloom"] <= estimate["ci_hi"] <= 1
    e1 = bundle["cnn"].predict_embedding(np.zeros((2, 30, 6), dtype=np.float32))
    e2 = loaded["cnn"].predict_embedding(np.zeros((2, 30, 6), dtype=np.float32))
    assert np.allclose(e1, e2, atol=1e-6)


def test_committed_artifacts_are_real():
    import json

    artifacts = SRC / "backend" / "ml" / "artifacts"
    # BOTH variants: the weather-only bundle is what actually serves live
    # traffic, so a synthetic weather_only_meta must trip the same gate
    # (it once shipped while only meta.json was checked).
    for name in ("meta.json", "weather_only_meta.json"):
        meta_path = artifacts / name
        if not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text())
        assert meta.get("training_source") == "tick-tick-bloom", (
            f"committed {name} must be real-label trained - "
            "see docs/kaggle-training.md"
        )


# --- report endpoint (no keys configured → honest unavailable) -------------

def test_report_needs_keys(monkeypatch):
    import api.report as R
    from fastapi.testclient import TestClient
    from api.main import app

    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setattr(R, "assess_location", lambda *args, **kwargs: pytest.fail("assessment should not run"))
    client = TestClient(app, raise_server_exceptions=False)
    response = client.post("/v1/report", json={"lat": 1.0, "lon": 2.0})
    assert response.status_code == 503
    assert response.json()["message"] == "AI reports unavailable"


def test_report_uses_server_assessment_and_verified_provider(monkeypatch):
    import api.report as R
    from fastapi.testclient import TestClient
    from api.main import app

    assessment = {
        "latitude": 47.3,
        "longitude": 8.5,
        "provenance": "weather-only-model",
        "fetched_at": "2026-09-23T15:00:00+00:00",
        "feature_names": [f"feature_{i}" for i in range(32)],
        "feature_row": [float(i) for i in range(32)],
        "model_estimate": {
            "p_bloom": 0.42,
            "ci_lo": 0.25,
            "ci_hi": 0.6,
            "drivers": [{"feature": "feature_0", "shap_value": 0.1}],
        },
        "wash_off": {"risk_score": 0.4},
        "signals": ["warm week"],
        "nearest_waterbody": None,
    }
    R._REPORT_CACHE.clear()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    async def fake_assess(*args, **kwargs):
        return assessment

    monkeypatch.setattr(R, "assess_location", fake_assess)
    async def fake_validate_area(*args, **kwargs):
        return {
            "status": "validated", "name": "Test Lake", "matched_name": "Test Lake",
            "description": "verified background", "latitude": 47.3, "longitude": 8.5,
        }

    monkeypatch.setattr(R, "_validate_area", fake_validate_area)

    async def fake_generate(prompt):
        assert "MEASURED_AND_COMPUTED" in prompt
        assert "GENERAL_BACKGROUND" in prompt
        assert "0.42" in prompt and "0.25" in prompt and "0.6" in prompt
        assert "feature_0" in prompt
        import json as _json
        return _json.dumps({
            "what": "The model estimate is 0.42 with interval 0.25 to 0.6. That means about four days in ten would bloom.",
            "why": "The supplied features explain the result. Warm water and calm air push the risk higher.",
            "cause_effect": "Feature 0 changed. That change raised the score.",
            "check_next": "Check the next weather window. Come back after new data arrives.",
            "disclaimer": "Advisory only — not a safety determination.",
            "p_bloom_cited": 0.42,
            "ci_lo_cited": 0.25,
            "ci_hi_cited": 0.6,
        }), "gemini"

    monkeypatch.setattr(R, "_generate_with_fallback", fake_generate)
    client = TestClient(app, raise_server_exceptions=False)
    response = client.post("/v1/report", json={
        "latitude": 47.3, "longitude": 8.5, "name": "Test Lake",
    })
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["provider"] == "gemini"
    assert payload["context"]["feature_row"] == assessment["feature_row"]
    assert "0.42" in payload["report"] and "0.25" in payload["report"] and "0.6" in payload["report"]
    assert payload["degraded"]["degraded"] is False


def test_report_retries_once_then_uses_template(monkeypatch):
    import api.report as R
    from fastapi.testclient import TestClient
    from api.main import app

    assessment = {
        "latitude": 1.0, "longitude": 2.0, "provenance": "live-heuristic-nowcast",
        "fetched_at": "2026-09-23T15:00:00+00:00", "feature_names": [f"f{i}" for i in range(32)],
        "feature_row": list(range(32)), "model_estimate": None,
        "wash_off": {"risk_score": 0.4}, "signals": [], "nearest_waterbody": None,
    }
    calls = 0
    R._REPORT_CACHE.clear()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    async def fake_assess(*args, **kwargs):
        return assessment

    monkeypatch.setattr(R, "assess_location", fake_assess)
    async def fake_validate_area(*args, **kwargs):
        return {"status": "not_requested"}

    monkeypatch.setattr(R, "_validate_area", fake_validate_area)

    async def fake_generate(prompt):
        nonlocal calls
        calls += 1
        if calls == 1:
            return "What\n0.42\nDisclaimer\nAdvisory only — not a safety determination.", "gemini"
        return "What\n0.4\nDisclaimer\nAdvisory only — not a safety determination.", "gemini"

    async def instant_sleep(delay):
        return None

    monkeypatch.setattr(R, "_generate_with_fallback", fake_generate)
    monkeypatch.setattr(R.asyncio, "sleep", instant_sleep)
    client = TestClient(app, raise_server_exceptions=False)
    response = client.post("/v1/report", json={"lat": 1.0, "lon": 2.0})
    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "gemini+template"
    assert payload["degraded"]["degraded"] is True
    assert "0.4" in payload["report"]
    assert "Built-in text used for: what" in payload["degraded"]["reason"]
    # Initial call plus one section regeneration (initial + spaced retry),
    # then the template names the failing section.
    assert calls == 3


def test_explore_live_row_and_estimate():
    from api.explore import _live_feature_row, _model_estimate

    fc = {"hourly": {
        "temperature_2m": [22.0] * 168,
        "wind_speed_10m": [2.0] * 168,
        "precipitation": [0.0] * 168,
        "shortwave_radiation": [200.0] * 168,
        "cloud_cover": [10.0] * 168,
        "dewpoint_2m": [12.0] * 168,
        "pressure_msl": [1013.0] * 168,
    }}
    arch = {"hourly": {"temperature_2m": [18.0] * 720}}
    row = _live_feature_row(47.38, 8.54, fc, arch, 5.0)
    assert row.shape == (32,)
    assert row[0] == 22.0 and row[2] == 4.0  # temp mean + anomaly
    assert _live_feature_row(0, 0, {"hourly": {}}, {}, 0.0) is None
    assert _model_estimate(row, None) is None


# --- region policy + feature parity ------------------------------------------

def test_wind_dir_circular_variance():
    from features.feature_store import wind_dir_circular_variance as wv

    assert wv([90.0] * 10) == 0.0
    assert wv([0.0, 180.0]) == pytest.approx(1.0, abs=1e-9)
    # Compass wrap: 359° and 1° are neighbors, not opposites.
    assert wv([359.0, 1.0]) < 0.01
    assert wv([]) == 0.0
    assert 0.0 <= wv([10.0, 90.0, 200.0, 320.0]) <= 1.0


def test_per_region_metrics():
    import numpy as np
    from ml.inference.predict import per_region_metrics

    y = np.array([0, 1, 0, 1, 0, 1])
    oof = np.array([0.2, 0.8, 0.4, 0.6, 0.1, 0.9])
    out = per_region_metrics(y, oof, np.array([0, 0, 0, 1, 1, 1]), ["west", "midwest"])
    assert set(out) == {"west", "midwest"}
    assert out["west"]["n"] == 3 and out["midwest"]["n"] == 3
    assert out["west"]["positive_rate"] == pytest.approx(1 / 3, abs=1e-3)
    assert out["west"]["auc"] is not None
    single = per_region_metrics(
        np.array([0, 0, 0, 0]), np.array([0.2, 0.3, 0.1, 0.4]),
        np.array([0, 0, 0, 0]), ["only"],
    )
    assert single["only"]["auc"] is None  # single-class guard


def test_ensemble_ignores_raw_tabular():
    """Anti-leakage lock: the meta-learner sees (lgbm_p, cnn_emb) only, so no
    raw feature — region ID included — can steer it."""
    import numpy as np
    from ml.training.ensemble import Ensemble

    rng = np.random.default_rng(0)
    y = (rng.random(60) > 0.5).astype(int)
    oof = rng.random(60)
    emb = rng.normal(0, 1, (60, 16))
    a = Ensemble().fit(oof, emb, np.zeros((60, 32)), y)
    b = Ensemble().fit(oof, emb, rng.normal(0, 1, (60, 32)), y)
    probe = (0.7, rng.normal(0, 1, 16), np.zeros(32))
    assert a.predict_proba(*probe) == b.predict_proba(*probe)


def test_severity_weighted_fit_runs():
    import numpy as np
    from ml.training.lightgbm_branch import LightGBMBranch
    from ml.training.cnn_branch import BloomCNN

    rng = np.random.default_rng(2)
    X = rng.normal(0, 1, (40, 32)).astype(np.float32)
    y = (rng.random(40) > 0.5).astype(int)
    w = 0.5 + rng.integers(1, 6, 40) / 5.0
    LightGBMBranch().fit(X, y, sample_weight=w)
    BloomCNN().fit(rng.normal(0, 1, (40, 30, 6)).astype(np.float32), y,
                   epochs=1, subsample=40, sample_weight=w)


# --- CAML SeaBASS loader ------------------------------------------------------

CAML_SB = """\
/begin_header
/investigators=test_team
/fields=uid,latitude,longitude,date,severity,density_cells_per_ml,region,distance_to_water_m
/units=none,degrees,degrees,yyyymmdd,none,cells/ml,none,m
/missing=-9999
/delimiter=comma
/end_header
a1,47.30,8.50,2016-06-01,1,5000,midwest,0
a2,41.90,-83.10,2016-07-01,,200000,midwest,120
a3,33.04,-117.07,2016-08-05,5,12000000,west,2500
"""


def test_severity_bands():
    from ingestion.drivendata_loader import severity_from_density as s

    assert (s(0), s(19999), s(20000), s(99999), s(100000), s(999999),
            s(1000000), s(9999999), s(10000000), s(5e7)) == (1, 1, 2, 2, 3, 3, 4, 4, 5, 5)
    assert s(None) is None and s("junk") is None


def test_caml_seabass_frame(tmp_path):
    from ingestion.drivendata_loader import load_training_frame

    sb = tmp_path / "caml.sb"
    sb.write_text(CAML_SB, encoding="utf-8")
    rows = load_training_frame(tmp_path)
    assert len(rows) == 3
    by_uid = {r["uid"]: r for r in rows}
    assert by_uid["a1"]["y"] == 0 and by_uid["a3"]["y"] == 1
    assert by_uid["a2"]["severity"] == 3  # derived from density
    assert by_uid["a2"]["distance_to_water_m"] == 120.0
    assert [r["date"] for r in rows] == sorted(r["date"] for r in rows)

    near = load_training_frame(tmp_path, max_distance_m=1000)
    assert [r["uid"] for r in near] == ["a1", "a2"]


def test_caml_plain_csv_without_header(tmp_path):
    from ingestion.drivendata_loader import load_training_frame

    (tmp_path / "caml.csv").write_text(
        "uid,latitude,longitude,date,severity,density_cells_per_ml,region\n"
        "b1,47.3,8.5,2016-06-01,2,50000,midwest\n",
        encoding="utf-8",
    )
    rows = load_training_frame(tmp_path)
    assert len(rows) == 1 and rows[0]["y"] == 0


def test_frame_prefers_competition(tmp_path):
    from ingestion.drivendata_loader import load_training_frame

    (tmp_path / "x.sb").write_text(CAML_SB, encoding="utf-8")
    (tmp_path / "train_labels.csv").write_text(
        "uid,severity,density\nz1,4,2000000\n", encoding="utf-8")
    (tmp_path / "metadata.csv").write_text(
        "uid,latitude,longitude,date,split,region\n"
        "z1,47.3,8.5,2016-06-01,train,midwest\n", encoding="utf-8")
    rows = load_training_frame(tmp_path)
    assert len(rows) == 1 and rows[0]["uid"] == "z1"


# --- crash-safe training: resume from cache + optuna storage ---------------

def test_weather_cache_resume(tmp_path):
    import ml.training.real_labels as rl
    from ingestion.drivendata_loader import load_training_frame

    calls = []

    def stub(lat, lon, start, end):
        calls.append((round(lat, 2), start))
        hours = 30 * 24
        return {"hourly": {
            "temperature_2m": [20.0] * hours,
            "wind_speed_10m": [3.0] * hours,
            "precipitation": [0.0] * hours,
            "shortwave_radiation": [200.0] * hours,
            "cloud_cover": [20.0] * hours,
            "dewpoint_2m": [12.0] * hours,
            "pressure_msl": [1013.0] * hours,
        }}

    rows = load_training_frame(
        ROOT / "tests" / "fixtures" / "ticktickbloom_mini")
    cache = tmp_path / "wc.csv"
    f1 = rl.build_weather_frame(rows, cache_path=cache, fetch_fn=stub)
    assert cache.exists() and len(f1["y"]) == 12

    # Simulate a crash: keep only the first 6 cached rows, rebuild.
    import csv as _csv
    with open(cache, newline="") as f:
        kept = list(_csv.DictReader(f))[:6]
    with open(cache, "w", newline="") as f:
        w = _csv.DictWriter(f, fieldnames=["key", "weather", "sequence"])
        w.writeheader()
        w.writerows(kept)
    calls.clear()
    f2 = rl.build_weather_frame(rows, cache_path=cache, fetch_fn=stub)
    assert len(calls) == 6, f"expected only the 6 missing rows refetched, got {len(calls)}"
    assert len(f2["y"]) == 12
    assert f2["dates"] == sorted(f2["dates"])


def test_optuna_resume(tmp_path):
    optuna = pytest.importorskip("optuna")
    import numpy as np
    from ml.training.tuning import tune_lightgbm

    rng = np.random.default_rng(0)
    X = rng.normal(0, 1, (60, 32))
    y = (rng.random(60) > 0.5).astype(int)
    storage = f"sqlite:///{tmp_path}/opt.db"
    r1 = tune_lightgbm(X, y, n_trials=2, n_splits=2, storage=storage)
    r2 = tune_lightgbm(X, y, n_trials=2, n_splits=2, storage=storage)
    study = optuna.load_study(study_name="bloomcast-lgbm", storage=storage)
    # optimize() runs n_trials *additional* trials: 2+2 accumulate, nothing lost.
    assert len(study.trials) == 4
    assert study.best_value == min(r1["best_brier"], r2["best_brier"])
    assert set(r2["params"]) >= {"n_estimators", "learning_rate", "num_leaves"}


# --- polite fetcher: Retry-After, backoff, progress ---------------------------

def test_fetch_honors_retry_after(monkeypatch):
    import httpx
    from ml.training import real_labels as rl

    calls = []

    class R429:
        status_code = 429
        headers = {"retry-after": "0"}

        def raise_for_status(self):
            raise httpx.HTTPStatusError("throttled", request=None, response=self)

    class R200:
        headers = {}

        def raise_for_status(self):
            return None

        def json(self):
            return {"hourly": {}}

    def fake_get(*a, **k):
        calls.append(1)
        if len(calls) < 3:
            return R429()
        return R200()

    monkeypatch.setattr(httpx, "get", fake_get)
    out = rl._default_fetch(47.0, 8.0, "2016-06-01", "2016-07-01")
    assert out == {"hourly": {}} and len(calls) == 3


def test_fetch_gives_up(monkeypatch):
    import httpx
    from ml.training import real_labels as rl

    def always_fail(*a, **k):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(httpx, "get", always_fail)
    monkeypatch.setattr("time.sleep", lambda *a: None)
    try:
        rl._default_fetch(47.0, 8.0, "2016-06-01", "2016-07-01", retries=1)
        raise AssertionError("should have raised")
    except httpx.ConnectError:
        pass


def test_frame_progress_prints(tmp_path, capsys):
    import ml.training.real_labels as rl
    from ingestion.drivendata_loader import load_training_frame

    rows = load_training_frame(ROOT / "tests" / "fixtures" / "ticktickbloom_mini")
    rl.build_weather_frame(rows[:4], cache_path=None, fetch_fn=_stub_archive,
                           max_workers=2, progress_every=2)
    out = capsys.readouterr().out
    assert "weather join" in out


def test_interrupt_cancels_pending_futures(tmp_path):
    """Simulated Ctrl+C mid-join: KeyboardInterrupt surfaces promptly and no
    hang on pool shutdown."""
    import time
    import ml.training.real_labels as rl
    from ingestion.drivendata_loader import load_training_frame

    calls = []

    def boom(*a):
        calls.append(1)
        if len(calls) == 2:
            raise KeyboardInterrupt()
        time.sleep(0.01)
        return _stub_archive(*a)

    rows = load_training_frame(ROOT / "tests" / "fixtures" / "ticktickbloom_mini")
    t = time.time()
    try:
        rl.build_weather_frame(rows, cache_path=None, fetch_fn=boom, max_workers=2)
        raise AssertionError("should have raised KeyboardInterrupt")
    except KeyboardInterrupt:
        pass
    assert time.time() - t < 30, "interrupt must not hang on shutdown"


# --- join crash-safety: bad rows, corrupt cache, empty frame ---------------

def test_bad_rows_become_skips_not_crashes(monkeypatch, tmp_path):
    import ml.training.real_labels as rl

    def stub(lat, lon, start, end):
        hours = 30 * 24
        return {"hourly": {
            "temperature_2m": [20.0] * hours,
            "wind_speed_10m": [3.0] * hours,
            "precipitation": [0.0] * hours,
            "shortwave_radiation": [200.0] * hours,
            "cloud_cover": [20.0] * hours,
            "dewpoint_2m": [12.0] * hours,
            "pressure_msl": [1013.0] * hours,
        }}

    rows = [
        {"uid": "ok1", "lat": 47.3, "lon": 8.5, "date": "2016-06-01",
         "region": "midwest", "severity": 1, "y": 0},
        {"uid": "baddate", "lat": 47.3, "lon": 8.5, "date": "not-a-date",
         "region": "midwest", "severity": 4, "y": 1},
        {"uid": "ok2", "lat": 41.9, "lon": -83.1, "date": "2016-07-01",
         "region": "midwest", "severity": 5, "y": 1},
    ]
    frame = rl.build_weather_frame(rows, cache_path=None, fetch_fn=stub)
    assert len(frame["y"]) == 2 and frame["skipped"] == 1
    assert frame["dates"] == ["2016-06-01", "2016-07-01"]


def test_corrupt_cache_row_is_skipped(tmp_path):
    import ml.training.real_labels as rl
    from ingestion.drivendata_loader import load_training_frame

    cache = tmp_path / "wc.csv"
    cache.write_text(
        "key,weather,sequence\n"
        "deadbeef,\"{not json\",\"[]\"\n",
        encoding="utf-8",
    )
    rows = load_training_frame(ROOT / "tests" / "fixtures" / "ticktickbloom_mini")

    def boom(*a):
        raise AssertionError("network must not be touched")

    # Corrupt entry matches nothing: rows miss cache, boom raises inside
    # _one (caught per-row), frame ends empty with a clear error — no crash
    # during cache load itself.
    try:
        rl.build_weather_frame(rows, cache_path=cache, fetch_fn=boom)
        raise AssertionError("expected empty-frame ValueError")
    except ValueError as e:
        assert "no usable rows" in str(e)


def test_empty_frame_raises_clearly():
    import ml.training.real_labels as rl

    try:
        rl.build_weather_frame([], cache_path=None, fetch_fn=lambda *a: {})
        raise AssertionError("should have raised ValueError")
    except ValueError as e:
        assert "no usable rows" in str(e)


# --- quantile regressors are distinct and ordered ----------------------------

def test_quantile_models_differ_and_order(tmp_path):
    import numpy as np
    from ml.training.tuning import train_quantiles
    from ml.training.artifacts import save_artifacts, load_artifacts
    from features.feature_store import FEATURE_NAMES

    rng = np.random.default_rng(0)
    X = rng.normal(0, 1, (200, 32))
    y = (rng.random(200) > 0.5).astype(int)
    q = train_quantiles(X, y, {"n_estimators": 30})
    p05 = np.asarray(q["q05"].predict(X[:20])).ravel()
    p95 = np.asarray(q["q95"].predict(X[:20])).ravel()
    assert (p05 <= p95 + 1e-9).all(), "5th percentile must not exceed 95th"
    assert q["q05"].model_to_string() != q["q95"].model_to_string()

    # native boosters survive the artifact round-trip
    from ml.training.lightgbm_branch import LightGBMBranch
    from sklearn.isotonic import IsotonicRegression
    from ml.training.ensemble import Ensemble
    from ml.training.cnn_branch import BloomCNN

    lgbm = LightGBMBranch().fit(X, y)
    cal = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1)
    cal.fit(lgbm.model.predict_proba(X)[:, 1], y)
    ens = Ensemble().fit(
        lgbm.model.predict_proba(X)[:, 1],
        rng.normal(0, 1, (200, 16)), X, y)
    cnn = BloomCNN()
    out = tmp_path / "art"
    save_artifacts(out, lgbm_branch=lgbm, calibrator=cal, ensemble=ens, cnn=cnn,
                   feature_names=FEATURE_NAMES,
                   meta={"model_version": "t", "training_source": "t",
                         "training_note": "t", "ci_half": 0.3,
                         "oof_auc": 0.5, "oof_brier": 0.25,
                         "scorecard": {}, "headline": {}},
                   quantiles=q)
    loaded = load_artifacts(out, FEATURE_NAMES)
    assert loaded is not None and loaded["meta"]["has_quantiles"] is True
    r05 = np.asarray(loaded["quantiles"]["q05"].predict(X[:20])).ravel()
    assert np.allclose(p05, r05, atol=1e-9)


    loaded = load_artifacts(out, FEATURE_NAMES)
    assert loaded is not None and loaded["meta"]["has_quantiles"] is True
    r05 = np.asarray(loaded["quantiles"]["q05"].predict(X[:20])).ravel()
    assert np.allclose(p05, r05, atol=1e-9)


# --- realtime serving core: cache, throttle, climatology, spectral --------

def test_ttl_cache_expiry_and_eviction():
    from shared.cache import TTLCache, coord_key

    now = [1000.0]
    cache = TTLCache(ttl_s=60, max_entries=2, clock=lambda: now[0])
    assert cache.get("a") is None
    cache.set("a", 1)
    assert cache.get("a") == (1, 0.0)
    now[0] += 30
    assert cache.get("a") == (1, 30.0)
    now[0] += 31
    assert cache.get("a") is None  # expired, not served stale
    cache.set("a", 1)
    cache.set("b", 2)
    cache.set("c", 3)
    assert cache.get("a") is None  # oldest evicted at capacity
    assert cache.get("c") == (3, 0.0)
    assert coord_key(47.3771, 8.5411) == coord_key(47.3774, 8.5414)


def test_throttle_blocks_then_recovers():
    from shared.cache import SlidingWindowThrottle

    now = [0.0]
    throttle = SlidingWindowThrottle(limit=2, window_s=60.0, clock=lambda: now[0])
    assert throttle.check("ip")[0] is True
    assert throttle.check("ip")[0] is True
    allowed, wait = throttle.check("ip")
    assert allowed is False and wait > 0
    assert throttle.check("other")[0] is True  # per-identity budget
    now[0] += 61
    assert throttle.check("ip")[0] is True
    throttle.reset("ip")


def test_climatology_fallback_rule():
    from ingestion.climatology import fallback_rule_value, prior_for

    july = fallback_rule_value({}, 47.0, 7)
    january = fallback_rule_value({}, 47.0, 1)
    assert july["ndci_mean"] > january["ndci_mean"]  # northern summer peak
    south = fallback_rule_value({}, -33.0, 1)
    assert south["ndci_mean"] > fallback_rule_value({}, -33.0, 7)["ndci_mean"]
    for key in ("ndci_mean", "ndci_trend_5d", "ndci_max", "chlorophyll_a_mean",
                "chlorophyll_a_trend_5d", "ndvi_mean", "fai_mean", "ndci_std_7d"):
        assert key in july

    missing = prior_for(47.0, 8.0, month=7)
    assert missing["source"] in ("unavailable", "grid-climatology")


def test_climatology_waterbody_path(tmp_path):
    import json
    from ingestion import climatology as clim

    table = {
        "generated_at": "2026-01-01T00:00:00Z",
        "method": "test",
        "method_note": "test note",
        "waterbodies": {
            "CH-ZUR-01": {
                "name": "Lake Zurich",
                "monthly": {"7": {k: 0.1 for k in clim.SPECTRAL_KEYS}},
                "annual": {k: 0.05 for k in clim.SPECTRAL_KEYS},
            }
        },
    }
    path = tmp_path / "clim.json"
    path.write_text(json.dumps(table))
    out = clim.prior_for(47.0, 8.0, month=7, waterbody_id="CH-ZUR-01")
    # default global table has no waterbodies; explicit path does
    direct = clim.load_priors(path)
    assert direct["waterbodies"]["CH-ZUR-01"]["monthly"]["7"]["ndci_mean"] == 0.1
    assert out["source"] in ("waterbody-climatology", "grid-climatology", "unavailable")


def test_spectral_pure_functions():
    import numpy as np
    from ingestion.streamflush import compute_streamflush_risk  # noqa: F401 (import surface)
    from ingestion.spectral_pc import select_scene, ndci_from_arrays, forward_fill

    class Item:
        def __init__(self, cloud, bands):
            self.properties = {"eo:cloud_cover": cloud}
            self.assets = {b: True for b in bands}
            self.id = f"scene-{cloud}"

    best = select_scene([Item(50, ["B04", "B05"]), Item(10, ["B04", "B05"]),
                         Item(5, ["B04"])])
    assert best.id == "scene-10"
    assert select_scene([Item(90, ["B04", "B05"])]) is None
    assert select_scene([]) is None

    mean, frac = ndci_from_arrays(
        np.array([[100.0, 120.0]]), np.array([[150.0, 180.0]]))
    assert mean == pytest.approx((50 / 250 + 60 / 300) / 2)
    assert frac == 1.0
    assert ndci_from_arrays(np.zeros((2, 2)), np.zeros((2, 2))) == (None, 0.0)

    filled = forward_fill({"ndci_mean": 0.2, "scene_id": "s1"}, "cloudy")
    assert filled["forward_filled"] is True and filled["ndci_mean"] == 0.2
    empty = forward_fill(None, "no scene")
    assert empty["ndci_mean"] is None and empty["forward_filled"] is False


def test_assess_location_mocked(monkeypatch):
    import asyncio
    import api.infer as infer

    async def fake_windows(lat, lon):
        hours = [f"2026-09-20T{h:02d}:00" for h in range(72 + 168)]
        return {
            "past": {"precipitation": [0.0] * 72},
            "forecast": {
                "time": hours,
                "temperature_2m": [22.0] * len(hours),
                "wind_speed_10m": [2.0] * len(hours),
                "wind_direction_10m": [90.0] * len(hours),
                "precipitation": [0.0] * len(hours),
                "shortwave_radiation": [200.0] * len(hours),
                "cloud_cover": [10.0] * len(hours),
                "dewpoint_2m": [12.0] * len(hours),
                "pressure_msl": [1013.0] * len(hours),
            },
            "archive": {"hourly": {"temperature_2m": [18.0] * 720,
                                   "precipitation": [0.0] * 720}},
            "archive_status": "ok",
        }

    monkeypatch.setattr(infer, "_fetch_windows", fake_windows)
    monkeypatch.setattr(infer, "_load_serving_artifacts", lambda: None)
    infer.configure_cache(60)
    try:
        first = asyncio.run(infer.assess_location(47.38, 8.54))
        assert first["provenance"] == "live-heuristic-nowcast"
        assert first["cache"]["hit"] is False
        assert first["wash_off"]["risk_score"] >= 0
        assert len(first["daily_outlook"]) == 7
        assert first["model_status"]["status"] in ("loaded", "fallback")
        assert first["model_status"]["reason"] is None or isinstance(first["model_status"]["reason"], str)
        second = asyncio.run(infer.assess_location(47.38, 8.54))
        assert second["cache"]["hit"] is True  # TTL served, upstream untouched
    finally:
        infer.configure_cache(900)


def test_assess_batch_limits_and_errors(monkeypatch):
    import asyncio
    import api.infer as infer

    async def fake_assess(lat, lon):
        if lat == 91.0:
            raise infer.InvalidLocation("bad")
        return {"latitude": lat, "provenance": "x"}

    monkeypatch.setattr(infer, "assess_location", fake_assess)
    out = asyncio.run(infer.assess_batch(
        [{"lat": 47.0, "lon": 8.0}, {"lat": 91.0, "lon": 0.0}],
        max_locations=50, concurrency=2))
    assert out["count"] == 1 and len(out["errors"]) == 1
    assert out["errors"][0]["index"] == 1
    try:
        asyncio.run(infer.assess_batch([{"lat": 0.0, "lon": 0.0}] * 3,
                                        max_locations=2))
        raise AssertionError("should have raised")
    except infer.AssessError as e:
        assert "Too many locations" in str(e)
    try:
        infer.validate_location(999, 0.0)
        raise AssertionError("should have raised")
    except infer.InvalidLocation:
        pass
    infer.validate_location(47.0, 8.0)


def test_singleton_loads_once_and_reports():
    from ml.training import artifacts as A
    from features.feature_store import FEATURE_NAMES

    A.reset_serving_cache()
    first = A.get_serving_artifacts(FEATURE_NAMES)
    assert first is not None
    assert A._SERVING["loads"] == 1
    second = A.get_serving_artifacts(FEATURE_NAMES)
    assert second is first
    assert A._SERVING["loads"] == 1  # no per-request reload
    status = A.serving_model_status(FEATURE_NAMES)
    assert status["status"] == "loaded"
    assert status["training_source"] == "tick-tick-bloom"
    A.reset_serving_cache()


def test_region_holdout_rotation_reports():
    import numpy as np
    from ml.inference.predict import region_holdout_metrics

    rng = np.random.default_rng(0)
    X = rng.normal(0, 1, (120, 32))
    y = (rng.random(120) > 0.5).astype(int)
    regions = ["west", "midwest", "south", "northeast"]
    out = region_holdout_metrics(X, y, np.array([i % 4 for i in range(120)]), regions)
    assert out["status"] == "ok"
    assert set(out["regions"]) == set(regions)
    assert out["worst_region"]["name"] in regions
    single = region_holdout_metrics(X, y, np.zeros(120, dtype=int), ["only"])
    assert single["status"] == "unavailable"


def test_sanitize_backfills_provenance():
    from ml.training.scorecard import sanitize_loaded_scorecard

    sc = sanitize_loaded_scorecard({"brier": 0.2, "auc": 0.7}, "tick-tick-bloom")
    assert sc["training_source"] == "tick-tick-bloom"
    assert "EU" not in sc["limitations"] or "No EU validation exists" in sc["limitations"]
    assert sc["eu_holdout"]["status"] == "data-blocked"
    assert sc["holdout_region"]["status"] == "not-recorded"


def test_infer_routes_reject_and_shape(monkeypatch):
    import api.infer as infer
    from fastapi.testclient import TestClient
    from api.main import app

    async def boom(lat, lon):
        raise infer.UpstreamUnavailable("down")

    monkeypatch.setattr(infer, "_fetch_windows", boom)
    monkeypatch.setattr(infer, "_load_serving_artifacts", lambda: None)
    client = TestClient(app, raise_server_exceptions=False)
    assert client.get("/v1/infer?lat=999&lon=0").status_code == 400
    response = client.get("/v1/infer?lat=47.0&lon=8.0")
    assert response.status_code == 503
    assert "error" in response.json() and "kind" in response.json()
    bad = client.post("/v1/infer/batch", json={})
    assert bad.status_code == 400
    many = client.post("/v1/infer/batch",
                       json={"locations": [{"lat": 0.0, "lon": 0.0}] * 51})
    assert many.status_code == 400


def test_health_reports_model_status():
    from fastapi.testclient import TestClient
    from api.main import app

    client = TestClient(app, raise_server_exceptions=False)
    data = client.get("/v1/health").json()
    assert data["status"] == "ok"
    assert data["model"]["status"] in ("loaded", "fallback")
    assert data["realtime"]["upstream_calls_per_location"] == 2


def test_report_unavailable_without_provider_keys(monkeypatch):
    from fastapi.testclient import TestClient
    import api.main as main

    monkeypatch.setattr(main, "providers_configured", lambda: False)
    client = TestClient(main.app)
    response = client.post("/v1/report", json={"lat": 47.0, "lon": 8.0})
    assert response.status_code == 503
    assert response.json()["status"] == "unavailable"


def test_singleton_loader_threadsafe():
    import threading
    from features.feature_store import FEATURE_NAMES
    from ml.training import artifacts as A

    A.reset_serving_cache()
    try:
        results = []

        def load():
            results.append(A.get_serving_artifacts(FEATURE_NAMES))

        threads = [threading.Thread(target=load) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert len(results) == 8
        assert all(r is results[0] for r in results)
    finally:
        A.reset_serving_cache()


def test_climatology_prior_for_contract():
    from ingestion.climatology import SPECTRAL_KEYS, prior_for

    for lat, lon in ((47.0, 8.0), (0.0, -150.0), (-33.0, 151.0)):
        prior = prior_for(lat, lon, month=7)
        assert prior["source"] in (
            "unavailable", "grid-climatology", "waterbody-climatology")
        assert prior["month"] == 7
        for key in SPECTRAL_KEYS:
            assert key in prior["values"]


def test_serving_load_path_has_no_torch():
    """M-K1: the serving chain must never pull in torch.

    torch (~500MB+) would blow the free-tier RAM budget and cold start; the
    CNN ships as numpy weights by design. pandas arrives transitively via
    sklearn/lightgbm and is tolerated (tens of MB, needed by their compat
    layers) — the test asserts the true invariant, not a wish.
    Run in a subprocess so the audit sees exactly what serving pulls in,
    unaffected by whatever the test session already imported.
    """
    import subprocess
    code = (
        "import sys; "
        "sys.path.insert(0, 'src/backend'); "
        "import ml.inference.predict, ml.training.artifacts; "
        "assert 'torch' not in sys.modules, 'torch in serving path'"
    )
    r = subprocess.run([sys.executable, "-c", code], capture_output=True,
                       text=True, cwd=ROOT)
    assert r.returncode == 0, r.stderr


def test_broken_artifacts_degrade_to_heuristic_not_500(monkeypatch):
    """Regression: libgomp-style loader explosions must never 500 explore.

    On the Render image LightGBM's native lib failed to import (missing
    system libgomp), and the unguarded status call turned every assessment
    into an HTTP 500. The loader may raise; serving must answer heuristic.
    """
    import asyncio
    import api.infer as infer
    from ml.training import artifacts as A

    async def fake_windows(lat, lon):
        hours = [f"2026-09-20T{h:02d}:00" for h in range(72 + 168)]
        return {
            "past": {"precipitation": [0.0] * 72},
            "forecast": {
                "time": hours,
                "temperature_2m": [22.0] * len(hours),
                "wind_speed_10m": [2.0] * len(hours),
                "wind_direction_10m": [90.0] * len(hours),
                "precipitation": [0.0] * len(hours),
                "shortwave_radiation": [200.0] * len(hours),
                "cloud_cover": [10.0] * len(hours),
                "dewpoint_2m": [12.0] * len(hours),
                "pressure_msl": [1013.0] * len(hours),
            },
            "archive": {"hourly": {"temperature_2m": [18.0] * 720,
                                   "precipitation": [0.0] * 720}},
            "archive_status": "ok",
        }

    def boom(expected, path=None, force=False):
        raise OSError("libgomp.so.1: cannot open shared object file")

    monkeypatch.setattr(infer, "_fetch_windows", fake_windows)
    monkeypatch.setattr(A, "get_serving_artifacts", boom)
    infer.configure_cache(0)
    try:
        out = asyncio.run(infer.assess_location(47.38, 8.54, use_cache=False))
        assert out["provenance"] == "live-heuristic-nowcast"
        assert out["model_estimate"] is None
        assert out["model_status"]["status"] == "fallback"
        assert "libgomp" in out["model_status"]["reason"]
    finally:
        infer.configure_cache(900)
        A.reset_serving_cache()


def test_report_reason_never_leaks_keys(monkeypatch):
    """Secrets must never reach the frontend: provider exceptions echo
    request headers verbatim (httpx prints the offending Bearer value),
    and pasted keys carry newlines that must be stripped on load."""
    import asyncio
    import api.report as R

    fake_groq = "gsk_" + "A" * 20
    fake_gemini = "AIza" + "B" * 20

    monkeypatch.setenv("GROQ_API_KEY", f"  {fake_groq}\n")
    monkeypatch.setenv("GEMINI_API_KEY", fake_gemini)
    keys = R._provider_keys()
    assert keys["groq"] == fake_groq
    assert keys["gemini"] == fake_gemini

    leaked = RuntimeError(
        f"all configured providers failed: Illegal header value "
        f"b'Bearer {fake_groq}\n' and {fake_gemini}"
    )
    clean = R.sanitize_error(leaked)
    assert fake_groq not in clean
    assert fake_gemini not in clean
    assert "gsk_" not in clean and "AIza" not in clean
    assert "\n" not in clean
    assert "[redacted]" in clean

    async def boom(name, key, prompt):
        raise RuntimeError(f"provider {name} blew up with {fake_groq}")

    async def no_validate(name, lat, lon):
        return {"name": name, "status": "not_requested",
                "source": "test", "retrieved_at": "now"}

    monkeypatch.setattr(R, "_call_provider", boom)
    monkeypatch.setattr(R, "_validate_area", no_validate)
    assessment = {"latitude": 47.0, "longitude": 8.0,
                  "model_estimate": {"p_bloom": 0.5, "ci_lo": 0.2,
                                     "ci_hi": 0.8, "drivers": []}}
    text, provider, _ctx, _area, degradation = asyncio.run(
        R.generate_report({}, assessment))
    assert provider == "template"
    assert degradation["degraded"] is True
    assert fake_groq not in degradation["reason"]


def test_report_tries_gemini_first_then_groq(monkeypatch):
    """Provider order is contractual: Gemini primary, Groq fallback. Both
    errors must surface (the old code showed only the last one, hiding a
    dead primary behind the fallback's error)."""
    import asyncio
    import api.report as R

    calls = []

    async def flaky(name, key, prompt):
        calls.append(name)
        if name == "gemini":
            raise RuntimeError("gemini 404 shut down")
        return "groq text", "groq"

    monkeypatch.setattr(R, "_call_provider", flaky)
    monkeypatch.setattr(R, "_provider_keys",
                        lambda: {"gemini": "gk", "groq": "qk"})
    text, provider = asyncio.run(R._generate_with_fallback("prompt"))
    assert calls == ["gemini", "groq"]
    assert text == ("groq text", "groq") and provider == "groq"

    async def both_dead(name, key, prompt):
        calls.append(name)
        raise RuntimeError(f"{name} down")

    monkeypatch.setattr(R, "_call_provider", both_dead)
    calls.clear()
    try:
        asyncio.run(R._generate_with_fallback("prompt"))
        raise AssertionError("expected RuntimeError")
    except RuntimeError as exc:
        message = R.sanitize_error(exc)
        assert "gemini failed" in message and "groq failed" in message


def test_report_validation_accepts_json_contract(monkeypatch):
    """The validator must accept any honest citation (percentages, spaced
    headers, human driver names) and reject invented numbers — with feedback
    naming the failure so the retry prompt can demand it."""
    import api.report as R

    context = {"model_estimate": {"p_bloom": 0.6992, "ci_lo": 0.3992,
                                  "ci_hi": 0.9992},
               "drivers": [{"feature": "temp_mean_7d",
                            "human": "Recent warm temperatures"}]}

    def draft(**overrides):
        base = {
            "what": "Assessment shows 69.92% risk. That is high enough to watch closely.",
            "why": "Warm weather pushed the score up. Calm air helped it stay high.",
            "cause_effect": "Recent warm temperatures drove risk. The heat built up over several days.",
            "check_next": "Recheck later today. Come back after new data arrives.",
            "disclaimer": "Advisory only — not a safety determination.",
            "p_bloom_cited": 0.6992,
            "ci_lo_cited": 0.3992,
            "ci_hi_cited": 0.9992,
        }
        base.update(overrides)
        return json.dumps(base)

    assert R._is_valid_report(draft(), context) is True
    assert R._is_valid_report("```json\n" + draft() + "\n```", context) is True
    rendered = R._render_report_text(R._parse_json_report(draft()))
    for heading in ("What\n", "Why\n", "Cause\u2192effect chain\n",
                    "What to check next\n", "Disclaimer"):
        assert heading in rendered

    lying = draft(p_bloom_cited=0.42)
    assert R._is_valid_report(lying, context) is False
    assert any("0.6992" in problem
               for problem in R.validation_feedback(lying, context))

    missing = json.loads(draft())
    del missing["cause_effect"]
    assert R._is_valid_report(json.dumps(missing), context) is False

    assert R._is_valid_report("Just some prose, no JSON.", context) is False
    assert R.validation_feedback("", context) == [
        "respond with a single JSON object containing the keys "
        + ", ".join(R.REPORT_KEYS)]


def test_upstream_throttle_surfaces_as_429(monkeypatch):
    """Upstream throttling must reach the client as 429 + Retry-After, never
    503: the frontend auto-retry, proxies, and backoff logic key off 429.
    (A 503 here once hid every throttling event as a server failure.)"""
    import api.infer as infer
    from fastapi.testclient import TestClient
    from api.main import app

    async def throttled(lat, lon):
        # What the real _fetch_windows raises after Open-Meteo answers 429
        # past every retry (it maps UpstreamRateLimited to this internally).
        raise infer.UpstreamBusy(
            "The weather service is busy right now.", 7)

    monkeypatch.setattr(infer, "_fetch_windows", throttled)
    monkeypatch.setattr(infer, "_load_serving_artifacts", lambda: None)
    infer.configure_cache(0)
    try:
        client = TestClient(app, raise_server_exceptions=False)
        first = client.get("/v1/infer?lat=47.0&lon=8.0")
        assert first.status_code == 429
        assert first.headers.get("retry-after") == "7"
        assert first.json()["kind"] == "upstream-busy"
        second = client.get("/v1/explore?lat=47.0&lon=8.0")
        assert second.status_code == 429
    finally:
        infer.configure_cache(900)


def test_stale_cache_served_on_throttle(monkeypatch):
    """Under upstream throttling, a recent-but-expired assessment is served
    loudly labelled stale instead of failing. Beyond the stale window the
    throttle error still surfaces."""
    import asyncio
    import time
    import api.infer as infer
    from shared.cache import TTLCache

    now = [1000.0]
    cache = TTLCache(ttl_s=60, max_entries=8, clock=lambda: now[0])
    cache.set("k", {"v": 1})
    assert cache.get_stale("k", 240) == ({"v": 1}, 0.0)
    now[0] += 90
    # Note: get() evicts expired entries, so get_stale is checked first —
    # production reads fresh first for the same reason.
    value, age = cache.get_stale("k", 240)
    assert value == {"v": 1} and age == 90.0
    assert cache.get("k") is None
    now[0] += 200
    assert cache.get_stale("k", 240) is None

    async def fake_windows(lat, lon):
        hours = [f"2026-09-20T{h:02d}:00" for h in range(72 + 168)]
        return {
            "past": {"precipitation": [0.0] * 72},
            "forecast": {
                "time": hours,
                "temperature_2m": [22.0] * len(hours),
                "wind_speed_10m": [2.0] * len(hours),
                "wind_direction_10m": [90.0] * len(hours),
                "precipitation": [0.0] * len(hours),
                "shortwave_radiation": [200.0] * len(hours),
                "cloud_cover": [10.0] * len(hours),
                "dewpoint_2m": [12.0] * len(hours),
                "pressure_msl": [1013.0] * len(hours),
            },
            "archive": {"hourly": {"temperature_2m": [18.0] * 720,
                                   "precipitation": [0.0] * 720}},
            "archive_status": "ok",
        }

    monkeypatch.setattr(infer, "_fetch_windows", fake_windows)
    monkeypatch.setattr(infer, "_load_serving_artifacts", lambda: None)
    infer.configure_cache(0.05)
    try:
        fresh = asyncio.run(infer.assess_location(11.0, 22.0))
        assert fresh["stale"] is False

        async def throttled(lat, lon):
            raise infer.UpstreamBusy("busy", 1)

        monkeypatch.setattr(infer, "_fetch_windows", throttled)
        time.sleep(0.1)
        stale = asyncio.run(infer.assess_location(11.0, 22.0))
        assert stale["stale"] is True
        assert stale["cache"]["hit"] is True
        assert any("throttl" in caveat for caveat in stale["caveats"])
        assert stale["wash_off"] == fresh["wash_off"]
    finally:
        infer.configure_cache(900)


def test_batch_retries_throttled_location_once(monkeypatch):
    import asyncio
    import api.infer as infer

    calls = []

    async def flaky(lat, lon):
        calls.append((lat, lon))
        if len(calls) == 1:
            raise infer.UpstreamBusy("busy", 0.01)
        return {"latitude": lat, "provenance": "x"}

    monkeypatch.setattr(infer, "assess_location", flaky)
    out = asyncio.run(infer.assess_batch([{"lat": 47.0, "lon": 8.0}],
                                         max_locations=50, concurrency=2))
    assert out["count"] == 1 and out["errors"] == []
    assert len(calls) == 2


def test_infer_score_uses_browser_windows_without_upstream(monkeypatch):
    """Shared-IP throttle escape hatch: the client fetches Open-Meteo with
    its own IP quota and the server scores with zero upstream calls. Scoring
    is identical (same split/row/model); provenance records the difference.
    Scored results populate the shared cache for the next visitor."""
    import api.infer as infer
    from fastapi.testclient import TestClient
    from api.main import app

    hours = [f"2026-09-20T{h:02d}:00" for h in range(72 + 168)]
    hourly = {
        "time": hours,
        "temperature_2m": [22.0] * len(hours),
        "wind_speed_10m": [2.0] * len(hours),
        "wind_direction_10m": [90.0] * len(hours),
        "precipitation": [0.0] * len(hours),
        "shortwave_radiation": [200.0] * len(hours),
        "cloud_cover": [10.0] * len(hours),
        "dewpoint_2m": [12.0] * len(hours),
        "pressure_msl": [1013.0] * len(hours),
    }

    async def no_upstream(lat, lon):
        raise AssertionError("score path must not touch upstream")

    monkeypatch.setattr(infer, "_fetch_windows", no_upstream)
    monkeypatch.setattr(infer, "_load_serving_artifacts", lambda: None)
    infer.configure_cache(900)
    try:
        client = TestClient(app, raise_server_exceptions=False)
        response = client.post("/v1/infer/score", json={
            "latitude": 12.0, "longitude": 34.0,
            "window": {"hourly": hourly},
            "archive": {"hourly": {"temperature_2m": [18.0] * 720,
                                   "precipitation": [0.0] * 720}},
        })
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["provenance"] == "client-fetched-heuristic"
        assert body["weather_source"] == "browser"
        assert body["upstream_calls"] == 0
        assert len(body["daily_outlook"]) == 7
        # Shared cache: the same coords now hit without any payload.
        cached = client.get("/v1/infer?lat=12.0&lon=34.0")
        assert cached.status_code == 200
        assert cached.json()["cache"]["hit"] is True

        missing = client.post("/v1/infer/score",
                              json={"latitude": 12.0, "longitude": 34.0})
        assert missing.status_code == 400
        empty = client.post("/v1/infer/score", json={
            "latitude": 12.0, "longitude": 34.0,
            "window": {"hourly": {"time": [], "temperature_2m": []}}})
        assert empty.status_code == 400
        huge = client.post("/v1/infer/score", json={
            "latitude": 12.0, "longitude": 34.0,
            "window": {"hourly": {"time": list(range(2000)),
                                  "temperature_2m": [1.0] * 2000,
                                  "precipitation": [0.0] * 2000}}})
        assert huge.status_code == 400
        no_archive = client.post("/v1/infer/score", json={
            "latitude": 13.0, "longitude": 35.0,
            "window": {"hourly": hourly}, "archive": None})
        assert no_archive.status_code == 200
        assert no_archive.json()["past_30d"]["status"] == "unavailable"
    finally:
        infer.configure_cache(900)


def test_report_429_backs_off_then_retries(monkeypatch):
    """A provider 429 waits out Retry-After and retries the SAME provider
    once before yielding to the next — hammering through a rate limit is
    what turns a 2-second hiccup into a hard failure."""
    import asyncio
    import httpx
    import api.report as R

    calls = []

    def rate_limited():
        request = httpx.Request("POST", "https://example.test/x")
        response = httpx.Response(429, headers={"retry-after": "0"},
                                  request=request)
        return httpx.HTTPStatusError("throttled", request=request,
                                     response=response)

    async def flaky(key, prompt):
        calls.append(1)
        if len(calls) == 1:
            raise rate_limited()
        return "recovered", "gemini"

    sleeps = []
    real_sleep = asyncio.sleep
    monkeypatch.setattr(R, "_gemini_report", flaky)
    monkeypatch.setattr(R.asyncio, "sleep",
                        lambda s: (sleeps.append(s), real_sleep(0))[1])
    text, provider = asyncio.run(R._call_provider("gemini", "k", "p"))
    assert (text, provider) == ("recovered", "gemini")
    assert len(calls) == 2 and len(sleeps) == 1
    """The fallback must read as a plain explanation, not a shrug: what
    happened, that nothing is invented, and what to do next."""
    import api.report as R

    context = {"latitude": 1.0, "longitude": 2.0,
               "fetched_at": "2026-09-25T00:00:00+00:00",
               "model_estimate": {"p_bloom": 0.5, "ci_lo": 0.2, "ci_hi": 0.8},
               "drivers": [], "signals": [], "wash_off": {},
               "spectral_prior": {}, "caveats": []}
    text = R._template_report(context)
    lowered = text.lower()
    assert "built-in summary" in lowered
    assert "nothing here is guessed" in lowered or "made up" in lowered
    assert "0.5" in text and "0.2" in text and "0.8" in text


def test_report_keeps_good_sections_regenerates_bad_ones(monkeypatch):
    """Keep-partial contract: validated sections from the first reply survive;
    only failed sections regenerate (via the fallback provider). The final
    report mixes kept + regenerated text and labels both providers."""
    import asyncio
    import json as _json
    import api.report as R
    from fastapi.testclient import TestClient
    from api.main import app

    assessment = {
        "latitude": 47.3, "longitude": 8.5,
        "provenance": "weather-only-model",
        "fetched_at": "2026-09-23T15:00:00+00:00",
        "feature_names": ["temp_mean_7d"],
        "feature_row": [22.0],
        "model_estimate": {
            "p_bloom": 0.42, "ci_lo": 0.25, "ci_hi": 0.6,
            "drivers": [{"feature": "temp_mean_7d",
                         "human": "Recent warm temperatures"}],
        },
        "wash_off": {"risk_score": 0.4}, "signals": [],
        "nearest_waterbody": None,
    }

    async def fake_assess(*args, **kwargs):
        return assessment

    monkeypatch.setattr(R, "assess_location", fake_assess)

    async def fake_validate_area(*args, **kwargs):
        return {"status": "not_requested"}

    monkeypatch.setattr(R, "_validate_area", fake_validate_area)

    async def fake_generate(prompt):
        # Whole-report prompt carries the full key template; section
        # regenerations carry only {"text": ...}.
        if '"cause_effect"' in prompt:
            return _json.dumps({
                "what": "KEPT what 0.42, interval 0.25 to 0.6. It stays as written here.",
                "why": "KEPT why for this spot. It stays as written too.",
                "cause_effect": "No drivers mentioned here.",
                "check_next": "KEPT next for later. It stays as written too.",
                "disclaimer": "Advisory only — not a safety determination.",
                "p_bloom_cited": 0.42,
                "ci_lo_cited": 0.25,
                "ci_hi_cited": 0.6,
            }), "gemini"
        return _json.dumps({
            "text": "FIXED cause naming temp_mean_7d with 0.42. It now passes all checks.",
            "p_bloom_cited": 0.42,
            "ci_lo_cited": 0.25,
            "ci_hi_cited": 0.6,
        }), "groq"

    monkeypatch.setattr(R, "_generate_with_fallback", fake_generate)
    R._REPORT_CACHE.clear()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    client = TestClient(app, raise_server_exceptions=False)
    response = client.post("/v1/report", json={"lat": 47.3, "lon": 8.5})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["provider"] == "gemini+groq"
    assert payload["degraded"]["degraded"] is False
    assert "KEPT what" in payload["report"]
    assert "FIXED cause naming temp_mean_7d" in payload["report"]


def test_driver_match_tolerates_paraphrase_not_evasion(monkeypatch):
    """Multi-word driver names survive LLM paraphrase (majority of
    significant words) but a lone generic noun does not count."""
    import api.report as R

    assert R._mentions_driver("Warm temperatures boost algae growth.",
                              "temp_mean_7d", "Recent warm temperatures") is True
    assert R._mentions_driver("Temperatures are high today.",
                              "temp_mean_7d", "Recent warm temperatures") is False
    assert R._mentions_driver("heat wave flag raised.",
                              "heat_wave_flag", "") is True


def test_report_cache_reuses_validated_text(monkeypatch):
    """Repeat Generate presses on the same assessment must not spend quota:
    the second identical request returns the cached validated text without
    calling any provider."""
    import asyncio
    import json as _json
    import api.report as R

    R._REPORT_CACHE.clear()
    assessment = {
        "latitude": 60.0, "longitude": 11.0,
        "provenance": "weather-only-model",
        "fetched_at": "2026-09-23T15:00:00+00:00",
        "feature_names": ["temp_mean_7d"],
        "feature_row": [22.0],
        "model_estimate": {
            "p_bloom": 0.5, "ci_lo": 0.2, "ci_hi": 0.8,
            "drivers": [{"feature": "temp_mean_7d",
                         "human": "Recent warm temperatures"}],
        },
        "wash_off": {"risk_score": 0.4}, "signals": [],
        "nearest_waterbody": None,
    }
    calls = []

    async def fake_assess(*args, **kwargs):
        return assessment

    monkeypatch.setattr(R, "assess_location", fake_assess)

    async def fake_validate_area(*args, **kwargs):
        return {"status": "not_requested"}

    monkeypatch.setattr(R, "_validate_area", fake_validate_area)

    async def fake_generate(prompt):
        calls.append(1)
        return _json.dumps({
            "what": "Cached what 0.5, interval 0.2 to 0.8. Stays valid.",
            "why": "Cached why here today. It stays valid too.",
            "cause_effect": "Recent warm temperatures drove it. Heat built up.",
            "check_next": "Recheck soon today. Come back after new data arrives.",
            "disclaimer": "Advisory only \u2014 not a safety determination.",
            "p_bloom_cited": 0.5,
            "ci_lo_cited": 0.2,
            "ci_hi_cited": 0.8,
        }), "groq"

    monkeypatch.setattr(R, "_generate_with_fallback", fake_generate)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    first = asyncio.run(R.generate_report({}, assessment))
    second = asyncio.run(R.generate_report({}, assessment))
    assert len(calls) == 1
    assert first[0] == second[0] and first[1] == second[1] == "groq"
    assert first[4] == {"degraded": False, "reason": None}


def test_provider_cooldown_skips_throttled_providers(monkeypatch):
    """After a 429, the provider cools down for 60 s: an immediate retry
    skips it outright instead of hammering a dead quota. The skip is named
    in the error so the cooldown is visible, not silent."""
    import asyncio
    import api.report as R

    R._last_provider_429.clear()
    monkeypatch.setattr(R, "_provider_keys",
                        lambda: {"gemini": "gk", "groq": "qk"})
    calls = []

    async def always_429(name, key, prompt):
        calls.append(name)
        raise RuntimeError(f"{name} failed: 429 Too Many Requests")

    monkeypatch.setattr(R, "_call_provider", always_429)
    try:
        try:
            asyncio.run(R._generate_with_fallback("p"))
            raise AssertionError("expected RuntimeError")
        except RuntimeError as exc:
            assert "429" in str(exc)
        assert calls == ["gemini", "groq"]
        calls.clear()
        try:
            asyncio.run(R._generate_with_fallback("p"))
            raise AssertionError("expected RuntimeError")
        except RuntimeError as exc:
            assert "cooling down" in str(exc)
        assert calls == []
    finally:
        R._last_provider_429.clear()


def test_section_spaced_retry_recovers(monkeypatch):
    """A section that fails validation once succeeds after the spaced
    correction retry — without discarding the already-kept sections."""
    import asyncio
    import json as _json
    import api.report as R

    R._REPORT_CACHE.clear()
    attempts = []

    async def fake_generate(prompt):
        attempts.append(1)
        if len(attempts) == 1:
            return _json.dumps({
                "text": "Too short.",
                "p_bloom_cited": 0.5,
                "ci_lo_cited": 0.2,
                "ci_hi_cited": 0.8,
            }), "gemini"
        return _json.dumps({
            "text": "Recovered why section here today. It passes checks now.",
        }), "groq"

    async def instant_sleep(delay):
        return None

    monkeypatch.setattr(R, "_generate_with_fallback", fake_generate)
    monkeypatch.setattr(R.asyncio, "sleep", instant_sleep)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    context = {"model_estimate": {"p_bloom": 0.5, "ci_lo": 0.2,
                                  "ci_hi": 0.8},
               "drivers": []}
    text, provider, cited = asyncio.run(R._regenerate_section("why", context))
    assert "Recovered why" in text
    assert provider == "groq"
    assert len(attempts) == 2


def test_section_provider_error_skips_retry(monkeypatch):
    """Provider errors fail fast with no spaced retry: backoff already
    happened inside the provider call, so waiting again only burns quota."""
    import asyncio
    import api.report as R

    async def instant_sleep(delay):
        raise AssertionError("sleep must not run on provider errors")

    async def boom(prompt):
        raise RuntimeError("gemini failed: 429 stiffed")

    monkeypatch.setattr(R, "_generate_with_fallback", boom)
    monkeypatch.setattr(R.asyncio, "sleep", instant_sleep)
    try:
        asyncio.run(R._regenerate_section("why", {"drivers": []}))
        raise AssertionError("expected RuntimeError")
    except RuntimeError as exc:
        assert "provider error" in str(exc)


def test_provider_http_error_quotes_vendor_body(monkeypatch):
    """A vendor 400 must surface its own explanation (retired model, TPM
    cap, bad parameter) instead of a bare status code — the status alone
    never names the cause."""
    import asyncio
    import httpx
    import api.report as R

    def bad_model(*args, **kwargs):
        request = httpx.Request("POST", "https://example.test/x")
        response = httpx.Response(
            400,
            json={"error": {"message": "model_not_available: gone", "type": "invalid_request"}},
            request=request,
        )
        raise httpx.HTTPStatusError("bad", request=request, response=response)

    monkeypatch.setattr(R, "_groq_report", bad_model)
    try:
        asyncio.run(R._call_provider("groq", "k", "p"))
        raise AssertionError("expected RuntimeError")
    except RuntimeError as exc:
        assert "groq HTTP 400" in str(exc)
        assert "model_not_available" in str(exc)


def test_report_model_ids_defined_and_overridable(monkeypatch):
    """Both provider model IDs must exist as module constants (a past edit
    deleted GEMINI_MODEL while its call site survived — live NameError that
    no mocked test caught) and honor env overrides."""
    import importlib
    import api.report as R

    importlib.reload(R)
    assert R.GEMINI_MODEL == "gemini-3.5-flash"
    assert R.GROQ_MODEL == "openai/gpt-oss-20b"
    monkeypatch.setenv("GEMINI_MODEL", "custom-gemini")
    monkeypatch.setenv("GROQ_MODEL", "custom-groq")
    importlib.reload(R)
    assert R.GEMINI_MODEL == "custom-gemini"
    assert R.GROQ_MODEL == "custom-groq"
    monkeypatch.undo()
    importlib.reload(R)


def test_groq_plain_text_second_chance(monkeypatch):
    """When Groq rejects strict JSON mode (failed_generation), the same
    prompt retries once as plain text — our parser tolerates fences, so a
    mode failure costs one retry, not the report. Other errors re-raise."""
    import asyncio
    import api.report as R

    calls = []

    async def fake_completion(key, prompt, json_mode):
        calls.append(json_mode)
        if json_mode:
            raise RuntimeError("groq HTTP 400: Failed to validate JSON. "
                               "See 'failed_generation' for more details.")
        return '{"text": "plain fallback"}'

    monkeypatch.setattr(R, "_groq_completion", fake_completion)
    text = asyncio.run(R._groq_report("k", "p"))
    assert text == '{"text": "plain fallback"}'
    assert calls == [True, False]

    async def fatal(key, prompt, json_mode):
        raise RuntimeError("groq HTTP 401: invalid key")

    monkeypatch.setattr(R, "_groq_completion", fatal)
    try:
        asyncio.run(R._groq_report("k", "p"))
        raise AssertionError("expected RuntimeError")
    except RuntimeError as exc:
        assert "invalid key" in str(exc)


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
