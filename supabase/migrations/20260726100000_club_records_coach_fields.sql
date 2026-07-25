-- Club coach panel — manual race entry fields on club_records (Phase 1.1).
-- club_records already applied; this adds the race name for coach_confirmed rows.
-- Apply before enabling CLUB_ADMIN_ENABLED. NOT applied by this task.

alter table public.club_records
  add column if not exists race_name text,
  add column if not exists entered_by text;   -- coach identifier who confirmed/hid

comment on column public.club_records.race_name is
  'Name of the race for a coach_confirmed result (manual entry from the admin club panel).';
