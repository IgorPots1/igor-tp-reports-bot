create table if not exists public.trainingpeaks_actions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.trainingpeaks_students(id) on delete set null,
  action_type text not null default 'move_workout',
  status text not null default 'pending_coach',
  source_chat_id text not null,
  source_message_id text not null,
  source_user_id text,
  raw_text text not null,
  parsed_payload jsonb not null,
  confidence text,
  coach_chat_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trainingpeaks_actions_action_type_check check (action_type in ('move_workout')),
  constraint trainingpeaks_actions_status_check check (status in ('pending_coach'))
);

create index if not exists trainingpeaks_actions_created_at_idx
  on public.trainingpeaks_actions (created_at desc);

create index if not exists trainingpeaks_actions_student_id_idx
  on public.trainingpeaks_actions (student_id);

create index if not exists trainingpeaks_actions_status_idx
  on public.trainingpeaks_actions (status);

create or replace function public.set_trainingpeaks_actions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_trainingpeaks_actions_updated_at on public.trainingpeaks_actions;

create trigger set_trainingpeaks_actions_updated_at
before update on public.trainingpeaks_actions
for each row
execute function public.set_trainingpeaks_actions_updated_at();

revoke all on table public.trainingpeaks_actions from anon, authenticated, public;
grant select, insert, update on table public.trainingpeaks_actions to service_role;

alter table public.trainingpeaks_actions enable row level security;
