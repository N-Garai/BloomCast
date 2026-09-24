"""Grounded AI bloom reports built from server-side assessments."""
import asyncio
import json
import os
import re
from datetime import UTC, datetime
from math import asin, cos, radians, sin, sqrt

import httpx

from api.infer import assess_location as _infer_assess_location
from features.feature_store import humanize_feature

DISCLAIMER = "Advisory only — not a safety determination."
GEMINI_MODEL = "gemini-2.0-flash"
GROQ_MODEL = "llama-3.1-8b-instant"
SYSTEM = (
    "You are BloomCast's grounded report writer. Use only supplied measured or "
    "computed values and verified background. Do not invent facts or numbers. "
    "Keep the report at an eighth-grade reading level and end with the exact "
    "BloomCast advisory disclaimer."
)


class NoKeyError(Exception):
    """Raised when no report provider is configured."""


def _utc_now():
    return datetime.now(UTC).isoformat()


def _provider_keys():
    # Pasted keys routinely arrive with trailing newlines/whitespace from the
    # Render dashboard — an unstripped "\n" makes httpx reject the header
    # ("Illegal header value") and kills the provider.
    return {
        "gemini": os.environ.get("GEMINI_API_KEY", "").strip(),
        "groq": os.environ.get("GROQ_API_KEY", "").strip(),
    }


# Patterns that must never reach a client response or log line. Provider
# exceptions echo request headers (httpx "Illegal header value" prints the
# offending Bearer value verbatim), so every surfaced error passes through
# sanitize_error first — no API key ever comes to the front.
_KEY_PATTERNS = (
    r"gsk_[A-Za-z0-9]+",
    r"AIza[A-Za-z0-9_-]+",
    r"sk-(?:proj-)?[A-Za-z0-9]+",
    r"Bearer\s+\S+",
    r"x-goog-api-key[\"']?\s*[:=]\s*\S+",
)


def sanitize_error(exc):
    """Redact secrets from an exception before it leaves the backend."""
    text = str(exc)
    for pattern in _KEY_PATTERNS:
        text = re.sub(pattern, "[redacted]", text)
    text = re.sub(r"[\r\n]+", " ", text)
    return text[:500]


def providers_configured():
    return any(_provider_keys().values())


async def assess_location(latitude, longitude):
    return await _infer_assess_location(latitude, longitude)


def _number_token(value):
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip()
    return text or None


def _haversine_km(lat1, lon1, lat2, lon2):
    radius_km = 6371.0
    lat1, lat2 = radians(lat1), radians(lat2)
    delta_lat = radians(lat2 - lat1)
    delta_lon = radians(lon2 - lon1)
    a = (sin(delta_lat / 2) ** 2
         + cos(lat1) * cos(lat2) * sin(delta_lon / 2) ** 2)
    return 2 * radius_km * asin(sqrt(a))


def _area_name(body, assessment):
    name = body.get("name") or body.get("waterbody_name")
    if not name:
        nearest = assessment.get("nearest_waterbody") or {}
        name = nearest.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()
    return None


def _build_context(assessment):
    model = assessment.get("model_estimate") or {}
    feature_row = assessment.get("feature_row") or []
    return {
        "latitude": assessment.get("latitude"),
        "longitude": assessment.get("longitude"),
        "provenance": assessment.get("provenance"),
        "fetched_at": assessment.get("fetched_at"),
        "generated_at": _utc_now(),
        "cache": assessment.get("cache") or {},
        "stale": assessment.get("stale"),
        "feature_names": assessment.get("feature_names") or [],
        "feature_row": feature_row,
        "feature_count": len(feature_row),
        "model_estimate": model,
        "drivers": model.get("drivers") or [],
        "wash_off": assessment.get("wash_off") or {},
        "week_ahead": assessment.get("week_ahead") or {},
        "spectral_prior": assessment.get("spectral_prior") or {},
        "signals": assessment.get("signals") or [],
        "caveats": assessment.get("caveats") or [],
    }


def _background(context):
    area = context.get("area_validation") or {}
    if area.get("status") != "validated":
        return "No verified area background was retrieved."
    name = area.get("matched_name") or area.get("name") or "the supplied area"
    description = area.get("description")
    location = ""
    if area.get("latitude") is not None and area.get("longitude") is not None:
        location = f" at {area['latitude']}, {area['longitude']}"
    return f"{name}{location}: {description}" if description else f"{name}{location}."


def build_prompt(context):
    measured = json.dumps(context, sort_keys=True, separators=(",", ":"))
    return (
        "You are BloomCast's grounded report writer.\n"
        "Use only the MEASURED_AND_COMPUTED values and the GENERAL_BACKGROUND "
        "snippet below. Keep the report at an eighth-grade reading level. "
        "Do not add local facts, measurements, names, causes, or recommendations "
        "that are not present in those two sections. Never invent a number. "
        "When p_bloom, ci_lo, and ci_hi are present, cite their exact decimal "
        "strings; do not convert them to percentages. Use only drivers present "
        "in the scored feature row for the cause-and-effect section.\n"
        "Return the five sections below in this order: What, Why, Cause→effect "
        "chain, What to check next, Disclaimer. End with the Disclaimer section "
        "whose final line is exactly: " + DISCLAIMER + "\n\n"
        "MEASURED_AND_COMPUTED\n" + measured + "\n\n"
        "GENERAL_BACKGROUND\n" + _background(context)
    )


async def _gemini_report(key, prompt):
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
            headers={"x-goog-api-key": key, "Content-Type": "application/json"},
            json={
                "system_instruction": {"parts": [{"text": SYSTEM}]},
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.25},
            },
        )
        response.raise_for_status()
        data = response.json()
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"].strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"unexpected Gemini response shape: {exc}") from exc


async def _groq_report(key, prompt):
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": GROQ_MODEL,
                "messages": [
                    {"role": "system", "content": "Write a grounded BloomCast report using only supplied facts."},
                    {"role": "user", "content": prompt},
                ],
                "max_tokens": 600,
                "temperature": 0.25,
            },
        )
        response.raise_for_status()
        data = response.json()
    try:
        return data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"unexpected Groq response shape: {exc}") from exc


async def _call_provider(name, key, prompt):
    if name == "gemini":
        return await _gemini_report(key, prompt)
    return await _groq_report(key, prompt)


async def _generate_with_fallback(prompt):
    keys = _provider_keys()
    last_error = None
    for name in ("gemini", "groq"):
        key = keys.get(name, "")
        if not key:
            continue
        try:
            return await _call_provider(name, key, prompt), name
        except Exception as exc:  # noqa: BLE001 - try the next provider
            last_error = exc
    if last_error is not None:
        raise RuntimeError(f"all configured providers failed: {last_error}")
    raise NoKeyError(
        "AI reports are not configured on this deployment "
        "(set GEMINI_API_KEY or GROQ_API_KEY)"
    )


async def _validate_area(name, latitude, longitude):
    result = {
        "name": name,
        "status": "not_requested" if not name else "unavailable",
        "source": "Wikidata REST wbsearchentities",
        "retrieved_at": _utc_now(),
    }
    if not name:
        return result
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                "https://www.wikidata.org/w/api.php",
                params={
                    "action": "wbsearchentities",
                    "search": name,
                    "language": "en",
                    "format": "json",
                    "formatversion": 2,
                    "limit": 10,
                },
            )
            response.raise_for_status()
            data = response.json()
    except Exception:  # noqa: BLE001 - area lookup is optional
        return {**result, "error": "Wikidata lookup unavailable"}

    candidates = data.get("search") or []
    allowed_types = {"waterbody", "lake", "river", "reservoir", "dam", "water"}
    candidate = None
    for item in candidates:
        candidate_type = str(item.get("type") or item.get("entitytype") or "").lower()
        description = str(item.get("description") or item.get("label") or "").lower()
        if candidate_type and candidate_type not in allowed_types:
            continue
        if not candidate_type and not any(
            term in description for term in ("waterbody", "lake", "river", "reservoir", "dam", "water")
        ):
            continue
        candidate = item
        break
    if candidate is None:
        return {**result, "status": "not_found"}

    label = candidate.get("label") or {}
    matched_name = candidate.get("title") or (label.get("value") if isinstance(label, dict) else None)
    description = candidate.get("description") or (label.get("desc") if isinstance(label, dict) else None)
    coordinate = candidate.get("coordinate") or {}
    candidate_lat = coordinate.get("lat")
    candidate_lon = coordinate.get("lon")
    distance_km = None
    if candidate_lat is not None and candidate_lon is not None:
        try:
            distance_km = _haversine_km(
                float(latitude), float(longitude), float(candidate_lat), float(candidate_lon)
            )
        except (TypeError, ValueError, OverflowError):
            distance_km = None
    status = "validated" if distance_km is not None and distance_km <= 100.0 else "coordinate_mismatch"
    return {
        **result,
        "status": status,
        "exists": True,
        "matched_name": matched_name,
        "description": description,
        "latitude": candidate_lat,
        "longitude": candidate_lon,
        "distance_km": round(distance_km, 2) if distance_km is not None else None,
    }


def _is_valid_report(text, context):
    if not text or not text.strip():
        return False
    if not text.strip().endswith(DISCLAIMER):
        return False
    required_sections = (
        "What\n",
        "Why\n",
        "Cause→effect chain\n",
        "What to check next\n",
        "Disclaimer",
    )
    if not all(section in text for section in required_sections):
        return False
    model = context.get("model_estimate") or {}
    values = [model.get("p_bloom"), model.get("ci_lo"), model.get("ci_hi")]
    if not all(_number_token(value) in text for value in values if value is not None):
        return False
    cause_start = text.find("Cause→effect chain\n")
    cause_end = text.find("What to check next\n", cause_start)
    if cause_start < 0 or cause_end < 0:
        return False
    cause = text[cause_start + len("Cause→effect chain\n"):cause_end]
    for driver in context.get("drivers") or []:
        feature = driver.get("feature") if isinstance(driver, dict) else None
        if not feature:
            continue
        aliases = {str(feature), humanize_feature(str(feature))}
        if not any(alias in cause for alias in aliases):
            return False
    return True


def _template_report(context):
    model = context.get("model_estimate") or {}
    wash_off = context.get("wash_off") or {}
    latitude = context.get("latitude")
    longitude = context.get("longitude")
    location = (
        f"{latitude}, {longitude}"
        if latitude is not None and longitude is not None
        else "the assessed location"
    )
    fetched = context.get("fetched_at") or "a recent assessment"
    if model.get("p_bloom") is not None:
        score_text = f"The model estimate is {_number_token(model['p_bloom'])}"
        if model.get("ci_lo") is not None and model.get("ci_hi") is not None:
            score_text += (
                f" with the reported interval {_number_token(model['ci_lo'])} to "
                f"{_number_token(model['ci_hi'])}"
            )
        score_text += "."
    else:
        risk_score = _number_token(wash_off.get("risk_score"))
        score_text = (
            f"The live weather assessment gives a wash-off risk score of {risk_score}, "
            "which is not a calibrated bloom probability."
            if risk_score is not None
            else "No calibrated bloom probability or wash-off risk score was available."
        )
    drivers = []
    for driver in context.get("drivers") or []:
        if not isinstance(driver, dict):
            continue
        feature = driver.get("feature")
        if not feature:
            continue
        shap_value = _number_token(driver.get("shap_value"))
        if shap_value is not None:
            drivers.append(f"{humanize_feature(str(feature))} ({shap_value})")
        else:
            drivers.append(humanize_feature(str(feature)))
    driver_text = "; ".join(drivers) if drivers else "the supplied feature row"
    signals = " ".join(str(signal) for signal in context.get("signals") or [])
    area = context.get("area_validation") or {}
    if area.get("status") == "validated":
        area_text = f" Wikidata identifies {area.get('matched_name')} near the assessed coordinates."
    else:
        area_text = ""
    what = (
        f"What\nBloomCast assessed {location} using live weather data fetched at {fetched}.{area_text}\n"
        f"{score_text}"
    )
    why = f"Why\nThe report uses the supplied feature row and model output. {driver_text}."
    if drivers:
        cause = (
            "Cause→effect chain\n"
            f"The scored feature row contains {driver_text}. {signals or 'No strong weather signal was flagged.'}"
        )
    else:
        cause = (
            "Cause→effect chain\n"
            "No scored driver was available for the cause-and-effect chain. "
            f"{signals or 'No strong weather signal was flagged.'}"
        )
    check = (
        "What to check next\n"
        "Check the next live weather window, the spectral prior status, and citizen reports before acting on this estimate."
    )
    return f"{what}\n\n{why}\n\n{cause}\n\n{check}\n\nDisclaimer\n{DISCLAIMER}\n"


async def generate_report(body, assessment):
    keys = _provider_keys()
    if not any(keys.values()):
        raise NoKeyError("AI reports are not configured on this deployment")
    context = _build_context(assessment)
    area = await _validate_area(_area_name(body, assessment),
                                assessment.get("latitude"),
                                assessment.get("longitude"))
    context["area_validation"] = area
    prompt = build_prompt(context)
    try:
        text, provider = await asyncio.wait_for(_generate_with_fallback(prompt), timeout=14.0)
    except Exception as exc:  # noqa: BLE001 - degrade to template
        return _template_report(context), "template", context, area, {
            "degraded": True,
            "reason": f"LLM generation timed out or failed: {sanitize_error(exc)}",
        }
    if not _is_valid_report(text, context):
        try:
            text, provider = await asyncio.wait_for(_generate_with_fallback(prompt), timeout=14.0)
        except Exception as exc:  # noqa: BLE001 - one retry then template
            return _template_report(context), "template", context, area, {
                "degraded": True,
                "reason": f"Report number check failed and retry failed: {sanitize_error(exc)}",
            }
    if not _is_valid_report(text, context):
        return _template_report(context), "template", context, area, {
            "degraded": True,
            "reason": "Report number check failed; template report used",
        }
    return text, provider, context, area, {"degraded": False, "reason": None}
