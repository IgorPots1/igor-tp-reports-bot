-- Club maps (Phase 4b) — city + cached Mapbox static image per track, and a per-student
-- route-visibility opt-out. Additive, non-destructive. NOT applied by this task — apply
-- manually before enabling CLUB_MAP_TILES_ENABLED / setting CLUB_MAPBOX_TOKEN.
--
-- WHY a private bucket + our own route (never a public URL): a public Storage URL would let
-- anyone open a student's route image by guessing the path, bypassing the club_routes_visible
-- check. The bucket is created PRIVATE; images are read only server-side via service_role and
-- streamed through GET /api/m/club/track-image/[workoutId], which auth-gates every request.
--
-- WHY the cache is keyed by polyline hash, not workout id: a track is recomputed on re-ingest
-- or a privacy-radius change; keying only on workout id would keep serving the OLD image with
-- the OLD route. city_hash / map_hash store the polyline hash the cached city / image were
-- built from; a mismatch forces a rebuild.

-- Per-track cache: resolved city and the polyline hashes the city / image were built from.
alter table public.trainingpeaks_workout_tracks
  add column if not exists city text,
  add column if not exists city_hash text,
  add column if not exists map_hash text;

comment on column public.trainingpeaks_workout_tracks.city is
  'Reverse-geocoded city for the (cropped) route, cached. Rebuilt when city_hash != current polyline hash.';
comment on column public.trainingpeaks_workout_tracks.map_hash is
  'Polyline hash the cached Storage image (bucket club-track-maps, path <workout_cache_id>.png) was built from. NULL = no/stale image.';

-- Per-student route-visibility opt-out. Default TRUE = routes shown (address already cropped);
-- turning it OFF means the coach purges the student''s cached images from Storage (removed, not
-- just hidden) and the image route refuses.
alter table public.trainingpeaks_students
  add column if not exists club_routes_visible boolean not null default true;

comment on column public.trainingpeaks_students.club_routes_visible is
  'Club route/map opt-out. FALSE → cached route images are deleted from Storage and the track-image route returns 403. The cropped polyline row stays (gated) so re-enabling can regenerate.';

-- Private Storage bucket for the rendered route images. public=false → no direct URL access;
-- served only through our auth-gated route via service_role. No storage.objects policies are
-- created, so anon/authenticated are default-denied; service_role bypasses RLS.
insert into storage.buckets (id, name, public)
values ('club-track-maps', 'club-track-maps', false)
on conflict (id) do nothing;
