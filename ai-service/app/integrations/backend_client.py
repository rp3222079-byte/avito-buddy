from typing import Any

import httpx


class BackendClient:
    def __init__(self, client: httpx.AsyncClient, base_url: str) -> None:
        self._client = client
        self._base_url = base_url.rstrip("/")

    async def get_jira_tasks(self, user_id: str, role: str) -> dict[str, Any]:
        response = await self._client.get(
            f"{self._base_url}/api/jira/tasks",
            headers={"X-User-ID": user_id, "X-User-Role": role},
        )
        response.raise_for_status()
        result = response.json()
        if not isinstance(result, dict):
            raise ValueError("Backend response must be a JSON object")
        return result

