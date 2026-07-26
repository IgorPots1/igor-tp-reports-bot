-- Materialized club record reconstruction (Phase 1.1).
--
-- WHY a SEPARATE table from club_records: club_records holds coach-authored
-- overrides (source='coach_confirmed') — authoritative, human-entered, must NEVER
-- be auto-wiped. Materialization recomputes reconstructed records by scoped
-- DELETE+INSERT per affected student; mixing the two in one table would let a
-- recompute clobber coach rows. Separation keeps the recompute delete safe and the
-- override table pristine. The read path (getClubRecords) merges: coach override
-- (club_records) wins > snapshot (this table).
--
-- One row per (student_id, distance_key, record_type, slot):
--   record_type: 'race' | 'training_split'
--   slot:        'best'          — best non-hidden of that type → personal card line
--                'best_verified' — best VERIFIED race           → club tops
-- training_split has no 'best_verified' slot (tops are race-only).
--
-- Do NOT apply in production automatically — file-of-record; apply via the rollout.

create table if not exists public.club_record_snapshots (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  distance_key text not null,
  record_type text not null check (record_type in ('race', 'training_split')),
  slot text not null check (slot in ('best', 'best_verified')),
  duration_seconds integer not null,
  distance_km numeric,
  pace_sec_per_km numeric,
  record_date date,
  trust text not null check (trust in ('verified', 'preliminary')),
  calc_method text not null check (calc_method in ('best_split', 'whole_workout')),
  source text not null default 'reconstructed',
  source_workout_cache_id uuid,
  computed_at timestamptz not null default now(),
  unique (student_id, distance_key, record_type, slot)
);

-- Club tops read: distance_key + record_type + slot, ordered by duration.
create index if not exists club_record_snapshots_top_idx
  on public.club_record_snapshots (distance_key, record_type, slot, duration_seconds);

-- Personal card + scoped recompute delete: by student.
create index if not exists club_record_snapshots_student_idx
  on public.club_record_snapshots (student_id);

-- Deny-by-default for anon/authenticated (mirrors other club tables); the app
-- reads/writes server-side via service_role, which bypasses RLS.
alter table public.club_record_snapshots enable row level security;

-- service_role runs the materialize job (scoped DELETE+INSERT) and the read path.
grant select, insert, update, delete on public.club_record_snapshots to service_role;
