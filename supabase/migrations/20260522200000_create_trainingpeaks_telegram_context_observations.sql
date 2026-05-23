alter table public.trainingpeaks_students
  add column if not exists telegram_formality text not null default 'unknown',
  add column if not exists telegram_context_notes text;

alter table public.trainingpeaks_students
  drop constraint if exists trainingpeaks_students_telegram_formality_check;

alter table public.trainingpeaks_students
  add constraint trainingpeaks_students_telegram_formality_check
  check (telegram_formality in ('ty', 'vy', 'unknown'));

create table if not exists public.trainingpeaks_telegram_context_observations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.trainingpeaks_students(id) on delete set null,
  source_type text not null check (source_type in ('business_dm', 'private_dm', 'group_topic')),
  chat_id text not null,
  message_thread_id bigint,
  message_id text,
  observed_at timestamptz not null default now(),
  labels jsonb not null default '[]'::jsonb,
  text_sha256 text,
  text_preview text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists trainingpeaks_telegram_context_observations_student_observed_idx
  on public.trainingpeaks_telegram_context_observations (student_id, observed_at desc);

create index if not exists trainingpeaks_telegram_context_observations_chat_text_sha256_idx
  on public.trainingpeaks_telegram_context_observations (chat_id, text_sha256)
  where text_sha256 is not null;

revoke all on table public.trainingpeaks_telegram_context_observations from anon, authenticated, public;
grant select, insert, update, delete on table public.trainingpeaks_telegram_context_observations to service_role;

alter table public.trainingpeaks_telegram_context_observations enable row level security;
