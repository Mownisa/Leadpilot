"""Tiny provider-agnostic LLM client.

Groq, Gemini and OpenRouter all expose an OpenAI-compatible
`/chat/completions` endpoint, so one httpx call covers all three. Providers are
tried in order; the first one with a configured API key that answers wins. That
gives free-tier resilience (rate limits, outages) without any SDK dependency.
"""
import json
import logging
import os
import re
from dataclasses import dataclass

import httpx

log = logging.getLogger("leadpilot.llm")

TIMEOUT = float(os.getenv("LLM_TIMEOUT", "25"))


class LLMError(Exception):
    pass


@dataclass
class Provider:
    name: str
    url: str
    key: str
    model: str


# (name, url, api-key env var, model env var, default model)
_SPEC = [
    ("groq", "https://api.groq.com/openai/v1/chat/completions",
     "GROQ_API_KEY", "GROQ_MODEL", "llama-3.3-70b-versatile"),
    ("gemini", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
     "GEMINI_API_KEY", "GEMINI_MODEL", "gemini-2.5-flash"),
    ("openrouter", "https://openrouter.ai/api/v1/chat/completions",
     "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free"),
]


def providers() -> list[Provider]:
    out = []
    for name, url, key_env, model_env, default in _SPEC:
        key = os.getenv(key_env, "").strip()
        if key:
            out.append(Provider(name, url, key, os.getenv(model_env, default)))
    preferred = os.getenv("LLM_PROVIDER", "").strip().lower()
    out.sort(key=lambda p: 0 if p.name == preferred else 1)
    return out


async def chat_completion(
    messages: list[dict],
    *,
    json_mode: bool = False,
    temperature: float = 0.3,
    max_tokens: int = 1800,
) -> tuple[str, str]:
    """Returns (text, provider_name). Raises LLMError if every provider fails."""
    provs = providers()
    if not provs:
        raise LLMError(
            "No AI provider configured. Set GROQ_API_KEY (or GEMINI_API_KEY / OPENROUTER_API_KEY)."
        )
    errors: list[str] = []
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        for p in provs:
            body = {
                "model": p.model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
            if json_mode:
                body["response_format"] = {"type": "json_object"}
            headers = {"Authorization": f"Bearer {p.key}"}
            try:
                r = await client.post(p.url, headers=headers, json=body)
                # Some models reject response_format; retry once without it.
                if r.status_code == 400 and json_mode:
                    body.pop("response_format", None)
                    r = await client.post(p.url, headers=headers, json=body)
                r.raise_for_status()
                text = r.json()["choices"][0]["message"]["content"] or ""
                if not text.strip():
                    raise ValueError("empty completion")
                return text, p.name
            except httpx.HTTPStatusError as e:
                detail = e.response.text[:300]
                log.warning("provider %s failed: HTTP %s %s", p.name, e.response.status_code, detail)
                errors.append(f"{p.name}: HTTP {e.response.status_code} {detail[:120]}")
            except Exception as e:  # noqa: BLE001 - we want to fall through to the next provider
                log.warning("provider %s failed: %s", p.name, e)
                errors.append(f"{p.name}: {type(e).__name__}")
    raise LLMError("All AI providers failed (" + ", ".join(errors) + "). Please retry in a moment.")


def extract_json(text: str) -> dict:
    """Pull the first JSON object out of a model response (handles ```json fences)."""
    text = re.sub(r"```(?:json)?", "", text).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object in response")
    return json.loads(text[start : end + 1])