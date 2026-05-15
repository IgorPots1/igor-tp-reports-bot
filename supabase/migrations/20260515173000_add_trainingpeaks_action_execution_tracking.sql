alter table public.trainingpeaks_actions
  add column if not exists execution_status text not null default 'not_started',
  add column if not exists execution_mode text,
  add column if not exists claimed_by text,
  add column if not exists claimed_at timestamptz,
  add column if not exists last_run_id uuid;

alter table public.trainingpeaks_actions
  drop constraint if exists trainingpeaks_actions_execution_status_check;

alter table public.trainingpeaks_actions
  add constraint trainingpeaks_actions_execution_status_check check (
    execution_status in (
      'not_started',
      'dry_run_running',
      'dry_run_completed',
      'execute_pending',
      'running_local',
      'completed',
      'failed'
    )
  );

alter table public.trainingpeaks_actions
  drop constraint if exists trainingpeaks_actions_execution_mode_check;

alter table public.trainingpeaks_actions
  add constraint trainingpeaks_actions_execution_mode_check check (
    execution_mode is null or execution_mode in ('dry_run', 'real')
  );

create table if not exists public.trainingpeaks_action_runs (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.trainingpeaks_actions(id) on delete cascade,
  run_type text not null,
  status text not null,
  dry_run boolean not null default true,
  runner_id text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text,
  log_json jsonb not null default '{}'::jsonb,
  screenshot_before_path text,
  screenshot_after_path text,
  created_at timestamptz not null default now(),
  constraint trainingpeaks_action_runs_run_type_check check (run_type in ('dry_run', 'real')),
  constraint trainingpeaks_action_runs_status_check check (status in ('running', 'completed', 'failed'))
);

create index if not exists trainingpeaks_action_runs_action_id_idx
  on public.trainingpeaks_action_runs (action_id, created_at desc);

create index if not exists trainingpeaks_actions_execution_claim_idx
  on public.trainingpeaks_actions (status, execution_status, approved_at, created_at);

alter table public.trainingpeaks_actions
  drop constraint if exists trainingpeaks_actions_last_run_id_fkey;

alter table public.trainingpeaks_actions
  add constraint trainingpeaks_actions_last_run_id_fkey
  foreign key (last_run_id)
  references public.trainingpeaks_action_runs(id)
  on delete set null;

revoke all on table public.trainingpeaks_action_runs from anon, authenticated, public;
grant select, insert, update on table public.trainingpeaks_action_runs to service_role;

alter table public.trainingpeaks_action_runs enable row level security;
