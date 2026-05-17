# TrainingPeaks Export Tool

Current commands:

- `npm run tp-login`
- `npm run tp-export-one-student -- --student=Olga --from=2026-04-27 --to=2026-05-03`
- `npm run tp-parse-week -- --student=Olga --from=2026-04-27 --to=2026-05-03`
- `npm run tp-generate-report -- --student=Olga --from=2026-04-27 --to=2026-05-03`
- `npm run tp-weekly-one -- --student=Olga --from=2026-04-27 --to=2026-05-03`
- `npm run tp-weekly-all`
- `npm run tp-reports-list`
- `npm run tp-report-open -- --student=Olga`
- `npm run tp-report-copy -- --student=Olga`
- `npm run tp-sync-reports -- --from=2026-04-27 --to=2026-05-03`
- `npm run tp-sync-students`
- `npm run tp-agent-once`
- `npm run tp-races-requests-once`
- `npm run tp-student-add -- --legacy-local-only --student=Olga --name="Ольга" --url="https://app.trainingpeaks.com/#calendar/athletes/5734279"` (legacy local-only)

## Monday weekly workflow

Еженедельный сценарий на понедельник:

1. В `Web Admin` проверьте, что список учеников и Telegram-привязки актуальны. `trainingpeaks_students` в Supabase является source of truth.

2. Откройте терминал:

```bash
cd ~/igor-tp-reports-bot/tools/trainingpeaks-export
```

3. Проверьте настроенных учеников:

```bash
npm run tp-reports-list
```

4. Запустите недельный workflow для всех включенных учеников:

```bash
npm run tp-weekly-all
```

Что важно:

- Если даты не переданы, инструмент автоматически берет предыдущую полную неделю с понедельника по воскресенье.
- В понедельник это означает период с понедельника по воскресенье прошлой недели.
- Обрабатываются только ученики, у которых `is_active=true` и `weekly_report_enabled=true`.

5. Ручной шаг в TrainingPeaks:

- Для каждого ученика откроется браузер.
- Вручную перейдите в `Athlete Account Settings -> Export Data`.
- Выберите запрошенные даты.
- Скачайте `Workout Summary` (обязательно).
- `Workout Files` можно скачать дополнительно, но для текущего weekly report это не требуется.
- Вернитесь в терминал и нажмите Enter.

6. Проверьте готовность отчетов:

```bash
npm run tp-reports-list
```

7. Откройте отчет:

```bash
npm run tp-report-open -- --student=Olga
```

8. Скопируйте отчет:

```bash
npm run tp-report-copy -- --student=Olga
```

9. Опубликуйте безопасные метаданные и черновик отчета в Supabase для будущих Telegram-команд:

```bash
cd ~/igor-tp-reports-bot
npm run tp-sync-reports -- --from=2026-04-27 --to=2026-05-03
```

10. После `tp-agent-once` в coach chat придет только короткая сводка по weekly job и ссылка на `Web Admin`.

Полная проверка, ручная правка и отправка ученику теперь делаются из `Web Admin`.

### Current safety rules

- Отчеты создаются только как черновики.
- `tp-sync-reports` публикует только безопасные метаданные и текст `report-draft.md` в Supabase для чтения ботом через общее состояние.
- `tp-agent-once` забирает только одну queued-задачу из Supabase и запускается вручную на локальном Mac.
- После успешного sync `tp-agent-once` отправляет только короткую Telegram-сводку в чат заказчика задачи.
- Полный текст отчётов в weekly notification больше не вставляется.
- Inline-кнопки approve/skip в weekly notification больше не используются.
- Авто-отправки спортсменам нет: студент получает отчёт только из `Web Admin` после явного действия тренера.
- `exports/`, `parsed/`, `reports/`, `.env`, `config/students.json` локальные и находятся в `.gitignore`.
- Учеников с плохим качеством данных можно временно отключать через `weekly_report_enabled=false`.
- `tp-weekly-one` и `tp-weekly-all` теперь обновляют локальный `config/students.json` из Supabase перед запуском и не доверяют устаревшему локальному списку учеников.

### Run one queued job

Для one-shot запуска локального runner:

```bash
cd ~/igor-tp-reports-bot/tools/trainingpeaks-export
npm run tp-agent-once
```

Команда:

1. Claim'ит одну queued-задачу из `trainingpeaks_jobs`.
2. Выполняет `tp-sync-students` и обновляет локальный `config/students.json` из Supabase.
3. Запускает существующие `tp-weekly-all --from=... --to=...` и `tp-sync-reports --from=... --to=...`.
4. Читает готовые `report_markdown` из Supabase, считает итог по job и отправляет в Telegram requester chat короткую сводку с ссылкой на `Web Admin`.
5. Помечает задачу как `completed` или `failed` в Supabase.

### Run one queued race-scan request

Для one-shot запуска локального race scanner runner:

```bash
cd ~/igor-tp-reports-bot/tools/trainingpeaks-export
npm run tp-races-requests-once
```

Команда:

1. Claim'ит одну queued-задачу `job_type=race_scan_events` из `trainingpeaks_jobs`.
2. Запускает `tp-scan-events --from=... --to=...` локально на Mac (GET-only).
3. Формирует компактный Telegram-ответ по найденным забегам.
4. При длинном ответе разбивает его на несколько сообщений.
5. Помечает задачу как `completed` или `failed`.

Нормальный weekly flow теперь такой:

```text
Web Admin:
create/update students and Telegram links

Telegram:
/tp_week
/tp_run_week last

Mac:
cd ~/igor-tp-reports-bot/tools/trainingpeaks-export
npm run tp-agent-once
```

Что изменилось:

- `tp-agent-once` теперь автоматически синхронизирует учеников из Supabase перед локальным export pipeline.
- Обычное ручное редактирование `config/students.json` больше не нужно.
- Перед перезаписью `config/students.json` создается backup-файл `students.backup-YYYYMMDD-HHMMSS.json`, если локальный файл уже существовал.
- Если sync учеников падает, `tp-weekly-all` не запускается.
- После sync в Telegram уходит только summary notification с числом готовых/ошибочных отчётов и ссылкой на `Web Admin`.
- Основной review/send workspace теперь `Web Admin`, а Telegram остается каналом уведомлений и quick status.
- Для прямой ссылки в summary notification нужен `APP_BASE_URL` или `NEXT_PUBLIC_APP_URL`; как fallback используется `VERCEL_URL`.
- Для отправки студенту по-прежнему нужен `TELEGRAM_BUSINESS_CONNECTION_ID` и привязанный `telegram_chat_id` у студента.
- Vercel по-прежнему не запускает Playwright/export/parser/AI.

### Link student Telegram

Основной путь для weekly delivery: студент пишет в Telegram Business, после чего coach связывает чат из карточки ученика в `Web Admin`.

Break-glass fallback:

```text
/tp_set_telegram <student_id> <chat_id>
```

После этого у студента должны быть:

- `telegram_chat_id`
- `telegram_delivery_enabled=true`

Только тогда отправка weekly report из `Web Admin` сможет доставить сообщение через Telegram Business.

### Sync students from Supabase

Локально можно отдельно обновить список учеников:

```bash
npm run tp-sync-students
```

Dry run:

```bash
npm run tp-sync-students -- --dry-run
```

Скрипт:

- читает только `is_active=true` и `weekly_report_enabled=true` из `trainingpeaks_students`
- сохраняет локальный формат `config/students.json`, который ожидает export pipeline
- при 0 активных weekly-enabled учениках пишет пустой `config/students.json`, чтобы не запускаться по stale local config
- требует `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY`

### Add student

Используйте только для explicit legacy local-only сценариев:

```bash
npm run tp-student-add -- --legacy-local-only --student=Olga --name="Ольга" --url="https://app.trainingpeaks.com/#calendar/athletes/5734279"
```

Без `--legacy-local-only` команда теперь отказывается менять `config/students.json` и просит использовать Web Admin / Supabase как source of truth.

С `--legacy-local-only` команда создает локальный `config/students.json`, если файла еще нет, и добавляет в него ученика. Для обновления существующей записи используйте `--update`.

Этот файл локальный и не должен попадать в коммит.

`tp-weekly-one` is the MVP weekly workflow for one student:

1. Open the athlete in TrainingPeaks with the same persistent browser profile.
2. Refresh local `config/students.json` from Supabase and verify that the selected student is still active and weekly-enabled there.
3. Capture manual exports into `exports/{student_id}/{from}_{to}/`.
4. Parse the week into `parsed/{student_id}/{from}_{to}/weekly-summary.json`.
5. Generate AI report drafts in `reports/{student_id}/{from}_{to}/`.

Export expectations:

- Required export: `Workout Summary`
- Optional export: `Workout Files`
- The current weekly report is generated from the Summary CSV inside the `Workout Summary` export.
- `Workout Files` are kept compatible and may still be useful later for deeper analysis, but they are not required now.

Use `--skip-export` to reuse an existing export folder and only run parse + report:

```bash
npm run tp-weekly-one -- --student=Olga --from=2026-04-27 --to=2026-05-03 --skip-export
```

`tp-weekly-all` runs the same weekly workflow for every student from a freshly synced Supabase list where both flags are enabled:

- `is_active === true`
- `weekly_report_enabled === true`

If `--from` and `--to` are omitted, it automatically uses the previous full Monday-Sunday week based on local time.
If no new downloads are captured during the manual export step, the workflow now asks before reusing existing ZIP exports from that week.
Reuse only continues when a likely `Workout Summary` ZIP is present.

If a student is missing, inactive, or has `weekly_report_enabled=false` in Supabase, weekly generation is blocked even if stale local config still exists.

Examples:

```bash
npm run tp-weekly-all
npm run tp-weekly-all -- --skip-export
npm run tp-weekly-all -- --from=2026-04-27 --to=2026-05-03 --skip-export
```

`tp-reports-list` reviews the local weekly report status for configured students without creating or modifying files.

Status rules:

- `ready`: `reports/{student_id}/{from}_{to}/report-draft.md` exists
- `parsed_only`: `parsed/{student_id}/{from}_{to}/weekly-summary.json` exists, but `report-draft.md` is missing
- `exported_only`: `exports/{student_id}/{from}_{to}/` contains ZIP exports, but there is no parsed summary or report
- `missing_export`: no ZIP exports were found for the selected week
- `skipped`: `is_active !== true` or `weekly_report_enabled !== true`

If `--from` and `--to` are omitted, it automatically uses the previous full Monday-Sunday week based on local time.

Use `--enabled-only` to list only students where both `is_active` and `weekly_report_enabled` are `true`.

Examples:

```bash
npm run tp-reports-list
npm run tp-reports-list -- --from=2026-04-27 --to=2026-05-03
npm run tp-reports-list -- --enabled-only
```

`tp-report-open` opens an already generated local report draft for one student without modifying any files.

If `--from` and `--to` are omitted, it automatically uses the previous full Monday-Sunday week based on local time.

Examples:

```bash
npm run tp-report-open -- --student=Olga
npm run tp-report-open -- --student=Olga --from=2026-04-27 --to=2026-05-03
```

Expected report path:

- `reports/{student_id}/{from}_{to}/report-draft.md`

If the report does not exist yet, the command prints the expected path and suggests generating it with `tp-weekly-one` or `tp-weekly-all`.

`tp-report-copy` copies an already generated local report draft to the macOS clipboard without modifying any files.

If `--from` and `--to` are omitted, it automatically uses the previous full Monday-Sunday week based on local time.

Examples:

```bash
npm run tp-report-copy -- --student=Olga
npm run tp-report-copy -- --student=Olga --from=2026-04-27 --to=2026-05-03
```

Expected report path:

- `reports/{student_id}/{from}_{to}/report-draft.md`

If the report does not exist yet, the command prints the expected path and suggests generating it with `tp-weekly-one` or `tp-weekly-all`.

Student config lives in `config/students.json` and stays local (`config/students.json` is gitignored). The tool accepts both the new array format and older minimal entries that used `id` and `url`.

Recommended shape:

```json
[
  {
    "student_id": "Olga",
    "name": "Ольга",
    "trainingpeaks_athlete_url": "https://app.trainingpeaks.com/#calendar/athletes/5734279",
    "is_active": true,
    "weekly_report_enabled": true,
    "data_quality_status": "ok",
    "notes": ""
  }
]
```

Compatibility defaults:

- Missing `is_active` defaults to `true`
- Missing `weekly_report_enabled` defaults to `false`
- Missing `data_quality_status` is allowed
- Missing `notes` is allowed

Use `tp-student-add` only for explicit legacy local-only cases. If `config/students.json` is missing, the script creates it from `config/students.example.json`.

```bash
npm run tp-student-add -- --legacy-local-only --student=Olga --name="Ольга" --url="https://app.trainingpeaks.com/#calendar/athletes/5734279"
```

If the `student_id` already exists, the command refuses to overwrite it unless you add `--update`:

```bash
npm run tp-student-add -- --legacy-local-only --student=Olga --name="Ольга" --url="https://app.trainingpeaks.com/#calendar/athletes/5734279" --update
```
