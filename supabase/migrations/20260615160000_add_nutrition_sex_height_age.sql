-- Task 10++: optional anthropometrics on the nutrition card for BMR (Mifflin)
-- and FFM/energy-availability. All nullable — reviews still generate when unset
-- (BMR falls back to a Cunningham/FFM estimate). Used ONLY for goal=lose|gain
-- (the corrected maintenance anchor); maintain behaviour is unchanged.
alter table nutrition_student_profiles
  add column if not exists sex text
    check (sex is null or sex in ('female', 'male'));

alter table nutrition_student_profiles
  add column if not exists height_cm numeric;

alter table nutrition_student_profiles
  add column if not exists age_years integer;
