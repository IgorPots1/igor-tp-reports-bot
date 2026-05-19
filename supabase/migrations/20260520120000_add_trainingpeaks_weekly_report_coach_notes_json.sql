alter table public.trainingpeaks_weekly_reports
  add column if not exists coach_notes_json jsonb;
