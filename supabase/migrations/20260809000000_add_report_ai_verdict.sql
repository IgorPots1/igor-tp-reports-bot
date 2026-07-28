-- Haiku report-arbiter verdict cache, per inbound observation.
--
-- The feedback sweep runs every ~30 min and re-scans the same lookback window each time. Without a
-- cache it would re-classify every candidate message on every run. This column stores the verdict
-- ONCE so subsequent sweeps read it instead of calling Haiku again (cost tracks NEW messages, ~60/day).
--
-- NULL = not yet classified → the sweep falls back to the regex `report_like` label (soft degradation,
-- identical to pre-arbiter behaviour). Gated at runtime by FEEDBACK_AI_ARBITER_ENABLED.
--
-- APPLY: not auto-applied. Run before deploying the arbiter code:
--   supabase db push   (or apply this file in the Supabase SQL editor)

alter table public.trainingpeaks_telegram_context_observations
  add column if not exists report_ai_label text,
  add column if not exists report_ai_at timestamptz;

alter table public.trainingpeaks_telegram_context_observations
  drop constraint if exists trainingpeaks_ctx_obs_report_ai_label_chk;
alter table public.trainingpeaks_telegram_context_observations
  add constraint trainingpeaks_ctx_obs_report_ai_label_chk
  check (report_ai_label is null or report_ai_label in ('report', 'clarification', 'not_report'));

-- Fast lookup of not-yet-classified candidates in the lookback window (partial index stays tiny —
-- rows drop out of it as soon as they're classified).
create index if not exists idx_tp_ctx_obs_report_ai_null
  on public.trainingpeaks_telegram_context_observations (student_id, observed_at)
  where report_ai_label is null;
