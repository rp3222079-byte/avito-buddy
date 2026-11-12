from typing import Any

import httpx


class RagClient:
    def __init__(
        self, client: httpx.AsyncClient, base_url: str, internal_token: str
    ) -> None:
        self._client = client
        self._base_url = base_url.rstrip("/")
        self._internal_token = internal_token

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
            headers={
                "X-Internal-Token": self._internal_token,
                "X-User-ID": user_id,
                "X-User-Role": role,
            },
        )
        response.raise_for_status()
        result = response.json()
        if not isinstance(result, dict):
            raise ValueError("RAG response must be a JSON object")
        return result

    async def get_checklist(self, *, user_id: str, role: str) -> dict[str, Any]:
        return await self.search_knowledge_base(
            "черновой чек-лист адаптации стажёра: этапы, задачи первой недели, "
            "первые задачи, экватор и завершение стажировки",
            user_id=user_id,
            role=role,
        )

