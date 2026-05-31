-- Dependencies:
-- - public.trainingpeaks_students
-- - public.trainingpeaks_telegram_context_observations

create table if not exists public.trainingpeaks_student_memory_items (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  memory_type text not null,
  summary_text text not null,
  structured jsonb not null default '{}'::jsonb,
  source text not null default 'ai_extraction',
  confidence real,
  valid_from date,
  valid_until date,
  is_active boolean not null default true,
  superseded_by uuid references public.trainingpeaks_student_memory_items(id),
  source_observation_id uuid references public.trainingpeaks_telegram_context_observations(id),
  source_message_preview text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trainingpeaks_student_memory_items_memory_type_check check (
    memory_type in (
      'communication_style',
      'schedule_constraint',
      'availability_preference',
      'pain_or_injury',
      'health_status',
      'emotional_state',
      'load_tolerance',
      'planning_preference',
      'race_or_goal',
      'travel_or_life_event',
      'equipment_or_device_note'
    )
  ),
  constraint trainingpeaks_student_memory_items_source_check check (
    source in (
      'ai_extraction',
      'coach_manual',
      'system',
      'observation_import',
      'telegram_command'
    )
  ),
  constraint trainingpeaks_student_memory_items_confidence_check check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  ),
  constraint trainingpeaks_student_memory_items_source_message_preview_length_check check (
    source_message_preview is null or char_length(source_message_preview) <= 160
  )
);

comment on table public.trainingpeaks_student_memory_items is
  'Durable distilled coaching memory items per student. Unlike trainingpeaks_telegram_context_observations (raw event stream), this table stores stable coach-relevant facts.';

comment on column public.trainingpeaks_student_memory_items.structured is
  'Structured payload for durable memory attributes. For communication_style, may include formality/tone/emoji/punctuation plus preferred_greeting and greeting confidence stats.';

create index if not exists trainingpeaks_student_memory_items_student_active_idx
  on public.trainingpeaks_student_memory_items (student_id, is_active);

create index if not exists trainingpeaks_student_memory_items_memory_type_idx
  on public.trainingpeaks_student_memory_items (memory_type);

create index if not exists trainingpeaks_student_memory_items_active_valid_until_idx
  on public.trainingpeaks_student_memory_items (valid_until)
  where is_active = true and valid_until is not null;

create index if not exists trainingpeaks_student_memory_items_source_observation_id_idx
  on public.trainingpeaks_student_memory_items (source_observation_id)
  where source_observation_id is not null;

revoke all on table public.trainingpeaks_student_memory_items from anon, authenticated, public;
grant select, insert, update, delete on table public.trainingpeaks_student_memory_items to service_role;

alter table public.trainingpeaks_student_memory_items enable row level security;
