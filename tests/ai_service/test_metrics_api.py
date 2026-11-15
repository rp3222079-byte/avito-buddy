import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

from app.api.routes.metrics import router


@pytest.fixture
def app(tmp_path):
    metrics = {"intern_id": "intern_ivan", "stages": []}
    stuck = {"flags": [{"task_id": "AVT-555"}]}
    metrics_path = tmp_path / "metrics.json"
    stuck_path = tmp_path / "stuck.json"
    metrics_path.write_text(json.dumps(metrics), encoding="utf-8")
    stuck_path.write_text(json.dumps(stuck), encoding="utf-8")
    application = FastAPI()
    application.include_router(router)
    application.state.internal_token = "test-token"
    application.state.request_context_secret = ""
    application.state.settings = SimpleNamespace(
        mock_ai_metrics_path=metrics_path,
        mock_ai_stuck_path=stuck_path,
    )
    return application


def headers(role="mentor"):
    return {
        "X-Internal-Token": "test-token",
        "X-User-ID": "mentor_smith" if role == "mentor" else "intern_ivan",
        "X-User-Role": role,
    }


@pytest.mark.asyncio
async def test_metrics_returns_fixture_without_calling_llm(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/ai/metrics", headers=headers())

    assert response.status_code == 200
    assert response.json() == {"intern_id": "intern_ivan", "stages": []}


@pytest.mark.asyncio
async def test_stuck_validates_input_and_returns_fixture(app):
    body = {
        "tasks": [{
            "task_id": "AVT-555",
            "priority": "Blocker",
            "type": "Bug",
            "current_stage": "IN_PROGRESS",
            "entered_at": "2026-11-13T10:00:00Z",
        }],
        "transitions": [{
            "task_id": "AVT-555",
            "stage": "IN_PROGRESS",
            "entered_at": "2026-11-13T10:00:00Z",
        }],
        "baseline": {"default": 8, "Blocker": 1},
    }
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/ai/stuck", json=body, headers=headers())

    assert response.status_code == 200
    assert response.json() == {"flags": [{"task_id": "AVT-555"}]}


@pytest.mark.parametrize(
    ("path", "body", "request_headers", "expected_status"),
    [
        ("/ai/metrics", None, {}, 401),
        ("/ai/metrics", None, headers("intern"), 403),
        ("/ai/stuck", {}, headers(), 422),
    ],
)
@pytest.mark.asyncio
async def test_ai_analytics_requires_authorized_mentor_and_valid_payload(
    app, path, body, request_headers, expected_status
):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(path, json=body, headers=request_headers)

    assert response.status_code == expected_status
