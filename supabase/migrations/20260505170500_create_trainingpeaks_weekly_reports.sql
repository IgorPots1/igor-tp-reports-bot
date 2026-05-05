create table if not exists public.trainingpeaks_weekly_reports (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,
  student_name text not null,
  week_from date not null,
  week_to date not null,
  status text not null,
  report_markdown text,
  summary_json jsonb,
  warnings jsonb,
  synced_at timestamptz not null default now(),
  review_status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, week_from, week_to)
);

create index if not exists trainingpeaks_weekly_reports_student_week_idx
  on public.trainingpeaks_weekly_reports (student_id, week_from desc, week_to desc);

create index if not exists trainingpeaks_weekly_reports_status_idx
  on public.trainingpeaks_weekly_reports (status);

create or replace function public.set_trainingpeaks_weekly_reports_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_trainingpeaks_weekly_reports_updated_at on public.trainingpeaks_weekly_reports;

create trigger set_trainingpeaks_weekly_reports_updated_at
before update on public.trainingpeaks_weekly_reports
for each row
execute function public.set_trainingpeaks_weekly_reports_updated_at();

grant select, insert, update on table public.trainingpeaks_weekly_reports to service_role;

alter table public.trainingpeaks_weekly_reports enable row level security;
