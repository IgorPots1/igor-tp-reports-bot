-- Manual "do NOT auto-override" holds for TrainingPeaks thresholds/zones.
--
-- Purpose:
--   * mark an athlete whose threshold was verified/decided by hand, so automation
--     (tp-athlete set-threshold, tp-threshold-restore, tp-threshold-rollback,
--     tp-fix-run-zone) REFUSES to write their zones, and the candidate scan puts them
--     in a "решено вручную" group instead of "кандидаты".
--   * unlike tp_threshold_applications (which logs an APPLIED value, value_after NOT NULL),
--     a hold carries NO threshold value — it is purely "leave this athlete alone".
--
-- First hold (why this table exists): Tatiana Buchkina (5475792). Her real threshold is
-- ~5:40 with an unusually small race↔easy gap (easy/threshold ratio 1.127, lowest on the
-- roster) — an athlete characteristic, not a data error; her RUN zone set is intentionally
-- left at 5:24. Igor decides her threshold by hand.
--
-- Posture mirrors tp_threshold_applications: service_role only, RLS on. Holds are liftable,
-- so UPDATE is granted (set active=false) — but rows are never hard-deleted (audit trail).

create table if not exists public.tp_threshold_holds (
  id                        uuid primary key default gen_random_uuid(),
  trainingpeaks_athlete_id  bigint not null,
  reason                    text not null,               -- why the hold exists (human)
  held_by                   text,                        -- who placed it, e.g. 'igor'
  active                    boolean not null default true, -- false = hold lifted (kept for history)
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists tp_threshold_holds_active_idx
  on public.tp_threshold_holds (trainingpeaks_athlete_id) where active;

revoke all on table public.tp_threshold_holds from anon, authenticated, public;
grant select, insert, update on table public.tp_threshold_holds to service_role;
alter table public.tp_threshold_holds enable row level security;
