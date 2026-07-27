-- Club Mini App (/m/club) Phase D: comments on club workouts.
-- Gated at runtime by CLUB_COMMENTS_ENABLED (OFF by default -> the API returns 503
-- and the mini-app renders no comment UI). NOT applied by this task; apply manually
-- before enabling comments.
--
-- The first proper student WRITE path in the club. Ownership is enforced in the API
-- route (student_id comes from the validated initData resolver, never the client);
-- RLS here is defense-in-depth exactly like club_reactions (20260725130000).

create table if not exists public.club_comments (
  id uuid primary key default gen_random_uuid(),
  workout_cache_id uuid not null
    references public.trainingpeaks_workout_cache(id) on delete cascade,
  student_id uuid not null
    references public.trainingpeaks_students(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists club_comments_workout_idx
  on public.club_comments (workout_cache_id, created_at);

create index if not exists club_comments_student_recent_idx
  on public.club_comments (student_id, created_at);

comment on table public.club_comments is
  'Student comments on club workouts (/m/club). Self-scoped writes only (author edits/deletes own; coach deletes any from admin). Read-only to others. No notifications.';

-- Defense-in-depth: RLS default-deny for anon/authenticated. The app writes ONLY via
-- the service_role key (which bypasses RLS), so a leaked anon/publishable key cannot
-- read or tamper with comments directly. There is no auth.uid() mapping (students are
-- TrainingPeaks entities, not auth.users) so per-author ownership is checked in the
-- API route, not at the RLS layer.
alter table public.club_comments enable row level security;
-- (Deliberately no CREATE POLICY: default-deny.)

-- Grant the app role DML (club_* tables were created without the grants Supabase
-- normally attaches; see 20260726130000_club_tables_grants.sql). Apply BEFORE enabling
-- CLUB_COMMENTS_ENABLED, else every read/write 42501-fails and is silently swallowed.
grant select, insert, update, delete on table public.club_comments to service_role;
