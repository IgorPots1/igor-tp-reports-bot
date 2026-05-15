alter table public.trainingpeaks_actions
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists decided_by_chat_id text,
  add column if not exists decided_by_user_id text,
  add column if not exists decision_message_id text;

alter table public.trainingpeaks_actions
  drop constraint if exists trainingpeaks_actions_status_check;

alter table public.trainingpeaks_actions
  add constraint trainingpeaks_actions_status_check check (
    status in ('pending_coach', 'approved', 'rejected')
  );
