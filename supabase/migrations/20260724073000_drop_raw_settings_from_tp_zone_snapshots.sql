-- Drop the vestigial raw_settings column from tp_zone_snapshots.
--
-- The original create migration (20260723230000) first shipped with a raw_settings
-- jsonb column meant to hold the full GET /settings response. That body carries real
-- PII and a working iCalendarKeys access key, so it must never be stored. The create
-- migration was corrected to omit the column and the snapshot script now persists only
-- the whitelisted `zones` projection — but a database that applied the ORIGINAL version
-- still has raw_settings (confirmed live: the column is present, default '{}').
--
-- Drop it so no secret-capable column exists at all. The snapshot script never writes
-- it, so this loses no data (it only ever held '{}').
--
-- Idempotent (drop column if exists) — a no-op on a DB created from the corrected
-- create migration. FILE ONLY — apply manually, not auto-run.

alter table public.tp_zone_snapshots drop column if exists raw_settings;
