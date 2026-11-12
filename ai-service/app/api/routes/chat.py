import hmac
import json
import logging
from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from openai import APIConnectionError, APITimeoutError, APIStatusError

from app.schemas.chat import ChatRequest, ChatResponse
from app.services.agent import AgentService

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = logging.getLogger(__name__)


def _agent(request: Request) -> AgentService:
    return request.app.state.agent


def _context(
    request: Request,
    token: str | None,
    user_id: str | None,
    role: str | None,
) -> tuple[str, str]:
    expected_token = getattr(request.app.state, "internal_token", "")
    if not expected_token:
        raise HTTPException(
            status_code=503, detail="AI-service internal auth is not configured"
        )
    if not token or not hmac.compare_digest(token, expected_token):
        raise HTTPException(status_code=401, detail="Internal service authentication required")
    if not user_id or not role:
        raise HTTPException(status_code=401, detail="Backend identity is required")
    return user_id, role


@router.post("", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    request: Request,
    internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    user_id: str | None = Header(default=None, alias="X-User-ID"),
    role: Literal["intern", "mentor"] | None = Header(default=None, alias="X-User-Role"),
) -> ChatResponse:
    """Non-streaming endpoint for the Go proxy and quick Swagger checks."""
    trusted_user_id, trusted_role = _context(request, internal_token, user_id, role)
    try:
        result = await _agent(request).reply(
            body.message,
            role=trusted_role,
            user_id=trusted_user_id,
            confirmed_action=body.confirmed_action,
        )
    except APITimeoutError as error:
        raise HTTPException(status_code=504, detail="LLM request timed out") from error
    except APIConnectionError as error:
        raise HTTPException(status_code=503, detail="LLM is unavailable") from error
    except APIStatusError as error:
        raise HTTPException(status_code=502, detail="LLM returned an error") from error

    return ChatResponse(
        reply=result.text,
        model=request.app.state.settings.llm_model,
        sources=result.sources,
        tools_used=result.tools_used,
        actions=result.actions,
    )


@router.post("/stream")
async def chat_stream(
    body: ChatRequest,
    request: Request,
    internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    user_id: str | None = Header(default=None, alias="X-User-ID"),
    role: Literal["intern", "mentor"] | None = Header(default=None, alias="X-User-Role"),
) -> StreamingResponse:
    """SSE stream; the Go proxy/frontend should forward its events unchanged."""
    agent = _agent(request)
    trusted_user_id, trusted_role = _context(request, internal_token, user_id, role)

    async def events():
        try:
            async for event in agent.stream_reply(
                body.message,
                role=trusted_role,
                user_id=trusted_user_id,
                confirmed_action=body.confirmed_action,
            ):
                event_name = event["event"]
                payload = {key: value for key, value in event.items() if key != "event"}
                yield f"event: {event_name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
        except APITimeoutError:
            yield 'event: error\ndata: {"message":"LLM request timed out"}\n\n'
        except (APIConnectionError, APIStatusError):
            yield 'event: error\ndata: {"message":"LLM временно недоступна"}\n\n'
        except Exception:
            logger.exception("Unexpected error while streaming AI response")
            yield 'event: error\ndata: {"message":"Не удалось обработать запрос"}\n\n'

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

