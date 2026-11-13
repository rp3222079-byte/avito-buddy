from dataclasses import dataclass
import hashlib
from pathlib import Path
from typing import Any, Protocol


class Collection(Protocol):
    def get(self, **kwargs: Any) -> dict[str, Any]: ...

    def delete(self, **kwargs: Any) -> None: ...

    def upsert(self, **kwargs: Any) -> None: ...

    def query(self, **kwargs: Any) -> dict[str, Any]: ...


class TextSplitter(Protocol):
    def split_text(self, text: str) -> list[str]: ...


@dataclass(frozen=True)
class SearchResult:
    text: str
    source: str
    score: float
    chunk_id: str


class KnowledgeIndex:
    def __init__(
        self,
        collection: Collection,
        splitter: TextSplitter,
        knowledge_base_path: Path,
        score_threshold: float,
    ) -> None:
        self._collection = collection
        self._splitter = splitter
        self._knowledge_base_path = knowledge_base_path
        self._score_threshold = score_threshold

    def index_documents(self) -> int:
        files = sorted(self._knowledge_base_path.glob("*.md"))
        if not files:
            raise RuntimeError("В базе знаний не найдены Markdown-документы")
        indexed = 0
        for path in files:
            source = path.name
            content = path.read_text(encoding="utf-8")
            allowed_roles, indexed_content = self._document_access(content, source)
            chunks = [
                chunk.strip() for chunk in self._splitter.split_text(indexed_content)
            ]
            chunks = [chunk for chunk in chunks if chunk]
            checksum = hashlib.sha256(content.encode("utf-8")).hexdigest()
            existing = self._collection.get(
                where={"source": source}, include=["metadatas"]
            )
            metadata = existing.get("metadatas") or []
            if metadata and all(item.get("checksum") == checksum for item in metadata):
                continue
            if existing.get("ids"):
                self._collection.delete(where={"source": source})
            ids = [self._chunk_id(source, checksum, number) for number in range(len(chunks))]
            metadatas = [
                {
                    "source": source,
                    "checksum": checksum,
                    "chunk_number": number,
                    "allow_intern": "intern" in allowed_roles,
                    "allow_mentor": "mentor" in allowed_roles,
                }
                for number in range(len(chunks))
            ]
            self._collection.upsert(
                ids=ids,
                documents=chunks,
                metadatas=metadatas,
            )
            indexed += len(chunks)
        return indexed

    def search(
        self, query: str, role: str, limit: int = 4
    ) -> tuple[list[SearchResult], bool]:
        if role not in {"intern", "mentor"}:
            raise ValueError("role must be intern or mentor")
        response = self._collection.query(
            query_texts=[query],
            n_results=min(limit, 4),
            include=["documents", "metadatas", "distances"],
            where={f"allow_{role}": True},
        )
        ids = (response.get("ids") or [[]])[0]
        documents = (response.get("documents") or [[]])[0]
        metadatas = (response.get("metadatas") or [[]])[0]
        distances = (response.get("distances") or [[]])[0]
        results = []
        for chunk_id, text, metadata, distance in zip(
            ids, documents, metadatas, distances, strict=False
        ):
            score = max(0.0, min(1.0, 1.0 - float(distance)))
            results.append(
                SearchResult(
                    text=text,
                    source=metadata["source"],
                    score=score,
                    chunk_id=chunk_id,
                )
            )
        confident = bool(results and results[0].score >= self._score_threshold)
        return results, confident

    @staticmethod
    def _chunk_id(source: str, checksum: str, number: int) -> str:
        value = f"{source}:{checksum}:{number}".encode("utf-8")
        return hashlib.sha256(value).hexdigest()

    @staticmethod
    def _document_access(content: str, source: str) -> tuple[set[str], str]:
        marker, separator, body = content.partition("\n")
        prefix = "<!-- allowed_roles:"
        if not separator or not marker.startswith(prefix) or not marker.endswith("-->"):
            raise RuntimeError(
                f"Документ {source} не содержит allowed_roles в первой строке"
            )
        roles = {
            role.strip()
            for role in marker[len(prefix):-3].split(",")
            if role.strip()
        }
        if not roles or not roles.issubset({"intern", "mentor"}):
            raise RuntimeError(
                f"Документ {source} содержит некорректный allowed_roles"
            )
        return roles, body
