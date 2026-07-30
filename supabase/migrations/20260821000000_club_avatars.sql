-- Club member avatars from Telegram. Additive, non-destructive. Apply before enabling
-- CLUB_AVATARS_ENABLED.
--
-- A Telegram photo URL (initData photo_url / getFile link) is SHORT-LIVED (~1 hour) and the getFile
-- download link carries the bot token (a secret) — so the URL itself is never stored. We download the
-- image bytes and cache them in a PRIVATE bucket (club-avatars), served only through our auth-gated
-- route (exactly like the route maps, bucket club-track-maps). These columns hold the cache pointer,
-- the last Telegram re-check time (weekly throttle), and the per-student privacy opt-out.
alter table public.trainingpeaks_students
  add column if not exists club_avatar_visible boolean not null default true,
  add column if not exists club_avatar_path text,
  add column if not exists club_avatar_checked_at timestamptz;

comment on column public.trainingpeaks_students.club_avatar_visible is
  'Club avatar opt-out. FALSE → the cached avatar image is deleted from Storage and the avatar route returns 403; the UI falls back to the monogram. Default TRUE (take the photo).';
comment on column public.trainingpeaks_students.club_avatar_path is
  'Storage path (bucket club-avatars) of the cached avatar image, or NULL when none was fetched. The bytes are ours; the Telegram URL is never stored (it expires in ~1h).';
comment on column public.trainingpeaks_students.club_avatar_checked_at is
  'Last time we asked Telegram for this student''s photo. Re-checked at most once a week on mini-app open, so a changed photo refreshes cheaply without hammering the Bot API.';

-- Private Storage bucket for the cached avatar images. public=false → no direct URL access; served
-- only through our auth-gated route via service_role. No storage.objects policies → anon/authenticated
-- are default-denied; service_role bypasses RLS.
insert into storage.buckets (id, name, public)
values ('club-avatars', 'club-avatars', false)
on conflict (id) do nothing;
