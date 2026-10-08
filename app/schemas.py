"""Request/response models.

The LLM is treated as an *untrusted* producer of JSON: every field it returns is
coerced and clamped by the validators below, so the UI never has to defend
against a malformed analysis.
"""
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class LeadInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    location: str = Field(default="", max_length=160)
    requirement: str = Field(min_length=1, max_length=600)
    budget: str = Field(default="", max_length=120)
    timeline: str = Field(default="", max_length=120)
    message: str = Field(default="", max_length=6000)


def _to_list(v) -> list[str]:
    if v is None:
        return []
    if isinstance(v, str):
        return [v.strip()] if v.strip() else []
    return [str(x).strip() for x in v if str(x).strip()]


def _to_text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, (list, tuple)):
        return " ".join(str(x) for x in v)
    return str(v).strip()


class Analysis(BaseModel):
    summary: str
    intent: str
    key_requirements: list[str] = Field(default_factory=list)
    objections: list[str] = Field(default_factory=list)
    next_action: str
    suggested_response: str
    score: int = Field(ge=0, le=100)
    score_reason: str = ""
    urgency: Literal["high", "medium", "low"] = "medium"
    follow_up_hours: int = Field(default=24, ge=1, le=720)

    @field_validator("summary", "intent", "next_action", "suggested_response", "score_reason", mode="before")
    @classmethod
    def _text(cls, v):
        return _to_text(v)

    @field_validator("key_requirements", "objections", mode="before")
    @classmethod
    def _lists(cls, v):
        return _to_list(v)

    @field_validator("score", mode="before")
    @classmethod
    def _score(cls, v):
        return max(0, min(100, int(round(float(v)))))

    @field_validator("follow_up_hours", mode="before")
    @classmethod
    def _hours(cls, v):
        try:
            return max(1, min(720, int(round(float(v)))))
        except (TypeError, ValueError):
            return 24

    @field_validator("urgency", mode="before")
    @classmethod
    def _urgency(cls, v):
        v = str(v or "").strip().lower()
        return v if v in ("high", "medium", "low") else "medium"


class DebriefResult(Analysis):
    what_changed: str = ""

    @field_validator("what_changed", mode="before")
    @classmethod
    def _wc(cls, v):
        return _to_text(v)


class TimelineEvent(BaseModel):
    at: str = Field(default="", max_length=40)
    kind: str = Field(default="", max_length=30)
    text: str = Field(default="", max_length=2000)


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class AnalyzeRequest(BaseModel):
    lead: LeadInput


class LeadContext(BaseModel):
    lead: LeadInput
    analysis: Analysis
    timeline: list[TimelineEvent] = Field(default_factory=list, max_length=50)


class ChatRequest(LeadContext):
    history: list[ChatTurn] = Field(default_factory=list, max_length=20)
    message: str = Field(min_length=1, max_length=2000)


class DebriefRequest(LeadContext):
    notes: str = Field(min_length=1, max_length=4000)
