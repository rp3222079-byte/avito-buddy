from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from openai import APIConnectionError, APIStatusError, APITimeoutError

from app.api.routes.chat import router
from app.api.routes.health import router as health_router


@pytest.fixture
def app():
    application = FastAPI()
    application.include_router(router)
    application.state.demo_user_id = "demo-intern"
    application.state.demo_user_role = "intern"
    application.state.settings = SimpleNamespace(llm_model="test-model")
    application.state.agent = SimpleNamespace(
        reply=AsyncMock(
            return_value=SimpleNamespace(
                text="Ответ",
                sources=[{"source": "guide.md"}],
                tools_used=["search_knowledge_base"],
            )
        ),
        stream_reply=AsyncMock(),
    )
    return application


@pytest.mark.asyncio
async def test_chat_route_uses_demo_identity_and_returns_agent_result(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/chat", json={"message": "Привет"})

    assert response.status_code == 200
    assert response.json() == {
        "reply": "Ответ",
        "model": "test-model",
        "sources": [{"source": "guide.md"}],
        "tools_used": ["search_knowledge_base"],
        "actions": [],
    }
    app.state.agent.reply.assert_awaited_once_with(
        "Привет", role="intern", user_id="demo-intern"
    )


@pytest.mark.asyncio
async def test_chat_route_forwards_backend_identity_headers(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/chat",
            json={"message": "Покажи задачи"},
            headers={"X-User-ID": "intern-42", "X-User-Role": "intern"},
        )

    assert response.status_code == 200
    app.state.agent.reply.assert_awaited_once_with(
        "Покажи задачи", role="intern", user_id="intern-42"
    )


@pytest.mark.asyncio
async def test_chat_route_validates_message_length(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/chat", json={"message": ""})

    assert response.status_code == 422
    app.state.agent.reply.assert_not_awaited()


@pytest.mark.asyncio
async def test_chat_stream_route_formats_sse_events(app):
    async def event_generator(*args, **kwargs):
        yield {"event": "token", "text": "Привет"}
        yield {"event": "done", "sources": [], "tools_used": []}

    app.state.agent.stream_reply = event_generator
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/chat/stream", json={"message": "Привет"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert 'event: token\ndata: {"text": "Привет"}' in response.text
    assert 'event: done\ndata: {"sources": [], "tools_used": []}' in response.text


@pytest.mark.parametrize(
    ("error", "status_code"),
    [
        (APITimeoutError(request=httpx.Request("POST", "http://llm.test")), 504),
        (APIConnectionError(request=httpx.Request("POST", "http://llm.test")), 503),
        (
            APIStatusError(
                "provider error",
                response=httpx.Response(500, request=httpx.Request("POST", "http://llm.test")),
                body=None,
            ),
            502,
        ),
    ],
)
@pytest.mark.asyncio
async def test_chat_route_maps_llm_errors_to_http_status(app, error, status_code):
    app.state.agent.reply.side_effect = error
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/chat", json={"message": "Привет"})

    assert response.status_code == status_code


@pytest.mark.parametrize(
    ("error", "expected_message"),
    [
        (APITimeoutError(request=httpx.Request("POST", "http://llm.test")), "LLM request timed out"),
        (APIConnectionError(request=httpx.Request("POST", "http://llm.test")), "LLM временно недоступна"),
    ],
)
@pytest.mark.asyncio
async def test_chat_stream_emits_error_event_for_llm_failure(app, error, expected_message):
    async def failing_stream(*args, **kwargs):
        raise error
        yield  # Keep this function an async generator.

    app.state.agent.stream_reply = failing_stream
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/chat/stream", json={"message": "Привет"})

    assert response.status_code == 200
    assert "event: error" in response.text
    assert expected_message in response.text


@pytest.mark.asyncio
async def test_health_route_returns_liveness_without_agent(app):
    app.include_router(health_router)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
