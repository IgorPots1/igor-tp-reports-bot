create table if not exists public.trainingpeaks_students (
  id uuid primary key default gen_random_uuid(),
  student_id text not null unique,
  student_name text not null,
  trainingpeaks_athlete_url text not null unique,
  is_active boolean not null default true,
  weekly_report_enabled boolean not null default true,
  data_quality_status text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_trainingpeaks_students_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_trainingpeaks_students_updated_at on public.trainingpeaks_students;

create trigger set_trainingpeaks_students_updated_at
before update on public.trainingpeaks_students
for each row
execute function public.set_trainingpeaks_students_updated_at();

grant select, insert, update on table public.trainingpeaks_students to service_role;

alter table public.trainingpeaks_students enable row level security;
