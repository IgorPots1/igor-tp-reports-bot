-- Nutrition Task 10: student goal drives the methodology (deficit / maintenance /
-- surplus), not just prompt tone. Default 'maintain' = current behavior, so
-- existing students are unchanged until a coach sets a goal.
alter table public.nutrition_student_profiles
  add column if not exists nutrition_goal_type text not null default 'maintain';

-- Optional target weight, used only for tone ("до цели ещё N кг") when goal is
-- 'lose' — it does NOT change the (moderate) deficit math.
alter table public.nutrition_student_profiles
  add column if not exists target_weight_kg numeric;

do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'nutrition_student_profiles' and constraint_name = 'nutrition_student_profiles_goal_type_check'
  ) then
    alter table public.nutrition_student_profiles
      add constraint nutrition_student_profiles_goal_type_check
      check (nutrition_goal_type in ('lose', 'maintain', 'gain'));
  end if;
end $$;

comment on column public.nutrition_student_profiles.nutrition_goal_type is
  'Student nutrition goal: lose | maintain | gain. Drives target/plan math (moderate deficit / current behavior / small surplus). Never bypasses safety.';
comment on column public.nutrition_student_profiles.target_weight_kg is
  'Optional target weight for goal=lose. Tone only ("до цели N кг"); does not change the deficit size.';
