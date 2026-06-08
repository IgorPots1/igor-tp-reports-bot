create table if not exists public.nutrition_student_profiles (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references public.trainingpeaks_students(id) on delete cascade,
  enabled boolean not null default false,
  goal text,
  tracking_app text,
  current_weight_kg numeric,
  preferences jsonb not null default '{}'::jsonb,
  dislikes jsonb not null default '{}'::jsonb,
  tolerance_notes text,
  coach_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.nutrition_weight_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  weight_kg numeric not null,
  logged_at timestamptz not null default now(),
  source text not null check (
    source in ('manual', 'telegram_candidate', 'athlete_report', 'coach_manual', 'telegram', 'report')
  ),
  confirmed_by_coach boolean not null default true,
  raw_text text,
  created_at timestamptz not null default now()
);

create table if not exists public.nutrition_context_items (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  item_type text not null check (
    item_type in (
      'preference',
      'dislike',
      'tolerance',
      'energy',
      'hunger',
      'gi',
      'training_food_experience',
      'note'
    )
  ),
  text text not null,
  source text not null check (
    source in ('telegram', 'coach_manual', 'report', 'manual_text', 'athlete_report')
  ),
  confidence numeric,
  priority int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.nutrition_reports (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  week_from date not null,
  week_to date not null,
  source_type text not null check (source_type in ('manual_text', 'screenshot', 'pdf', 'csv', 'mixed')),
  raw_text text,
  file_refs jsonb,
  status text not null check (
    status in ('received', 'parsed', 'insufficient', 'needs_review', 'ready_for_analysis')
  ),
  data_quality jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.nutrition_daily_macros (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.nutrition_reports(id) on delete cascade,
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  day date not null,
  kcal numeric,
  protein_g numeric,
  fat_g numeric,
  carbs_g numeric,
  confidence numeric,
  source text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.nutrition_weekly_analyses (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  report_id uuid references public.nutrition_reports(id) on delete set null,
  week_from date not null,
  week_to date not null,
  status text not null check (
    status in ('draft_generated', 'blocked_safety', 'needs_review', 'approved_for_copy', 'archived')
  ),
  internal_summary jsonb not null default '{}'::jsonb,
  tp_past_week_context jsonb not null default '{}'::jsonb,
  tp_next_week_context jsonb not null default '{}'::jsonb,
  nutrition_summary jsonb not null default '{}'::jsonb,
  safety_flags jsonb not null default '{}'::jsonb,
  context_snapshot jsonb not null default '{}'::jsonb,
  prompt_hash text,
  context_hash text,
  ai_model text,
  athlete_message_draft text,
  coach_edits text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists nutrition_student_profiles_student_id_uidx
  on public.nutrition_student_profiles (student_id);
create index if not exists nutrition_reports_student_created_at_desc_idx
  on public.nutrition_reports (student_id, created_at desc);
create index if not exists nutrition_reports_status_created_at_desc_idx
  on public.nutrition_reports (status, created_at desc);
create index if not exists nutrition_weekly_analyses_student_week_idx
  on public.nutrition_weekly_analyses (student_id, week_from desc, week_to desc);
create unique index if not exists nutrition_weekly_analyses_student_week_uidx
  on public.nutrition_weekly_analyses (student_id, week_from, week_to);
create index if not exists nutrition_weekly_analyses_status_week_from_desc_idx
  on public.nutrition_weekly_analyses (status, week_from desc);
create index if not exists nutrition_context_items_student_active_priority_created_idx
  on public.nutrition_context_items (student_id, is_active, priority desc, created_at desc);
create index if not exists nutrition_weight_logs_student_logged_at_desc_idx
  on public.nutrition_weight_logs (student_id, logged_at desc);
create index if not exists nutrition_daily_macros_student_day_idx
  on public.nutrition_daily_macros (student_id, day);
create index if not exists nutrition_daily_macros_report_day_idx
  on public.nutrition_daily_macros (report_id, day);
create unique index if not exists nutrition_daily_macros_report_day_uidx
  on public.nutrition_daily_macros (report_id, day)
  where report_id is not null;

create or replace function public.set_nutrition_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_nutrition_student_profiles_updated_at on public.nutrition_student_profiles;
create trigger set_nutrition_student_profiles_updated_at
before update on public.nutrition_student_profiles
for each row
execute function public.set_nutrition_updated_at();

drop trigger if exists set_nutrition_context_items_updated_at on public.nutrition_context_items;
create trigger set_nutrition_context_items_updated_at
before update on public.nutrition_context_items
for each row
execute function public.set_nutrition_updated_at();

drop trigger if exists set_nutrition_reports_updated_at on public.nutrition_reports;
create trigger set_nutrition_reports_updated_at
before update on public.nutrition_reports
for each row
execute function public.set_nutrition_updated_at();

drop trigger if exists set_nutrition_weekly_analyses_updated_at on public.nutrition_weekly_analyses;
create trigger set_nutrition_weekly_analyses_updated_at
before update on public.nutrition_weekly_analyses
for each row
execute function public.set_nutrition_updated_at();

revoke all on table public.nutrition_student_profiles from anon, authenticated, public;
grant select, insert, update, delete on table public.nutrition_student_profiles to service_role;
alter table public.nutrition_student_profiles enable row level security;

revoke all on table public.nutrition_weight_logs from anon, authenticated, public;
grant select, insert, update, delete on table public.nutrition_weight_logs to service_role;
alter table public.nutrition_weight_logs enable row level security;

revoke all on table public.nutrition_context_items from anon, authenticated, public;
grant select, insert, update, delete on table public.nutrition_context_items to service_role;
alter table public.nutrition_context_items enable row level security;

revoke all on table public.nutrition_reports from anon, authenticated, public;
grant select, insert, update, delete on table public.nutrition_reports to service_role;
alter table public.nutrition_reports enable row level security;

revoke all on table public.nutrition_daily_macros from anon, authenticated, public;
grant select, insert, update, delete on table public.nutrition_daily_macros to service_role;
alter table public.nutrition_daily_macros enable row level security;

revoke all on table public.nutrition_weekly_analyses from anon, authenticated, public;
grant select, insert, update, delete on table public.nutrition_weekly_analyses to service_role;
alter table public.nutrition_weekly_analyses enable row level security;
