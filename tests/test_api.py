"""API tests with the LLM mocked, so they run offline and cost nothing."""
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import llm, main  # noqa: E402

LEAD = {
    "name": "Priya Raman",
    "location": "Coimbatore",
    "requirement": "3BHK apartment",
    "budget": "85L-95L",
    "timeline": "3 weeks",
    "message": "Loan pre-approved. Need to shift before November.",
}
GOOD = {
    "summary": "Ready buyer.",
    "intent": "Ready to buy soon",
    "key_requirements": ["3BHK", "Avinashi Road"],
    "objections": "Possession delay",  # string on purpose: must be coerced to a list
    "next_action": "Call today",
    "suggested_response": "Hi Priya, happy to arrange a visit.",
    "score": "92.4",  # string on purpose
    "score_reason": "Pre-approved loan, 3 week deadline",
    "urgency": "HIGH",
    "follow_up_hours": 4,
}


@pytest.fixture()
def client():
    main._hits.clear()
    return TestClient(main.app)


def fake_llm(responses):
    calls = []

    async def _fake(messages, **kw):
        calls.append({"messages": messages, **kw})
        return responses[min(len(calls) - 1, len(responses) - 1)], "fake"

    return _fake, calls


def test_analyze_coerces_and_tiers(client, monkeypatch):
    fake, calls = fake_llm([json.dumps(GOOD)])
    monkeypatch.setattr(llm, "chat_completion", fake)
    r = client.post("/api/analyze", json={"lead": LEAD})
    assert r.status_code == 200
    body = r.json()
    assert body["tier"] == "hot"
    a = body["analysis"]
    assert a["score"] == 92 and a["urgency"] == "high"
    assert a["objections"] == ["Possession delay"]
    assert calls[0]["json_mode"] is True
    assert "Priya Raman" in calls[0]["messages"][1]["content"]


def test_analyze_clamps_score_and_handles_fences(client, monkeypatch):
    bad = dict(GOOD, score=250, urgency="whenever", follow_up_hours="soon")
    fake, _ = fake_llm(["```json\n" + json.dumps(bad) + "\n```"])
    monkeypatch.setattr(llm, "chat_completion", fake)
    a = client.post("/api/analyze", json={"lead": LEAD}).json()["analysis"]
    assert a["score"] == 100 and a["urgency"] == "medium" and a["follow_up_hours"] == 24


def test_analyze_retries_once_on_garbage(client, monkeypatch):
    fake, calls = fake_llm(["sorry, no json here", json.dumps(GOOD)])
    monkeypatch.setattr(llm, "chat_completion", fake)
    r = client.post("/api/analyze", json={"lead": LEAD})
    assert r.status_code == 200 and len(calls) == 2


def test_analyze_gives_502_when_model_keeps_failing(client, monkeypatch):
    fake, _ = fake_llm(["nope"])
    monkeypatch.setattr(llm, "chat_completion", fake)
    assert client.post("/api/analyze", json={"lead": LEAD}).status_code == 502


def test_validation_rejects_empty_name(client):
    assert client.post("/api/analyze", json={"lead": dict(LEAD, name="")}).status_code == 422


def test_chat_is_grounded_in_lead_context(client, monkeypatch):
    fake, calls = fake_llm(["Lead with the pre-approved loan."])
    monkeypatch.setattr(llm, "chat_completion", fake)
    payload = {
        "lead": LEAD,
        "analysis": GOOD,
        "timeline": [{"at": "x", "kind": "created", "text": "Lead created"}],
        "history": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}],
        "message": "What should I emphasize on the call?",
    }
    r = client.post("/api/chat", json=payload)
    assert r.status_code == 200 and r.json()["reply"].startswith("Lead with")
    msgs = calls[0]["messages"]
    assert msgs[0]["role"] == "system"
    assert "Priya Raman" in msgs[0]["content"] and "85L-95L" in msgs[0]["content"]
    assert "Possession delay" in msgs[0]["content"]
    assert msgs[-1]["content"] == "What should I emphasize on the call?"
    assert [m["role"] for m in msgs[1:-1]] == ["user", "assistant"]


def test_debrief_rescoring_and_delta(client, monkeypatch):
    updated = dict(GOOD, score=55, what_changed="Husband wants a discount; visit not yet booked.")
    fake, calls = fake_llm([json.dumps(updated)])
    monkeypatch.setattr(llm, "chat_completion", fake)
    payload = {"lead": LEAD, "analysis": dict(GOOD, score=92), "timeline": [], "notes": "Husband wants discount"}
    body = client.post("/api/debrief", json=payload).json()
    assert body["analysis"]["score"] == 55 and body["tier"] == "warm"
    assert body["score_delta"] == 55 - 92
    assert "discount" in body["what_changed"]
    assert "Husband wants discount" in calls[0]["messages"][1]["content"]


def test_llm_error_maps_to_502(client, monkeypatch):
    async def boom(*a, **k):
        raise llm.LLMError("All AI providers failed")

    monkeypatch.setattr(llm, "chat_completion", boom)
    r = client.post("/api/analyze", json={"lead": LEAD})
    assert r.status_code == 502 and "providers" in r.json()["detail"]


def test_no_keys_message(client, monkeypatch):
    for k in ("GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    r = client.post("/api/analyze", json={"lead": LEAD})
    assert r.status_code == 502 and "GROQ_API_KEY" in r.json()["detail"]


def test_rate_limit(client, monkeypatch):
    monkeypatch.setattr(main, "RATE_LIMIT", 2)
    fake, _ = fake_llm([json.dumps(GOOD)])
    monkeypatch.setattr(llm, "chat_completion", fake)
    codes = [client.post("/api/analyze", json={"lead": LEAD}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_tier_boundaries():
    assert [main.tier(s) for s in (0, 39, 40, 69, 70, 100)] == ["cold", "cold", "warm", "warm", "hot", "hot"]


def test_extract_json():
    assert llm.extract_json('noise ```json\n{"a": 1}\n``` tail') == {"a": 1}
    with pytest.raises(ValueError):
        llm.extract_json("no braces")
