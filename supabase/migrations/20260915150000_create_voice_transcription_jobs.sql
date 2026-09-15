-- Manual voice-transcription queue: Igor forwards/records a voice message directly to the bot
-- (not a student), Vercel enqueues a job here, a local Mac runner (launchd, whisper.cpp) claims
-- it, transcribes, and edits the ack message with the result. Vercel cannot run whisper.cpp
-- itself, so the queue is the only handoff point between the webhook and the local runner.
--
-- Reused as-is by the automatic incoming-voice transcription task later (attachment_type in
-- ('voice','video_note') on trainingpeaks_telegram_context_observations) — same worker, same
-- table shape, different enqueue call site. Kept in its own table rather than folded into that
-- observations table: this queue's rows are pure processing state (status/attempts/last_error),
-- unrelated to student/context attribution, and get created before any student resolution happens.

create table if not exists public.voice_transcription_jobs (
  id uuid primary key default gen_random_uuid(),

  telegram_chat_id text not null,
  telegram_message_id text not null,
  -- Bot's own "принял, расшифровываю..." message. The runner edits THIS message with the
  -- transcript, so it must be captured at enqueue time (sendMessage's own response), not
  -- looked up later.
  ack_message_id text,

  file_id text not null,
  file_unique_id text,
  duration_sec integer,
  mime_type text,
  file_size_bytes bigint,
  source_kind text not null check (source_kind in ('voice', 'video_note', 'audio', 'document')),

  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed', 'skipped')),
  attempts integer not null default 0,
  last_error text,

  transcript text,
  transcript_model text,
  processing_ms integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Dedup at the same layer as the business_message webhook: Telegram retries the webhook with the
-- same update on a slow/failed ack, and without this a retried forward would enqueue twice.
create unique index if not exists voice_transcription_jobs_chat_message_idx
  on public.voice_transcription_jobs (telegram_chat_id, telegram_message_id);

-- The runner's claim query: oldest pending first, nothing else scanned.
create index if not exists voice_transcription_jobs_pending_idx
  on public.voice_transcription_jobs (created_at)
  where status = 'pending';

create or replace function public.set_voice_transcription_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_voice_transcription_jobs_updated_at on public.voice_transcription_jobs;

create trigger set_voice_transcription_jobs_updated_at
before update on public.voice_transcription_jobs
for each row
execute function public.set_voice_transcription_jobs_updated_at();

revoke all on table public.voice_transcription_jobs from anon, authenticated, public;
grant select, insert, update on table public.voice_transcription_jobs to service_role;

alter table public.voice_transcription_jobs enable row level security;
