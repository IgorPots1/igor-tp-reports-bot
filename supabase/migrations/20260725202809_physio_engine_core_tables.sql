-- ============================================================
-- PHYSIO ENGINE: физиологический движок поверх lap-данных
-- Считает то, чего нет в TrainingPeaks: CS/D', durability,
-- готовность по HRV, нагрузку и радар алертов для тренера.
-- ============================================================

-- 1. Точки кривой максимальных усилий (mean-maximal speed curve)
create table if not exists physio_effort_points (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  student_name text,
  duration_bucket text not null,
  duration_s numeric not null,
  distance_m numeric not null,
  speed_mps numeric not null,
  avg_hr numeric,
  workout_cache_id uuid,
  trainingpeaks_workout_id bigint,
  workout_date date not null,
  lap_from int,
  lap_to int,
  window_days int not null,
  computed_at timestamptz not null default now()
);
comment on table physio_effort_points is
  'Лучшие (near-maximal) усилия атлета по бакетам длительности, собранные скользящим окном по последовательным кругам. Вход для модели критической скорости.';
create index if not exists idx_physio_effort_points_student on physio_effort_points(student_id, window_days, duration_bucket);

-- 2. Физиологический профиль атлета
create table if not exists physio_profiles (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  student_name text,
  trainingpeaks_athlete_id bigint,
  computed_at timestamptz not null default now(),
  window_days int not null,
  window_from date,
  window_to date,
  -- модель критической скорости: d = CS*t + D'
  cs_mps numeric,
  d_prime_m numeric,
  cs_pace_sec_per_km numeric,
  model_r2 numeric,
  n_points int,
  points jsonb,
  quality text,                 -- high | medium | low | insufficient
  quality_reasons text[],
  -- пульсовые опорные точки из TrainingPeaks
  lthr numeric,
  max_hr numeric,
  rest_hr numeric,
  tp_threshold_pace_sec_per_km numeric,
  -- производные
  vdot numeric,
  zones jsonb,                  -- темповые зоны от CS
  predictions jsonb,            -- прогноз времени по дистанциям
  durability_index numeric,     -- % падения EF за час работы
  durability_grade text,        -- strong | ok | weak | unknown
  durability_samples int,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table physio_profiles is
  'Физиологический профиль: критическая скорость (CS), анаэробный резерв D-prime, зоны от CS, durability, прогнозы результата. Одна текущая строка на атлета (is_current).';
create unique index if not exists uq_physio_profiles_current
  on physio_profiles(student_id, window_days) where is_current;
create index if not exists idx_physio_profiles_student on physio_profiles(student_id, computed_at desc);

-- 3. Durability: деградация эффективности внутри длинных тренировок
create table if not exists physio_durability_samples (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  student_name text,
  workout_cache_id uuid,
  trainingpeaks_workout_id bigint,
  workout_date date not null,
  duration_s numeric,
  distance_m numeric,
  quartile_ef numeric[],        -- EF по квартилям времени
  quartile_pace numeric[],
  quartile_hr numeric[],
  ef_decline_pct numeric,       -- (Q1 - Q4) / Q1 * 100
  decline_per_hour_pct numeric, -- нормировано на час
  hr_drift_pct numeric,
  pace_fade_pct numeric,
  pace_cv numeric,
  is_valid boolean not null default true,
  invalid_reason text,
  computed_at timestamptz not null default now()
);
comment on table physio_durability_samples is
  'Поквартильный анализ длинных аэробных пробежек: как падает efficiency factor по ходу работы. Полевой суррогат durability (Maunder 2021).';
create unique index if not exists uq_physio_durability_workout on physio_durability_samples(workout_cache_id);
create index if not exists idx_physio_durability_student on physio_durability_samples(student_id, workout_date desc);

-- 4. Ежедневная готовность (HRV / пульс покоя / сон)
create table if not exists physio_readiness_daily (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  student_name text,
  metric_date date not null,
  hrv numeric,
  ln_rmssd numeric,
  ln_rmssd_7d numeric,
  ln_rmssd_sd numeric,
  swc numeric,
  swc_low numeric,
  swc_high numeric,
  hrv_state text,               -- green | amber | red | no_data
  rhr numeric,
  rhr_baseline numeric,
  rhr_delta numeric,
  sleep_h numeric,
  sleep_baseline numeric,
  sleep_debt_3d numeric,
  body_battery numeric,
  stress_level numeric,
  readiness_score numeric,      -- 0..100
  readiness_state text,         -- green | amber | red | no_data
  drivers text[],
  computed_at timestamptz not null default now()
);
comment on table physio_readiness_daily is
  'Ежедневная готовность: ln(RMSSD) против скользящей базы +/- SWC (0.5*SD), пульс покоя, дефицит сна. Модель Plews/Altini.';
create unique index if not exists uq_physio_readiness on physio_readiness_daily(student_id, metric_date);
create index if not exists idx_physio_readiness_date on physio_readiness_daily(metric_date desc);

-- 5. Ежедневная нагрузка
create table if not exists physio_load_daily (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  student_name text,
  metric_date date not null,
  sessions int not null default 0,
  duration_s numeric not null default 0,
  distance_m numeric not null default 0,
  trimp numeric not null default 0,
  ctl numeric,
  atl numeric,
  tsb numeric,
  acwr numeric,
  acwr_uncoupled numeric,
  monotony numeric,
  strain numeric,
  computed_at timestamptz not null default now()
);
comment on table physio_load_daily is
  'Ежедневная тренировочная нагрузка: Banister TRIMP по кругам, CTL/ATL/TSB (42/7), ACWR (в т.ч. несвязанный вариант), монотонность и strain по Foster.';
create unique index if not exists uq_physio_load on physio_load_daily(student_id, metric_date);
create index if not exists idx_physio_load_date on physio_load_daily(metric_date desc);

-- 6. Радар алертов тренера
create table if not exists physio_alerts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  student_name text,
  alert_date date not null,
  code text not null,
  severity int not null default 2,   -- 1 инфо, 2 внимание, 3 срочно
  title text not null,
  detail text,
  payload jsonb,
  status text not null default 'open',  -- open | acknowledged | dismissed
  acknowledged_at timestamptz,
  acknowledged_by text,
  created_at timestamptz not null default now()
);
comment on table physio_alerts is
  'Радар внимания тренера: автоматические флаги по всем атлетам. Только сигнал для ревью, никаких автоматических действий с атлетом.';
create unique index if not exists uq_physio_alerts on physio_alerts(student_id, alert_date, code);
create index if not exists idx_physio_alerts_open on physio_alerts(alert_date desc, severity desc) where status = 'open';

-- 7. Журнал прогонов
create table if not exists physio_engine_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stage text,
  status text not null default 'running',
  stats jsonb,
  error text
);

-- RLS: закрываем всё, доступ только через service_role
do $$
declare t text;
begin
  foreach t in array array[
    'physio_effort_points','physio_profiles','physio_durability_samples',
    'physio_readiness_daily','physio_load_daily','physio_alerts','physio_engine_runs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
