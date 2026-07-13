-- FIT ingest: two HR-diagnostics columns on trainingpeaks_workout_derived_metrics.
--
-- 1) cadence_lock_coverage_pct
--    The HR cleaner already COMPUTES this (% of moving samples inside a
--    cadence-lock window -- the optical-strap failure mode where heart rate
--    latches onto cadence) and then threw it away. The first wide run found 62
--    workouts with degraded/unreliable HR (up to 81.8% of samples replaced), and
--    there was no way to check, after the fact, whether the cadence-lock detector
--    had actually fired on any of them. Persisting it makes that answerable.
--
-- 2) hr_trusted
--    Igor's rule: when HR is unreliable we keep the number but SUPPRESS the
--    conclusions. avg_hr stays in the row for diagnostics; hr_trusted=false is
--    the explicit flag the report-generation layer reads to know it must stay
--    silent about this workout's heart rate. A dedicated boolean (rather than
--    making generation re-interpret the hr_quality enum) so the contract is
--    unambiguous at the call site.
--    Written as: hr_quality IN ('good','degraded') -> true; 'unreliable' or no
--    HR at all -> false.
--
-- Both are nullable and default NULL: rows written before this migration simply
-- have no value, which is honest -- not a fabricated 0/true.

alter table public.trainingpeaks_workout_derived_metrics
  add column if not exists cadence_lock_coverage_pct numeric,
  add column if not exists hr_trusted boolean;

comment on column public.trainingpeaks_workout_derived_metrics.cadence_lock_coverage_pct is
  '% of moving-time samples the HR cleaner found inside a cadence-lock window (optical-HR-latched-to-cadence). Diagnostics only.';

comment on column public.trainingpeaks_workout_derived_metrics.hr_trusted is
  'FALSE = do not draw heart-rate conclusions from this workout (hr_quality=unreliable or no HR). avg_hr is still stored, but generation must stay silent about HR.';
