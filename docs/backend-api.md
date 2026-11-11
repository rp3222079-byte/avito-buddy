# Backend и RAG

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
- RAG и Swagger: `http://localhost:8001/docs`
- ChromaDB: `http://localhost:8002`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

Первый запуск RAG скачивает мультиязычную ONNX-модель размером около 220 МБ. Модель сохраняется в Docker volume `embedding_models`.

## Демо-пользователи

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

Задачи и создание тикета:

```sh
curl -b /tmp/avito-intern.cookies http://localhost:8080/api/jira/tasks

curl -b /tmp/avito-intern.cookies \
  -H 'Content-Type: application/json' \
  -d '{"system":"confluence"}' \
  http://localhost:8080/api/jira/ticket
```

Повторный запрос на ту же систему вернёт тот же `ticket_id` с HTTP 200 вместо создания новой записи.

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

## Подключение AI-service

Внутренние вызовы AI-service к Go Backend должны передавать три заголовка:

```text
X-Internal-Token: значение INTERNAL_TOKEN
X-User-ID: intern_ivan
X-User-Role: intern
```

Один только `X-User-ID` не даёт доступ. Значение `INTERNAL_TOKEN` должно совпадать у Go Backend и AI-service и не должно передаваться браузеру.

## Тесты

```sh
cd backend
go test ./...

cd ../rag-service
python -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
PYTHONPATH=. .venv/bin/pytest -q
```

Миграция PostgreSQL применяется автоматически при первом создании volume. Если схема изменилась после первого запуска, примените новую миграцию отдельно или пересоздайте только development volume.
