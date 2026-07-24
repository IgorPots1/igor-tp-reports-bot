-- Zone/threshold snapshots captured READ-ONLY from GET /fitness/v1/athletes/{id}/settings.
--
-- Purpose: an append-only historical record of each athlete's zones + thresholds, and the
-- read-only PRECONDITION for any future gated zone write. Per the Zone-write policy in
-- docs/tp-api-capability-matrix.md, no zone apply may run against an athlete who has never
-- been snapshotted here. Rows are immutable — a new capture is a new row, never an update.
--
-- Naming: trainingpeaks_athlete_id (bigint) follows the existing TP-table convention
-- (trainingpeaks_workout_cache, trainingpeaks_students), NOT the plainer athlete_id from
-- the task brief — kept consistent with the rest of the schema on purpose.
--
-- zones stores ONLY the WHITELISTED zone/threshold projection of GET /settings
-- (see tools/trainingpeaks-export/scripts/lib/tp-settings-whitelist.ts). The raw settings
-- body carries PII + a working iCalendarKeys access key and is NEVER stored. There is no
-- raw_settings column; the drop below is a defensive no-op for DBs that had an earlier one.
--
-- FILE ONLY — apply manually, not auto-run.

create table if not exists public.tp_zone_snapshots (
  id uuid primary key default gen_random_uuid(),
  trainingpeaks_athlete_id bigint not null,
  -- optional linkage to the roster; nullable because not every TP athlete has a
  -- trainingpeaks_students row, and a removed student must not drop the snapshot.
  student_id uuid references public.trainingpeaks_students(id) on delete set null,
  captured_at timestamptz not null default now(),
  -- whitelisted zone/threshold projection only — never the raw settings body.
  zones jsonb,
  -- provenance of this snapshot (endpoint + shape version), e.g. 'settings_v1'.
  source text not null default 'settings_v1',
  created_at timestamptz not null default now(),
  constraint tp_zone_snapshots_trainingpeaks_athlete_id_check check (trainingpeaks_athlete_id > 0)
);

-- Defensive: if this DB applied an earlier version that had raw_settings, drop it.
-- No-op on a fresh table created above. The column only ever held '{}' (never written).
alter table public.tp_zone_snapshots drop column if exists raw_settings;

-- "latest snapshot per athlete" and per-athlete history.
create index if not exists tp_zone_snapshots_athlete_captured_idx
  on public.tp_zone_snapshots (trainingpeaks_athlete_id, captured_at desc);

-- Append-only, service-role only: select + insert, deliberately NO update/delete grant
-- (immutable history; matches the repo's no-DELETE posture on TP tables).
revoke all on table public.tp_zone_snapshots from anon, authenticated, public;
grant select, insert on table public.tp_zone_snapshots to service_role;

alter table public.tp_zone_snapshots enable row level security;
