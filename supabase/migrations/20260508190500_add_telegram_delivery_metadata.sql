alter table public.trainingpeaks_students
  add column if not exists telegram_chat_id text,
  add column if not exists telegram_username text,
  add column if not exists telegram_profile_url text,
  add column if not exists telegram_delivery_enabled boolean not null default false;

alter table public.trainingpeaks_weekly_reports
  alter column review_status set default 'draft';

update public.trainingpeaks_weekly_reports
set review_status = 'draft'
where review_status is null;

alter table public.trainingpeaks_weekly_reports
  alter column review_status set not null,
  add column if not exists approved_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists sent_to_chat_id text,
  add column if not exists delivery_error text;
