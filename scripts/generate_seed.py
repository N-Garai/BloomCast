"""Generate deterministic seed data for the demo dataset."""
import sys, os, json, datetime as dt

# scripts/generate_seed.py -> scripts/ -> <repo root>
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SRC = os.path.join(_ROOT, "src")
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
sys.path.insert(0, os.path.join(_SRC, "backend"))

from ml.inference.predict import train_and_predict, per_waterbody_forecasts

forecast, scorecard, sandbox = train_and_predict()
profiles = per_waterbody_forecasts()
out_dir = os.path.join(_SRC, "data", "seed")
os.makedirs(out_dir, exist_ok=True)

with open(os.path.join(_SRC, "data", "waterbodies.geojson")) as f:
    wbs = json.load(f)["features"]

for n, wb in enumerate(wbs):
    fid = wb["properties"]["id"]
    prof = profiles[n % len(profiles)]
    fcopy = json.loads(json.dumps(forecast))
    fcopy.update(prof)
    fcopy["waterbody_id"] = fid
    fcopy["name"] = wb["properties"]["name"]
    fcopy["region"] = wb["properties"]["region"]
    fcopy["country"] = wb["properties"]["country"]
    fcopy["centroid"] = wb["properties"]["centroid"]
    fcopy["type"] = wb["properties"]["type"]
    with open(os.path.join(out_dir, f"forecast-{fid}.json"), "w") as f:
        json.dump(fcopy, f, indent=2, default=str)

with open(os.path.join(_SRC, "data", "replay_events.json")) as f:
    events = json.load(f)["events"]

for ev in events:
    eid = ev["event_id"]
    days = []
    s = dt.date.fromisoformat(ev["start_date"])
    conf = dt.date.fromisoformat(ev["confirmation_date"])
    end = dt.date.fromisoformat(ev["end_date"])
    d = s
    idx = 0
    while d <= end:
        lead = (conf - d).days
        if lead > 7:
            p = 0.18 + 0.02 * idx
        elif lead > 5:
            p = 0.35 + 0.06 * (7 - lead)
        elif lead > 3:
            p = 0.55 + 0.06 * (5 - lead)
        elif lead > 0:
            p = 0.70 + 0.05 * (3 - lead)
        else:
            p = 0.88 + 0.02 * (d - conf).days
        p = min(0.97, max(0.1, p + (idx % 3) * 0.01))
        days.append({
            "date": d.isoformat(),
            "lead_time_days": max(0, lead),
            "forecast_probability": round(p, 3),
            "ci_lo": round(max(0.0, p - 0.12), 3),
            "ci_hi": round(min(1.0, p + 0.12), 3),
            "ndci_chip": f"chips/{eid}-{d.isoformat()}.webp",
            "shap_top_features": [
                {"feature": "wind_speed_mean_3d", "human": "Calm winds (low mixing)", "shap_value": round(0.18 - 0.01 * idx, 3)},
                {"feature": "ndci_trend_5d", "human": "Rising chlorophyll trend", "shap_value": round(0.14 + 0.01 * idx, 3)},
                {"feature": "temp_anomaly_7d", "human": "Surface temperature anomaly", "shap_value": round(0.09 + 0.005 * idx, 3)},
            ],
            "satellite_ndci": round(0.05 + 0.02 * idx + (0.35 if d >= conf else 0), 3),
        })
        d += dt.timedelta(days=1)
        idx += 1
    with open(os.path.join(out_dir, f"replay-{eid}.json"), "w") as f:
        json.dump({
            "event_id": eid,
            "waterbody_id": ev["waterbody_id"],
            "name": ev["name"],
            "confirmation_date": ev["confirmation_date"],
            "lead_time_days": ev["lead_time_days"],
            "forecast_hit": ev["forecast_hit"],
            "severity_peak": ev["severity_peak"],
            "description": ev["description"],
            "source": ev["source"],
            "days": days,
        }, f, indent=2)

with open(os.path.join(out_dir, "scorecard.json"), "w") as f:
    json.dump(scorecard, f, indent=2, default=str)

for wb in wbs:
    fid = wb["properties"]["id"]
    with open(os.path.join(out_dir, f"sandbox-{fid}.json"), "w") as f:
        json.dump({
            "waterbody_id": fid,
            "name": wb["properties"]["name"],
            "baseline_annual_high_risk_days": 18,
            "scenarios": sandbox,
        }, f, indent=2, default=str)

with open(os.path.join(_SRC, "data", "stream_segments.geojson")) as f:
    segs = json.load(f)["features"]

for seg in segs:
    sid = seg["properties"]["id"]
    with open(os.path.join(out_dir, f"streamflush-{sid}.json"), "w") as f:
        json.dump({
            "segment_id": sid,
            "name": seg["properties"]["name"],
            "city": seg["properties"]["city"],
            "country": seg["properties"]["country"],
            "risk_score": round(0.35 + (hash(sid) % 60) / 100, 3),
            "risk_level": ["low", "moderate", "high", "critical"][hash(sid) % 4],
            "rainfall_48h_mm": round(12.0 + (hash(sid) % 40), 1),
            "dry_days_antecedent": round(2.0 + (hash(sid) % 10), 1),
            "impervious_proxy": seg["properties"]["impervious_proxy"],
            "updated_at": "2026-09-18T02:00:00Z",
        }, f, indent=2)

# FHIR sample bundle
from ml.training.fhir_bundle import build_alert_bundle
with open(os.path.join(out_dir, "fhir-alert-sample.json"), "w") as f:
    json.dump(build_alert_bundle(
        alert_id="sample", waterbody_id="CH-ZUR-01", waterbody_name="Lake Zurich",
        city="Zurich", country="CH", longitude=8.541, latitude=47.327, altitude=406,
        horizon_days=5, p_bloom=0.64, ci_lo=0.52, ci_hi=0.76, threshold=0.6,
        model_version="sha-sample", sent_at="2026-09-18T02:30:00Z",
        recipient="elena.vasquez@lisboa.pt",
        shap_top_features=forecast["shap_top_features"],
    ), f, indent=2, default=str)

print("seed files written:", len(os.listdir(out_dir)))
for fn in sorted(os.listdir(out_dir)):
    print(" ", fn)