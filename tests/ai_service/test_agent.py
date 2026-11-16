import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.agent import AgentService


class FakeToolExecutor:
    definitions = [{"type": "function", "function": {"name": "search_knowledge_base"}}]

    def __init__(self, result=None):
        self.result = result or {"results": [{"source": "guide.md"}]}
        self.execute = AsyncMock(return_value=self.result)


def message(content=None, tool_calls=None):
    return SimpleNamespace(content=content, tool_calls=tool_calls or [])


def completion(content=None, tool_calls=None):
    return SimpleNamespace(choices=[SimpleNamespace(message=message(content, tool_calls))])


def tool_call(name="search_knowledge_base", arguments='{"query":"policy"}', call_id="call-1"):
    return SimpleNamespace(
        id=call_id,
        function=SimpleNamespace(name=name, arguments=arguments),
    )


@pytest.fixture
def prompt_file(tmp_path: Path) -> Path:
    path = tmp_path / "system_prompt.txt"
    path.write_text("Ты наставник.", encoding="utf-8")
    return path


@pytest.mark.asyncio
async def test_agent_sends_system_prompt_and_returns_plain_answer(prompt_file):
    llm = AsyncMock()
    llm.chat.completions.create.return_value = completion("Привет!")
    executor = FakeToolExecutor()
    agent = AgentService(llm, "test-model", prompt_file, "Asia/Novosibirsk", executor)

    result = await agent.reply("Привет", role="intern", user_id="intern-7")

    request = llm.chat.completions.create.call_args.kwargs
    assert request["model"] == "test-model"
    assert request["messages"][0]["content"].startswith("Ты наставник.")
    assert "role: intern" in request["messages"][0]["content"]
    assert request["messages"][1] == {"role": "user", "content": "Привет"}
    assert result.text == "Привет!"
    assert result.tools_used == []
    executor.execute.assert_not_awaited()


def test_agent_extracts_unique_sources_and_skips_malformed_chunks():
    assert AgentService._sources_from_tool_result(
        "get_jira_tasks", {"results": [{"source": "ignored.md"}]}
    ) == []
    assert AgentService._sources_from_tool_result(
        "search_knowledge_base",
        {
            "results": [
                "malformed chunk",
                {"metadata": {"source": "guide.md"}},
                {"source": "guide.md"},
                {"source": "faq.md"},
                {},
            ]
        },
    ) == [{"source": "guide.md"}, {"source": "faq.md"}]


@pytest.mark.asyncio
async def test_agent_runs_tool_then_returns_sources_and_final_answer(prompt_file):
    llm = AsyncMock()
    llm.chat.completions.create.side_effect = [
        completion(tool_calls=[tool_call()]),
        completion("Нашёл инструкцию."),
    ]
    executor = FakeToolExecutor()
    agent = AgentService(llm, "test-model", prompt_file, "Asia/Novosibirsk", executor)

    result = await agent.reply("Где инструкция?", role="intern", user_id="intern-7")

    assert result.text == "Нашёл инструкцию."
    assert result.tools_used == ["search_knowledge_base"]
    assert result.sources == [{"source": "guide.md"}]
    executor.execute.assert_awaited_once_with(
        "search_knowledge_base", {"query": "policy"}, user_id="intern-7", role="intern",
        confirmed_action=None,
    )
    follow_up_messages = llm.chat.completions.create.call_args_list[1].kwargs["messages"]
    assert follow_up_messages[-1]["role"] == "tool"
    assert json.loads(follow_up_messages[-1]["content"]) == executor.result


@pytest.mark.asyncio
async def test_agent_handles_invalid_tool_arguments(prompt_file):
    llm = AsyncMock()
    llm.chat.completions.create.side_effect = [
        completion(tool_calls=[tool_call(arguments="not-json")]),
        completion("Не удалось выполнить поиск."),
    ]
    executor = FakeToolExecutor()
    agent = AgentService(llm, "test-model", prompt_file, "Asia/Novosibirsk", executor)

    result = await agent.reply("Найди", role="intern", user_id="intern-7")

    assert result.text == "Не удалось выполнить поиск."
    executor.execute.assert_not_awaited()
    tool_result = json.loads(llm.chat.completions.create.call_args_list[1].kwargs["messages"][-1]["content"])
    assert tool_result["error"] == "invalid tool arguments"


@pytest.mark.asyncio
async def test_agent_rejects_non_object_tool_arguments(prompt_file):
    llm = AsyncMock()
    llm.chat.completions.create.side_effect = [
        completion(tool_calls=[tool_call(arguments='["not", "an object"]')]),
        completion("Не удалось выполнить поиск."),
    ]
    executor = FakeToolExecutor()
    agent = AgentService(llm, "test-model", prompt_file, "Asia/Novosibirsk", executor)

    await agent.reply("Найди", role="intern", user_id="intern-7")

    executor.execute.assert_not_awaited()
    tool_result = json.loads(
        llm.chat.completions.create.call_args_list[1].kwargs["messages"][-1]["content"]
    )
    assert tool_result["error"] == "invalid tool arguments"
    assert tool_result["detail"] == "tool arguments must be a JSON object"


@pytest.mark.asyncio
async def test_agent_stops_after_four_tool_rounds(prompt_file):
    llm = AsyncMock()
    llm.chat.completions.create.return_value = completion(tool_calls=[tool_call()])
    executor = FakeToolExecutor()
    agent = AgentService(llm, "test-model", prompt_file, "Asia/Novosibirsk", executor)

    result = await agent.reply("Найди", role="intern", user_id="intern-7")

    assert "допустимое число" in result.text
    assert llm.chat.completions.create.await_count == 4
    assert executor.execute.await_count == 4


@pytest.mark.asyncio
async def test_stream_reply_emits_tokens_and_done(prompt_file):
    async def chunks():
        yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content="Ответ ", tool_calls=[]))])
        yield SimpleNamespace(choices=[])
        yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content="потоком", tool_calls=[]))])

    llm = AsyncMock()
    llm.chat.completions.create.return_value = chunks()
    agent = AgentService(llm, "test-model", prompt_file, "Asia/Novosibirsk", FakeToolExecutor())

    events = [event async for event in agent.stream_reply("Привет", "intern", "intern-7")]

    assert events == [
        {"event": "token", "text": "Ответ "},
        {"event": "token", "text": "потоком"},
        {"event": "done", "sources": [], "tools_used": [], "actions": []},
    ]
    assert llm.chat.completions.create.call_args.kwargs["stream"] is True


@pytest.mark.asyncio
async def test_stream_reply_executes_streamed_tool_call(prompt_file):
    async def tool_chunks():
        yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(
            content=None,
            tool_calls=[SimpleNamespace(
                index=0,
                id="call-1",
                function=SimpleNamespace(name="search_knowledge_base", arguments=""),
            )],
        ))])
        yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(
            content=None,
            tool_calls=[SimpleNamespace(
                index=0,
                id=None,
                function=SimpleNamespace(name=None, arguments='{"query":"policy"}'),
            )],
        ))])

    async def answer_chunks():
        yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(
            content="Нашёл инструкцию.", tool_calls=[]
        ))])

    llm = AsyncMock()
    llm.chat.completions.create.side_effect = [tool_chunks(), answer_chunks()]
    executor = FakeToolExecutor()
    agent = AgentService(llm, "test-model", prompt_file, "Asia/Novosibirsk", executor)

    events = [event async for event in agent.stream_reply("Найди", "intern", "intern-7")]

    executor.execute.assert_awaited_once_with(
        "search_knowledge_base", {"query": "policy"}, user_id="intern-7", role="intern",
        confirmed_action=None,
    )
    assert events == [
        {"event": "token", "text": "Нашёл инструкцию."},
        {"event": "done", "sources": [{"source": "guide.md"}], "tools_used": ["search_knowledge_base"], "actions": []},
    ]


@pytest.mark.asyncio
async def test_stream_reply_keeps_distinct_tool_ids_when_index_is_reused(prompt_file):
    async def tool_chunks():
        for name in ("get_jira_tasks", "get_checklist"):
            call = tool_call(name=name, arguments="{}", call_id=name)
            call.index = 0
            yield SimpleNamespace(choices=[SimpleNamespace(delta=message(tool_calls=[call]))])

    async def answer_chunks():
        yield SimpleNamespace(choices=[SimpleNamespace(delta=message("Готово."))])

    llm = AsyncMock()
    llm.chat.completions.create.side_effect = [tool_chunks(), answer_chunks()]
    executor = FakeToolExecutor()
    agent = AgentService(llm, "test-model", prompt_file, "Asia/Novosibirsk", executor)

    events = [event async for event in agent.stream_reply("Брифинг", "intern", "intern-7")]

    assert events[-1]["tools_used"] == ["get_jira_tasks", "get_checklist"]
    tool_messages = llm.chat.completions.create.call_args.kwargs["messages"][-2:]
    assert [entry["tool_call_id"] for entry in tool_messages] == ["get_jira_tasks", "get_checklist"]


@pytest.mark.asyncio
async def test_stream_reply_reports_error_after_four_tool_rounds(prompt_file):
    async def tool_chunks(round_number):
        yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(
            content=None,
            tool_calls=[SimpleNamespace(
                index=0,
                id=f"call-{round_number}",
                function=SimpleNamespace(name="search_knowledge_base", arguments=""),
            )],
        ))])
        yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(
            content=None,
            tool_calls=[SimpleNamespace(
                index=0,
                id=None,
                function=SimpleNamespace(name=None, arguments='{"query":"policy"}'),
            )],
        ))])

    llm = AsyncMock()
    llm.chat.completions.create.side_effect = [tool_chunks(index) for index in range(4)]
    executor = FakeToolExecutor()
    agent = AgentService(llm, "test-model", prompt_file, "Asia/Novosibirsk", executor)

    events = [event async for event in agent.stream_reply("Найди", "intern", "intern-7")]

    assert len(events) == 1
    assert events[0]["event"] == "error"
    assert "допустимое число" in events[0]["message"]
    assert llm.chat.completions.create.await_count == 4
    assert executor.execute.await_count == 4
