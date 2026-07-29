-- Grants for club_form_sends + club_open_events. The tables were created (migrations
-- 20260811000000 / 20260811100000) but WITHOUT a service_role grant, so every read/write hit
-- Postgres 42501 "permission denied" — the same class the other club tables already grant
-- (see 20260726130000_club_tables_grants.sql, club_access_requests, etc.). Mirrors that pattern.
--
-- Idempotent (grant is a no-op if already present). Apply on the prod DB.

grant select, insert, update, delete on public.club_form_sends to service_role;
grant select, insert, update, delete on public.club_open_events to service_role;
