-- Наряд 2 (свой режим): a per-student flag replacing the hardcoded surname check
-- for "this athlete is on her own eating regime — do not evaluate calories/fat as
-- a problem". Layer A only (tone/feedback); no calorie-norm number override yet.
alter table public.nutrition_student_profiles
  add column if not exists own_regime boolean not null default false;
