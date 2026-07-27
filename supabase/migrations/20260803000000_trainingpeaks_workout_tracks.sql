-- Club Phase 4 — GPS track (simplified polyline) per workout, from FIT records.
--
-- One row per workout_cache_id. Written by the FIT ingest scan (same pass that
-- writes laps/derived) when CLUB_TRACKS_ENABLED is on and the FIT has GPS records.
-- Read only by the club surface (/m/club) to draw an SVG silhouette of the route —
-- no map tiles, keys, or external services. Coordinates are a Douglas–Peucker
-- simplified polyline (target 50–150 points) so a row is ~1–3 KB, not the full track.
--
-- Privacy: only the simplified shape is stored, and the club renders it as a
-- coordinate-normalised silhouette (bbox-relative), never on a real map. Old
-- workouts are NOT backfilled by default (naryad: only new workouts get a track).
--
-- Additive, non-destructive. NOT applied by this task — apply manually before
-- enabling CLUB_TRACKS_ENABLED. The ingest tolerates the missing table (best-effort
-- insert wrapped in try/catch); the club tolerates it (returns no track → block hidden).

create table if not exists public.trainingpeaks_workout_tracks (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  trainingpeaks_athlete_id bigint,
  trainingpeaks_workout_id bigint,
  -- hard link to the cache row; the track disappears with the workout it belongs to.
  workout_cache_id uuid not null unique
    references public.trainingpeaks_workout_cache(id) on delete cascade,
  workout_date date,

  -- Simplified polyline: JSON array of [lat, lng] pairs (degrees, ~5 dp), 50–150 pts.
  polyline jsonb not null,
  point_count integer not null,
  -- Bounding box for aspect-ratio-correct silhouette rendering.
  bbox jsonb not null,        -- { minLat, minLng, maxLat, maxLng }
  source text not null default 'fit',

  scanned_at timestamptz not null default now(),
  scan_job_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint trainingpeaks_workout_tracks_source_check check (source in ('fit')),
  constraint trainingpeaks_workout_tracks_point_count_check check (point_count >= 2)
);

create index if not exists trainingpeaks_workout_tracks_athlete_workout_idx
  on public.trainingpeaks_workout_tracks (trainingpeaks_athlete_id, trainingpeaks_workout_id);

create or replace function public.set_trainingpeaks_workout_tracks_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_trainingpeaks_workout_tracks_updated_at
  on public.trainingpeaks_workout_tracks;

create trigger set_trainingpeaks_workout_tracks_updated_at
before update on public.trainingpeaks_workout_tracks
for each row
execute function public.set_trainingpeaks_workout_tracks_updated_at();

-- App + ingest use service_role (bypasses RLS). Upsert on workout_cache_id needs
-- insert + update; no delete (rows cascade with the workout).
revoke all on table public.trainingpeaks_workout_tracks from anon, authenticated, public;
grant select, insert, update on table public.trainingpeaks_workout_tracks to service_role;

alter table public.trainingpeaks_workout_tracks enable row level security;
-- Deliberately no CREATE POLICY: default-deny for anon/authenticated.

comment on table public.trainingpeaks_workout_tracks is
  'Club Phase 4: simplified GPS polyline (Douglas–Peucker, 50–150 pts) per workout, from FIT records. Read by /m/club to draw an SVG route silhouette. No map tiles/keys. New workouts only.';
