import json
from pathlib import Path
from typing import Any

import httpx

from app.integrations.backend_client import BackendClient
from app.integrations.rag_client import RagClient

ENABLED_TOOLS = {
    "search_knowledge_base",
    "get_jira_tasks",
    "get_checklist",
    "create_access_ticket",
    "notify_mentor",
    "get_mentor_interns",
}
ACCESS_SYSTEMS = {"confluence", "jira", "figma", "github"}


class ToolExecutor:
    """Loads tool schemas and executes only the tools enabled for this service."""

    def __init__(
        self,
        schema_path: Path,
        rag_client: RagClient,
        backend_client: BackendClient,
    ) -> None:
        schemas = json.loads(schema_path.read_text(encoding="utf-8"))
        self._definitions = [
            schema
            for schema in schemas
            if schema.get("function", {}).get("name") in ENABLED_TOOLS
        ]
        loaded_names = {schema["function"]["name"] for schema in self._definitions}
        if loaded_names != ENABLED_TOOLS:
            missing = sorted(ENABLED_TOOLS - loaded_names)
            raise ValueError(f"Missing tool definitions in {schema_path}: {missing}")

        self._rag = rag_client
        self._backend = backend_client

    @property
    def definitions(self) -> list[dict[str, Any]]:
        return self._definitions

    async def execute(
        self,
        name: str,
        arguments: dict[str, Any],
        *,
        user_id: str,
        role: str,
        confirmed_action: str | None = None,
    ) -> dict[str, Any]:
        try:
            if name == "search_knowledge_base":
                query = arguments.get("query")
                if not isinstance(query, str) or not query.strip():
                    return {"error": "query must be a non-empty string"}
                return await self._rag.search_knowledge_base(
                    query.strip(),
                    user_id=user_id,
                    role=role,
                )

            if name == "get_checklist":
                return await self._rag.get_checklist(user_id=user_id, role=role)

            if name == "get_jira_tasks":
                if role != "intern":
                    return {"error": "get_jira_tasks is available to interns only"}
                return await self._backend.get_jira_tasks(user_id=user_id, role=role)

            if name == "create_access_ticket":
                if role != "intern":
                    return {"error": "create_access_ticket is available to interns only"}
                if confirmed_action != name:
                    return {"error": "user_confirmation_required", "action": name}
                system = arguments.get("system")
                if not isinstance(system, str) or system not in ACCESS_SYSTEMS:
                    return {
                        "error": "system must be one of the supported access systems",
                        "supported_systems": sorted(ACCESS_SYSTEMS),
                    }
                return await self._backend.create_access_ticket(
                    system=system, user_id=user_id, role=role
                )

            if name == "notify_mentor":
                if role != "intern":
                    return {"error": "notify_mentor is available to interns only"}
                if confirmed_action != name:
                    return {"error": "user_confirmation_required", "action": name}
                message = arguments.get("message")
                if not isinstance(message, str) or not message.strip():
                    return {"error": "message must be a non-empty string"}
                if len(message.strip()) > 1000:
                    return {"error": "message must not exceed 1000 characters"}
                return await self._backend.notify_mentor(
                    message=message.strip(), user_id=user_id, role=role
                )

            if name == "get_mentor_interns":
                if role != "mentor":
                    return {"error": "get_mentor_interns is available to mentors only"}
                return await self._backend.get_mentor_interns(
                    user_id=user_id, role=role
                )

            return {"error": f"Tool is not enabled: {name}"}
        except (httpx.HTTPError, ValueError) as error:
            # Return a tool result so the model can produce the configured fallback.
            return {"error": "tool service unavailable", "detail": str(error)}

