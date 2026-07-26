-- Club Mini App — grant service_role DML on the club tables (ROLLOUT BLOCKER FIX).
--
-- Finding (2026-07, Phase 2 readiness): the club_* tables were created without the
-- DML grants that Supabase normally attaches. Verified on igor-agent-hub:
--   trainingpeaks_workout_cache → service_role has INSERT,SELECT,UPDATE (+ owner privs)
--   club_races / club_records / club_reactions / … → service_role has only
--     REFERENCES,TRIGGER,TRUNCATE  (NO select/insert/update/delete)
-- The app talks to these tables ONLY via the service_role key, so with the grants
-- missing EVERY club_* read fails with 42501 and is silently swallowed (the loaders
-- are wrapped in try/catch → empty), and every write (declare race, react, coach
-- confirm) would 42501-fail. Nothing user-facing breaks today only because all these
-- features are flag-OFF and read from the workout cache. They will silently do
-- NOTHING the moment a flag is flipped — until this migration is applied.
--
-- Fix: grant SELECT/INSERT/UPDATE/DELETE to service_role. RLS stays default-deny for
-- anon/authenticated (see 20260725130000 + 20260726120000), so this does not widen
-- exposure to leaked anon/publishable keys — the app path (service_role) simply works.
--
-- Apply BEFORE enabling any club feature flag. NOT applied by this task.

grant select, insert, update, delete on table
  public.club_races,
  public.club_records,
  public.club_reactions,
  public.club_challenges,
  public.club_link_events,
  public.club_dayoff_requests,
  public.club_wishes
to service_role;
