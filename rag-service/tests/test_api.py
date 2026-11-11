from fastapi.testclient import TestClient

from app.index import SearchResult
from app.main import create_app


class FakeSearcher:
    def search(self, query: str, limit: int = 4) -> tuple[list[SearchResult], bool]:
        return [SearchResult(query, "team_rules.md", 0.91, "chunk-1")], True


def test_search_contract() -> None:
    with TestClient(create_app(FakeSearcher())) as client:
        response = client.post("/rag/search", json={"query": "Встреча в четверг"})

    assert response.status_code == 200
    assert response.json() == {
        "results": [
            {
                "text": "Встреча в четверг",
                "source": "team_rules.md",
                "score": 0.91,
                "chunk_id": "chunk-1",
            }
        ],
        "confident": True,
    }


def test_rejects_blank_and_too_long_queries() -> None:
    with TestClient(create_app(FakeSearcher())) as client:
        assert client.post("/rag/search", json={"query": "   "}).status_code == 422
        assert client.post("/rag/search", json={"query": "x" * 1001}).status_code == 422
