-- Часть Ю (Юлия Крылова): a per-student flag (not a hardcoded surname) telling the
-- nutrition pipeline to fully ignore TrainingPeaks activities classified "Other"
-- (her 2-hour strength sessions are mislabeled "Other" and must not affect fuel/
-- expenditure or the review text). Mirrors own_regime. Layer: data input only —
-- the EA floor and lose methodology are untouched; this just drops noise sessions.
alter table public.nutrition_student_profiles
  add column if not exists exclude_other_activities boolean not null default false;
