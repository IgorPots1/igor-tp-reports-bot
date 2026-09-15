-- Completeness gaps in trainingpeaks_telegram_context_observations, all additive:
--
-- direction/sender_role: today there is no column that says who sent a message. business_dm
-- never wrote a role at all; group/private wrote it only into metadata->>'senderRole', with a
-- confusing overload — 'third_party_in_linked_topic' means "the coach, OR some other third
-- party" with no way to tell them apart from this column alone. sender_role is a clean,
-- consistently-populated replacement; direction is new information entirely (nothing before
-- this recorded outbound coach messages as a distinct thing anywhere in this table).
--
-- attachment_*: voice/photo/etc. messages are already inserted with text=null in some source
-- paths (private_dm, group_topic) and dropped entirely in others (business_dm) — see the
-- telegram-context-completeness наряд's Задача 0/3 audit. These columns give every source path
-- a place to record what the attachment was, once Задача A3 stops dropping them.
--
-- transcript*: holds a voice/video_note transcription without overwriting text_preview (the
-- original message's own text/caption, which stays whatever it was — usually empty for a voice
-- message with no caption).
--
-- metadata is left untouched: it still carries the raw fromId/fromUsername/scores/etc. that
-- nothing here replaces.

alter table public.trainingpeaks_telegram_context_observations
  add column if not exists direction text not null default 'inbound',
  add column if not exists sender_role text,
  add column if not exists attachment_type text,
  add column if not exists attachment_file_id text,
  add column if not exists attachment_duration_sec integer,
  add column if not exists transcript text,
  add column if not exists transcript_status text,
  add column if not exists transcript_at timestamptz;

alter table public.trainingpeaks_telegram_context_observations
  drop constraint if exists trainingpeaks_telegram_context_observations_direction_check;
alter table public.trainingpeaks_telegram_context_observations
  add constraint trainingpeaks_telegram_context_observations_direction_check
  check (direction in ('inbound', 'outbound'));

alter table public.trainingpeaks_telegram_context_observations
  drop constraint if exists trainingpeaks_telegram_context_observations_attachment_type_check;
alter table public.trainingpeaks_telegram_context_observations
  add constraint trainingpeaks_telegram_context_observations_attachment_type_check
  check (attachment_type is null or attachment_type in
    ('voice', 'video_note', 'photo', 'document', 'sticker', 'audio', 'unknown'));

alter table public.trainingpeaks_telegram_context_observations
  drop constraint if exists trainingpeaks_telegram_context_observations_transcript_status_check;
alter table public.trainingpeaks_telegram_context_observations
  add constraint trainingpeaks_telegram_context_observations_transcript_status_check
  check (transcript_status is null or transcript_status in ('pending', 'done', 'failed', 'skipped'));

-- Partial index for the transcription worker's claim query (mirrors voice_transcription_jobs'
-- own pending index) — only ever a small slice of the table.
create index if not exists trainingpeaks_telegram_context_observations_transcript_pending_idx
  on public.trainingpeaks_telegram_context_observations (observed_at)
  where transcript_status = 'pending';

-- (student_id, observed_at desc) already exists from the creation migration
-- (20260522200000) — not recreated here.
