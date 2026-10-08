# Interview prep (do not need to submit this)

You must be able to explain every line. Read this twice, then open the code and trace one request end to end.

## 60-second pitch
"LeadPilot is a lead copilot for real-estate salespeople. They paste in a lead; an LLM returns a brief, a 0-100 score, the next action and a reply to send. Leads rank into hot/warm/cold. They can chat with a copilot that only knows that lead, and after a call they paste notes and the AI re-scores the lead and tells them what changed. A follow-up queue shows who needs attention today."

## Trace one request (know this cold)
1. `public/app.js` `submitLead()` -> `api("/analyze", {lead})`.
2. `app/main.py` `analyze()` -> `_rate_limit()` -> `prompts.analysis_messages()` builds system + user messages.
3. `_structured()` -> `llm.chat_completion(json_mode=True)` loops through providers that have keys; first success wins.
4. `llm.extract_json()` strips fences and parses; `Analysis.model_validate()` coerces/clamps (`schemas.py`).
5. `tier(score)` is computed in code. Response goes back; the frontend stores the lead in localStorage and sets `dueAt = now + follow_up_hours`.
6. Chat/debrief send the lead + analysis + last 15 timeline events with each call (stateless server).

## Decisions you will be asked about, with honest answers
- **Why localStorage / stateless?** Vercel functions can't keep memory or disk between calls. Browser storage + sending context keeps it reliable with zero infra. Cost: no multi-device/team view. With more time: Postgres/Supabase + auth, same API shapes.
- **Why is the tier computed in code, not by the LLM?** Consistency and tunability. LLMs are inconsistent at categorical labels; a number from a rubric + a threshold in code is deterministic and adjustable without re-prompting.
- **How do you know the score is any good?** I don't have conversion data. It's a rubric-driven judgment (urgency, budget, intent, specificity). Production: log outcomes (closed won/lost) and calibrate or train a lightweight model on the LLM's structured features.
- **Hallucination risk in the suggested reply?** Prompt forbids inventing prices/discounts/availability; reply must ask or defer. Temperature 0.2 for structured calls. Salesperson reviews/edits before sending (the reply box is editable).
- **Prompt injection from the customer message?** Message is passed as quoted data and the prompt says to treat it as data. Not bulletproof; no tools or secrets are reachable from the model, which limits blast radius.
- **Why 3 providers?** Free tiers rate-limit; fallback keeps the demo alive. All speak OpenAI-compatible JSON so it's one code path.
- **What happens if the model returns bad JSON?** Validators coerce what they can; otherwise one corrective retry; otherwise a clear 502 and the UI shows the error.
- **Why this feature (post-call re-score + follow-up queue)?** Most tools score a lead once. The salesperson's value is in the loop: call -> notes -> new priority -> next step. It also makes the lead list a *living* worklist instead of a static report.
- **What would you build next?** WhatsApp/CRM integration, voice-call transcription feeding the debrief automatically (fits Masal's voice product), team DB, outcome-based score calibration, streaming responses, analytics on which actions convert.

## Customer-facing explanation (FDE style, non-technical buyer)
"It reads what the customer wrote, tells your rep how likely they are to buy and how soon, what they're worried about, and exactly what to say next. The score isn't magic: it's based on how soon they want to buy, whether their budget is real, and how engaged they are. Your rep can always edit the message before sending, and after each call the system updates the priority so nobody forgets a hot lead."

## If something breaks live
- `/api/health` shows which providers have keys. Empty list = env var missing in Vercel (redeploy after adding).
- 502 with "providers failed" = rate limit/outage; retry, or add a second provider key.
- Blank page on Vercel = check `public/` was deployed and Deployment Protection is off.
