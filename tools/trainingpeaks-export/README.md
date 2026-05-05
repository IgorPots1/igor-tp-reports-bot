# TrainingPeaks Export Tool

Current commands:

- `npm run tp-login`
- `npm run tp-export-one-student -- --student=Olga --from=2026-04-27 --to=2026-05-03`
- `npm run tp-parse-week -- --student=Olga --from=2026-04-27 --to=2026-05-03`
- `npm run tp-generate-report -- --student=Olga --from=2026-04-27 --to=2026-05-03`
- `npm run tp-weekly-one -- --student=Olga --from=2026-04-27 --to=2026-05-03`
- `npm run tp-weekly-all`
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
