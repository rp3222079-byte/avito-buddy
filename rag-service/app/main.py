from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Protocol

from fastapi import FastAPI, Request
from pydantic import BaseModel, Field, field_validator

from app.config import Settings, load_settings
from app.index import KnowledgeIndex, SearchResult


class Searcher(Protocol):
    def search(self, query: str, limit: int = 4) -> tuple[list[SearchResult], bool]: ...


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=1000)

    @field_validator("query")
    @classmethod
    def query_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("query must not be blank")
        return stripped


class SearchResultResponse(BaseModel):
    text: str
    source: str
    score: float
    chunk_id: str


class SearchResponse(BaseModel):
    results: list[SearchResultResponse]
    confident: bool


def build_index(settings: Settings) -> KnowledgeIndex:
    import chromadb
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    from app.embeddings import FastEmbedEmbeddingFunction

    client = chromadb.HttpClient(host=settings.chroma_host, port=settings.chroma_port)
    collection = client.get_or_create_collection(
        name=settings.collection_name,
        embedding_function=FastEmbedEmbeddingFunction(
            settings.embedding_model,
            cache_dir=settings.embedding_cache_dir,
        ),
        metadata={"hnsw:space": "cosine"},
    )
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
        separators=["\n## ", "\n### ", "\n\n", "\n", ". ", " ", ""],
    )
    return KnowledgeIndex(
        collection=collection,
        splitter=splitter,
        knowledge_base_path=settings.knowledge_base_path,
        score_threshold=settings.score_threshold,
    )


def create_app(searcher: Searcher | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        if searcher is None:
            settings = load_settings()
            index = build_index(settings)
            index.index_documents()
            application.state.searcher = index
        else:
            application.state.searcher = searcher
        yield

    application = FastAPI(title="Avito Buddy RAG", version="1.0.0", lifespan=lifespan)

    @application.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @application.post("/rag/search", response_model=SearchResponse)
    def search(body: SearchRequest, request: Request) -> SearchResponse:
        results, confident = request.app.state.searcher.search(body.query, limit=4)
        return SearchResponse(
            results=[SearchResultResponse(**vars(result)) for result in results],
            confident=confident,
        )

    return application


app = create_app()
