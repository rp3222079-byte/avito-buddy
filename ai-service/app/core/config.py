from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path

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
    app_timezone: str
    system_prompt_path: Path
    tools_schema_path: Path


@lru_cache
def get_settings() -> Settings:
    return Settings(
        llm_base_url=os.getenv("LLM_BASE_URL", "http://localhost:11434/v1/"),
        llm_api_key=os.getenv("LLM_API_KEY", "ollama"),
        llm_model=os.getenv("LLM_MODEL", "qwen3:8b"),
        llm_timeout_seconds=float(os.getenv("LLM_TIMEOUT_SECONDS", "120")),
        rag_base_url=os.getenv("RAG_BASE_URL", "http://localhost:8001"),
        backend_base_url=os.getenv("BACKEND_BASE_URL", "http://localhost:8080"),
        internal_token=os.getenv("INTERNAL_TOKEN", ""),
        app_timezone=os.getenv("APP_TIMEZONE", "Asia/Novosibirsk"),
        system_prompt_path=Path(
            os.getenv("SYSTEM_PROMPT_PATH", str(SERVICE_DIR / "system_prompt.txt"))
        ),
        tools_schema_path=Path(
            os.getenv("TOOLS_SCHEMA_PATH", str(SERVICE_DIR / "tools_schema.json"))
        ),
    )

