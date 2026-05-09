alter table public.trainingpeaks_students
  add column if not exists archived_at timestamptz;

update public.trainingpeaks_students
set archived_at = coalesce(archived_at, updated_at, now())
where is_active = false
  and archived_at is null;

alter table public.trainingpeaks_weekly_reports
  add column if not exists edited_report_markdown text,
  add column if not exists edited_at timestamptz;
