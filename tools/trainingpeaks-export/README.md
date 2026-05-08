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
- `npm run tp-student-add -- --student=Olga --name="Ольга" --url="https://app.trainingpeaks.com/#calendar/athletes/5734279"`

## Monday weekly workflow

Еженедельный сценарий на понедельник:

1. Откройте терминал:

```bash
cd ~/igor-tp-reports-bot/tools/trainingpeaks-export
```

2. Проверьте настроенных учеников:

```bash
npm run tp-reports-list
```

3. Запустите недельный workflow для всех включенных учеников:

```bash
npm run tp-weekly-all
```

Что важно:

- Если даты не переданы, инструмент автоматически берет предыдущую полную неделю с понедельника по воскресенье.
- В понедельник это означает период с понедельника по воскресенье прошлой недели.
- Обрабатываются только ученики, у которых `is_active=true` и `weekly_report_enabled=true`.

4. Ручной шаг в TrainingPeaks:

- Для каждого ученика откроется браузер.
- Вручную перейдите в `Athlete Account Settings -> Export Data`.
- Выберите запрошенные даты.
- Скачайте `Workout Summary` (обязательно).
- `Workout Files` можно скачать дополнительно, но для текущего weekly report это не требуется.
- Вернитесь в терминал и нажмите Enter.

5. Проверьте готовность отчетов:

```bash
npm run tp-reports-list
```

6. Откройте отчет:

```bash
npm run tp-report-open -- --student=Olga
```

7. Скопируйте отчет:

```bash
npm run tp-report-copy -- --student=Olga
```

8. Опубликуйте безопасные метаданные и черновик отчета в Supabase для будущих Telegram-команд:

```bash
cd ~/igor-tp-reports-bot
npm run tp-sync-reports -- --from=2026-04-27 --to=2026-05-03
```

9. После `tp-agent-once` черновики придут в coach chat с кнопками:

- `✅ Отправить ученику`
- `⏭ Пропустить`

Отправка спортсмену происходит только после явного подтверждения тренера через Telegram Business.

### Current safety rules

- Отчеты создаются только как черновики.
- `tp-sync-reports` публикует только безопасные метаданные и текст `report-draft.md` в Supabase для чтения ботом через общее состояние.
- `tp-agent-once` забирает только одну queued-задачу из Supabase и запускается вручную на локальном Mac.
- После успешного sync `tp-agent-once` отправляет черновики отчетов только в Telegram чат заказчика задачи.
- На каждом draft сообщении есть inline-кнопки approve/skip.
- Авто-отправки спортсменам нет: студент получает отчёт только после нажатия `✅ Отправить ученику`.
- `exports/`, `parsed/`, `reports/`, `.env`, `config/students.json` локальные и находятся в `.gitignore`.
- Учеников с плохим качеством данных можно временно отключать через `weekly_report_enabled=false`.

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
4. Читает готовые `report_markdown` из Supabase и отправляет каждый draft обратно в Telegram requester chat отдельным сообщением с inline-кнопками approve/skip.
5. Помечает задачу как `completed` или `failed` в Supabase.

Нормальный weekly flow теперь такой:

```text
Telegram:
/tp_add_student Name | TP_URL
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
- После sync отчеты-драфты отправляются обратно в Telegram только тому, кто создал задачу.
- Coach review теперь происходит прямо в Telegram кнопками `✅ Отправить ученику` и `⏭ Пропустить`.
- Для отправки студенту нужен `TELEGRAM_BUSINESS_CONNECTION_ID` и привязанный `telegram_chat_id` у студента.
- Vercel по-прежнему не запускает Playwright/export/parser/AI.

### Link student Telegram

Чтобы привязать студента к Telegram-чату для weekly delivery, используйте coach-only команду:

```text
/tp_set_telegram <student_id> <chat_id>
```

После этого у студента должны быть:

- `telegram_chat_id`
- `telegram_delivery_enabled=true`

Только тогда кнопка `✅ Отправить ученику` сможет доставить weekly report через Telegram Business.

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
- не перезаписывает локальный файл, если Supabase вернул 0 активных учеников
- требует `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY`

### Add student

Используйте:

```bash
npm run tp-student-add -- --student=Olga --name="Ольга" --url="https://app.trainingpeaks.com/#calendar/athletes/5734279"
```

Команда создает локальный `config/students.json`, если файла еще нет, и добавляет в него ученика. Для обновления существующей записи используйте `--update`.

Этот файл локальный и не должен попадать в коммит.

`tp-weekly-one` is the MVP weekly workflow for one student:

1. Open the athlete in TrainingPeaks with the same persistent browser profile.
2. Capture manual exports into `exports/{student_id}/{from}_{to}/`.
3. Parse the week into `parsed/{student_id}/{from}_{to}/weekly-summary.json`.
4. Generate AI report drafts in `reports/{student_id}/{from}_{to}/`.

Export expectations:

- Required export: `Workout Summary`
- Optional export: `Workout Files`
- The current weekly report is generated from the Summary CSV inside the `Workout Summary` export.
- `Workout Files` are kept compatible and may still be useful later for deeper analysis, but they are not required now.

Use `--skip-export` to reuse an existing export folder and only run parse + report:

```bash
npm run tp-weekly-one -- --student=Olga --from=2026-04-27 --to=2026-05-03 --skip-export
```

`tp-weekly-all` runs the same weekly workflow for every student where both flags are enabled:

- `is_active === true`
- `weekly_report_enabled === true`

If `--from` and `--to` are omitted, it automatically uses the previous full Monday-Sunday week based on local time.
If no new downloads are captured during the manual export step, the workflow now asks before reusing existing ZIP exports from that week.
Reuse only continues when a likely `Workout Summary` ZIP is present.

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

Use `tp-student-add` to add a local student entry. If `config/students.json` is missing, the script creates it from `config/students.example.json`.

```bash
npm run tp-student-add -- --student=Olga --name="Ольга" --url="https://app.trainingpeaks.com/#calendar/athletes/5734279"
```

If the `student_id` already exists, the command refuses to overwrite it unless you add `--update`:

```bash
npm run tp-student-add -- --student=Olga --name="Ольга" --url="https://app.trainingpeaks.com/#calendar/athletes/5734279" --update
```
