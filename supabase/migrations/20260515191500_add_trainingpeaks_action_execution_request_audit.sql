alter table public.trainingpeaks_actions
  add column if not exists execution_requested_at timestamptz,
  add column if not exists execution_requested_by_chat_id text,
  add column if not exists execution_requested_by_user_id text,
  add column if not exists execution_request_message_id text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by_chat_id text,
  add column if not exists cancelled_by_user_id text,
  add column if not exists cancel_message_id text;
