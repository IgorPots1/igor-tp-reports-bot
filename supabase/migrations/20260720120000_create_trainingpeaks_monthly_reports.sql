-- Monthly student reports. Mirrors trainingpeaks_weekly_reports
-- (20260505170500) but keyed on a calendar month range (month_from..month_to)
-- instead of a week. One draft row per student per month; review_status gates
-- coach approval before anything is shown to the student in the Mini App.
create table if not exists public.trainingpeaks_monthly_reports (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,
  student_name text not null,
  month_from date not null,
  month_to date not null,
  status text not null,
  report_markdown text,
  summary_json jsonb,
  coach_notes_json jsonb,
  warnings jsonb,
  synced_at timestamptz not null default now(),
  review_status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, month_from, month_to)
);

create index if not exists trainingpeaks_monthly_reports_student_month_idx
  on public.trainingpeaks_monthly_reports (student_id, month_from desc, month_to desc);

create index if not exists trainingpeaks_monthly_reports_status_idx
  on public.trainingpeaks_monthly_reports (status);

create index if not exists trainingpeaks_monthly_reports_review_status_idx
  on public.trainingpeaks_monthly_reports (review_status);

create or replace function public.set_trainingpeaks_monthly_reports_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_trainingpeaks_monthly_reports_updated_at on public.trainingpeaks_monthly_reports;

create trigger set_trainingpeaks_monthly_reports_updated_at
before update on public.trainingpeaks_monthly_reports
for each row
execute function public.set_trainingpeaks_monthly_reports_updated_at();

revoke all on table public.trainingpeaks_monthly_reports from anon, authenticated, public;
grant select, insert, update on table public.trainingpeaks_monthly_reports to service_role;

alter table public.trainingpeaks_monthly_reports enable row level security;
