create table if not exists public.workout_template_families (
  id uuid primary key default gen_random_uuid(),
  family_code text not null unique check (
    family_code in (
      'beginner_run_walk',
      'easy',
      'long_run',
      'steady_tempo',
      'intervals',
      'race_specific',
      'pre_race',
      'race_week',
      'optional_development'
    )
  ),
  structure_type text not null check (
    structure_type in ('continuous', 'intervals', 'long', 'activation', 'mixed', 'free')
  ),
  display_name_ru text not null,
  is_enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workout_template_variants (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.workout_template_families(id) on delete cascade,
  variant_code text not null,
  intensity_intent text not null check (
    intensity_intent in (
      'easy',
      'steady',
      'controlled_threshold',
      'threshold',
      'vo2',
      'race_pace',
      'marathon_pace',
      'hm_pace',
      'ten_k_pace'
    )
  ),
  display_name_ru text not null,
  is_coach_only boolean not null default false,
  is_enabled boolean not null default true,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, variant_code)
);

create table if not exists public.workout_template_warmup_refs (
  id uuid primary key default gen_random_uuid(),
  ref_code text not null unique,
  display_name_ru text not null,
  duration_min_approx integer,
  description_ru text,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workout_template_cooldown_refs (
  id uuid primary key default gen_random_uuid(),
  ref_code text not null unique,
  display_name_ru text not null,
  duration_min_approx integer,
  description_ru text,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workout_template_description_refs (
  id uuid primary key default gen_random_uuid(),
  ref_code text not null unique,
  display_name_ru text not null,
  description_text_ru text,
  supports_communication_style boolean not null default true,
  is_draft boolean not null default true,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workout_template_presets (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.workout_template_variants(id) on delete cascade,
  preset_code text not null unique,
  source text not null check (source in ('observed', 'manual', 'science', 'baseline')),
  tier text not null check (tier in ('core', 'advanced', 'extended', 'expansion')),
  enabled_by_default boolean not null default true,
  coach_only boolean not null default false,
  coach_review_required boolean not null default true,
  requires_explicit_vo2_intensity boolean not null default false,
  athlete_level_min text check (athlete_level_min in ('L0', 'L1', 'L2', 'L3', 'L4', 'L4M')),
  display_name_ru text not null,
  observed_count integer not null default 0 check (observed_count >= 0),
  athlete_count integer not null default 0 check (athlete_count >= 0),
  warmup_ref_id uuid references public.workout_template_warmup_refs(id),
  cooldown_ref_id uuid references public.workout_template_cooldown_refs(id),
  description_template_ref_id uuid references public.workout_template_description_refs(id),
  is_enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workout_template_preset_parameters (
  id uuid primary key default gen_random_uuid(),
  preset_id uuid not null unique references public.workout_template_presets(id) on delete cascade,
  reps integer check (reps is null or reps > 0),
  work_duration_min numeric check (work_duration_min is null or work_duration_min > 0),
  work_duration_sec numeric check (work_duration_sec is null or work_duration_sec > 0),
  work_distance_km numeric check (work_distance_km is null or work_distance_km > 0),
  work_unit text check (work_unit is null or work_unit in ('min', 'sec', 'km')),
  distance_unit text check (distance_unit is null or distance_unit in ('km', 'm')),
  recovery_duration_min numeric check (recovery_duration_min is null or recovery_duration_min > 0),
  recovery_duration_sec numeric check (recovery_duration_sec is null or recovery_duration_sec > 0),
  recovery_unit text check (recovery_unit is null or recovery_unit in ('min', 'sec')),
  recovery_type text check (recovery_type is null or recovery_type in ('easy_jog', 'walk', 'rest', 'active_rest')),
  total_quality_volume_min numeric,
  rpe_target numeric check (rpe_target is null or (rpe_target >= 1 and rpe_target <= 10)),
  rpe_cap numeric check (rpe_cap is null or (rpe_cap >= 1 and rpe_cap <= 10)),
  reps_in_reserve text,
  avoid_acidosis boolean,
  target_mode text not null default 'rpe' check (target_mode in ('pace', 'rpe', 'hr_chest_only')),
  pace_hr_hint_mode text check (pace_hr_hint_mode is null or pace_hr_hint_mode in ('none', 'advisory_wide_band_only', 'required')),
  nutrition_required boolean not null default false,
  fueling_strategy text check (fueling_strategy is null or fueling_strategy in ('beginner', 'standard', 'advanced', 'race_rehearsal')),
  run_duration_min numeric,
  walk_duration_min numeric,
  extra_params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (rpe_cap is null or rpe_target is null or rpe_cap >= rpe_target)
);

comment on table public.workout_template_families is
  'Coach OS workout template families. Source of truth for the compact catalog taxonomy, intentionally smaller than methodology-family source documents.';

comment on table public.workout_template_variants is
  'Coach OS workout template variants grouped under the compact DB families, including coach-only intensity intents.';

comment on table public.workout_template_presets is
  'Catalog presets for Coach OS workout templates. No TrainingPeaks generation or athlete-specific baseline logic is stored here.';

comment on table public.workout_template_preset_parameters is
  'Parameter payload for a single workout template preset. Supports duration-based and distance-based interval definitions.';

create index if not exists workout_template_variants_family_sort_idx
  on public.workout_template_variants (family_id, sort_order, variant_code);

create index if not exists workout_template_presets_variant_sort_idx
  on public.workout_template_presets (variant_id, sort_order, preset_code);

create index if not exists workout_template_presets_enabled_review_idx
  on public.workout_template_presets (is_enabled, enabled_by_default, coach_review_required);

create index if not exists workout_template_preset_parameters_target_mode_idx
  on public.workout_template_preset_parameters (target_mode);

create or replace function public.set_workout_template_catalog_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_workout_template_families_updated_at on public.workout_template_families;
create trigger set_workout_template_families_updated_at
before update on public.workout_template_families
for each row
execute function public.set_workout_template_catalog_updated_at();

drop trigger if exists set_workout_template_variants_updated_at on public.workout_template_variants;
create trigger set_workout_template_variants_updated_at
before update on public.workout_template_variants
for each row
execute function public.set_workout_template_catalog_updated_at();

drop trigger if exists set_workout_template_warmup_refs_updated_at on public.workout_template_warmup_refs;
create trigger set_workout_template_warmup_refs_updated_at
before update on public.workout_template_warmup_refs
for each row
execute function public.set_workout_template_catalog_updated_at();

drop trigger if exists set_workout_template_cooldown_refs_updated_at on public.workout_template_cooldown_refs;
create trigger set_workout_template_cooldown_refs_updated_at
before update on public.workout_template_cooldown_refs
for each row
execute function public.set_workout_template_catalog_updated_at();

drop trigger if exists set_workout_template_description_refs_updated_at on public.workout_template_description_refs;
create trigger set_workout_template_description_refs_updated_at
before update on public.workout_template_description_refs
for each row
execute function public.set_workout_template_catalog_updated_at();

drop trigger if exists set_workout_template_presets_updated_at on public.workout_template_presets;
create trigger set_workout_template_presets_updated_at
before update on public.workout_template_presets
for each row
execute function public.set_workout_template_catalog_updated_at();

drop trigger if exists set_workout_template_preset_parameters_updated_at on public.workout_template_preset_parameters;
create trigger set_workout_template_preset_parameters_updated_at
before update on public.workout_template_preset_parameters
for each row
execute function public.set_workout_template_catalog_updated_at();

revoke all on table public.workout_template_families from anon, authenticated, public;
revoke all on table public.workout_template_variants from anon, authenticated, public;
revoke all on table public.workout_template_warmup_refs from anon, authenticated, public;
revoke all on table public.workout_template_cooldown_refs from anon, authenticated, public;
revoke all on table public.workout_template_description_refs from anon, authenticated, public;
revoke all on table public.workout_template_presets from anon, authenticated, public;
revoke all on table public.workout_template_preset_parameters from anon, authenticated, public;

grant select, insert, update, delete on table public.workout_template_families to service_role;
grant select, insert, update, delete on table public.workout_template_variants to service_role;
grant select, insert, update, delete on table public.workout_template_warmup_refs to service_role;
grant select, insert, update, delete on table public.workout_template_cooldown_refs to service_role;
grant select, insert, update, delete on table public.workout_template_description_refs to service_role;
grant select, insert, update, delete on table public.workout_template_presets to service_role;
grant select, insert, update, delete on table public.workout_template_preset_parameters to service_role;

alter table public.workout_template_families enable row level security;
alter table public.workout_template_variants enable row level security;
alter table public.workout_template_warmup_refs enable row level security;
alter table public.workout_template_cooldown_refs enable row level security;
alter table public.workout_template_description_refs enable row level security;
alter table public.workout_template_presets enable row level security;
alter table public.workout_template_preset_parameters enable row level security;
