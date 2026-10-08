import collections
import logging
import os
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import llm, prompts
from .schemas import (
    Analysis,
    AnalyzeRequest,
    ChatRequest,
    DebriefRequest,
    DebriefResult,
)

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="LeadPilot API", docs_url="/api/docs", openapi_url="/api/openapi.json")

# ---- tiny best-effort per-IP rate limit (protects the free-tier API key) ----
RATE_LIMIT = int(os.getenv("RATE_LIMIT_PER_MIN", "30"))
_hits: dict[str, collections.deque] = collections.defaultdict(collections.deque)


def _rate_limit(request: Request) -> None:
    fwd = request.headers.get("x-forwarded-for", "")
    ip = fwd.split(",")[0].strip() or (request.client.host if request.client else "unknown")
    now = time.time()
    q = _hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        raise HTTPException(429, "Too many requests - please wait a minute and retry.")
    q.append(now)


def tier(score: int) -> str:
    """Tier is derived from the score in code, not by the LLM, so ranking is consistent."""
    return "hot" if score >= 70 else "warm" if score >= 40 else "cold"


@app.exception_handler(llm.LLMError)
async def _llm_error(_: Request, exc: llm.LLMError):
    return JSONResponse(status_code=502, content={"detail": str(exc)})


async def _structured(messages: list[dict], model_cls):
    """Call the LLM in JSON mode, validate, and retry once with a corrective nudge."""
    for _ in range(2):
        text, provider = await llm.chat_completion(messages, json_mode=True, temperature=0.2)
        try:
            return model_cls.model_validate(llm.extract_json(text)), provider
        except Exception as e:  # noqa: BLE001
            logging.warning("invalid model output: %s", e)
            messages = messages + [
                {"role": "assistant", "content": text},
                {"role": "user", "content": "That was not valid. Return ONLY the JSON object with ALL required keys."},
            ]
    raise HTTPException(502, "The AI returned an unreadable response. Please try again.")


@app.get("/api/health")
async def health():
    return {"ok": True, "providers": [p.name for p in llm.providers()]}


@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest, request: Request):
    _rate_limit(request)
    analysis, provider = await _structured(prompts.analysis_messages(req.lead), Analysis)
    return {"analysis": analysis.model_dump(), "tier": tier(analysis.score), "provider": provider}


@app.post("/api/chat")
async def chat(req: ChatRequest, request: Request):
    _rate_limit(request)
    history = [t.model_dump() for t in req.history]
    msgs = prompts.chat_messages(req, history, req.message)
    text, provider = await llm.chat_completion(msgs, temperature=0.5, max_tokens=900)
    return {"reply": text.strip(), "provider": provider}


@app.post("/api/debrief")
async def debrief(req: DebriefRequest, request: Request):
    _rate_limit(request)
    result, provider = await _structured(prompts.debrief_messages(req, req.notes), DebriefResult)
    data = result.model_dump()
    what_changed = data.pop("what_changed")
    return {
        "analysis": data,
        "tier": tier(result.score),
        "score_delta": result.score - req.analysis.score,
        "what_changed": what_changed,
        "provider": provider,
    }


# Local dev: serve the static frontend from the same process. On Vercel the
# files in public/ are served by the CDN and only /api/* reaches this app.
_PUBLIC = Path(__file__).resolve().parent.parent / "public"
if _PUBLIC.exists():
    app.mount("/", StaticFiles(directory=_PUBLIC, html=True), name="static")
