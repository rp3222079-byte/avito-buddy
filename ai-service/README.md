# AI-buddy AI-service

FastAPI AI-service for the project. It connects to an OpenAI-compatible chat API
(local Ollama by default), loads the existing system prompt and tool schemas,
and implements the first two tools: knowledge search through RAG and intern-task
lookup through Go API. Conversation storage and the morning scheduler are not
connected yet.

## Architecture

```text
app/
├── api/routes/     HTTP endpoints and transport concerns
├── core/           Environment-backed settings
├── integrations/   HTTP clients for RAG and Go API
├── schemas/        Validated request/response models
├── services/       Agent orchestration and tool-calling loop
├── tools/           Tool schema loading and execution dispatcher
└── main.py         FastAPI app and dependency lifecycle

system_prompt.txt   Existing agent prompt specification
tools_schema.json   Existing tool definitions for the next integration step
test_cases.md       Existing behavioral examples
```

Next modules: a persistence adapter for bounded conversation history and a
scheduler for `generate_morning_briefing()`. The Go Backend itself is not in this
repository; the service contract for its chat proxy is documented below.

## Run locally with Ollama

Ollama must be running with the configured model available (default: `qwen3:8b`).
From the repository root:

```sh
cp ai-service/.env.example ai-service/.env
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --app-dir ai-service --reload --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/docs` for the interactive API docs.

## Run tests

From the repository root, install the application and test dependencies, then
run the AI-service tests:

```sh
.venv/bin/python -m pip install -r requirements.txt -r ai-service/requirements-dev.txt
.venv/bin/python -m pytest
```

The shared tests live in the repository-level `tests/` directory, grouped by
area (currently `tests/ai_service/`). They mock the LLM, RAG, and Go API, so
those services do not need to be running. Pytest reports coverage for
`ai-service/app` and fails if it drops below 80%.

## Endpoints

- `GET /health` — process liveness; it does not wait for the model.
- `POST /api/chat` — one-shot local chat request.
- `POST /api/chat/stream` — Server-Sent Events (`token`, `done`, or `error`).

Both chat endpoints accept `X-User-ID` and `X-User-Role` headers from the Go
Backend. For local Swagger checks, omitted headers default to `intern_ivan` and
`intern`; do not rely on these demo defaults in a deployed environment.

Enabled tools:

- `search_knowledge_base` → `POST {RAG_BASE_URL}/rag/search`; forwards trusted identity headers for RAG access filtering.
- `get_jira_tasks` → `GET {BACKEND_BASE_URL}/api/jira/tasks`, forwarding the
  trusted identity in `X-User-ID` and `X-User-Role` headers.

The service filters `tools_schema.json` to these two tools. Access-ticket,
mentor-notification, and mentor-dashboard tools remain disabled until their
handlers and role checks are implemented.

Both chat endpoints load `system_prompt.txt` and add the role, current local time,
and weekday. Send `X-User-ID` and `X-User-Role: intern|mentor` headers from the
Go Backend. For local Swagger checks, omitted headers default to the demo identity
from `.env`; in production, derive them from the authenticated session rather
than trusting the browser.

Example:

```sh
curl http://127.0.0.1:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Привет! Ответь коротко."}'
```

For `/api/chat/stream`, use a streaming HTTP client such as `fetch()` and read
the response body. The browser `EventSource` API cannot send this POST body.

The endpoints are ready for the Go Backend to proxy. The Go service should
authenticate the session, pass its user ID and role in the internal headers,
then return the AI-service JSON or forward the SSE stream to the frontend. The
frontend should call Go Backend, not Ollama or this internal service directly.
The demo headers are not an authentication mechanism.

