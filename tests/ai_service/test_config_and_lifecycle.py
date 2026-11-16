from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI

import app.core.config as config_module
import app.main as main_module


def test_get_settings_reads_environment_values(monkeypatch, tmp_path):
    config_module.get_settings.cache_clear()
    values = {
        "LLM_BASE_URL": "http://llm.test/v1",
        "LLM_API_KEY": "test-key",
        "LLM_MODEL": "test-model",
        "LLM_TIMEOUT_SECONDS": "7.5",
        "RAG_BASE_URL": "http://rag.test",
        "BACKEND_BASE_URL": "http://backend.test",
        "INTERNAL_TOKEN": "shared-secret",
        "REQUEST_CONTEXT_SECRET": "request-secret",
        "APP_TIMEZONE": "UTC",
        "SYSTEM_PROMPT_PATH": str(tmp_path / "prompt.txt"),
        "TOOLS_SCHEMA_PATH": str(tmp_path / "tools.json"),
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)

    settings = config_module.get_settings()

    assert settings.llm_base_url == values["LLM_BASE_URL"]
    assert settings.llm_api_key == values["LLM_API_KEY"]
    assert settings.llm_model == values["LLM_MODEL"]
    assert settings.llm_timeout_seconds == 7.5
    assert settings.rag_base_url == values["RAG_BASE_URL"]
    assert settings.backend_base_url == values["BACKEND_BASE_URL"]
    assert settings.internal_token == values["INTERNAL_TOKEN"]
    assert settings.request_context_secret == values["REQUEST_CONTEXT_SECRET"]
    assert settings.app_timezone == "UTC"
    assert str(settings.system_prompt_path) == values["SYSTEM_PROMPT_PATH"]
    assert str(settings.tools_schema_path) == values["TOOLS_SCHEMA_PATH"]
    config_module.get_settings.cache_clear()


@pytest.mark.asyncio
async def test_app_lifespan_initializes_and_closes_clients(monkeypatch, tmp_path):
    settings = SimpleNamespace(
        llm_base_url="http://llm.test/v1",
        llm_api_key="key",
        llm_model="model",
        llm_timeout_seconds=4,
        rag_base_url="http://rag.test",
        backend_base_url="http://backend.test",
        internal_token="shared-secret",
        request_context_secret="request-secret",
        app_timezone="UTC",
        system_prompt_path=tmp_path / "system_prompt.txt",
        tools_schema_path=tmp_path / "tools.json",
    )
    llm_client = SimpleNamespace(close=AsyncMock())
    http_client = SimpleNamespace(aclose=AsyncMock())
    agent = object()
    executor = object()
    rag_client = object()
    backend_client = object()
    openai_factory = MagicMock(return_value=llm_client)
    http_factory = MagicMock(return_value=http_client)
    agent_factory = MagicMock(return_value=agent)
    executor_factory = MagicMock(return_value=executor)

    monkeypatch.setattr(main_module, "get_settings", lambda: settings)
    monkeypatch.setattr(main_module, "AsyncOpenAI", openai_factory)
    monkeypatch.setattr(main_module.httpx, "AsyncClient", http_factory)
    monkeypatch.setattr(main_module, "RagClient", MagicMock(return_value=rag_client))
    monkeypatch.setattr(main_module, "BackendClient", MagicMock(return_value=backend_client))
    monkeypatch.setattr(main_module, "ToolExecutor", executor_factory)
    monkeypatch.setattr(main_module, "AgentService", agent_factory)
    application = FastAPI()

    async with main_module.lifespan(application):
        assert application.state.settings is settings
        assert application.state.llm_client is llm_client
        assert application.state.internal_token == "shared-secret"
        assert application.state.request_context_secret == "request-secret"
        assert application.state.agent is agent
        executor_factory.assert_called_once()
        agent_factory.assert_called_once()

    llm_client.close.assert_awaited_once()
    http_client.aclose.assert_awaited_once()


@pytest.mark.parametrize("url", ["", "http://host.docker.internal:11434/v1/"])
def test_ollama_keeps_local_defaults(monkeypatch, url):
    monkeypatch.setenv("LLM_BASE_URL", url)
    monkeypatch.setenv("LLM_API_KEY", "")
    monkeypatch.setenv("LLM_MODEL", "")

    settings = config_module.get_settings.__wrapped__()

    assert settings.llm_api_key == "ollama"
    assert settings.llm_model == "qwen3:8b"


@pytest.mark.parametrize(
    ("key", "model"),
    [("", "gpt-4.1-mini"), ("ollama", "gpt-4.1-mini"), ("test-key", "")],
)
def test_remote_llm_requires_explicit_key_and_model(monkeypatch, key, model):
    monkeypatch.setenv("LLM_BASE_URL", "https://openai.bothub.chat/v1")
    monkeypatch.setenv("LLM_API_KEY", key)
    monkeypatch.setenv("LLM_MODEL", model)

    with pytest.raises(ValueError, match="Set LLM_API_KEY and LLM_MODEL"):
        config_module.get_settings.__wrapped__()
