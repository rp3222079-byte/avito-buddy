from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv

SERVICE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(SERVICE_DIR / ".env")


@dataclass(frozen=True)
class Settings:
    llm_base_url: str
    llm_api_key: str
    llm_model: str
    llm_timeout_seconds: float
    rag_base_url: str
    backend_base_url: str
    internal_token: str
    request_context_secret: str
    app_timezone: str
    system_prompt_path: Path
    tools_schema_path: Path


@lru_cache
def get_settings() -> Settings:
    llm_base_url = os.getenv("LLM_BASE_URL", "").strip() or "http://localhost:11434/v1/"
    llm_api_key = os.getenv("LLM_API_KEY", "").strip()
    llm_model = os.getenv("LLM_MODEL", "").strip()
    endpoint = urlsplit(llm_base_url)
    local_ollama = endpoint.port == 11434 and endpoint.hostname in {
        "localhost", "127.0.0.1", "::1", "host.docker.internal", "ollama"
    }
    if local_ollama:
        llm_api_key = llm_api_key or "ollama"
        llm_model = llm_model or "qwen3:8b"
    elif not llm_api_key or llm_api_key == "ollama" or not llm_model:
        raise ValueError("Set LLM_API_KEY and LLM_MODEL for the configured LLM_BASE_URL.")

    return Settings(
        llm_base_url=llm_base_url,
        llm_api_key=llm_api_key,
        llm_model=llm_model,
        llm_timeout_seconds=float(os.getenv("LLM_TIMEOUT_SECONDS", "120")),
        rag_base_url=os.getenv("RAG_BASE_URL", "http://localhost:8001"),
        backend_base_url=os.getenv("BACKEND_BASE_URL", "http://localhost:8080"),
        internal_token=os.getenv("INTERNAL_TOKEN", ""),
        request_context_secret=os.getenv("REQUEST_CONTEXT_SECRET", ""),
        app_timezone=os.getenv("APP_TIMEZONE", "Asia/Novosibirsk"),
        system_prompt_path=Path(
            os.getenv("SYSTEM_PROMPT_PATH", str(SERVICE_DIR / "system_prompt.txt"))
        ),
        tools_schema_path=Path(
            os.getenv("TOOLS_SCHEMA_PATH", str(SERVICE_DIR / "tools_schema.json"))
        ),
    )

