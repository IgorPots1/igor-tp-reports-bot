-- Наряд 3 (методика стартов), Шаг 1: a bridge table so the race/event scanner
-- (local runner, /tp_races → tp-scan-events, reads TP's events endpoint) can
-- persist upcoming races, and nutrition (serverless) can read them per week to
-- recognise race-day / race-week. Source 'scan' = auto from the scanner;
-- 'manual' = coach override in the card. Manual wins over scan at read time.
create table if not exists public.trainingpeaks_race_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.trainingpeaks_students(id) on delete cascade,
  trainingpeaks_athlete_id bigint,
  event_date date not null,
  title text,
  distance_km numeric,
  distance_raw text,
  source text not null default 'scan' check (source in ('scan', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per student/day/source (re-scans and re-marks upsert in place).
create unique index if not exists trainingpeaks_race_events_student_day_source_idx
  on public.trainingpeaks_race_events (student_id, event_date, source);

create index if not exists trainingpeaks_race_events_student_date_idx
  on public.trainingpeaks_race_events (student_id, event_date);

create or replace function public.set_trainingpeaks_race_events_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_trainingpeaks_race_events_updated_at on public.trainingpeaks_race_events;
create trigger trg_trainingpeaks_race_events_updated_at
  before update on public.trainingpeaks_race_events
  for each row execute function public.set_trainingpeaks_race_events_updated_at();

grant select, insert, update, delete on table public.trainingpeaks_race_events to service_role;

alter table public.trainingpeaks_race_events enable row level security;
