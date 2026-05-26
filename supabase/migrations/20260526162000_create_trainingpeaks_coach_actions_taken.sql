create table if not exists public.trainingpeaks_coach_actions_taken (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.trainingpeaks_coach_cases(id) on delete set null,
  student_id uuid references public.trainingpeaks_students(id) on delete set null,
  action_kind text not null check (
    action_kind in (
      'case_resolved',
      'case_dismissed'
    )
  ),
  source text not null check (
    source in (
      'telegram_command',
      'admin_ui',
      'system_backfill'
    )
  ),
  actor_telegram_chat_id text,
  note_preview text check (note_preview is null or char_length(note_preview) <= 120),
  note_sha256 text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.trainingpeaks_coach_actions_taken is
  'Structured coach decision audit rows for TrainingPeaks coach cases without storing raw note text.';

create index if not exists trainingpeaks_coach_actions_taken_case_id_created_at_desc_idx
  on public.trainingpeaks_coach_actions_taken (case_id, created_at desc);

create index if not exists trainingpeaks_coach_actions_taken_student_id_created_at_desc_idx
  on public.trainingpeaks_coach_actions_taken (student_id, created_at desc);

create index if not exists trainingpeaks_coach_actions_taken_action_kind_created_at_desc_idx
  on public.trainingpeaks_coach_actions_taken (action_kind, created_at desc);

revoke all on table public.trainingpeaks_coach_actions_taken from anon, authenticated, public;
grant select, insert on table public.trainingpeaks_coach_actions_taken to service_role;

alter table public.trainingpeaks_coach_actions_taken enable row level security;
