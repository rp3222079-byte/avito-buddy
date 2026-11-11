from typing import Any

import httpx


class RagClient:
    def __init__(self, client: httpx.AsyncClient, base_url: str) -> None:
        self._client = client
        self._base_url = base_url.rstrip("/")

    async def search_knowledge_base(
        self,
        query: str,
        *,
        user_id: str,
        role: str,
    ) -> dict[str, Any]:
        response = await self._client.post(
            f"{self._base_url}/rag/search",
            json={"query": query},
            headers={"X-User-ID": user_id, "X-User-Role": role},
        )
        response.raise_for_status()
        result = response.json()
        if not isinstance(result, dict):
            raise ValueError("RAG response must be a JSON object")
        return result

