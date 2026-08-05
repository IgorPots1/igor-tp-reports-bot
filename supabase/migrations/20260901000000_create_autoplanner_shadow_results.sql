-- Autoplanner sprint 1 — shadow acceptance results (spec §7.2, overrides П1/П2/П5).
--
-- NOT APPLIED by this task — file only. Apply deliberately before wiring the shadow generator.
--
-- Stores one row per backtested / shadow (athlete, week N) comparison: the anchor is trained
-- STRICTLY on data before week_start (train_window_to = week_start) and compared to what Igor
-- actually prescribed in week N. Read-only analytics; no runtime consumer, no cron, no TP writes.
--
-- Provenance note (П5): the durable guard against the anchor learning from its own output is a
-- fixed CUTOFF DATE in code (lib/autoplanner-provenance.ts COACH_AUTHORED_BEFORE), NOT this column.
-- The `provenance` column here is secondary bookkeeping for individual shadow rows.

create table if not exists public.autoplanner_shadow_results (
  id                        uuid primary key default gen_random_uuid(),
  trainingpeaks_athlete_id  bigint not null,
  student_id                uuid references public.trainingpeaks_students (id),

  week_start                date not null,               -- validated week N
  train_window_from         date not null,               -- start of the 26-week training window
  train_window_to           date not null,               -- = week_start (training is strictly BEFORE)

  half_life_days            integer,                     -- recency half-life used (null = infinite)
  anchor_source             text not null,               -- easy_description | cohort_ratio | cs_calibrated | applied_threshold
  confidence                text,                        -- high | medium | medium_low | low
  provenance                text not null default 'coach_authored',  -- coach_authored | generated | generated_coach_edited (secondary, see §1.0/П5)

  generated_json            jsonb not null,              -- predicted week (or predicted easy anchor)
  actual_json               jsonb,                       -- what Igor actually prescribed in week N
  match_scores_json         jsonb,                       -- per-axis match (family/volume/day/intensity/easy)
  easy_pred_minus_actual_s  integer,                     -- signed easy-pace shift, s/km (half-life diagnostic)

  created_at                timestamptz not null default now(),

  constraint autoplanner_shadow_results_train_before_check check (train_window_to = week_start and train_window_from < week_start)
);

comment on table public.autoplanner_shadow_results is
  'Autoplanner shadow/backtest acceptance rows. Anchor trained strictly before week_start, compared to prescribed week N (out-of-sample). No TP/DB runtime writes; analytics only.';
comment on column public.autoplanner_shadow_results.easy_pred_minus_actual_s is
  'Signed s/km: predicted easy midpoint minus actually-prescribed midpoint in week N. Systematic positive over a rising-form trend => half-life too long.';

create unique index if not exists autoplanner_shadow_results_uniq
  on public.autoplanner_shadow_results (trainingpeaks_athlete_id, week_start, coalesce(half_life_days, -1));
create index if not exists autoplanner_shadow_results_week_idx
  on public.autoplanner_shadow_results (week_start);

-- Service-role only (matches the coach-os / methodology tables). No anon/authenticated policies:
-- RLS on with zero policies => only the service role (which bypasses RLS) can read/write.
alter table public.autoplanner_shadow_results enable row level security;
