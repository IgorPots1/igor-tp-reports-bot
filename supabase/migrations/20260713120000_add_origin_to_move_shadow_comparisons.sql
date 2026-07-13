-- M3.5 (move-http-shadow plan): adds an explicit `origin` column to
-- trainingpeaks_move_shadow_comparisons, distinguishing rows written by the
-- live M2 hook (during a real move) from rows written by the M3.5 backfill
-- script (replaying PAST completed moves against the CURRENT live TP
-- calendar, to accumulate resolver statistics faster than real move volume
-- allows).
--
-- WHY NOT MIX THEM: backfill rows test the resolver against a calendar state
-- that has DRIFTED since the original move (the workout may since have moved
-- again, been edited, or -- if truly gone -- is excluded from backfill
-- entirely as "unreproducible"). That is a fundamentally different, weaker
-- guarantee than a live-hook row, which observes ground truth at the exact
-- moment of the real move. The plan's switch criterion (naryad: "≥30-50
-- ПЕРЕНОСОВ", "≥3-4 НЕДЕЛИ" of live shadow traffic) is about live traffic
-- specifically -- mixing backfill volume into that count would make the
-- criterion look satisfied without actually being satisfied. tp-move-shadow-
-- report.ts (M3) is updated alongside this migration to filter to
-- origin='live' for the official switch-decision numbers; backfill rows are
-- reported separately, explicitly labeled as not counting toward the gate.
--
-- Depends on 20260713000000_create_trainingpeaks_move_shadow_comparisons.sql
-- having been applied first (that migration is NOT touched/edited here --
-- additive follow-up only, in case Igor has already reviewed/applied it).
--
-- NOT APPLIED by the agent -- apply manually via the Supabase SQL Editor,
-- after 20260713000000, after review.

begin;

alter table public.trainingpeaks_move_shadow_comparisons
  add column origin text not null default 'live'
  check (origin = any (array['live', 'backfill']));

-- Existing rows (if any were written by the live hook before this migration)
-- keep the default 'live', which is correct -- they were live-hook rows by
-- construction, this column just wasn't tracked explicitly yet.

create index if not exists trainingpeaks_move_shadow_comparisons_origin_idx
  on public.trainingpeaks_move_shadow_comparisons (origin);

commit;
