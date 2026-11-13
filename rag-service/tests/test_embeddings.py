from app.embeddings import FastEmbedEmbeddingFunction


class Vector:
    def tolist(self) -> list[float]:
        return [1.0, 0.0]


class FakeModel:
    def embed(self, _: object) -> list[Vector]:
        return [Vector()]

    def query_embed(self, _: object) -> list[Vector]:
        return [Vector()]


def test_preserves_array_objects_required_by_chroma_http_client() -> None:
    embedding = FastEmbedEmbeddingFunction.__new__(FastEmbedEmbeddingFunction)
    embedding._model = FakeModel()

    assert embedding(["документ"])[0].tolist() == [1.0, 0.0]
    assert embedding.embed_query(["вопрос"])[0].tolist() == [1.0, 0.0]
