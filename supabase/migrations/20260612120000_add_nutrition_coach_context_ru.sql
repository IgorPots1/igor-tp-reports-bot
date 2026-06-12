alter table public.nutrition_student_profiles
  add column if not exists coach_context_ru text;

comment on column public.nutrition_student_profiles.coach_context_ru is
  'Coach-only short context for nutrition review interpretation (1-3 sentences, not athlete-facing).';
