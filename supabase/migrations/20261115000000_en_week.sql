-- Free training week for @runnigor (English): igorp.run/en/week, check-ins via Instagram DM
-- (ChatPlace calls /api/en-week/*). Code: src/features/en-week/*. Everything behind EN_WEEK_ENABLED.
--
-- ONLY ADDITIONS: four new tables, nothing existing is touched (the screenshot bucket already exists). Idempotent (if not exists).
--
-- RLS on without policies: only the server on service_role reads and writes
-- (as 20261114000000_trial_bot.sql).
--
-- HEALTH: from the health screen ONLY the boolean health_flag is stored. Which item the person
-- tapped (heart, chest pain, injury, pregnancy) never leaves the browser: not here, not in events.

create table if not exists public.en_week_users (
  id uuid primary key default gen_random_uuid(),
  -- personal plan link /en/week/p/<token>
  token text not null unique,
  chatplace_client_id text,
  ig_username text,
  -- the onboarding mirrors Igor's "AI running coach" app (goal-driven branching)
  goal text not null check (goal in ('start_running', 'return_to_running', 'run_consistently', 'train_for_race')),
  runs smallint not null check (runs in (2, 3, 4)),
  -- start_running branch
  start_now text check (start_now in ('never_or_almost_never', 'tried_without_regularity', 'sometimes_1_2_per_week')),
  start_longest text check (start_longest in ('less_than_1km', '1_to_3km', '3_to_5km')),
  -- return_to_running branch
  return_last text check (return_last in ('recently', '3_to_6_months_ago', '6_plus_months_ago')),
  return_level text check (return_level in ('around_3km', 'around_5km', '10km_plus')),
  -- training baseline (every goal except start_running)
  weekly_volume text check (weekly_volume in ('0_5', '5_15', '15_30', '30_50', '50_plus', 'unknown')),
  longest_run text check (longest_run in ('up_to_3', '3_5', '5_10', '10_15', '15_21', '21_plus', 'unknown')),
  quality_experience text check (quality_experience in ('easy_only', 'sometimes', 'regularly', 'unknown')),
  -- train_for_race branch: best recent result (paces) and the next race
  best_distance text check (best_distance in ('5k', '10k', 'half', 'marathon')),
  best_seconds integer check (best_seconds between 600 and 30000),
  next_race_distance text check (next_race_distance in ('5k', '10k', 'half', 'marathon')),
  -- "YYYY-MM"
  next_race_month text check (next_race_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  running_level text not null check (running_level in ('beginner', 'intermediate')),
  track text not null check (track in ('beginner', 'runner')),
  days_pattern text,
  -- browser time zone captured on submit; all days and DM slots are in this zone
  tz text not null default 'UTC',
  -- x-vercel-ip-country at submit: no offers for some countries (Igor, 21.10.2026)
  country text,
  health_flag boolean not null default false,
  plan_kind text check (plan_kind in ('ladder', 'return', 'regular', 'race')),
  start_rung smallint check (start_rung between 1 and 7),
  week_start date,
  stage text not null check (stage in ('health_stop', 'before_start', 'week', 'post', 'done')),
  offer_shown_at timestamptz,
  offer_dm_at timestamptz,
  case1_dm_at timestamptz,
  summary_dm_at timestamptz,
  summary_viewed_at timestamptz,
  followup_dm_at timestamptz,
  final_dm_at timestamptz,
  cta_clicked_at timestamptz,
  last_checkin_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists en_week_users_client_idx on public.en_week_users (chatplace_client_id, created_at desc)
  where chatplace_client_id is not null;
create index if not exists en_week_users_stage_idx on public.en_week_users (stage);

create table if not exists public.en_week_sessions (
  id bigserial primary key,
  user_id uuid not null references public.en_week_users (id) on delete cascade,
  idx smallint not null check (idx between 1 and 4),
  date date not null,
  kind text not null check (kind in ('rung', 'walk', 'runner')),
  preset_code text not null,
  rung smallint,
  title text not null,
  body_en text not null,
  minutes numeric not null,
  checkin text check (checkin in ('easy', 'ok', 'hard', 'skipped', 'pain')),
  checkin_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idx)
);

create index if not exists en_week_sessions_date_idx on public.en_week_sessions (date);

create table if not exists public.en_week_events (
  id bigserial primary key,
  user_id uuid references public.en_week_users (id) on delete cascade,
  kind text not null,
  -- set only for DM slots ("dm:<local date>:<slot>"): makes GET /today idempotent
  dedupe_key text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists en_week_events_dedupe_idx on public.en_week_events (user_id, dedupe_key)
  where dedupe_key is not null;
create index if not exists en_week_events_kind_created_idx on public.en_week_events (kind, created_at desc);
create index if not exists en_week_events_user_idx on public.en_week_events (user_id, created_at desc);

-- Workout screenshots (watch / app) from the plan page. Files live in the EXISTING private bucket
-- intervals-checkin-files (20261111000000_intervals_plan_page.sql: public = false, 5 MB,
-- image/jpeg|png|webp) under en-week/<user id>/<session idx>/; the page gets signed URLs only.
-- At most 3 per workout (checked by the server).
create table if not exists public.en_week_screenshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.en_week_users (id) on delete cascade,
  session_idx smallint not null check (session_idx between 1 and 4),
  path text not null unique check (path like 'en-week/%'),
  bytes integer,
  created_at timestamptz not null default now()
);

create index if not exists en_week_screenshots_user_idx on public.en_week_screenshots (user_id, session_idx);

alter table public.en_week_screenshots enable row level security;

alter table public.en_week_users enable row level security;
alter table public.en_week_sessions enable row level security;
alter table public.en_week_events enable row level security;

-- Default privileges are revoked in this project (see 20261114000200_trial_bot_grants.sql):
-- without explicit grants the server on service_role gets "permission denied".
grant select, insert, update, delete on table
  public.en_week_users, public.en_week_sessions, public.en_week_events, public.en_week_screenshots
  to service_role;
grant usage, select on sequence public.en_week_sessions_id_seq, public.en_week_events_id_seq to service_role;

comment on table public.en_week_users is
  'Free training week for @runnigor (igorp.run/en/week). Health: only the boolean health_flag, never which item.';
comment on table public.en_week_sessions is 'Workouts of the free week (2-3), re-planned after each check-in.';
comment on table public.en_week_events is 'Funnel events of the free week; dm:<date>:<slot> keys dedupe ChatPlace calls.';
