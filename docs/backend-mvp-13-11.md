# Backend MVP: скорборд, этапы, метрики и STUCK

Документ описывает Backend-часть задания «правки 13.11» из ветки
`backend-mvp-13-11`.

## 1. Что реализовано

| Метод и путь | Назначение | Источник данных |
| --- | --- | --- |
| `POST /sync/jira` | Заглушка ручной синхронизации Jira | фиксированный ответ |
| `GET /scoreboard` | Рейтинг стажёров | `data/mock_scoreboard.json` |
| `GET /tasks/{id}/stages` | Этапы задачи и время на этапах | `data/mock_jira.json` |
| `GET /interns/{id}/metrics` | Средние метрики по этапам | `data/mock_ai_metrics_response.json` |
| `GET /flags` | Активные STUCK-флаги | `data/mock_flags.json` |
| `PATCH /flags/{id}/resolve` | Подтверждение локального скрытия флага | данные не изменяются |
| `GET /api/mentor/interns` | Стажёры наставника с флагами | `mock_mentor.json` + `mock_flags.json` |

Первые шесть маршрутов являются открытыми MVP-заглушками. Для
`GET /api/mentor/interns` нужна сессия наставника.

## 2. Как устроено

- `backend/internal/api/router.go` регистрирует маршруты и зависимости.
- `backend/internal/api/features.go` содержит HTTP handlers и вычисляет поля
  стажёров.
- `backend/internal/storage/feature_store.go` загружает JSON-моки при старте и
  рассчитывает длительности этапов.
- `backend/internal/domain/models.go` содержит модели ответов API.
- `backend/internal/config/config.go` читает пути к мокам из environment.
- `docs/openapi.yaml` содержит полный машиночитаемый контракт.

Backend при запуске читает моки в память. После ручного изменения JSON-файла
Backend нужно перезапустить.

## 3. Правила расчёта

### Этапы задачи

`current_stage` — последний элемент массива `transitions`.

Для каждого этапа длительность равна разнице между его `entered_at` и
`entered_at` следующего этапа в секундах. У последнего этапа длительность
равна `null`.

Пример для `AVT-555`:

```json
{
  "current_stage": "IN_PROGRESS",
  "durations": {
    "NOT_STARTED": 7200,
    "IN_PROGRESS": null
  }
}
```

### Состояние стажёра

При запросе списка стажёров учитываются только флаги с
`resolved_at: null`:

1. есть флаг `high` → `status: "blocked"`;
2. есть флаг `medium` или `progress_percent < 30` → `status: "at_risk"`;
3. иначе → `status: "on_track"`.

`stuck` равен `true`, если есть хотя бы один активный флаг. `blockers`
формируется из поля `reason` активных флагов.

## 4. Запуск Backend

Из корня репозитория:

```bash
docker compose up -d --build postgres redis backend
docker compose ps
```

Дождитесь статуса `healthy` у трёх сервисов. Проверка состояния:

```bash
curl -i http://127.0.0.1:8080/health
```

Ожидается HTTP `200`:

```json
{"status":"ok"}
```

Логи Backend:

```bash
docker compose logs --tail=100 backend
```

## 5. Ручная проверка новых маршрутов

### 5.1 Синхронизация Jira

```bash
curl -i -X POST http://127.0.0.1:8080/sync/jira
```

Ожидается HTTP `200`:

```json
{"status":"success","updated":4}
```

### 5.2 Скорборд

```bash
curl -i 'http://127.0.0.1:8080/scoreboard?week=2026-W45'
```

Параметр `week` в MVP игнорируется. Ответ всегда содержит неделю из мока:

```json
{
  "week": "2026-W46",
  "entries": [
    {
      "intern_id": "intern_anna",
      "name": "Анна Петрова",
      "points": 40,
      "place": 1,
      "is_top5": true
    }
  ]
}
```

В полном ответе шесть записей: места 1–5 имеют `is_top5: true`, место 6 —
`false`.

### 5.3 Этапы задачи

```bash
curl -i http://127.0.0.1:8080/tasks/AVT-555/stages
```

Ожидается HTTP `200`, `current_stage: "IN_PROGRESS"` и длительность
`NOT_STARTED: 7200`.

Проверка отсутствующей задачи:

```bash
curl -i http://127.0.0.1:8080/tasks/AVT-404/stages
```

Ожидается HTTP `404`:

```json
{"error":{"code":"task_not_found","message":"Задача не найдена"}}
```

### 5.4 Метрики стажёра

```bash
curl -i http://127.0.0.1:8080/interns/intern_ivan/metrics
```

Ожидается HTTP `200` с `avg_hours`, `baseline_hours` и
`deviation_percent`. В MVP параметр `{id}` игнорируется, ответ целиком берётся
из мока.

### 5.5 STUCK-флаги

```bash
curl -i 'http://127.0.0.1:8080/flags?mentor_id=mentor_smith'
```

Ожидается HTTP `200` и массив `flags`. Параметр `mentor_id` в MVP
игнорируется.

### 5.6 Снятие флага

```bash
curl -i -X PATCH http://127.0.0.1:8080/flags/f-001/resolve
```

Ожидается HTTP `200`:

```json
{"status":"success"}
```

По требованиям MVP файл не изменяется. Повторный `GET /flags` снова вернёт
`f-001`. Frontend должен скрывать снятый флаг только в локальном state.

## 6. Проверка списка стажёров наставника

Сначала создайте demo-сессию и сохраните cookie:

```bash
COOKIE_FILE="${XDG_RUNTIME_DIR:-/tmp}/avito-buddy-mentor.cookies"

curl -i -c "$COOKIE_FILE" \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"mentor_smith","role":"mentor"}' \
  http://127.0.0.1:8080/api/session
```

Затем запросите стажёров:

```bash
curl -i -b "$COOKIE_FILE" http://127.0.0.1:8080/api/mentor/interns
```

Для `intern_ivan` ожидаются:

- `status: "blocked"`;
- `stuck: true`;
- два элемента в `flags`;
- два текста в `blockers`.

Для стажёров без активных флагов `flags` и `blockers` являются пустыми
массивами, `stuck` равен `false`.

## 7. Автоматические проверки

```bash
cd backend
go test ./...
go test -race ./...
go vet ./...
```

Проверка OpenAPI и Compose выполняется из корня:

```bash
docker compose config --quiet
```

## 8. Остановка тестового окружения

```bash
docker compose stop backend redis postgres
```

Команда сохраняет Docker volumes и не удаляет данные PostgreSQL и Redis.

## 9. Ограничения MVP

- Реального Jira API и cron-задачи нет.
- Скорборд, метрики и флаги не записываются в БД.
- `PATCH /flags/{id}/resolve` не меняет мок.
- Параметры `week`, `mentor_id` и `{id}` у метрик игнорируются.
- Миграции `scores`, `task_metrics`, `flags` и переходов этапов не создаются.
