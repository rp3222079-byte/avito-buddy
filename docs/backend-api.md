# Backend, AI и RAG

Go Backend работает независимо от frontend и является единственной публичной точкой входа для браузера. Полный машиночитаемый контракт находится в `docs/openapi.yaml`.

## Запуск

```sh
cp .env.example .env
docker compose up --build -d
docker compose ps
```

Если в системе задан локальный HTTP proxy/VPN, добавьте localhost в исключения перед `curl`:

```sh
export NO_PROXY=localhost,127.0.0.1
export no_proxy=localhost,127.0.0.1
```

Сервисы:

- Backend: `http://localhost:8080`
- AI-service: `http://localhost:8000`
- RAG и Swagger: `http://localhost:8001/docs`
- ChromaDB: `http://localhost:8002`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

Первый запуск RAG скачивает мультиязычную ONNX-модель размером около 220 МБ. Модель сохраняется в Docker volume `embedding_models`.
AI-service требует запущенного Ollama с моделью `qwen3:8b` (по умолчанию на хосте).

## Демо-режим и ограничения стенда

> **Важно:** Текущая реализация использует **демо-авторизацию** для локальной разработки и стенда.

**Что это значит:**
- `POST /api/session` принимает `user_id` и `role` из тела запроса и сверяет их со списком `AllowedIdentities` (demo-пользователи).
- **Это не настоящая аутентификация** — личность пользователя не верифицируется.
- В продакшене необходима интеграция с корпоративной системой входа (OAuth/SSO), формирование сессии только из проверенной личности, проверка связи «стажёр — наставник» на стороне Backend.
- Переменная `DEMO_MODE=true` (по умолчанию) включает этот режим. При `DEMO_MODE=false` эндпоинт `/api/session` вернёт ошибку конфигурации.
- `INTERNAL_TOKEN` и `X-Request-Context` **никогда не должны попадать в браузер** — они используются только для межсервисного взаимодействия (Go Backend ↔ AI-service).

**Демо-пользователи (только для стенда):**
| user_id | role |
|---|---|
| `intern_ivan` | `intern` |
| `intern_anna` | `intern` |
| `intern_oleg` | `intern` |
| `intern_maria` | `intern` |
| `mentor_smith` | `mentor` |

## Проверка через curl

Создание сессии стажёра:

```sh
curl -i -c /tmp/avito-intern.cookies \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"intern_ivan","role":"intern"}' \
  http://localhost:8080/api/session
```

Задачи и создание заявки через pending_action:

```sh
# 1. Создать черновик заявки
curl -b /tmp/avito-intern.cookies \
  -H 'Content-Type: application/json' \
  -d '{"action":"create_access_ticket","payload":{"system":"confluence","access_level":"read","reason":"Для задач стажировки"}}' \
  http://localhost:8080/api/pending-action

# 2. Подтвердить черновик (pending_id из ответа предыдущего шага)
curl -b /tmp/avito-intern.cookies \
  -H 'Content-Type: application/json' \
  -d '{"pending_id":"p_abc123"}' \
  http://localhost:8080/api/pending-action/confirm
```

Повторный запрос на ту же систему вернёт тот же `request_id` с HTTP 200 вместо создания новой записи.

Проверка роли наставника:

```sh
curl -i -b /tmp/avito-intern.cookies http://localhost:8080/api/mentor/interns

curl -c /tmp/avito-mentor.cookies \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"mentor_smith","role":"mentor"}' \
  http://localhost:8080/api/session

curl -b /tmp/avito-mentor.cookies http://localhost:8080/api/mentor/interns
```

Первый запрос возвращает `403`, второй — список стажёров наставника.

Уведомление наставника (только стажёр, с идемпотентностью):

```sh
curl -b /tmp/avito-intern.cookies \
  -H 'Content-Type: application/json' \
  -d '{"message":"Нужна помощь","idempotency_key":"notify-123"}' \
  http://localhost:8080/api/notify-mentor
```

Повторный запрос с тем же `idempotency_key` вернёт тот же результат без повторной отправки.

Поиск по базе знаний:

```sh
curl -H 'Content-Type: application/json' \
  -d '{"query":"Можно ли назначить встречу в четверг в 14:00?"}' \
  http://localhost:8001/rag/search
```

## Подключение frontend

Frontend должен отправлять cookie в каждом запросе:

```ts
await fetch("http://localhost:8080/api/jira/tasks", {
  credentials: "include",
});
```

Разрешённые origin перечисляются через `CORS_ALLOWED_ORIGINS` через запятую. Роль и `user_id` после входа берутся только из серверной сессии; браузерные `X-User-ID` и `X-User-Role` не считаются доверенными.

`POST /api/chat/stream` возвращает SSE-события `token`, затем `done` либо `error`. Поток проксируется без изменения тела.

Подтверждение действий: frontend получает `pending_action` с `pending_id`, показывает черновик пользователю, после нажатия «Подтвердить» отправляет `POST /api/pending-action/confirm` с `pending_id`. Backend выполняет действие и возвращает каноническую модель заявки (`request_id`, `system`, `status`, `sla_hours`, `existing`).

## Подключение AI-service

Внутренние вызовы AI-service к Go Backend должны передавать три заголовка:

```text
X-Internal-Token: значение INTERNAL_TOKEN
X-User-ID: intern_ivan
X-User-Role: intern
```

Один только `X-User-ID` не даёт доступ. Значение `INTERNAL_TOKEN` должно совпадать у Go Backend и AI-service и не должно передаваться браузеру.

AI-service также получает подписанный `X-Request-Context` и при заданном
`REQUEST_CONTEXT_SECRET` проверяет подпись, совпадение пользователя и роли, а
также возраст контекста. Значение secret должно совпадать у Backend и AI-service.

## Тесты

```sh
cd backend
go test ./...

cd ../rag-service
python -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
PYTHONPATH=. .venv/bin/pytest -q

cd ../ai-service
python -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
PYTHONPATH=. .venv/bin/pytest -q
```

Миграция PostgreSQL применяется автоматически при первом создании volume. Если схема изменилась после первого запуска, примените новую миграцию отдельно или пересоздайте только development volume.
