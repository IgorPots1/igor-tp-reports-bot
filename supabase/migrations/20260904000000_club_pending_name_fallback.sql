-- Block D — probeg name-match FALLBACK metadata for the confirmation queue.
--
-- Some real races never bind because probeg matches by date+distance+TIME and the race-day workout
-- time is missing or cut short (watch stopped early), so the anchor time is wrong (e.g. Krylova's
-- Московский марафон 2025: 38km/3:46:46 vs a ~4:1x full → outside the 900s tolerance → never queued).
-- The opt-in `--name-fallback` pass (probeg-people-probe.ts) matches such races by date+distance+NAME,
-- but ONLY via a coach-confirmed spelling (club_probeg_athlete_links), NEVER auto-links (queue only), and
-- flags namesakes as ambiguous. These columns carry that provenance so the queue card is resolvable at a
-- glance and the fallback rows are distinguishable from ordinary time matches.
--
--   match_kind  — 'time' (default, ordinary time-anchored match) | 'name_fallback' (this pass).
--   ambiguous   — TRUE when more than one confirmed-spelling finisher matched date+distance (namesakes):
--                 all such rows are queued together and the coach picks, the code never chooses.
--   anchor_note — human-readable reason the time anchor did not fire (shown on the card).
alter table public.club_protocol_pending
  add column if not exists match_kind text not null default 'time',
  add column if not exists ambiguous boolean not null default false,
  add column if not exists anchor_note text;

alter table public.club_protocol_pending drop constraint if exists club_protocol_pending_match_kind_check;
alter table public.club_protocol_pending add constraint club_protocol_pending_match_kind_check
  check (match_kind in ('time', 'name_fallback'));

notify pgrst, 'reload schema';
