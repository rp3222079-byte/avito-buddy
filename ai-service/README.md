# AI-buddy AI-service

FastAPI AI-service for the project. It connects to an OpenAI-compatible chat API
(local Ollama by default), loads the system prompt and tool schemas, and runs
knowledge search, checklist retrieval, intern tasks, access tickets, mentor
notifications, and mentor intern lookup through RAG and Go Backend. Conversation
storage and the morning scheduler are not connected yet.

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

system_prompt.txt   Agent prompt and tool-use rules
tools_schema.json   Tool definitions exposed to the model
test_cases.md       Existing behavioral examples
```

Next modules: a persistence adapter for bounded conversation history and a
scheduler for `generate_morning_briefing()`. The Go Backend source is maintained
separately; its current chat proxy forwards session context to this service. The
frontend in this folder still uses local demo behavior.

## Run locally with Ollama

Ollama must be running with the configured model available (default: `qwen3:8b`).
From the repository root:

```sh
cp ai-service/.env.example ai-service/.env
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --app-dir ai-service --reload --host 127.0.0.1 --port 8000
```

Start the Backend and RAG dependencies in another terminal with
`docker compose up --build postgres redis chromadb rag-service backend`. The
AI process reads `BACKEND_BASE_URL`, `RAG_BASE_URL`, and `INTERNAL_TOKEN` from
`ai-service/.env`; keep the token identical in the Compose environment. For a
single-command stack, use `docker compose up --build` from the repository root.
Ollama remains on the host and is reached from containers through
`host.docker.internal`.

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
- `POST /api/chat` — one-shot chat request with `message` and optional
  `confirmed_action` (`create_access_ticket` or `notify_mentor`).
- `POST /api/chat/stream` — the same request as Server-Sent Events (`token`, `done`, or `error`).

Both chat endpoints accept `X-User-ID` and `X-User-Role` headers from the Go
Backend and require `X-Internal-Token`. Set `INTERNAL_TOKEN` to the same secret
in AI-service and Go Backend. Supply a valid identity and role from the Backend
session on every request; the service does not invent a demo identity when
headers are missing. When `REQUEST_CONTEXT_SECRET` is configured, the service
also requires `X-Request-Context`, verifies its HMAC signature and identity, and
rejects contexts older than 60 seconds. Use the same secret in both services.

Enabled tools:

- `search_knowledge_base` → `POST {RAG_BASE_URL}/rag/search`; forwards the shared internal token and trusted identity headers. Each indexed Markdown document must declare `<!-- allowed_roles: intern,mentor -->` (or a narrower role list) on its first line; the current nine documents are shared between roles.
- `get_jira_tasks` → `GET {BACKEND_BASE_URL}/api/jira/tasks`, forwarding
  `X-Internal-Token` and the trusted identity in `X-User-ID` and `X-User-Role`.
- `get_checklist` → RAG search for the demo onboarding checklist; it is a draft, not an official policy.
- `create_access_ticket` → `POST {BACKEND_BASE_URL}/api/jira/ticket`; interns only.
- `notify_mentor` → `POST {BACKEND_BASE_URL}/api/notify-mentor`; interns only.
- `get_mentor_interns` → `GET {BACKEND_BASE_URL}/api/mentor/interns`; mentors only.

The service offers these six tools to the model and enforces role checks before
calling Backend. Ticket creation and mentor notification are side effects: the
AI endpoint requires `confirmed_action` to match the requested tool in the same
HTTP request. A confirmation from an earlier message is not retained.

Both chat endpoints load `system_prompt.txt` and add the role, current local time,
and weekday. Send `X-Internal-Token`, `X-User-ID` and `X-User-Role: intern|mentor`
headers from the Go Backend. For local Swagger checks, use the configured token
and a known demo identity explicitly; never expose the token to browser code.

Read-only chat example:

```sh
curl http://127.0.0.1:8000/api/chat \
  -H 'Content-Type: application/json' \
  -H 'X-Internal-Token: local-dev-internal-token' \
  -H 'X-User-ID: intern_ivan' \
  -H 'X-User-Role: intern' \
  -d '{"message":"Привет! Ответь коротко."}'
```

For `/api/chat/stream`, use a streaming HTTP client such as `fetch()` and read
the response body. The browser `EventSource` API cannot send this POST body.

To execute a confirmed ticket request, include the explicit confirmation in the
same request body:

```json
{"message":"Подтверждаю создание заявки на Jira","confirmed_action":"create_access_ticket"}
```

Use `"confirmed_action":"notify_mentor"` in the same way for a confirmed
mentor notification. The Backend session cookie and internal token remain
server-side; do not put `X-Internal-Token` in browser code.

The Go Backend proxies these endpoints and forwards the user ID and role from
its session. The frontend should call Go Backend, not Ollama or this internal
service directly. The current Backend session creation is demo-only and does
not authenticate a real person.
The shared internal token authenticates service-to-service requests; the user
identity must come from the authenticated Backend session.

