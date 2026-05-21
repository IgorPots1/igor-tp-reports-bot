create table if not exists public.trainingpeaks_student_threads (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  telegram_chat_id text not null,
  telegram_message_thread_id bigint not null,
  chat_title text,
  thread_title text,
  linked_by_user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (telegram_chat_id, telegram_message_thread_id)
);

create index if not exists trainingpeaks_student_threads_student_id_idx
  on public.trainingpeaks_student_threads (student_id);

create or replace function public.set_trainingpeaks_student_threads_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_trainingpeaks_student_threads_updated_at
  on public.trainingpeaks_student_threads;

create trigger set_trainingpeaks_student_threads_updated_at
before update on public.trainingpeaks_student_threads
for each row
execute function public.set_trainingpeaks_student_threads_updated_at();

revoke all on table public.trainingpeaks_student_threads from anon, authenticated, public;
grant select, insert, update, delete on table public.trainingpeaks_student_threads to service_role;

alter table public.trainingpeaks_student_threads enable row level security;
