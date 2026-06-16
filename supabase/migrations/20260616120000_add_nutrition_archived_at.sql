-- Reversible (soft) archive for nutrition reports and weekly analyses, so coaches
-- can hide old/test/wrong entries without losing data. archived_at = when hidden;
-- NULL = active. Active listings, "latest report", "previous week" and the review
-- memory all filter archived_at IS NULL; approved patterns (profile.nutrition_memory)
-- are separate and untouched.
alter table public.nutrition_reports
  add column if not exists archived_at timestamptz;

alter table public.nutrition_weekly_analyses
  add column if not exists archived_at timestamptz;

create index if not exists nutrition_reports_active_idx
  on public.nutrition_reports (student_id, week_from) where archived_at is null;

create index if not exists nutrition_weekly_analyses_active_idx
  on public.nutrition_weekly_analyses (student_id, week_from) where archived_at is null;
