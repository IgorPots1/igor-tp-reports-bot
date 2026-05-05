# TrainingPeaks Export Tool

Current commands:

- `npm run tp-login`
- `npm run tp-export-one-student -- --student=Olga --from=2026-04-27 --to=2026-05-03`
- `npm run tp-parse-week -- --student=Olga --from=2026-04-27 --to=2026-05-03`
- `npm run tp-generate-report -- --student=Olga --from=2026-04-27 --to=2026-05-03`
- `npm run tp-weekly-one -- --student=Olga --from=2026-04-27 --to=2026-05-03`

`tp-weekly-one` is the MVP weekly workflow for one student:

1. Open the athlete in TrainingPeaks with the same persistent browser profile.
2. Capture manual exports into `exports/{student_id}/{from}_{to}/`.
3. Parse the week into `parsed/{student_id}/{from}_{to}/weekly-summary.json`.
4. Generate AI report drafts in `reports/{student_id}/{from}_{to}/`.

Use `--skip-export` to reuse an existing export folder and only run parse + report:

```bash
npm run tp-weekly-one -- --student=Olga --from=2026-04-27 --to=2026-05-03 --skip-export
```
