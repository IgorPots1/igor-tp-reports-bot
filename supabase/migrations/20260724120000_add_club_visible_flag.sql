-- Club Mini App (/m/club) privacy flag.
--
-- Adds a per-student visibility switch for the club feed / leaderboards /
-- challenge. Default TRUE => every active student participates in the club feed
-- by default (naryad requirement), with the ability to opt out (set FALSE).
--
-- A student who opts out is removed from OTHERS' feed / tops / "красавчики", but
-- still sees their OWN personal cabinet (that is their own data).
--
-- NOTE: additive, non-destructive. NOT applied in prod by this task — apply
-- manually before enabling the opt-out at runtime. Until applied, the club
-- service defaults everyone to visible (see src/features/club/service.ts:
-- loadClubStudents — add `club_visible` to the select once this ships).

alter table public.trainingpeaks_students
  add column if not exists club_visible boolean not null default true;

comment on column public.trainingpeaks_students.club_visible is
  'Whether this student appears in the /m/club feed, leaderboards and challenge to OTHER students. Default true. Their own personal cabinet is always visible to themselves regardless.';
