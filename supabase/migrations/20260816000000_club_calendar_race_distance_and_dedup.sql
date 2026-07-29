-- Consolidate club races onto club_calendar_entries kind='race' (the path that already
-- executes to TP via scripts/club-execute-one.ts and carries applied_tp_workout_id for
-- idempotency + rollback). The cabinet «Старты» form will write here too. Two additive changes:
--
--   1) distance_meters — the form's distance chips (5 / 10 / 21.1 / 42.2 км, or custom km)
--      give a real number. A text label (race_distance_label) can't be matched to records or
--      sorted; distance_meters mirrors club_races.distance_meters so the E-Predictor target
--      and record typing keep a reliable distance after consolidation.
--
--   2) race dedup — the SAME student + date + normalized race name must not create a second
--      race. Functional unique index (lower + btrim of race_name) restricted to kind='race'.
--      Similar-but-different names on the same date stay allowed (coach reviews in admin).
--
-- Additive, non-destructive. NOT applied by this task.
-- NOTE: index creation fails if duplicate races already exist for a (student, date, name).
-- club_calendar_entries races are new/few, but if apply errors on the index, de-dup those
-- rows first (keep the one with applied_tp_workout_id) and re-run.

alter table public.club_calendar_entries
  add column if not exists distance_meters integer;

create unique index if not exists club_calendar_entries_race_dedup_uidx
  on public.club_calendar_entries (student_id, entry_date, lower(btrim(race_name)))
  where kind = 'race';
