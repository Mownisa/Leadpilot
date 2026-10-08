# AI usage disclosure

> Edit this so it matches what you actually did. Interviewers will ask about it, so only keep what is true.

**Claude (Anthropic)** - used to generate the initial project scaffold (FastAPI backend, provider-fallback LLM client, Pydantic schemas, the vanilla-JS frontend, offline tests) and to draft the prompts, the README and the interview notes. I reviewed the code, ran the test-suite, tested it against the live LLM API with my own key, and adjusted it.

**In the product itself:** Groq `llama-3.3-70b-versatile` (fallbacks: Gemini 2.5 Flash, OpenRouter Llama) powers the lead analysis, the grounded chat and the post-call re-scoring. These are real API calls on every action; nothing is canned.

*(Add anything else you used, e.g. "Copilot for autocomplete", "ChatGPT to debug a Vercel deploy issue".)*
