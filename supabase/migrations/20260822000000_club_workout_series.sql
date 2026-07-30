-- Club Phase 5 — per-workout HR + pace time series (smooth detail chart). Additive,
-- non-destructive. New workouts only (written at FIT ingest, like the polyline); old workouts are
-- NOT backfilled.
--
-- Storage is a DOWNSAMPLED series (~120 points regardless of run length: 3000 one-second samples are
-- binned into ~120 time buckets), so a row grows by ~2.5-3 KB of JSON — the same order as the
-- polyline. Drawing 3000 points on a 350px chart is pointless; 120 is smooth. Running workouts with
-- GPS only (the series rides on the existing track row, which requires a polyline).
alter table public.trainingpeaks_workout_tracks
  add column if not exists series jsonb;

comment on column public.trainingpeaks_workout_tracks.series is
  'Club Phase 5: downsampled HR+pace-over-time series (~120 points) for the workout detail chart, from FIT records at ingest. Array of { t (seconds from start), hr (bpm|null), pace (sec/km|null) }. Running workouts only; NULL for non-runs / old workouts (not backfilled).';
