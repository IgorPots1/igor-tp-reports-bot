-- Club Phase C — admin-managed challenges (extend club_challenges).
--
-- The table shipped minimal (title + goal_km + window), read only when
-- CLUB_CHALLENGE_GOAL_MODE=manual. Phase C makes challenges coach-managed from the
-- admin: goal TYPE (km | number of workouts), goal value, participants (whole club or
-- a selected list), several active at once, and a completed/archived history. The
-- auto goal (4-week rolling club km) stays the DEFAULT when no active manual challenge
-- exists — unchanged.
--
-- Additive, non-destructive. NOT applied by this task. The service tolerates the
-- pre-Phase-C shape (reads the new columns defensively).

alter table public.club_challenges
  add column if not exists goal_type text not null default 'km',
  add column if not exists goal_value numeric,
  add column if not exists participant_scope text not null default 'all',
  add column if not exists participant_ids uuid[] not null default '{}'::uuid[],
  add column if not exists status text not null default 'active',
  add column if not exists created_by text,
  add column if not exists completed_at timestamptz;

-- A workouts-goal challenge has no km goal, so goal_km must be allowed NULL. The
-- existing CHECK `goal_km > 0` evaluates to UNKNOWN for NULL and therefore passes
-- (a CHECK only fails on FALSE), so dropping NOT NULL is enough.
alter table public.club_challenges alter column goal_km drop not null;

-- Backfill goal_value from the legacy goal_km for any pre-existing rows.
update public.club_challenges set goal_value = goal_km where goal_value is null and goal_km is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'club_challenges_goal_type_check') then
    alter table public.club_challenges add constraint club_challenges_goal_type_check check (goal_type in ('km', 'workouts'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'club_challenges_scope_check') then
    alter table public.club_challenges add constraint club_challenges_scope_check check (participant_scope in ('all', 'selected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'club_challenges_status_check') then
    alter table public.club_challenges add constraint club_challenges_status_check check (status in ('active', 'completed', 'archived'));
  end if;
end $$;

create index if not exists club_challenges_status_idx on public.club_challenges (status, starts_at);

-- RLS already enabled on club_challenges (20260726120000). App writes/reads via
-- service_role (bypasses RLS). Grant the DML the admin needs (no delete — status
-- 'archived' is the soft-delete; if hard delete is ever needed, add a scoped grant).
grant select, insert, update on table public.club_challenges to service_role;

comment on column public.club_challenges.goal_type is
  'km | workouts. goal_value holds the target (km sum, or number of completed running workouts). goal_km kept for the legacy manual-km path.';
comment on column public.club_challenges.participant_scope is
  'all = whole visible club; selected = only participant_ids.';
