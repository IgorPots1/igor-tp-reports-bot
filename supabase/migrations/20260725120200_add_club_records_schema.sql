-- Club Mini App (/m/club) — FUTURE canonical records store (schema only).
--
-- Records today are reconstructed ON THE FLY at read time from
-- trainingpeaks_workout_cache + _laps (no second source of truth). This table is
-- NOT used at runtime yet — it is a forward-compatible home so a future
-- protocol-matching job (e.g. probeg.org fuzzy match by surname → official result)
-- can UPGRADE an existing row instead of forcing a schema rewrite.
--
-- NOT applied by this task.
--
-- Trust ladder (verified|preliminary|hidden) is computed at read time; `trust`
-- here would snapshot the last computation. The important columns are the SOURCE
-- provenance ones:
--
--   source = 'reconstructed'      -- current behaviour: derived from cache+laps
--          | 'official_protocol'  -- matched against an external race protocol
--          | 'coach_confirmed'    -- manually confirmed by the coach
--
-- OVERRIDE POLICY (documented for the future job, not implemented here):
--   official_protocol and coach_confirmed OUTRANK reconstructed. When a protocol
--   match arrives for (student, distance), the job updates the existing row:
--   sets source='official_protocol', writes protocol_url + protocol_result_time +
--   verified_at, and promotes trust to 'verified'. A reconstructed value is never
--   allowed to overwrite an official/coach one (source precedence:
--   coach_confirmed > official_protocol > reconstructed).

create table if not exists public.club_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null
    references public.trainingpeaks_students(id) on delete cascade,
  distance_key text not null check (distance_key in ('5k', '10k', '21k', '42k')),
  duration_seconds integer not null check (duration_seconds > 0),
  pace_sec_per_km numeric,
  record_date date,
  trust text not null default 'preliminary'
    check (trust in ('verified', 'preliminary', 'hidden')),
  source text not null default 'reconstructed'
    check (source in ('reconstructed', 'official_protocol', 'coach_confirmed')),
  -- protocol linkage (future probeg.org / official-result matching)
  protocol_url text,
  protocol_result_time_seconds integer,
  verified_at timestamptz,
  source_workout_cache_id uuid
    references public.trainingpeaks_workout_cache(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_records_unique unique (student_id, distance_key)
);

create index if not exists club_records_distance_idx
  on public.club_records (distance_key, duration_seconds);

comment on column public.club_records.source is
  'reconstructed | official_protocol | coach_confirmed. Precedence: coach_confirmed > official_protocol > reconstructed. A reconstructed value never overwrites an official/coach one.';
