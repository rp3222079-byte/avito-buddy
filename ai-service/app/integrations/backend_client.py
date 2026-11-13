from typing import Any

import httpx


class BackendClient:
    def __init__(
        self, client: httpx.AsyncClient, base_url: str, internal_token: str
    ) -> None:
        self._client = client
        self._base_url = base_url.rstrip("/")
        self._internal_token = internal_token

    async def get_jira_tasks(self, user_id: str, role: str) -> dict[str, Any]:
        response = await self._client.get(
            f"{self._base_url}/api/jira/tasks",
            headers=self._headers(user_id, role),
        )
        return self._json_object(response)

    async def create_access_ticket(
        self, system: str, user_id: str, role: str
    ) -> dict[str, Any]:
        response = await self._client.post(
            f"{self._base_url}/api/jira/ticket",
            json={"system": system},
            headers=self._headers(user_id, role),
        )
        return self._json_object(response)

    async def notify_mentor(
        self, message: str, user_id: str, role: str
    ) -> dict[str, Any]:
        response = await self._client.post(
            f"{self._base_url}/api/notify-mentor",
            json={"message": message},
            headers=self._headers(user_id, role),
        )
        return self._json_object(response)

    async def get_mentor_interns(self, user_id: str, role: str) -> dict[str, Any]:
        response = await self._client.get(
            f"{self._base_url}/api/mentor/interns",
            headers=self._headers(user_id, role),
        )
        return self._json_object(response)

    def _headers(self, user_id: str, role: str) -> dict[str, str]:
        return {
            "X-Internal-Token": self._internal_token,
            "X-User-ID": user_id,
            "X-User-Role": role,
        }

    @staticmethod
    def _json_object(response: httpx.Response) -> dict[str, Any]:
        response.raise_for_status()
        result = response.json()
        if not isinstance(result, dict):
            raise ValueError("Backend response must be a JSON object")
        return result

