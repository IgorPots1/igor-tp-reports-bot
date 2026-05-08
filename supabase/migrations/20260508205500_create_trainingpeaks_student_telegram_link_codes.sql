create table if not exists public.trainingpeaks_student_telegram_link_codes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  code text not null,
  status text not null check (status in ('active', 'used', 'expired')),
  expires_at timestamptz not null,
  used_at timestamptz,
  business_connection_id text,
  chat_id text,
  created_at timestamptz not null default now()
);

create unique index if not exists trainingpeaks_student_telegram_link_codes_active_code_idx
  on public.trainingpeaks_student_telegram_link_codes (lower(code))
  where status = 'active';

create index if not exists trainingpeaks_student_telegram_link_codes_student_status_idx
  on public.trainingpeaks_student_telegram_link_codes (student_id, status, created_at desc);

grant select, insert, update on table public.trainingpeaks_student_telegram_link_codes to service_role;

alter table public.trainingpeaks_student_telegram_link_codes enable row level security;
