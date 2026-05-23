create table if not exists public.trainingpeaks_message_intent_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null default 'telegram_business',
  student_id uuid references public.trainingpeaks_students(id) on delete set null,
  telegram_chat_id text,
  telegram_user_id text,
  telegram_message_id text,
  business_connection_id text,
  message_thread_id bigint,
  raw_text text,
  text_preview text,
  text_sha256 text,
  normalized_text text,
  rule_intent jsonb,
  rule_confidence numeric,
  ai_intent jsonb,
  ai_confidence numeric,
  final_intent jsonb,
  status text not null,
  action_id uuid references public.trainingpeaks_actions(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  constraint trainingpeaks_message_intent_logs_status_check
    check (status in (
      'action_created',
      'unrecognized',
      'ignored',
      'student_not_found',
      'parse_failed',
      'needs_review'
    ))
);

create index if not exists trainingpeaks_message_intent_logs_created_at_idx
  on public.trainingpeaks_message_intent_logs (created_at desc);

create index if not exists trainingpeaks_message_intent_logs_status_created_at_idx
  on public.trainingpeaks_message_intent_logs (status, created_at desc);

create index if not exists trainingpeaks_message_intent_logs_student_created_at_idx
  on public.trainingpeaks_message_intent_logs (student_id, created_at desc);

create unique index if not exists trainingpeaks_message_intent_logs_chat_message_uidx
  on public.trainingpeaks_message_intent_logs (telegram_chat_id, telegram_message_id)
  where telegram_chat_id is not null and telegram_message_id is not null;

create index if not exists trainingpeaks_message_intent_logs_review_status_created_at_idx
  on public.trainingpeaks_message_intent_logs (created_at desc)
  where status in ('unrecognized', 'needs_review');

revoke all on table public.trainingpeaks_message_intent_logs from anon, authenticated, public;
grant select, insert, update, delete on table public.trainingpeaks_message_intent_logs to service_role;

alter table public.trainingpeaks_message_intent_logs enable row level security;
