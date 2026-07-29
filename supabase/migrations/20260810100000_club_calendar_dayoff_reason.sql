-- Club calendar — day_off reason (native TP Availability `reason` enum).
--
-- When a day_off is executed as a native TP Availability (CLUB_DAYOFF_AS_AVAILABILITY),
-- the record carries a `reason` from TP's enum: Appointment / Injury / Sick / Vacation /
-- Work / Other (null = no reason). The student picks it in the club calendar form; it goes
-- verbatim to TP and gives structure for a future health signal (Injury/Sick → Coach OS
-- health bucket — plan only, see docs/club-health-signal-from-availability.md).
--
-- Stored as free text (not a DB enum) so adding/renaming a TP reason never needs a
-- migration; the allowed set is enforced in application code (CLUB_DAYOFF_REASONS).
--
-- Additive, non-destructive. NOT applied by this task.

alter table public.club_calendar_entries
  add column if not exists day_off_reason text;

comment on column public.club_calendar_entries.day_off_reason is
  'day_off: TP Availability reason enum (Appointment/Injury/Sick/Vacation/Work/Other), null = none. Sent verbatim to TP; Injury/Sick are the future health-signal triggers.';
