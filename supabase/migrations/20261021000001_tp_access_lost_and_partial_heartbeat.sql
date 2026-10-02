-- Наряд 2026-10-02 «статусы выполнил / не выполнил в /m/desk». Только аддитивное.
--
-- 1. Статус 'partial' в trainingpeaks_cron_run_logs.
--    Скан кэша писал heartbeat 'sent', даже когда у 12 учеников из 133 прогон падал с 403 —
--    exit 0 у --all-active. Писать 'failed' тоже нельзя: 403 есть в КАЖДОМ прогоне, и монитор
--    (смотрит последний 'sent') тревожил бы без конца. 'partial' = прогон дошёл до конца, но
--    часть учеников упала; разбивка 403 / fetch failed — в counts, не вперемешку.
--    Расширение check-констрейнта: все прежние значения остаются допустимыми.
alter table public.trainingpeaks_cron_run_logs
  drop constraint if exists trainingpeaks_cron_run_logs_status_check;
alter table public.trainingpeaks_cron_run_logs
  add constraint trainingpeaks_cron_run_logs_status_check
  check (status = any (array['started', 'sent', 'partial', 'failed', 'unauthorized', 'skipped']));

-- 2. Дедуп уведомления «нет доступа к TP».
--    Одна строка на ученика = текущий эпизод 403. Уведомление уходит один раз на эпизод
--    (notified_at), не на каждый прогон скана. Ok-скан закрывает эпизод (restored_at);
--    следующий 403 открывает новый — и снова одно уведомление.
create table if not exists public.trainingpeaks_tp_access_lost_notices (
  student_id uuid primary key references public.trainingpeaks_students(id) on delete cascade,
  student_name text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  notified_at timestamptz,
  restored_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.trainingpeaks_tp_access_lost_notices is
  'Эпизоды 403 при скане кэша TP по ученику. Пишет tp-workouts-cache-scan.ts. notified_at — '
  'уведомление тренеру отправлено (один раз на эпизод), restored_at — доступ вернулся (ok-скан).';

alter table public.trainingpeaks_tp_access_lost_notices enable row level security;

grant select, insert, update on public.trainingpeaks_tp_access_lost_notices to service_role;
-- Как у соседних trainingpeaks_*: anon/authenticated не получают ничего (default privileges
-- иначе выдают им REFERENCES/TRIGGER/TRUNCATE).
revoke all on public.trainingpeaks_tp_access_lost_notices from anon, authenticated;
