-- Анкета, часть которой заполняет ТРЕНЕР, а не ученик.
--
-- ЗАЧЕМ. Ближайшие ученики — выпускники интенсива: тренер видел их тренировки
-- и знает ответ лучше, чем они сами. Спрашивать человека о том, что уже знаешь,
-- — плохой онбординг: вопрос выглядит как проверка, ответ выходит хуже твоего
-- знания, и на нём потом строится план.
--
-- Предзаданное поле ученица НЕ ВИДИТ ВООБЩЕ. Не «заполнено, можно поменять» —
-- его в форме нет. Это разница между «тренер уже решил» и «тренер предложил,
-- а ты подтверди»: второе снова просит человека отвечать на то, что решено.
--
-- Всё аддитивное: create table, add column с дефолтом, index, comment, grant.

create table if not exists public.intervals_onboarding_prefill (
  source_id uuid primary key
    references public.student_data_sources(id) on delete cascade,

  -- НАБОР ЗАДАННЫХ ПОЛЕЙ — единственный источник правды о том, что тренер
  -- зафиксировал. Значения лежат в типизированных колонках ниже, но «задано ли
  -- поле» по ним определить НЕЛЬЗЯ: у половины из них NULL — законное значение
  -- ответа. «День длительной не важен» и «день длительной не задавали» — это
  -- разные вещи, и оба в колонке выглядят как NULL.
  set_fields text[] not null default '{}',

  goal_kind text check (goal_kind is null or goal_kind in ('race', 'regular', 'start_running')),
  race_date date,
  race_distance_km numeric,
  days_per_week integer check (days_per_week is null or days_per_week between 2 and 7),
  self_reported_weekly_minutes integer
    check (self_reported_weekly_minutes is null or self_reported_weekly_minutes between 0 and 1200),
  unavailable_weekdays smallint[],
  preferred_long_weekday smallint check (preferred_long_weekday is null or preferred_long_weekday between 0 and 6),
  can_run_continuously boolean,

  -- ПОЧЕМУ тренер так решил. Для корпуса это ценнее самого значения: «бегает
  -- непрерывно, видел на интенсиве» — это основание, а true — только вывод.
  note text,

  set_by text not null default 'coach',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Потолок методики новичка стережём и здесь, на входе тренера. Иначе ошибка
  -- всплыла бы у ученицы: она отправила бы форму и получила отказ за решение,
  -- которого не принимала.
  constraint intervals_onboarding_prefill_beginner_days_cap
    check (goal_kind is distinct from 'start_running' or days_per_week is null or days_per_week <= 3)
);

comment on table public.intervals_onboarding_prefill is
  'Ответы анкеты, заданные ТРЕНЕРОМ заранее. Эти поля ученик в форме не видит вообще. set_fields — что именно задано: по значениям это не определить, у половины полей NULL сам по себе осмысленный ответ.';
comment on column public.intervals_onboarding_prefill.set_fields is
  'Имена полей анкеты, которые задал тренер. Единственный признак «задано»: NULL в колонке значения может означать и законный ответ («день длительной не важен»), и отсутствие ответа.';

alter table public.intervals_onboarding_prefill enable row level security;
grant all on public.intervals_onboarding_prefill to service_role;

drop trigger if exists set_intervals_onboarding_prefill_updated_at
  on public.intervals_onboarding_prefill;
create trigger set_intervals_onboarding_prefill_updated_at
  before update on public.intervals_onboarding_prefill
  for each row execute function public.set_intervals_ingest_updated_at();

-- ── Происхождение ответов ────────────────────────────────────────────────────
--
-- СНИМОК, А НЕ ССЫЛКА. Список копируется в анкету в момент её отправки и дальше
-- не меняется, даже если тренер потом поправит предзаполнение. Для корпуса
-- важно, кто отвечал ТОГДА: «ученица сказала, что бегает непрерывно» и «тренер
-- знал, что она бегает непрерывно» — разные данные, и пара «контекст → ответ»
-- на них строится по-разному.
alter table public.intervals_onboarding_answers
  add column if not exists coach_set_fields text[] not null default '{}';

comment on column public.intervals_onboarding_answers.coach_set_fields is
  'Поля, которые задал тренер, а не ученик — снимок на момент отправки анкеты. Остальные поля ученик заполнил сам. Для корпуса это разные данные.';
