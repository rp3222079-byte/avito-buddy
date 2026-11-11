import json
from pathlib import Path
from typing import Any

import httpx

from app.integrations.backend_client import BackendClient
from app.integrations.rag_client import RagClient

ENABLED_TOOLS = {"search_knowledge_base", "get_jira_tasks"}


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

            if name == "get_jira_tasks":
                if role != "intern":
                    return {"error": "get_jira_tasks is available to interns only"}
                return await self._backend.get_jira_tasks(user_id=user_id, role=role)

            return {"error": f"Tool is not enabled: {name}"}
        except (httpx.HTTPError, ValueError) as error:
            # Return a tool result so the model can produce the configured fallback.
            return {"error": "tool service unavailable", "detail": str(error)}

