-- Nutrition Tasks 8 + 7: coach notes at upload + per-student review memory.
--
-- Task 8: one-time coach note attached to a specific weekly report (separate from
-- the athlete's diary text in raw_text). Feeds only that week's review.
alter table public.nutrition_reports
  add column if not exists coach_notes_ru text;

comment on column public.nutrition_reports.coach_notes_ru is
  'Coach note for THIS report only (clarifications, day context, "intervals fasted in the morning"). Coach-only, influences review tone/accents, not numbers.';

-- Tasks 8 + 7: compact per-student nutrition review memory. Holds persistent coach
-- notes (Task 8 "remember" checkbox) and, later, coach-approved repeating patterns,
-- last focus and a few numeric trends (Task 7). Fed compactly into every review.
-- Shape: { approved_patterns: [{text, since_week}], persistent_notes: [text],
--          last_focus: text|null, key_trends: [text] }
alter table public.nutrition_student_profiles
  add column if not exists nutrition_memory jsonb not null default '{}'::jsonb;

comment on column public.nutrition_student_profiles.nutrition_memory is
  'Compact per-student nutrition review memory: approved_patterns, persistent_notes, last_focus, key_trends. Coach-curated (draft->approve), fed compactly into reviews.';
