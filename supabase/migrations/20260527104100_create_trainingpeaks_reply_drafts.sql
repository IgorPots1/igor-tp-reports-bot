create table if not exists public.trainingpeaks_reply_drafts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete restrict,
  case_id uuid references public.trainingpeaks_coach_cases(id) on delete set null,
  source text not null default 'telegram_command' check (
    source in ('telegram_command', 'attention_digest', 'system')
  ),
  actor_telegram_chat_id text,
  ai_model text not null,
  prompt_context_sha256 text not null,
  student_message_sha256 text not null,
  student_message_preview text check (
    student_message_preview is null or char_length(student_message_preview) <= 80
  ),
  draft_sha256 text not null,
  draft_preview text check (
    draft_preview is null or char_length(draft_preview) <= 120
  ),
  draft_char_count int not null default 0,
  outcome text not null default 'generated' check (
    outcome in ('generated', 'used', 'edited', 'ignored')
  ),
  outcome_recorded_at timestamptz,
  coach_note_preview text check (
    coach_note_preview is null or char_length(coach_note_preview) <= 120
  ),
  coach_note_sha256 text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists trainingpeaks_reply_drafts_student_id_created_at_desc_idx
  on public.trainingpeaks_reply_drafts (student_id, created_at desc);

create index if not exists trainingpeaks_reply_drafts_outcome_created_at_desc_idx
  on public.trainingpeaks_reply_drafts (outcome, created_at desc);

create index if not exists trainingpeaks_reply_drafts_case_id_created_at_desc_idx
  on public.trainingpeaks_reply_drafts (case_id, created_at desc);

revoke all on table public.trainingpeaks_reply_drafts from anon, authenticated, public;
grant select, insert, update on table public.trainingpeaks_reply_drafts to service_role;

alter table public.trainingpeaks_reply_drafts enable row level security;
