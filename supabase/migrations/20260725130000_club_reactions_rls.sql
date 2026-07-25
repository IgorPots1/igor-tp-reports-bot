-- Club Mini App — lock down club_reactions with RLS.
--
-- The club_reactions table (20260725120000) is written ONLY by the app via the
-- service_role key (which bypasses RLS). This migration enables RLS with NO
-- permissive policies for anon/authenticated, so a leaked anon/publishable key
-- cannot read or tamper with reactions directly. service_role continues to work.
--
-- Students are TrainingPeaks entities, not auth.users, so there is no auth.uid()
-- mapping to gate per-student writes at the RLS layer — that ownership check lives
-- in the API route (student_id comes from the validated initData resolver, never
-- from the client). RLS here is defense-in-depth against direct table access.
--
-- NOT applied by this task.

alter table public.club_reactions enable row level security;

-- (Deliberately no CREATE POLICY: default-deny for anon/authenticated. Add a
-- read-only policy here later if the club ever reads reactions with a non-service
-- key.)
