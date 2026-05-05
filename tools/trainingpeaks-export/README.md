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
- `npm run tp-student-add -- --student=Olga --name="Ольга" --url="https://app.trainingpeaks.com/#calendar/athletes/5734279"`

## Monday weekly workflow

Еженедельный сценарий на понедельник:

1. Откройте терминал:

```bash
cd ~/igor-agent-hub/tools/trainingpeaks-export
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
- Скачайте `Workout Summary` и `Workout Files`.
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
cd ~/igor-agent-hub
npm run tp-sync-reports -- --from=2026-04-27 --to=2026-05-03
```

9. Вручную отправьте скопированный отчет спортсмену.

### Current safety rules

- Отчеты создаются только как черновики.
- `tp-sync-reports` публикует только безопасные метаданные и текст `report-draft.md` в Supabase для чтения ботом через общее состояние.
- Ничего не отправляется автоматически.
- `exports/`, `parsed/`, `reports/`, `.env`, `config/students.json` локальные и находятся в `.gitignore`.
- Интеграция с Telegram появится позже.
- Учеников с плохим качеством данных можно временно отключать через `weekly_report_enabled=false`.

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

Use `--skip-export` to reuse an existing export folder and only run parse + report:

```bash
npm run tp-weekly-one -- --student=Olga --from=2026-04-27 --to=2026-05-03 --skip-export
```

`tp-weekly-all` runs the same weekly workflow for every student where both flags are enabled:

- `is_active === true`
- `weekly_report_enabled === true`

If `--from` and `--to` are omitted, it automatically uses the previous full Monday-Sunday week based on local time.
If no new downloads are captured during the manual export step, the workflow now asks before reusing existing ZIP exports from that week.

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
