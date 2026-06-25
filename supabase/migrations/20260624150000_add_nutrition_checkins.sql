-- Athlete weekly nutrition check-in: structured self-reported scales (1-10).
-- Week/athlete-scoped (NOT tied to a single PDF upload — a week may have several),
-- mirroring the nutrition_weight_logs pattern so week-over-week trends stay clean.
-- The free-text note is intentionally NOT stored here: it flows into
-- nutrition_reports.raw_text (the existing channel that already reaches generation).
-- Weight is stored in nutrition_weight_logs, not duplicated here.
-- All scales are nullable: the athlete may skip the form.

create table if not exists public.nutrition_checkins (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  week_from date not null,
  week_to date not null,
  -- which upload created the check-in (soft link; survives report deletion)
  report_id uuid references public.nutrition_reports(id) on delete set null,
  energy smallint check (energy between 1 and 10),
  wellbeing smallint check (wellbeing between 1 and 10),
  eating_comfort smallint check (eating_comfort between 1 and 10),
  source text not null default 'athlete_miniapp'
    check (source in ('athlete_miniapp', 'coach_manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One check-in per athlete-week (upsert on re-upload) → one clean row per week for trends.
create unique index if not exists nutrition_checkins_student_week_idx
  on public.nutrition_checkins (student_id, week_from);
create index if not exists nutrition_checkins_student_created_desc_idx
  on public.nutrition_checkins (student_id, created_at desc);

revoke all on table public.nutrition_checkins from anon, authenticated, public;
grant select, insert, update, delete on table public.nutrition_checkins to service_role;
alter table public.nutrition_checkins enable row level security;

drop trigger if exists set_nutrition_checkins_updated_at on public.nutrition_checkins;
create trigger set_nutrition_checkins_updated_at
before update on public.nutrition_checkins
for each row
execute function public.set_nutrition_updated_at();
