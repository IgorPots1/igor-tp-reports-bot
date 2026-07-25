-- Club Mini App (/m/club) challenge goal — MANUAL mode source.
-- The default goal mode is `auto` (previous week's club km * factor), which needs
-- NO table. This table powers CLUB_CHALLENGE_GOAL_MODE=manual, letting the coach
-- set an explicit period goal. NOT applied by this task.

create table if not exists public.club_challenges (
  id uuid primary key default gen_random_uuid(),
  title text,
  goal_km numeric not null check (goal_km > 0),
  starts_at date not null,
  ends_at date not null,
  created_at timestamptz not null default now(),
  constraint club_challenges_window check (ends_at >= starts_at)
);

create index if not exists club_challenges_window_idx
  on public.club_challenges (starts_at, ends_at);

comment on table public.club_challenges is
  'Optional explicit club challenge goals (/m/club). Only read when CLUB_CHALLENGE_GOAL_MODE=manual; otherwise the goal is auto-derived from last week club km.';
