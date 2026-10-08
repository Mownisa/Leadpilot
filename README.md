# LeadPilot - AI lead prioritization copilot for real-estate sales

Built for the Masal AI FDE assignment (Round 2).

**Live app:** `<paste your Vercel URL here>`  
**Demo video:** `<paste your Loom / unlisted YouTube link here>`

## What I built

A salesperson gets hundreds of leads a day. LeadPilot lets them add a lead, and an LLM instantly produces a scannable brief, a priority score, a next action and a ready-to-send reply. Leads are ranked into **Hot / Warm / Cold** so the best ones are always on top.

| Requirement | Where it lives |
|---|---|
| Lead intake form (name, location, requirement, budget, timeline, free-text message) | "+ New lead" modal |
| AI analysis: summary, intent, key requirements, objections, next action, suggested response | Cards on the lead page, produced by `POST /api/analyze` |
| Conversational follow-up grounded in the lead | "Ask copilot" tab, `POST /api/chat` |
| Multiple saved leads, ranked by AI score, grouped hot/warm/cold | Sidebar (saved in the browser's localStorage) |
| Clear display | Next action is the top banner, score bar + tier badge, one-line cards, copy button |
| **My own feature: "Log a call" re-scoring + follow-up queue** | see below |

### My own feature: post-call debrief, re-scoring and a follow-up queue

Most lead tools stop at the first-contact analysis, but a real salesperson's day is *before, during and after* the call. After a call, the salesperson pastes rough notes ("husband wants 2% off, visiting Sunday"). The AI:

1. re-scores the lead using the new information (score can go up or down, and the UI shows the delta),
2. rewrites the recommended next action and the suggested message for the *new* situation,
3. writes one sentence on **what changed and why**,
4. logs everything to a per-lead timeline.

Every analysis also returns `follow_up_hours`. That drives a **due badge** on each lead ("Follow up now", "Due in 3h") and a banner "N follow-ups due in the next 24h", so leads that need attention today don't get lost. Chat and later analyses also see the timeline, so the copilot remembers what happened on earlier calls.

## Architecture

```
Browser (public/: index.html, style.css, app.js - vanilla JS, no build step)
   |  localStorage = lead database (leads, chat history, timeline)
   |  fetch /api/*  (every request carries the lead context it needs)
   v
FastAPI (app/main.py)  - stateless, deployed as one Vercel serverless function (api/index.py)
   |-- app/schemas.py   Pydantic models; coerce + clamp LLM output
   |-- app/prompts.py   all prompt text
   |-- app/llm.py       provider-fallback client (Groq -> Gemini -> OpenRouter)
   v
LLM provider (OpenAI-compatible /chat/completions)
```

Endpoints: `GET /api/health`, `POST /api/analyze`, `POST /api/chat`, `POST /api/debrief`. Interactive docs at `/api/docs`.

## AI model and how it's called

- Default: **Groq `llama-3.3-70b-versatile`** (free tier). Fallbacks: **Gemini `gemini-2.5-flash`**, then **OpenRouter** (free Llama). Whichever provider has an API key set is used; if one errors or is rate-limited, the next is tried. Model names are env-configurable (`.env.example`).
- All three providers speak the OpenAI-compatible `chat/completions` protocol, so there is **one `httpx` call and no SDK**.
- `/analyze` and `/debrief` use **JSON mode** (`response_format: json_object`) at temperature 0.2, with a strict key list in the system prompt. The response is parsed and validated; on invalid output the server retries once with a corrective message.
- `/chat` is free-form text at temperature 0.5. The system prompt contains the full lead record, the current analysis and the timeline, plus the last 12 chat turns, so answers are grounded in *that* lead rather than generic.

## Run locally

```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env                                    # then put ONE key in it (GROQ_API_KEY is easiest)
set -a; source .env; set +a                             # Windows PowerShell: $env:GROQ_API_KEY="..."
uvicorn app.main:app --reload
# open http://localhost:8000
pytest                                                  # 12 offline tests (LLM mocked)
```

## Deploy (Vercel, free)

1. Push this repo to GitHub (public).
2. vercel.com -> *Add New Project* -> import the repo. Framework preset: **Other**. No build command.
3. Project -> *Settings -> Environment Variables*: add `GROQ_API_KEY` (and optionally `GEMINI_API_KEY`). Redeploy.
4. Open `https://<project>.vercel.app/api/health` - it should list your provider. Then open the root URL.
5. Make sure Deployment Protection is **off** for the production URL (Settings -> Deployment Protection) so anyone with the link can open it.

## Key technical decisions

- **Score from the AI, tier from code.** The LLM returns a 0-100 score using an explicit rubric (timeline urgency 30, budget clarity/fit 25, intent/engagement 25, specificity 10, minus severe blockers). The Hot/Warm/Cold tier is derived from the score in code (>=70 / 40-69 / <40), so ranking is deterministic and I can tune thresholds without re-prompting.
- **LLM output is untrusted.** Pydantic validators coerce strings to lists, clamp the score to 0-100, default invalid urgency, and the endpoint retries once on unparseable output. The UI therefore never renders a malformed analysis.
- **Stateless backend + localStorage persistence.** Vercel functions have no durable disk or memory between invocations, so an in-memory server store would silently lose leads. Keeping leads in the browser and sending context with each request is reliable on serverless, needs no database account, and keeps the deploy to one command. Trade-off: leads are per-browser (see limitations).
- **Grounding rules in every prompt:** never invent prices, discounts, availability or property details; ask or defer instead. The customer's message is treated as data, not instructions (basic prompt-injection hygiene). Replies mirror the customer's language/tone (e.g. Tanglish/Hinglish).
- **Provider fallback** for free-tier resilience, with one OpenAI-compatible client instead of three SDKs.
- **No build step frontend.** Vanilla JS keeps the whole app readable in one sitting and removes a class of deploy failures.
- **Cost/abuse guard:** input length caps and a small per-IP rate limit protect the free API key on a public URL.

## Known limitations

- Leads are stored in the browser (localStorage): no cross-device sync, no multi-user team view, cleared if site data is cleared. Next step: Postgres/Supabase + auth.
- The rate limiter is in-memory per serverless instance, so it is best-effort, not a hard guarantee.
- Scores are LLM judgments, not calibrated against real conversion data. A production version should be validated against closed-won/lost outcomes.
- Free-tier models can be slow or rate-limited at peak; fallback helps but isn't a guarantee. No streaming of responses yet.
- No integrations (WhatsApp / CRM / calendar) and no real-time voice. The suggested reply is copy-paste.
- English-first UI; the AI replies in the customer's language but I tested mainly English and light Tanglish.

## Project layout

```
api/index.py        Vercel entrypoint (imports the FastAPI app)
app/main.py         routes, rate limit, tier logic, structured-output retry
app/llm.py          provider fallback client + JSON extraction
app/prompts.py      all prompts
app/schemas.py      request/response models + output sanitisation
public/             static frontend
tests/test_api.py   offline tests with the LLM mocked
vercel.json         routes /api/* to the function
```
