create table if not exists public.workout_template_guardrails (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null unique check (rule_code <> ''),
  severity text not null check (severity in ('hard_block', 'soft_warning', 'coach_review')),
  applies_to_family_codes text[] not null default '{}'::text[],
  applies_to_variant_codes text[] not null default '{}'::text[],
  applies_to_preset_codes text[] not null default '{}'::text[],
  applies_to_intensity_intents text[] not null default '{}'::text[],
  condition_jsonb jsonb not null default '{}'::jsonb,
  message_ru text not null,
  is_code_constant boolean not null default false,
  is_enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coach_review_rules (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null unique check (rule_code <> ''),
  trigger_type text not null check (trigger_type in ('percentage_increase', 'absolute_increase', 'flag_present', 'always')),
  threshold_value numeric,
  applies_to_context_flags text[] not null default '{}'::text[],
  applies_to_family_codes text[] not null default '{}'::text[],
  applies_to_variant_codes text[] not null default '{}'::text[],
  applies_to_preset_codes text[] not null default '{}'::text[],
  applies_to_intensity_intents text[] not null default '{}'::text[],
  condition_jsonb jsonb not null default '{}'::jsonb,
  message_ru text not null,
  is_code_constant boolean not null default false,
  is_enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.workout_template_guardrails is
  'Guardrails for Coach OS workout template selection and later plan generation. Does not create TrainingPeaks workouts.';

comment on table public.coach_review_rules is
  'Coach-review trigger rules for baseline deviations and high-risk contexts in Coach OS.';

create index if not exists workout_template_guardrails_enabled_sort_idx
  on public.workout_template_guardrails (is_enabled, sort_order, rule_code);

create index if not exists workout_template_guardrails_severity_idx
  on public.workout_template_guardrails (severity);

create index if not exists coach_review_rules_enabled_sort_idx
  on public.coach_review_rules (is_enabled, sort_order, rule_code);

create index if not exists coach_review_rules_trigger_type_idx
  on public.coach_review_rules (trigger_type);

create or replace function public.set_workout_template_guardrails_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_workout_template_guardrails_updated_at on public.workout_template_guardrails;
create trigger set_workout_template_guardrails_updated_at
before update on public.workout_template_guardrails
for each row
execute function public.set_workout_template_guardrails_updated_at();

drop trigger if exists set_coach_review_rules_updated_at on public.coach_review_rules;
create trigger set_coach_review_rules_updated_at
before update on public.coach_review_rules
for each row
execute function public.set_workout_template_guardrails_updated_at();

revoke all on table public.workout_template_guardrails from anon, authenticated, public;
revoke all on table public.coach_review_rules from anon, authenticated, public;

grant select, insert, update, delete on table public.workout_template_guardrails to service_role;
grant select, insert, update, delete on table public.coach_review_rules to service_role;

alter table public.workout_template_guardrails enable row level security;
alter table public.coach_review_rules enable row level security;
