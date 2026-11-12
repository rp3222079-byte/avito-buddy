from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from app.tools.executor import ToolExecutor


SCHEMA_PATH = Path(__file__).resolve().parents[2] / "ai-service" / "tools_schema.json"


@pytest.fixture
def clients():
    rag = AsyncMock()
    backend = AsyncMock()
    rag.search_knowledge_base.return_value = {"results": []}
    backend.get_jira_tasks.return_value = {"tasks": []}
    return rag, backend


def make_executor(clients):
    rag, backend = clients
    return ToolExecutor(SCHEMA_PATH, rag, backend)


def test_only_supported_tools_are_offered(clients):
    executor = make_executor(clients)
    names = {item["function"]["name"] for item in executor.definitions}

    assert names == {
        "search_knowledge_base",
        "get_jira_tasks",
        "get_checklist",
        "create_access_ticket",
        "notify_mentor",
        "get_mentor_interns",
    }


@pytest.mark.asyncio
async def test_search_tool_validates_query_and_passes_identity(clients):
    rag, _ = clients
    executor = make_executor(clients)

    result = await executor.execute(
        "search_knowledge_base",
        {"query": "  onboarding  "},
        user_id="intern-7",
        role="intern",
    )
    invalid = await executor.execute(
        "search_knowledge_base", {"query": "  "}, user_id="intern-7", role="intern"
    )

    rag.search_knowledge_base.assert_awaited_once_with(
        "onboarding", user_id="intern-7", role="intern"
    )
    assert result == {"results": []}
    assert invalid["error"] == "query must be a non-empty string"


@pytest.mark.asyncio
async def test_jira_tool_is_denied_to_mentor(clients):
    _, backend = clients
    executor = make_executor(clients)

    result = await executor.execute(
        "get_jira_tasks", {}, user_id="mentor-2", role="mentor"
    )

    assert result == {"error": "get_jira_tasks is available to interns only"}
    backend.get_jira_tasks.assert_not_awaited()


@pytest.mark.asyncio
async def test_jira_tool_calls_backend_for_intern(clients):
    _, backend = clients
    executor = make_executor(clients)

    result = await executor.execute(
        "get_jira_tasks", {}, user_id="intern-7", role="intern"
    )

    backend.get_jira_tasks.assert_awaited_once_with(user_id="intern-7", role="intern")
    assert result == {"tasks": []}


@pytest.mark.asyncio
async def test_tool_service_failure_is_returned_as_error(clients):
    rag, _ = clients
    rag.search_knowledge_base.side_effect = ValueError("bad response")
    executor = make_executor(clients)

    result = await executor.execute(
        "search_knowledge_base", {"query": "policy"}, user_id="intern-7", role="intern"
    )

    assert result == {"error": "tool service unavailable", "detail": "bad response"}


def test_executor_fails_fast_when_enabled_schema_is_missing(tmp_path, clients):
    incomplete_schema = tmp_path / "tools.json"
    incomplete_schema.write_text(
        '[{"type":"function","function":{"name":"search_knowledge_base"}}]',
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="Missing tool definitions"):
        ToolExecutor(incomplete_schema, *clients)


@pytest.mark.asyncio
async def test_executor_returns_error_for_unknown_tool(clients):
    executor = make_executor(clients)

    result = await executor.execute(
        "not_a_real_tool", {}, user_id="intern-7", role="intern"
    )

    assert result == {"error": "Tool is not enabled: not_a_real_tool"}
