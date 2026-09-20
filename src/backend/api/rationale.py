"""Optional LLM narratives for predictions (Gemini / Groq).

Scope honesty first: an API key does NOT train models and does NOT improve
accuracy. What it buys is a plain-language narrative over numbers the system
already computed — the same role LLMs play in KiloNOVAScout (rationale
generation, never scoring).

No SDK dependencies — raw HTTPS via httpx (already a runtime dep). No key
configured means HTTP 501 from the endpoint, never a silent failure. Keys
stay server-side; the frontend only ever sees the returned text.
"""
import os

import httpx

SYSTEM = (
    "You are BloomCast's explainer. Given bloom-risk numbers for a location, "
    "write 3-5 short sentences of plain-language rationale for a non-expert: "
    "what is driving the risk, what to watch, what a citizen could check. "
    "Cite the numbers you were given. Never invent data. End with exactly: "
    "'Advisory only — not a safety determination.'"
)

GEMINI_MODEL = "gemini-2.0-flash"
GROQ_MODEL = "llama-3.1-8b-instant"


class NoKeyError(Exception):
    """Raised when no provider key is configured."""


def build_prompt(context: dict) -> str:
    lines = ["BloomCast assessment context (JSON):"]
    for key in ("latitude", "longitude", "wash_off", "week_ahead",
                "signals", "model_estimate", "past_30d"):
        if key in context:
            lines.append(f"- {key}: {context[key]}")
    lines.append("Explain the risk in plain language.")
    return "\n".join(lines)


def _provider_keys() -> dict:
    return {
        "gemini": os.environ.get("GEMINI_API_KEY", ""),
        "groq": os.environ.get("GROQ_API_KEY", ""),
    }


async def generate_rationale(provider: str, context: dict) -> tuple[str, str]:
    """Returns (text, provider_used). Raises NoKeyError or RuntimeError."""
    keys = _provider_keys()
    order = [provider] if provider in keys else ["gemini", "groq"]
    prompt = build_prompt(context)
    last_err: Exception | None = None
    for name in order:
        key = keys.get(name, "")
        if not key:
            continue
        try:
            if name == "gemini":
                return await _gemini(key, prompt), "gemini"
            return await _groq(key, prompt), "groq"
        except Exception as exc:  # noqa: BLE001 - try the next provider
            last_err = exc
    if last_err is not None:
        raise RuntimeError(f"all configured providers failed: {last_err}")
    raise NoKeyError(
        "AI explanations are not configured on this deployment "
        "(set GEMINI_API_KEY or GROQ_API_KEY)"
    )


async def _gemini(key: str, prompt: str) -> str:
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
            headers={"x-goog-api-key": key, "Content-Type": "application/json"},
            json={"system_instruction": {"parts": [{"text": SYSTEM}]},
                  "contents": [{"parts": [{"text": prompt}]}]},
        )
        r.raise_for_status()
        data = r.json()
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"].strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"unexpected Gemini response shape: {exc}") from exc


async def _groq(key: str, prompt: str) -> str:
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": GROQ_MODEL,
                  "messages": [{"role": "system", "content": SYSTEM},
                               {"role": "user", "content": prompt}],
                  "max_tokens": 400, "temperature": 0.3},
        )
        r.raise_for_status()
        data = r.json()
    try:
        return data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"unexpected Groq response shape: {exc}") from exc
