from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import hmac
from typing import Literal, Protocol

from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from app.config import Settings, load_settings
from app.index import KnowledgeIndex, SearchResult


class Searcher(Protocol):
    def search(
        self, query: str, role: str, limit: int = 4
    ) -> tuple[list[SearchResult], bool]: ...


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


def create_app(
    searcher: Searcher | None = None, internal_token: str | None = None
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        if searcher is None:
            settings = load_settings()
            index = build_index(settings)
            index.index_documents()
            application.state.searcher = index
            application.state.internal_token = internal_token or settings.internal_token
        else:
            application.state.searcher = searcher
            application.state.internal_token = internal_token or ""
        yield

    application = FastAPI(title="Avito Buddy RAG", version="1.0.0", lifespan=lifespan)

    @application.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @application.post("/rag/search", response_model=SearchResponse)
    def search(
        body: SearchRequest,
        request: Request,
        internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
        user_id: str | None = Header(default=None, alias="X-User-ID"),
        role: Literal["intern", "mentor"] | None = Header(default=None, alias="X-User-Role"),
    ) -> SearchResponse:
        expected_token = request.app.state.internal_token
        if not expected_token:
            raise HTTPException(
                status_code=503, detail="RAG internal auth is not configured"
            )
        if not internal_token or not hmac.compare_digest(internal_token, expected_token):
            raise HTTPException(
                status_code=401, detail="Internal service authentication required"
            )
        if not user_id or not role:
            raise HTTPException(status_code=401, detail="Backend identity is required")
        results, confident = request.app.state.searcher.search(
            body.query, role=role, limit=4
        )
        return SearchResponse(
            results=[SearchResultResponse(**vars(result)) for result in results],
            confident=confident,
        )

    return application


app = create_app()
