create table if not exists public.nutrition_weekly_plans (
  id uuid primary key default gen_random_uuid(),

  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  source_report_id uuid references public.nutrition_reports(id) on delete set null,
  source_analysis_id uuid references public.nutrition_weekly_analyses(id) on delete set null,

  plan_week_from date not null,
  plan_week_to date not null,

  status text not null check (
    status in (
      'draft_generated',
      'blocked_safety',
      'needs_review',
      'approved_for_copy',
      'archived',
      'superseded'
    )
  ),

  generation_mode text not null check (
    generation_mode in ('ai', 'fallback')
  ),

  prompt_version text,
  ai_model text,

  coach_summary text,
  athlete_message_draft text,
  coach_edited_draft text,
  approved_at timestamptz,

  plan_summary jsonb not null default '{}'::jsonb,
  training_context_snapshot jsonb not null default '{}'::jsonb,
  nutrition_context_snapshot jsonb not null default '{}'::jsonb,
  safety_flags jsonb not null default '{}'::jsonb,

  superseded_by_plan_id uuid references public.nutrition_weekly_plans(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists nutrition_weekly_plans_student_plan_week_idx
  on public.nutrition_weekly_plans (student_id, plan_week_from desc, plan_week_to desc);

create index if not exists nutrition_weekly_plans_source_analysis_idx
  on public.nutrition_weekly_plans (source_analysis_id, created_at desc);

create index if not exists nutrition_weekly_plans_status_plan_week_idx
  on public.nutrition_weekly_plans (status, plan_week_from desc);

create index if not exists nutrition_weekly_plans_student_created_idx
  on public.nutrition_weekly_plans (student_id, created_at desc);

drop trigger if exists set_nutrition_weekly_plans_updated_at on public.nutrition_weekly_plans;
create trigger set_nutrition_weekly_plans_updated_at
before update on public.nutrition_weekly_plans
for each row
execute function public.set_nutrition_updated_at();

revoke all on table public.nutrition_weekly_plans from anon, authenticated, public;
grant select, insert, update, delete on table public.nutrition_weekly_plans to service_role;
alter table public.nutrition_weekly_plans enable row level security;
