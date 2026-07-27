-- Phase 1.3 (club speed): index-aligned ordering for the club window reads.
--
-- The club data layer reads trainingpeaks_workout_cache filtered by a workout_date
-- range and (as of Phase 1.3) ordered by (workout_date, id). The existing indexes are
-- (workout_date DESC, scanned_at DESC) and (student_id, workout_date DESC) — neither
-- serves an ASC (workout_date, id) ordering, so Postgres sorted the whole window.
--
-- This ascending composite covers the range filter AND the ORDER BY, so the paginated
-- offset reads (feed 45d, statistics ~14d, tops 60d, challenge ~40d) avoid a full sort.
-- Read-only additive change; no data touched. NOT applied automatically — apply before
-- relying on the Phase-1 speed numbers.
--
-- EXPLAIN to verify (run in the SQL editor before/after applying):
--   EXPLAIN ANALYZE
--   SELECT id, student_id, workout_date FROM trainingpeaks_workout_cache
--   WHERE workout_date >= (CURRENT_DATE - INTERVAL '45 days')::text
--     AND workout_date <= CURRENT_DATE::text
--   ORDER BY workout_date ASC, id ASC LIMIT 1000;
-- Expect: "Index Scan using club_cache_date_id_idx" (was: "Seq Scan" + "Sort").

CREATE INDEX IF NOT EXISTS club_cache_date_id_idx
  ON trainingpeaks_workout_cache (workout_date ASC, id ASC);
