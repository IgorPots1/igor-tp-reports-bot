-- Comparison base (intervals, tiers 1–2). Design doc:
-- /Users/igor/dev-notes/20 Coach OS/2026-07-14 Comparison Base Design.md, §F.
--
-- One denormalized column: the interval STRUCTURE key ('7x[300second]' | ...),
-- computed on ingest from source_snapshot.structure (a jsonb up to ~100k) by
-- comparison/comparison-key.ts. The matcher runs in serverless and must not
-- fetch and re-parse a hundred plan snapshots per comparison — with the key
-- denormalized it becomes an index scan. null = non-interval / unkeyable plan.
--
-- No new table, no norm cache: norms are computed on the fly (design doc §F).

alter table public.trainingpeaks_workout_derived_metrics
  add column if not exists comparison_key text;

create index if not exists trainingpeaks_workout_derived_metrics_cmp_idx
  on public.trainingpeaks_workout_derived_metrics (student_id, workout_type, comparison_key);
