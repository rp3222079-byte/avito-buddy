from contextlib import asynccontextmanager

from fastapi import FastAPI
import httpx
from openai import AsyncOpenAI

from app.api.routes import chat, health
from app.core.config import get_settings
from app.integrations.backend_client import BackendClient
from app.integrations.rag_client import RagClient
from app.services.agent import AgentService
from app.tools.executor import ToolExecutor


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    client = AsyncOpenAI(
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key,
        timeout=settings.llm_timeout_seconds,
    )
    http_client = httpx.AsyncClient(timeout=settings.llm_timeout_seconds)
    rag_client = RagClient(http_client, settings.rag_base_url, settings.internal_token)
    backend_client = BackendClient(
        http_client, settings.backend_base_url, settings.internal_token
    )
    tool_executor = ToolExecutor(
        schema_path=settings.tools_schema_path,
        rag_client=rag_client,
        backend_client=backend_client,
    )
    app.state.settings = settings
    app.state.llm_client = client
    app.state.internal_token = settings.internal_token
    app.state.request_context_secret = settings.request_context_secret
    app.state.agent = AgentService(
        client=client,
        model=settings.llm_model,
        system_prompt_path=settings.system_prompt_path,
        timezone=settings.app_timezone,
        tool_executor=tool_executor,
    )
    try:
        yield
    finally:
        await client.close()
        await http_client.aclose()


app = FastAPI(
    title="AI-buddy AI-service",
    description="Local development scaffold for the AI-buddy agent.",
    version="0.1.0",
    lifespan=lifespan,
)
app.include_router(health.router)
app.include_router(chat.router)

