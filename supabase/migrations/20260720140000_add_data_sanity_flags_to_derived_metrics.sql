-- FIT data-sanity flags (наряд fit-data-sanity). Like hr_trusted: a boolean the
-- consumers read to know whether to believe the pace/distance for a workout.
-- Set by the ingest's sanity gate (fit-data-sanity.ts): false when the
-- whole-workout pace is physically implausible (device GPS spike / GPS-lost
-- fragment). null = not computable (no FIT distance/time). Reasons land in the
-- existing normalization_warnings text[].
--
-- No stored overall pace/distance column: consumers aggregate laps themselves;
-- these flags tell them whether that aggregate is trustworthy.

alter table public.trainingpeaks_workout_derived_metrics
  add column if not exists pace_trusted boolean;

alter table public.trainingpeaks_workout_derived_metrics
  add column if not exists distance_trusted boolean;
