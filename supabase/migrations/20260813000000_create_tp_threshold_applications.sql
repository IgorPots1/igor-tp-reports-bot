-- Append-only log of threshold edits applied via the tp-athlete CLI.
--
-- Purpose:
--   * audit trail of every applied threshold change (who/what/when/from→to/why);
--   * lets the candidate scan DROP athletes already handled, and bring one BACK when
--     the live threshold no longer matches value_after (i.e. it was changed again).
--
-- Posture mirrors tp_zone_snapshots: service_role only, RLS on, no update/delete
-- (append-only). Values are stored in the NATIVE TP unit so they compare directly to
-- a zone snapshot / live GET: m/s for a pace (speed) threshold, bpm for HR.

create table if not exists public.tp_threshold_applications (
  id                        uuid primary key default gen_random_uuid(),
  trainingpeaks_athlete_id  bigint not null,
  applied_at                timestamptz not null default now(),
  kind                      text not null check (kind in ('pace', 'hr')),
  value_before              double precision,            -- native unit (m/s pace | bpm hr); null if unknown
  value_after               double precision not null,   -- native unit actually written
  value_after_display       text,                        -- human form, e.g. '5:28/км' or '168 bpm'
  evidence                  text,                         -- на чём основано (basis from the scan)
  tier                      text,                         -- забег | интервалы | темпо | manual | ...
  applied_by                text,                         -- e.g. 'tp-athlete-cli'
  created_at                timestamptz not null default now()
);

create index if not exists tp_threshold_applications_athlete_idx
  on public.tp_threshold_applications (trainingpeaks_athlete_id, applied_at desc);

revoke all on table public.tp_threshold_applications from anon, authenticated, public;
grant select, insert on table public.tp_threshold_applications to service_role;
alter table public.tp_threshold_applications enable row level security;
