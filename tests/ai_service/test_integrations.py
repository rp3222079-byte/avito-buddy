import json

import httpx
import pytest

from app.integrations.backend_client import BackendClient
from app.integrations.rag_client import RagClient


@pytest.mark.asyncio
async def test_rag_client_posts_query_and_identity_headers():
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"results": [{"source": "guide.md"}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await RagClient(client, "http://rag.local/").search_knowledge_base(
            "Как оформить отпуск?", user_id="intern-7", role="intern"
        )

    request = requests[0]
    assert request.method == "POST"
    assert str(request.url) == "http://rag.local/rag/search"
    assert json.loads(request.content) == {"query": "Как оформить отпуск?"}
    assert request.headers["X-User-ID"] == "intern-7"
    assert request.headers["X-User-Role"] == "intern"
    assert result == {"results": [{"source": "guide.md"}]}


@pytest.mark.asyncio
async def test_backend_client_gets_tasks_and_forwards_identity():
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"tasks": [{"id": "AV-12"}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await BackendClient(client, "http://backend.local/").get_jira_tasks(
            user_id="intern-7", role="intern"
        )

    request = requests[0]
    assert request.method == "GET"
    assert str(request.url) == "http://backend.local/api/jira/tasks"
    assert request.headers["X-User-ID"] == "intern-7"
    assert request.headers["X-User-Role"] == "intern"
    assert result == {"tasks": [{"id": "AV-12"}]}


@pytest.mark.asyncio
async def test_rag_client_rejects_non_object_json_response():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=[]))
    ) as client:
        with pytest.raises(ValueError, match="JSON object"):
            await RagClient(client, "http://rag.local").search_knowledge_base(
                "query", user_id="intern-7", role="intern"
            )


@pytest.mark.asyncio
async def test_backend_client_raises_for_http_error():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(503))
    ) as client:
        with pytest.raises(httpx.HTTPStatusError):
            await BackendClient(client, "http://backend.local").get_jira_tasks(
                user_id="intern-7", role="intern"
            )
