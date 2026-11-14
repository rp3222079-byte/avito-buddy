from typing import Any, Literal

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    confirmed_action: Literal["create_access_ticket", "notify_mentor"] | None = None


class ChatResponse(BaseModel):
    reply: str
    model: str
    sources: list[dict[str, Any]] = Field(default_factory=list)
    tools_used: list[str] = Field(default_factory=list)
    actions: list[dict[str, Any]] = Field(default_factory=list)

