from collections.abc import AsyncIterator
from datetime import datetime
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from zoneinfo import ZoneInfo

from openai import AsyncOpenAI

from app.tools.executor import ToolExecutor

SIDE_EFFECT_TOOLS = {"create_access_ticket", "notify_mentor"}


class AgentReply:
    def __init__(
        self,
        text: str,
        sources: list[dict[str, Any]],
        tools_used: list[str],
        actions: list[dict[str, Any]] | None = None,
    ):
        self.text = text
        self.sources = sources
        self.tools_used = tools_used
        self.actions = actions or []


class AgentService:
    """Runs the LLM/tool loop. Conversation persistence will be added separately."""

    def __init__(
        self,
        client: AsyncOpenAI,
        model: str,
        system_prompt_path: Path,
        timezone: str,
        tool_executor: ToolExecutor,
    ) -> None:
        self._client = client
        self._model = model
        self._system_prompt = system_prompt_path.read_text(encoding="utf-8")
        self._timezone = ZoneInfo(timezone)
        self._tool_executor = tool_executor

    def _messages(
        self, message: str, role: str, confirmed_action: str | None = None
    ) -> list[dict[str, Any]]:
        now = datetime.now(self._timezone)
        weekday = (
            "понедельник", "вторник", "среда", "четверг",
            "пятница", "суббота", "воскресенье",
        )[now.weekday()]
        # Explicit runtime context is required by system_prompt.txt.
        system_prompt = (
            f"{self._system_prompt}\n\n"
            "Контекст запроса:\n"
            f"role: {role}\n"
            f"current_datetime: {now.isoformat(timespec='minutes')}\n"
            f"weekday: {weekday}\n\n"
            f"confirmed_action: {confirmed_action or 'none'}\n\n"
            "В этой версии доступны только инструменты, переданные в запросе модели. "
            "Не утверждай, что недоступный инструмент вызван или действие выполнено. "
            "Если инструмент вернул ошибку, сообщи о временной недоступности и не выдумывай результат."
        )
        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": message},
        ]

    @staticmethod
    def _sources_from_tool_result(name: str, result: dict[str, Any]) -> list[dict[str, Any]]:
        if name not in {"search_knowledge_base", "get_checklist"}:
            return []
        chunks = result.get("results", result.get("chunks", []))
        sources: list[dict[str, Any]] = []
        if isinstance(chunks, list):
            for chunk in chunks:
                if not isinstance(chunk, dict):
                    continue
                metadata = chunk.get("metadata") if isinstance(chunk.get("metadata"), dict) else {}
                source = chunk.get("source") or metadata.get("source")
                if source and all(item.get("source") != source for item in sources):
                    sources.append({"source": source})
        return sources

    @staticmethod
    def _actions_from_tool_result(name: str, result: dict[str, Any]) -> list[dict[str, Any]]:
        if name not in {
            "get_jira_tasks",
            "create_access_ticket",
            "notify_mentor",
            "get_mentor_interns",
        }:
            return []
        actions = result.get("actions", [])
        if not isinstance(actions, list):
            return []
        return [action for action in actions if isinstance(action, dict)]

    async def _run_tool_calls(
        self,
        messages: list[dict[str, Any]],
        tool_calls: list[Any],
        *,
        user_id: str,
        role: str,
        confirmed_action: str | None = None,
        consumed_confirmations: set[str] | None = None,
        assistant_content: str | None = None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str], list[dict[str, Any]]]:
        assistant_calls = []
        sources: list[dict[str, Any]] = []
        tools_used: list[str] = []
        actions: list[dict[str, Any]] = []
        for call in tool_calls:
            assistant_calls.append(
                {
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.function.name,
                        "arguments": call.function.arguments,
                    },
                }
            )
        messages.append(
            {
                "role": "assistant",
                "content": assistant_content,
                "tool_calls": assistant_calls,
            }
        )

        for call in tool_calls:
            name = call.function.name
            if name not in tools_used:
                tools_used.append(name)
            try:
                arguments = json.loads(call.function.arguments or "{}")
                if not isinstance(arguments, dict):
                    raise ValueError("tool arguments must be a JSON object")
                if name in SIDE_EFFECT_TOOLS and consumed_confirmations is not None:
                    if name in consumed_confirmations:
                        result = {
                            "error": "confirmation_already_used",
                            "action": name,
                        }
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": call.id,
                                "content": json.dumps(result, ensure_ascii=False),
                            }
                        )
                        continue
                    if name == confirmed_action:
                        consumed_confirmations.add(name)
                result = await self._tool_executor.execute(
                    name,
                    arguments,
                    user_id=user_id,
                    role=role,
                    confirmed_action=confirmed_action,
                )
            except (json.JSONDecodeError, ValueError) as error:
                result = {"error": "invalid tool arguments", "detail": str(error)}

            sources.extend(self._sources_from_tool_result(name, result))
            actions.extend(self._actions_from_tool_result(name, result))
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": json.dumps(result, ensure_ascii=False),
                }
            )
        return messages, sources, tools_used, actions

    async def reply(
        self,
        message: str,
        role: str,
        user_id: str,
        confirmed_action: str | None = None,
    ) -> AgentReply:
        messages = self._messages(message, role, confirmed_action)
        sources: list[dict[str, Any]] = []
        tools_used: list[str] = []
        actions: list[dict[str, Any]] = []
        consumed_confirmations: set[str] = set()

        for _ in range(4):
            result = await self._client.chat.completions.create(
                model=self._model,
                messages=messages,
                tools=self._tool_executor.definitions,
                tool_choice="auto",
            )
            assistant_message = result.choices[0].message
            if not assistant_message.tool_calls:
                return AgentReply(
                    text=assistant_message.content or "",
                    sources=sources,
                    tools_used=tools_used,
                    actions=actions,
                )
            messages, new_sources, new_tools, new_actions = await self._run_tool_calls(
                messages,
                assistant_message.tool_calls,
                user_id=user_id,
                role=role,
                confirmed_action=confirmed_action,
                consumed_confirmations=consumed_confirmations,
                assistant_content=assistant_message.content,
            )
            sources.extend(new_sources)
            tools_used.extend(tool for tool in new_tools if tool not in tools_used)
            actions.extend(new_actions)

        return AgentReply(
            text="Не удалось завершить обработку запроса за допустимое число вызовов инструментов.",
            sources=sources,
            tools_used=tools_used,
            actions=actions,
        )

    async def stream_reply(
        self,
        message: str,
        role: str,
        user_id: str,
        confirmed_action: str | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        messages = self._messages(message, role, confirmed_action)
        sources: list[dict[str, Any]] = []
        tools_used: list[str] = []
        actions: list[dict[str, Any]] = []
        consumed_confirmations: set[str] = set()

        for _ in range(4):
            stream = await self._client.chat.completions.create(
                model=self._model,
                messages=messages,
                tools=self._tool_executor.definitions,
                tool_choice="auto",
                stream=True,
            )
            text_parts: list[str] = []
            calls: list[dict[str, Any]] = []
            active_calls: dict[int, dict[str, Any]] = {}
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta.content:
                    text_parts.append(delta.content)
                    yield {"event": "token", "text": delta.content}
                for call_delta in delta.tool_calls or []:
                    call = active_calls.get(call_delta.index)
                    # A gateway may reuse a stream index for a different tool-call ID.
                    if call is None or (call["id"] and call_delta.id and call["id"] != call_delta.id):
                        call = {"id": "", "type": "function", "function": {"name": "", "arguments": ""}}
                        active_calls[call_delta.index] = call
                        calls.append(call)
                    if call_delta.id:
                        call["id"] = call_delta.id
                    if call_delta.function:
                        if call_delta.function.name:
                            call["function"]["name"] += call_delta.function.name
                        if call_delta.function.arguments:
                            call["function"]["arguments"] += call_delta.function.arguments

            if not calls:
                yield {
                    "event": "done",
                    "sources": sources,
                    "tools_used": tools_used,
                    "actions": actions,
                }
                return

            # Rebuild call objects in the SDK-independent shape expected below.
            call_messages = []
            for call in calls:
                call_messages.append(_ToolCallView(call))
            messages, new_sources, new_tools, new_actions = await self._run_tool_calls(
                messages,
                call_messages,
                user_id=user_id,
                role=role,
                confirmed_action=confirmed_action,
                consumed_confirmations=consumed_confirmations,
                assistant_content="".join(text_parts) or None,
            )
            sources.extend(new_sources)
            tools_used.extend(tool for tool in new_tools if tool not in tools_used)
            actions.extend(new_actions)

        yield {
            "event": "error",
            "message": "Не удалось завершить запрос за допустимое число вызовов инструментов.",
            "actions": actions,
        }


class _ToolCallView:
    """Small adapter for tool-call fragments collected from a streamed response."""

    def __init__(self, data: dict[str, Any]) -> None:
        self.id = data["id"]
        self.function = SimpleNamespace(**data["function"])

