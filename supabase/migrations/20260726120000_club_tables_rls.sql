-- Club Mini App — enable RLS on the remaining club tables (defense-in-depth).
--
-- The request tables (club_races, club_dayoff_requests, club_wishes) and
-- club_reactions already have RLS enabled with a default-deny posture. This closes
-- the gap on the tables that did not: club_records, club_link_events,
-- club_challenges. All club data is written/read by the app via the service_role
-- key (which bypasses RLS); enabling RLS with NO permissive policies makes a leaked
-- anon/publishable key unable to read or tamper with these tables directly.
--
-- IMPORTANT — ownership model: club students are TrainingPeaks entities, NOT
-- auth.users, so there is no auth.uid() to gate rows per student at the RLS layer.
-- Per-student ownership ("a student reads/writes only their own") is enforced in the
-- API routes, where student_id comes from the validated Telegram initData resolver
-- and never from the client. RLS here is a hard default-deny wall for direct table
-- access, not a per-row ownership check.
--
-- NOT applied by this task.

alter table public.club_records enable row level security;
alter table public.club_link_events enable row level security;
alter table public.club_challenges enable row level security;

-- Deliberately no CREATE POLICY: default-deny for anon/authenticated. service_role
-- (the app / backfill) continues to bypass RLS and work unchanged.
