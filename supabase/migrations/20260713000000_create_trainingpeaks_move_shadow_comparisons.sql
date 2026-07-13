-- M2 (move-http-shadow plan): shadow comparator storage. This table records,
-- for every REAL move that runs while TP_MOVE_SHADOW_ENABLED=true, whether
-- the new live-API workoutId resolver (M1, src/features/trainingpeaks/
-- move-workout-resolver.ts) would have picked the SAME workout the old
-- DOM-scrape path actually moved. It is a pure measurement table: nothing in
-- the app reads it to make a decision. It is written by ONE place
-- (tp-actions-once.ts's shadow hook, execute-time, right after the old path
-- resolves its authoritative workoutId and before the PUT) and read by the
-- M3 shadow-report script that Igor uses to judge the switch criterion.
--
-- match_kind here is the COMPARATOR's verdict (resolver answer vs ground
-- truth), NOT the resolver's own internal matchKind (fingerprint_exact /
-- fields_unique / ambiguous / not_found -- that lives inside diagnostics
-- jsonb). The two are related but distinct:
--   exact_id            resolver resolved a workoutId AND it equals the DOM
--                        path's ground-truth workoutId.
--   id_mismatch          resolver resolved a workoutId that does NOT equal
--                        ground truth -- the exact catastrophe shadow mode
--                        exists to catch. Any single row of this kind resets
--                        the clean-streak criterion in the M3 report.
--   abstained_not_found   resolver's own matchKind was not_found (zero live
--                        candidates on the date, or none plausible).
--   abstained_ambiguous   resolver's own matchKind was ambiguous (2+
--                        plausible candidates, refused to guess).
--   resolver_error        the resolver call itself threw or timed out --
--                        caught by the hook's try/catch, never allowed to
--                        affect the real move.
--
-- NOT APPLIED by the agent -- deny-guard blocks Supabase writes from this
-- session by design (TrainingPeaks/Supabase schema changes require Igor's
-- explicit hand). Apply manually via the Supabase SQL Editor after review.

begin;

create table if not exists public.trainingpeaks_move_shadow_comparisons (
  id uuid primary key default gen_random_uuid(),

  -- Links back to the real move this comparison was taken during.
  action_id uuid not null references public.trainingpeaks_actions(id) on delete cascade,
  run_id uuid not null references public.trainingpeaks_action_runs(id) on delete cascade,

  athlete_id bigint not null,
  student_id uuid references public.trainingpeaks_students(id) on delete cascade,

  source_date date not null,
  target_date date not null,

  -- Ground truth (the old DOM path's own authoritative, freshly re-scraped
  -- workoutId at execute time -- tp-actions-once.ts:4208) vs the new
  -- resolver's independent answer.
  dom_workout_id bigint not null check (dom_workout_id > 0),
  resolved_workout_id bigint check (resolved_workout_id > 0),

  match_kind text not null check (
    match_kind = any (array['exact_id', 'id_mismatch', 'abstained_not_found', 'abstained_ambiguous', 'resolver_error'])
  ),

  -- The resolver's OWN internal verdict (fingerprint_exact / fields_unique /
  -- ambiguous / not_found), null only for resolver_error. See
  -- move-workout-resolver.ts's MoveWorkoutMatchKind.
  resolver_match_kind text,

  candidates_on_date integer not null default 0,

  dom_fingerprint text,
  recomputed_fingerprint text,
  fingerprint_match boolean,

  -- The move-source-policy bucket this move's source date came from
  -- (explicit_source_date / coach_confirmed_source_date / etc) -- lets the M3
  -- report break results down per the plan's "diversity gate" (at least one
  -- clean match per hard bucket).
  source_policy text,

  -- The ORIGINAL parsed move request's source.kind ("date" / "weekday" /
  -- "relative_day"), distinct from source_policy above (policy is about how
  -- execution TRUSTED the resolved date; source_kind is about how the coach
  -- originally DESCRIBED the source -- naryad explicitly requires buckets
  -- like "weekday descriptor" and "relative-day descriptor" for the
  -- diversity gate, which source_policy alone cannot distinguish).
  source_kind text,

  -- Full per-field comparison (evaluateMoveWorkoutCandidate's output for
  -- every live candidate considered), plus the resolver's abstain reason if
  -- any. This is the "log everything needed to root-cause a mismatch"
  -- requirement -- never redacted (no secrets ever flow through the
  -- resolver's data path, only workout/calendar fields).
  diagnostics jsonb not null default '{}'::jsonb,

  -- What the (never-trusted-for-resolution) cache said for the same
  -- (athlete, source_date), for the continuous cross-check measurement.
  cache_cross_check jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists trainingpeaks_move_shadow_comparisons_action_id_idx
  on public.trainingpeaks_move_shadow_comparisons (action_id);

create index if not exists trainingpeaks_move_shadow_comparisons_created_at_idx
  on public.trainingpeaks_move_shadow_comparisons (created_at desc);

create index if not exists trainingpeaks_move_shadow_comparisons_match_kind_idx
  on public.trainingpeaks_move_shadow_comparisons (match_kind);

create index if not exists trainingpeaks_move_shadow_comparisons_athlete_id_idx
  on public.trainingpeaks_move_shadow_comparisons (athlete_id);

revoke all on table public.trainingpeaks_move_shadow_comparisons from anon, authenticated, public;
grant select, insert on table public.trainingpeaks_move_shadow_comparisons to service_role;

alter table public.trainingpeaks_move_shadow_comparisons enable row level security;

commit;
