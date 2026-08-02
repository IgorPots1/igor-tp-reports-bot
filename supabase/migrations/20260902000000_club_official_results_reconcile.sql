-- Reconcile public.club_official_results with its intended schema (see 20260825000000).
--
-- WHY: prod применил club_official_results из БОЛЕЕ РАННЕГО черновика — без колонок
-- event / distance_doubtful / updated_at и без unique(student_id, race_date, protocol_url).
-- `create table if not exists` не досыпает колонки в уже существующую таблицу, поэтому файл
-- 20260825 «ушёл вперёд» БД. Из-за этого probeg-писатель (--write --commit) падал на КАЖДОЙ
-- из 94 строк журнала: «Could not find the 'distance_doubtful' column ... in the schema cache»
-- (проверено фактом: 0 записано, 94 ошибки; прямой select колонок → 42703; sentinel-upsert → 42P10).
--
-- Правка ТОЛЬКО additive и идемпотентная: колонки через add column if not exists, индекс через
-- create unique index if not exists. На свежей БД (где 20260825 создаёт таблицу целиком) всё это —
-- no-op (кроме, возможно, одноимённого лишнего unique-индекса, что безвредно на таблице в 0–100 строк).

alter table public.club_official_results
  add column if not exists event text,
  add column if not exists distance_doubtful boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

-- Писатель делает upsert с ON CONFLICT (student_id, race_date, protocol_url); гарантируем
-- совпадающий unique-индекс (в применённом черновике его не было → ошибка 42P10).
create unique index if not exists club_official_results_student_date_url_key
  on public.club_official_results (student_id, race_date, protocol_url);

-- Показать новые колонки PostgREST немедленно (без ожидания авто-перезагрузки схемы).
notify pgrst, 'reload schema';
