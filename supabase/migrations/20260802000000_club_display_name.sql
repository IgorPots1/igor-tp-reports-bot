-- Club Mini App (/m/club) — editable display name (Phase 3.2).
--
-- Adds an optional per-student display name used ONLY in the club surface (feed,
-- leaderboards, profile, member profiles). When NULL, the club falls back to the
-- student's real name (student_name) rendered as first+last. The student can edit
-- their own club_display_name from the profile screen; the coach can set any value
-- from the admin. Nothing outside the club reads this column.
--
-- Additive, non-destructive. NOT applied in prod by this task — apply manually
-- before relying on it at runtime. Until applied, the club service tolerates the
-- missing column (loadClubStudents selects it defensively) and everyone shows
-- their first+last real name.

alter table public.trainingpeaks_students
  add column if not exists club_display_name text;

comment on column public.trainingpeaks_students.club_display_name is
  'Optional display name shown ONLY in /m/club (feed, tops, profiles). NULL => fall back to student_name (first+last). Student edits own; coach edits any. Not read outside the club surface.';
