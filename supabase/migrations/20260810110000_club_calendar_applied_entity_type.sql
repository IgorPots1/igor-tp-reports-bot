-- Club calendar — record WHICH TP entity kind an applied entry created.
--
-- Rollback must delete the RIGHT resource (workout / event / note / availability). It used
-- to infer the kind by re-planning the entry with the CURRENT flags — so rolling back with a
-- different flag than was used to apply hit the WRONG delete endpoint. At batch scale (110
-- students) that is guaranteed mix-ups. The fix: store the entity kind at apply time and read
-- it on rollback (planCalendarEntryAction / flags are no longer consulted for rollback).
--
-- Values: 'workout' | 'event' | 'note' | 'availability'. NULL = pre-column applied rows
-- (rollback falls back to flag-based re-plan for those, backward compatible).
--
-- Additive, non-destructive. NOT applied by this task.

alter table public.club_calendar_entries
  add column if not exists applied_entity_type text
    check (applied_entity_type in ('workout', 'event', 'note', 'availability'));

comment on column public.club_calendar_entries.applied_entity_type is
  'The TP entity kind created for this entry (workout/event/note/availability), written at apply time so rollback deletes the right resource without guessing from current flags. NULL = applied before this column existed.';
