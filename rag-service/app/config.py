from dataclasses import dataclass
import os
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    chroma_host: str
    chroma_port: int
    collection_name: str
    knowledge_base_path: Path
    embedding_model: str
    embedding_cache_dir: str | None
    chunk_size: int
    chunk_overlap: int
    score_threshold: float
    internal_token: str


def load_settings() -> Settings:
    return Settings(
        chroma_host=os.getenv("CHROMA_HOST", "localhost"),
        chroma_port=int(os.getenv("CHROMA_PORT", "8002")),
        collection_name=os.getenv("CHROMA_COLLECTION", "avito_knowledge_base"),
        knowledge_base_path=Path(
            os.getenv("KNOWLEDGE_BASE_PATH", "../knowledge_base")
        ),
        embedding_model=os.getenv(
            "EMBEDDING_MODEL",
            "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        ),
        embedding_cache_dir=os.getenv("EMBEDDING_CACHE_DIR") or None,
        chunk_size=int(os.getenv("RAG_CHUNK_SIZE", "800")),
        chunk_overlap=int(os.getenv("RAG_CHUNK_OVERLAP", "120")),
        score_threshold=float(os.getenv("RAG_SCORE_THRESHOLD", "0.72")),
        internal_token=os.getenv("INTERNAL_TOKEN", ""),
    )
