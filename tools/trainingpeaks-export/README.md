# TrainingPeaks Export Tool

Current commands:

- `npm run tp-login`
- `npm run tp-export-one-student -- --student=Olga --from=2026-04-27 --to=2026-05-03`
- `npm run tp-parse-week -- --student=Olga --from=2026-04-27 --to=2026-05-03`
- `npm run tp-generate-report -- --student=Olga --from=2026-04-27 --to=2026-05-03`
- `npm run tp-weekly-one -- --student=Olga --from=2026-04-27 --to=2026-05-03`
- `npm run tp-weekly-all`
- `npm run tp-reports-list`
- `npm run tp-student-add -- --student=Olga --name="Ольга" --url="https://app.trainingpeaks.com/#calendar/athletes/5734279"`

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
