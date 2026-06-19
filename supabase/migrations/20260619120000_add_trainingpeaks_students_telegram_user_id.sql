alter table trainingpeaks_students
  add column if not exists telegram_user_id bigint;

create index if not exists idx_trainingpeaks_students_telegram_user_id
  on trainingpeaks_students(telegram_user_id);
