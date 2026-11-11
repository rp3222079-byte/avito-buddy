from pathlib import Path

from app.index import KnowledgeIndex


class SingleChunkSplitter:
    def split_text(self, text: str) -> list[str]:
        return [text]


class FakeCollection:
    def __init__(self) -> None:
        self.items: dict[str, tuple[str, dict]] = {}
        self.query_response: dict = {}

    def get(self, *, where: dict, include: list[str]) -> dict:
        selected = [
            (item_id, value)
            for item_id, value in self.items.items()
            if value[1]["source"] == where["source"]
        ]
        return {
            "ids": [item_id for item_id, _ in selected],
            "metadatas": [value[1] for _, value in selected],
        }

    def delete(self, *, where: dict) -> None:
        self.items = {
            item_id: value
            for item_id, value in self.items.items()
            if value[1]["source"] != where["source"]
        }

    def upsert(self, *, ids: list[str], documents: list[str], metadatas: list[dict]) -> None:
        for item_id, document, metadata in zip(ids, documents, metadatas, strict=True):
            self.items[item_id] = (document, metadata)

    def query(self, **_: object) -> dict:
        return self.query_response


def test_indexes_all_nine_documents_without_duplicates() -> None:
    collection = FakeCollection()
    knowledge_base = Path(__file__).resolve().parents[2] / "knowledge_base"
    index = KnowledgeIndex(collection, SingleChunkSplitter(), knowledge_base, 0.7)

    assert index.index_documents() == 9
    assert len(collection.items) == 9
    assert index.index_documents() == 0
    assert len(collection.items) == 9


def test_search_returns_at_most_four_chunks_and_confidence() -> None:
    collection = FakeCollection()
    collection.query_response = {
        "ids": [["a", "b", "c", "d"]],
        "documents": [["A", "B", "C", "D"]],
        "metadatas": [[{"source": "team_rules.md"} for _ in range(4)]],
        "distances": [[0.1, 0.2, 0.3, 0.4]],
    }
    index = KnowledgeIndex(collection, SingleChunkSplitter(), Path("."), 0.72)

    results, confident = index.search("Когда можно назначить встречу?")

    assert len(results) == 4
    assert results[0].source == "team_rules.md"
    assert results[0].score == 0.9
    assert confident is True


def test_search_marks_weak_match_as_not_confident() -> None:
    collection = FakeCollection()
    collection.query_response = {
        "ids": [["a"]],
        "documents": [["Не связанный текст"]],
        "metadatas": [[{"source": "company_facts.md"}]],
        "distances": [[0.6]],
    }
    index = KnowledgeIndex(collection, SingleChunkSplitter(), Path("."), 0.72)

    _, confident = index.search("Какая у меня зарплата?")

    assert confident is False
