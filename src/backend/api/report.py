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
# Model IDs are env-overridable so the next vendor retirement is a config
# change, not a code change. Defaults verified September 2026:
# - gemini-2.0-flash was shut down June 1, 2026 (use 3.5-flash).
# - llama-3.1-8b-instant deprecation announced June 17, 2026
#   (use openai/gpt-oss-120b).
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
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


REPORT_KEYS = ("what", "why", "cause_effect", "check_next", "disclaimer",
               "p_bloom_cited", "ci_lo_cited", "ci_hi_cited")

# Sections are generated as SEPARATE small LLM calls (in parallel): each is
# a tiny constrained task — describe one thing, cite its numbers — so a
# failure retries one paragraph instead of the whole report, and validation
# is per-section data instead of whole-prose wording. The disclaimer is a
# fixed legal line and is never generated.
SECTION_SPECS = {
    "what": ("Summarize what was assessed (location, data time) and state "
             "the headline estimate with its exact decimals.", True),
    "why": ("Explain in plain words why the model leans this way, using "
            "only the supplied drivers and signals.", False),
    "cause_effect": ("Lay out the cause-and-effect chain, naming every "
                     "supplied driver by name.", False),
    "check_next": ("Say concretely what to check next before acting on "
                   "this estimate.", False),
}


def _measured_block(context):
    measured = json.dumps(context, sort_keys=True, separators=(",", ":"))
    return ("MEASURED_AND_COMPUTED\n" + measured + "\n\n"
            "GENERAL_BACKGROUND\n" + _background(context))


def build_section_prompt(context, key):
    instruction, needs_numbers = SECTION_SPECS[key]
    keys = '{"text": "..."'
    if needs_numbers:
        keys += (', "p_bloom_cited": <exact p_bloom decimal, e.g. 0.6992>, '
                 '"ci_lo_cited": <exact ci_lo decimal>, '
                 '"ci_hi_cited": <exact ci_hi decimal>')
    keys += '}'
    return (
        "You are BloomCast's grounded report writer.\n"
        "Use only the MEASURED_AND_COMPUTED values and the GENERAL_BACKGROUND "
        "snippet below. Keep it at an eighth-grade reading level. "
        "Do not add local facts, measurements, names, causes, or recommendations "
        "that are not present in those two sections. Never invent a number: "
        "every number you write must already appear in MEASURED_AND_COMPUTED "
        "(small day-counts aside). "
        + instruction + "\n"
        "Respond with a single JSON object and nothing else — no markdown "
        "fences, no prose outside the JSON — with exactly these keys:\n"
        + keys + "\n\n" + _measured_block(context)
    )


def build_prompt(context):
    measured = json.dumps(context, sort_keys=True, separators=(",", ":"))
    return (
        "You are BloomCast's grounded report writer.\n"
        "Use only the MEASURED_AND_COMPUTED values and the GENERAL_BACKGROUND "
        "snippet below. Keep the report at an eighth-grade reading level. "
        "Do not add local facts, measurements, names, causes, or recommendations "
        "that are not present in those two sections. Never invent a number. "
        "Use only drivers present in the scored feature row for the cause-and-effect section.\n"
        "Respond with a single JSON object and nothing else — no markdown "
        "fences, no prose outside the JSON — with exactly these keys:\n"
        '{"what": "...", "why": "...", "cause_effect": "...", '
        '"check_next": "...", "disclaimer": "Advisory only — not a safety determination.", '
        '"p_bloom_cited": <exact p_bloom decimal, e.g. 0.6992>, '
        '"ci_lo_cited": <exact ci_lo decimal>, '
        '"ci_hi_cited": <exact ci_hi decimal>}\n'
        "Copy the three decimals exactly as given (do not round, do not use "
        "percentages in these three fields); cite them again in plain words "
        "inside the what/why text.\n\n"
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
                "generationConfig": {
                    "temperature": 0.25,
                    "responseMimeType": "application/json",
                    "responseSchema": {
                        "type": "OBJECT",
                        "properties": {
                            "what": {"type": "STRING"},
                            "why": {"type": "STRING"},
                            "cause_effect": {"type": "STRING"},
                            "check_next": {"type": "STRING"},
                            "disclaimer": {"type": "STRING"},
                            "p_bloom_cited": {"type": "NUMBER"},
                            "ci_lo_cited": {"type": "NUMBER"},
                            "ci_hi_cited": {"type": "NUMBER"},
                        },
                        "required": list(REPORT_KEYS),
                    },
                },
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
                    {"role": "system", "content": "Write a grounded BloomCast report using only supplied facts. Respond with a single JSON object and nothing else."},
                    {"role": "user", "content": prompt},
                ],
                "response_format": {"type": "json_object"},
                "max_tokens": 900,
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
    """Gemini first (primary), Groq second (fallback) — in that order.

    Every provider's error is collected, not just the last: the surfaced
    message names each failure, so a dead primary can no longer hide behind
    the fallback's error.
    """
    keys = _provider_keys()
    errors = {}
    for name in ("gemini", "groq"):
        key = keys.get(name, "")
        if not key:
            continue
        try:
            return await _call_provider(name, key, prompt), name
        except Exception as exc:  # noqa: BLE001 - try the next provider
            errors[name] = exc
    if errors:
        detail = "; ".join(f"{name} failed: {error}"
                           for name, error in errors.items())
        raise RuntimeError(f"all configured providers failed: {detail}")
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


def _normalize_section_text(text):
    """Canonicalize text for validation: lowercase, unify arrows/dashes and
    whitespace so "Cause → effect chain" and "Cause-effect chain" count as
    the specified "Cause→effect chain" section. Matching stays strict on
    numbers (handled separately) — only headings get flexibility."""
    out = text.lower()
    for char in ("→", "—", "–", "-", ":", ">"):
        out = out.replace(char, " ")
    return re.sub(r"\s+", " ", out).strip()


def _mentions_number(text, value):
    """True when the text cites a number equal to value — either as the exact
    decimal ("0.6992") or as its percentage ("69.92%"). Both are verifiable
    citations of the same number; what is forbidden is a *different* number.
    Tolerance is half a percentage point to absorb 0.699→69.9% rounding."""
    try:
        target = float(value)
    except (TypeError, ValueError):
        return False
    for match in re.finditer(r"(\d+(?:\.\d+)?)\s*(%)?", text):
        mentioned = float(match.group(1))
        if match.group(2):
            mentioned /= 100.0
        if abs(mentioned - target) <= 0.005:
            return True
    return False


def _mentions_driver(cause, feature, human):
    """Driver cited when its key or human name appears modulo case and
    punctuation ("heat_wave_flag" matches "heat wave flag")."""
    norm = re.sub(r"[^a-z0-9]+", "", cause.lower())
    for alias in {str(feature), str(human)}:
        if re.sub(r"[^a-z0-9]+", "", alias.lower()) in norm:
            return True
    return False


def _context_numbers(context):
    """Every numeric value anywhere in the measured context (plus small day
    counts, which prose legitimately uses). A section may only cite these."""
    nums = set()

    def walk(node):
        if isinstance(node, bool):
            return
        if isinstance(node, (int, float)):
            nums.add(float(node))
            return
        if isinstance(node, str):
            for match in re.finditer(r"(\d+(?:\.\d+)?)\s*(%)?", node):
                value = float(match.group(1))
                nums.add(value / 100.0 if match.group(2) else value)
            return
        if isinstance(node, dict):
            for value in node.values():
                walk(value)
            return
        if isinstance(node, (list, tuple)):
            for value in node:
                walk(value)

    walk(context)
    return nums


def _prose_numbers_ok(text, allowed):
    """Every number in the prose must be an allowed one (exact decimal or
    its percentage, small tolerance). Small integers (day counts, "8th
    grade") are always fine; anything else must match the context."""
    for match in re.finditer(r"(\d+(?:\.\d+)?)\s*(%)?", text or ""):
        value = float(match.group(1))
        if match.group(2):
            value /= 100.0
        if value.is_integer() and 0 <= value <= 31:
            continue
        if any(abs(value - known) <= max(0.005, abs(known) * 1e-3)
               for known in allowed):
            continue
        return False
    return True


def _parse_json_object(text, required_keys):
    """Parse a provider JSON reply (tolerating markdown fences). Returns the
    dict when every required key holds a string or number and the text fields
    are non-empty — else None."""
    if not text or not text.strip():
        return None
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned).strip()
    try:
        parsed = json.loads(cleaned)
    except (ValueError, TypeError):
        return None
    if not isinstance(parsed, dict):
        return None
    if any(not isinstance(parsed.get(key), (str, int, float))
           for key in required_keys):
        return None
    return parsed


def _parse_json_report(text):
    """Parse a whole-report reply under the full contract (kept for the
    contract test; generation itself is section-by-section)."""
    parsed = _parse_json_object(text, REPORT_KEYS)
    if parsed is None:
        return None
    if not all(str(parsed[key]).strip() for key in
               ("what", "why", "cause_effect", "check_next")):
        return None
    return parsed


def _numbers_match(parsed, context):
    """The cited decimals must equal the scored values (tight tolerance —
    copying a number is exact work; anything else is invention)."""
    model = context.get("model_estimate") or {}
    for key in ("p_bloom", "ci_lo", "ci_hi"):
        value = model.get(key)
        if value is None:
            continue
        try:
            cited = float(parsed.get(f"{key}_cited"))
        except (TypeError, ValueError):
            return False
        if abs(cited - float(value)) > 0.0005:
            return False
    return True


def _is_valid_report(text, context):
    """Validate the parsed report DATA, not its wording: correct JSON shape,
    exact disclaimer, cited numbers equal to scored values, drivers named in
    the cause section. Formatting can no longer fail — there is no formatting
    for the model to get wrong."""
    parsed = _parse_json_report(text)
    if parsed is None:
        return False
    if str(parsed.get("disclaimer", "")).strip() != DISCLAIMER:
        return False
    if not _numbers_match(parsed, context):
        return False
    cause = str(parsed.get("cause_effect", ""))
    for driver in context.get("drivers") or []:
        if not isinstance(driver, dict) or not driver.get("feature"):
            continue
        if not _mentions_driver(cause, driver["feature"],
                                driver.get("human", "")):
            return False
    return True


def validation_feedback(text, context):
    """Name exactly which checks failed so the retry prompt can demand them."""
    parsed = _parse_json_report(text)
    if parsed is None:
        return ["respond with a single JSON object containing the keys "
                + ", ".join(REPORT_KEYS)]
    problems = []
    if str(parsed.get("disclaimer", "")).strip() != DISCLAIMER:
        problems.append("disclaimer field must be exactly "
                        f'"{DISCLAIMER}"')
    if not _numbers_match(parsed, context):
        model = context.get("model_estimate") or {}
        problems.append(
            "p_bloom_cited/ci_lo_cited/ci_hi_cited must equal exactly "
            f"{model.get('p_bloom')}/{model.get('ci_lo')}/{model.get('ci_hi')}"
        )
    cause = str(parsed.get("cause_effect", ""))
    for driver in context.get("drivers") or []:
        if not isinstance(driver, dict) or not driver.get("feature"):
            continue
        if not _mentions_driver(cause, driver["feature"],
                                driver.get("human", "")):
            problems.append(f"cause_effect must name driver: {driver['feature']}")
    return problems


def _render_report_text(parsed):
    """Render the validated JSON into the five-section display text the UI
    already renders — headings are ours, so they can never mismatch."""
    return (
        f"What\n{str(parsed['what']).strip()}\n\n"
        f"Why\n{str(parsed['why']).strip()}\n\n"
        f"Cause→effect chain\n{str(parsed['cause_effect']).strip()}\n\n"
        f"What to check next\n{str(parsed['check_next']).strip()}\n\n"
        f"Disclaimer\n{DISCLAIMER}\n"
    )


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


def _validate_section(key, parsed, context):
    """Validate one generated section's DATA. Returns a list of problems
    (empty when valid) so the retry can demand exactly what's missing."""
    problems = []
    text = str(parsed.get("text", "") or "")
    if not text.strip():
        return [f"{key}: empty text"]
    if len(text) > 2000:
        problems.append(f"{key}: too long, be concise")
    if key == "what":
        model = context.get("model_estimate") or {}
        for name in ("p_bloom", "ci_lo", "ci_hi"):
            value = model.get(name)
            if value is None:
                continue
            try:
                cited = float(parsed.get(f"{name}_cited"))
            except (TypeError, ValueError):
                problems.append(f"{key}: {name}_cited must equal exactly {value}")
                continue
            if abs(cited - float(value)) > 0.0005:
                problems.append(f"{key}: {name}_cited must equal exactly {value}")
    if key == "cause_effect":
        for driver in context.get("drivers") or []:
            if not isinstance(driver, dict) or not driver.get("feature"):
                continue
            if not _mentions_driver(text, driver["feature"],
                                    driver.get("human", "")):
                problems.append(f"{key}: must name driver {driver['feature']}")
    if not _prose_numbers_ok(text, _context_numbers(context)):
        problems.append(f"{key}: cites a number not present in the inputs")
    return problems


async def _generate_section(key, context):
    """Generate and validate one section (provider fallback included).
    Returns (text, provider, cited_dict). Raises RuntimeError naming the
    failed checks when the section cannot be produced honestly."""
    prompt = build_section_prompt(context, key)
    last_problems: list = ["no attempt yet"]
    provider = "template"
    for attempt in ("initial", "correction"):
        if attempt == "correction":
            prompt = prompt + (
                "\n\nSTRICT CORRECTION — your previous draft failed "
                "validation for these reasons; fix every one, keep "
                "everything else:\n- " + "\n- ".join(last_problems)
            )
        try:
            raw, provider = await asyncio.wait_for(
                _generate_with_fallback(prompt), timeout=14.0)
        except Exception as exc:  # noqa: BLE001 - provider errors, retry/caller decides
            last_problems = [f"provider error: {sanitize_error(exc)}"]
            continue
        parsed = _parse_json_object(raw, ("text",))
        if parsed is None or not str(parsed.get("text", "")).strip():
            last_problems = ["respond with a single JSON object with a "
                             "non-empty text field"]
            continue
        last_problems = _validate_section(key, parsed, context)
        if not last_problems:
            cited = {name: parsed.get(f"{name}_cited")
                     for name in ("p_bloom", "ci_lo", "ci_hi")}
            return str(parsed["text"]).strip(), provider, cited
    raise RuntimeError(f"section {key}: " + "; ".join(last_problems))
async def generate_report(body, assessment):
    """Assemble the report section by section (in parallel): each section is
    generated and validated on its own, so one bad paragraph retries alone
    instead of sinking the whole report into the template fallback."""
    keys = _provider_keys()
    if not any(keys.values()):
        raise NoKeyError("AI reports are not configured on this deployment")
    context = _build_context(assessment)
    area = await _validate_area(_area_name(body, assessment),
                                assessment.get("latitude"),
                                assessment.get("longitude"))
    context["area_validation"] = area
    order = tuple(SECTION_SPECS)
    try:
        sections = await asyncio.wait_for(
            asyncio.gather(*(_generate_section(key, context) for key in order)),
            timeout=25.0,
        )
    except Exception as exc:  # noqa: BLE001 - degrade to template
        return _template_report(context), "template", context, area, {
            "degraded": True,
            "reason": f"LLM generation timed out or failed: {sanitize_error(exc)}",
        }
    texts = dict(zip(order, sections, strict=False))
    parsed = {
        "what": texts["what"][0],
        "why": texts["why"][0],
        "cause_effect": texts["cause_effect"][0],
        "check_next": texts["check_next"][0],
        "disclaimer": DISCLAIMER,
        "p_bloom_cited": texts["what"][2].get("p_bloom"),
        "ci_lo_cited": texts["what"][2].get("ci_lo"),
        "ci_hi_cited": texts["what"][2].get("ci_hi"),
    }
    providers = {text[1] for text in texts.values()}
    provider = texts["what"][1] if len(providers) == 1 else "+".join(sorted(providers))
    return (_render_report_text(parsed), provider, context, area,
            {"degraded": False, "reason": None})
