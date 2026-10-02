"""FHIR R4 bundle builder for BloomCast alerts."""
from datetime import datetime, timezone


def build_alert_bundle(
    alert_id: str,
    waterbody_id: str,
    waterbody_name: str,
    city: str,
    country: str,
    longitude: float,
    latitude: float,
    altitude: float,
    horizon_days: int,
    p_bloom: float,
    ci_lo: float,
    ci_hi: float,
    threshold: float,
    model_version: str,
    sent_at: str,
    recipient: str | None,
    shap_top_features: list,
) -> dict:
    comm_id = f"comm-{alert_id}"
    obs_id = f"obs-{alert_id}"
    loc_id = f"wb-{waterbody_id}"
    # Driver contributions are model-internal scores, not percentages: printing
    # "-138%" in a clinical message reads as nonsense (and over 100% is
    # absurd), so the human sentence carries direction words only. Exact
    # values stay in the SHAP payload / forecast endpoint for analysts.
    summary = "; ".join(
        f"{f['human']} ({'raises' if f['shap_value'] > 0 else 'lowers'} risk)"
        for f in shap_top_features[:3]
    )
    return {
        "resourceType": "Bundle",
        "type": "collection",
        "timestamp": sent_at,
        "entry": [
            {
                "fullUrl": f"urn:uuid:{comm_id}",
                "resource": {
                    "resourceType": "Communication",
                    "id": comm_id,
                    "status": "completed",
                # The alert is ABOUT a waterbody, not about a patient: HAPI
                # (correctly) rejects Location targets on Communication.subject,
                # while Communication.about accepts any resource type.
                "about": [{"reference": f"Location/{loc_id}"}],
                "sent": sent_at,
                **({"recipient": [{"reference": f"mailto:{recipient}"}]}
                   if recipient else {}),
                "sender": {
                        "display": "BloomCast Early Warning System",
                        "identifier": {"system": "https://bloomcast-api.onrender.com", "value": model_version},
                    },
                    "payload": [
                        {"contentString": (
                            f"BloomCast alert: {waterbody_name} {horizon_days}-day bloom probability "
                            f"{round(p_bloom * 100)}% (CI {round(ci_lo * 100)}-{round(ci_hi * 100)}%). "
                            f"Triggered by threshold ≥{round(threshold * 100)}%. Drivers: {summary}."
                        )},
                        {
                            "contentAttachment": {
                                "contentType": "application/json",
                                "url": f"https://bloomcast-api.onrender.com/v1/forecast/{waterbody_id}",
                                "title": "Detailed forecast with SHAP explanations",
                            }
                        },
                    ],
                    "extension": [
                        {"url": "https://bloomcast-api.onrender.com/fhir/extensions/model-version", "valueString": model_version},
                        {"url": "https://bloomcast-api.onrender.com/fhir/extensions/lead-time-days", "valueInteger": horizon_days},
                        {"url": "https://bloomcast-api.onrender.com/fhir/extensions/confidence-low", "valueDecimal": ci_lo},
                        {"url": "https://bloomcast-api.onrender.com/fhir/extensions/confidence-high", "valueDecimal": ci_hi},
                    ],
                },
            },
            {
                "fullUrl": f"urn:uuid:{obs_id}",
                "resource": {
                    "resourceType": "Observation",
                    "id": obs_id,
                    "status": "final",
                    "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "laboratory"}]}],
                    "code": {"coding": [{"system": "https://bloomcast-api.onrender.com/fhir/codes/bloom-risk", "code": "cyanobacteria-bloom-probability", "display": f"Cyanobacteria bloom probability ({horizon_days}-day horizon)"}]},
                    "effectiveDateTime": sent_at,
                    "valueQuantity": {"value": p_bloom, "unit": "probability", "system": "http://unitsofmeasure.org", "code": "1"},
                    "component": [
                        {"code": {"coding": [{"system": "https://bloomcast-api.onrender.com/fhir/codes/ci-low", "code": "ci-low"}]}, "valueQuantity": {"value": ci_lo}},
                        {"code": {"coding": [{"system": "https://bloomcast-api.onrender.com/fhir/codes/ci-high", "code": "ci-high"}]}, "valueQuantity": {"value": ci_hi}},
                    ],
                },
            },
            {
                "fullUrl": f"urn:uuid:{loc_id}",
                "resource": {
                    "resourceType": "Location",
                    "id": loc_id,
                    "name": waterbody_name,
                    "description": "Monitored freshwater body — cyanobacteria bloom risk forecast",
                    "type": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3-RoleCode", "code": "LAKE", "display": "Lake"}]}],
                    "address": {"city": city, "country": country},
                    "position": {"longitude": longitude, "latitude": latitude, "altitude": altitude},
                    "physicalType": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/location-physical-type", "code": "area", "display": "Area"}]},
                },
            },
        ],
    }