from collections.abc import Sequence
from typing import Any


class FastEmbedEmbeddingFunction:
    def __init__(self, model_name: str, cache_dir: str | None = None) -> None:
        from fastembed import TextEmbedding

        self._model = TextEmbedding(
            model_name=model_name,
            cache_dir=cache_dir,
            cuda=False,
        )
        self._model_name = model_name

    def __call__(self, input: Sequence[str]) -> list[Any]:
        return list(self._model.embed(input))

    def embed_query(self, input: Sequence[str]) -> list[Any]:
        return list(self._model.query_embed(input))

    def name(self) -> str:
        return f"fastembed-{self._model_name}"
