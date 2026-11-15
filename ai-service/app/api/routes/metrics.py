import json
import logging
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.auth import trusted_context

router = APIRouter(prefix="/ai", tags=["AI metrics"])
logger = logging.getLogger(__name__)


class StuckTask(BaseModel):
    task_id: str
    priority: str
    type: str
    current_stage: str
    entered_at: str


class StageTransition(BaseModel):
    task_id: str
    stage: str
    entered_at: str


class StuckRequest(BaseModel):
    tasks: list[StuckTask]
    transitions: list[StageTransition]
    baseline: dict[str, float] = Field(min_length=1)


def _load_mock(path: Path) -> dict[str, Any]:
    try:
        with path.open(encoding="utf-8") as file:
            result = json.load(file)
    except (OSError, json.JSONDecodeError) as error:
        logger.exception("Could not load AI mock response: %s", path.name)
        raise HTTPException(status_code=503, detail="AI mock response unavailable") from error
    if not isinstance(result, dict):
        raise HTTPException(status_code=503, detail="AI mock response must be a JSON object")
    return result


def _authorize(
    request: Request,
    internal_token: str | None,
    user_id: str | None,
    role: str | None,
    request_context: str | None,
) -> None:
    _, trusted_role = trusted_context(
        request, internal_token, user_id, role, request_context
    )
    if trusted_role != "mentor":
        raise HTTPException(status_code=403, detail="Mentor role required")


@router.post("/metrics")
async def metrics(
    request: Request,
    internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    user_id: str | None = Header(default=None, alias="X-User-ID"),
    role: Literal["intern", "mentor"] | None = Header(default=None, alias="X-User-Role"),
    request_context: str | None = Header(default=None, alias="X-Request-Context"),
) -> dict[str, Any]:
    """MVP stub: returns the checked-in metrics fixture; calculation is deferred."""
    _authorize(request, internal_token, user_id, role, request_context)
    return _load_mock(request.app.state.settings.mock_ai_metrics_path)


@router.post("/stuck")
async def stuck(
    body: StuckRequest,
    request: Request,
    internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    user_id: str | None = Header(default=None, alias="X-User-ID"),
    role: Literal["intern", "mentor"] | None = Header(default=None, alias="X-User-Role"),
    request_context: str | None = Header(default=None, alias="X-Request-Context"),
) -> dict[str, Any]:
    """MVP stub: validates the input contract and returns fixed mock flags."""
    _ = body
    _authorize(request, internal_token, user_id, role, request_context)
    return _load_mock(request.app.state.settings.mock_ai_stuck_path)
