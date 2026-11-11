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
        "search_knowledge_base", {"query": "policy"}, user_id="intern-7", role="intern"
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
        yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content="потоком", tool_calls=[]))])

    llm = AsyncMock()
    llm.chat.completions.create.return_value = chunks()
    agent = AgentService(llm, "test-model", prompt_file, "Asia/Novosibirsk", FakeToolExecutor())

    events = [event async for event in agent.stream_reply("Привет", "intern", "intern-7")]

    assert events == [
        {"event": "token", "text": "Ответ "},
        {"event": "token", "text": "потоком"},
        {"event": "done", "sources": [], "tools_used": []},
    ]
    assert llm.chat.completions.create.call_args.kwargs["stream"] is True
