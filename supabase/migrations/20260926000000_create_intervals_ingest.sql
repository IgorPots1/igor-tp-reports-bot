-- Приём тренировок из Intervals.icu: доступ ученика, активности, посекундные ряды.
--
-- НЕ ПРИМЕНЯЕТСЯ ЭТИМ НАРЯДОМ — только файл. Применяет Игорь.
--
-- Пилот на 5–7 человек. Ученик отдаёт свой личный ключ из Intervals.icu
-- (Settings → Developer Settings), авторизация — basic auth с логином-константой
-- API_KEY. Когда зарегистрируют OAuth-приложение, в ту же строку ляжет токен,
-- auth_method сменится на 'oauth' — и это ВСЁ, что должно поменяться: заголовок
-- Authorization собирает одна функция (src/features/intervals/auth.ts).

-- ── 1. Доступ к источнику данных ученика ─────────────────────────────────────
--
-- Таблица НАМЕРЕННО не названа intervals_*: сюда же придут другие провайдеры
-- (и OAuth-токены того же Intervals), а разводить по таблице на провайдера
-- значит переписывать чтение при каждом новом источнике.
--
-- credential и auth_method — РАЗНЫЕ поля, а не одно «как заходить». Слитый
-- вариант («ключ, который иногда токен») заставляет каждого читателя гадать,
-- что внутри; разделённый позволяет менять способ входа, не трогая хранение.
create table if not exists public.student_data_sources (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,

  provider text not null check (provider in ('intervals')),

  -- Идентификатор атлета у провайдера: у Intervals это строка вида «i38500»,
  -- с буквой. Хранится текстом, а не числом: ведущая «i» — часть значения,
  -- и она же уходит в путь запроса /api/v1/athlete/{id}/activities.
  external_athlete_id text not null,

  auth_method text not null check (auth_method in ('api_key', 'oauth')),

  -- СЕКРЕТ. Личный ключ ученика или OAuth-токен. Не логируется, не уходит в
  -- API-ответы, не показывается в админке. Читает только серверный код под
  -- service_role — RLS ниже закрывает таблицу для anon и authenticated целиком.
  credential text not null,

  -- Для OAuth: когда протухает access-токен. У ключей из Settings срока нет,
  -- поэтому при auth_method='api_key' поле остаётся NULL.
  credential_expires_at timestamptz,

  is_active boolean not null default true,

  -- Когда последний раз успешно забирали данные. Нужно, чтобы регулярный опрос
  -- (следующий кусок) знал, с какого места продолжать.
  last_synced_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Один аккаунт провайдера — одному ученику. Ловит опечатку в athlete_id,
  -- из-за которой чужие тренировки уехали бы в чужую карточку.
  unique (provider, external_athlete_id),
  -- И наоборот: у ученика один активный источник на провайдера.
  unique (student_id, provider)
);

comment on table public.student_data_sources is
  'Доступ ученика к внешнему источнику тренировок. Пилот: provider=intervals, auth_method=api_key (личный ключ ученика). credential — СЕКРЕТ, наружу не отдаётся никогда.';
comment on column public.student_data_sources.credential is
  'СЕКРЕТ: личный API-ключ ученика или OAuth-токен. Никогда не логировать, не включать в API-ответы, не показывать в интерфейсе.';
comment on column public.student_data_sources.auth_method is
  'api_key — basic auth с логином-константой API_KEY и этим ключом паролем; oauth — Bearer с этим токеном. Единственное место, где различие имеет значение: buildAuthorizationHeader в src/features/intervals/auth.ts.';

create index if not exists student_data_sources_student_idx
  on public.student_data_sources (student_id);

-- ── 2. Активности ────────────────────────────────────────────────────────────
--
-- Ключ идемпотентности — activity_id провайдера. Он уникален глобально, поэтому
-- ограничение стоит на самой колонке, а не на паре с источником: одна и та же
-- тренировка не может принадлежать двум ученикам, и повторный прогон бэкфилла
-- обязан обновлять строку, а не плодить вторую.
create table if not exists public.intervals_activities (
  id uuid primary key default gen_random_uuid(),

  source_id uuid not null references public.student_data_sources(id) on delete cascade,
  -- student_id продублирован намеренно: почти всякое чтение идёт «по ученику»,
  -- и без него каждый такой запрос тянул бы join ради одной колонки.
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,

  activity_id text not null unique,

  name text,
  -- Тип у провайдера как есть: 'Run', 'Ride', 'Swim', 'WeightTraining'…
  -- Не нормализуем на этом шаге: своя классификация появится там, где она
  -- реально нужна, и по живым данным, а не по догадке.
  activity_type text,

  -- Момент старта в UTC.
  start_date timestamptz,
  -- Местное время старта БЕЗ зоны: провайдер отдаёт «настенные часы» ученика,
  -- и именно они отвечают на вопрос «утренняя это была пробежка или вечерняя».
  -- Приведение к timestamptz испортило бы ответ на сервере в другой зоне.
  start_date_local timestamp,
  timezone text,

  moving_time_s integer,
  elapsed_time_s integer,
  distance_m numeric,
  total_elevation_gain_m numeric,

  average_heartrate numeric,
  max_heartrate numeric,
  average_speed_mps numeric,
  calories numeric,

  -- ── Уровень качества данных (см. src/features/intervals/data-quality.ts) ──
  -- Считается по РЯДАМ, а не по полям-средним: у активности может стоять
  -- average_heartrate от ремня, который отвалился на второй минуте. Генератору
  -- разбора важно, есть ли пульс НА ПРОТЯЖЕНИИ тренировки.
  data_level text not null default 'none'
    check (data_level in ('heartrate', 'pace_only', 'none')),
  has_heartrate boolean not null default false,
  has_pace boolean not null default false,
  -- Доля точек ряда с ненулевым пульсом, 0..100. Отвечает на вопрос «пульс был
  -- всю тренировку или только кусок» — по одному флагу этого не видно.
  hr_coverage_pct numeric,

  -- Полный ответ провайдера по активности. Лежит рядом намеренно: список полей
  -- у Intervals шире того, что разобрано в колонки, и когда генератору разбора
  -- понадобится ещё одно поле, его можно взять из уже привезённых данных, а не
  -- перекачивать историю заново.
  raw jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.intervals_activities is
  'Тренировки, привезённые из Intervals.icu. Идемпотентность по activity_id провайдера: повторный прогон обновляет строку, а не создаёт вторую.';
comment on column public.intervals_activities.data_level is
  'Что реально есть в рядах: heartrate — пульс (и темп); pace_only — только темп/скорость; none — ни того, ни другого. Считается по рядам, а не по средним полям. Генератор разбора обязан молчать об интенсивности, когда здесь не heartrate.';

create index if not exists intervals_activities_student_start_idx
  on public.intervals_activities (student_id, start_date desc);
create index if not exists intervals_activities_source_idx
  on public.intervals_activities (source_id);

-- ── 3. Посекундные ряды ──────────────────────────────────────────────────────
--
-- ОТДЕЛЬНАЯ таблица и ОДНА СТРОКА НА АКТИВНОСТЬ с рядами в jsonb. Почему так:
--
--   * Строка на точку означала бы ~3000 строк на часовую тренировку. На пилоте
--     из 7 человек с историей это миллионы строк ради данных, которые всегда
--     читаются целиком и никогда — по одной точке.
--   * Читать их построчно через PostgREST нельзя: серверный порог db-max-rows
--     равен 1000 и НЕ поднимается параметром limit — выборка молча обрежется на
--     тысячной точке, то есть на 17-й минуте бега. Каждое чтение ряда пришлось
--     бы листать пачками, и любой забывший — получит правдоподобный, но урезанный
--     ряд. Это уже случалось в проекте на других таблицах.
--   * Ряды тяжёлые (3039 точек × 3 ряда ≈ 40–60 КБ JSON), поэтому они вынесены
--     из intervals_activities: список тренировок за месяц не должен тащить
--     мегабайты. Postgres кладёт такие поля в TOAST и читает их только когда
--     колонку действительно попросили — но лишь если её не выбирают через
--     select *, а именно так почти всегда и пишут.
--
-- Массивы хранятся как jsonb, а не как real[]: в рядах есть дырки (потерянный
-- пульс — null внутри массива), jsonb переносит их без потерь и без спора о
-- типе, а сериализация в обе стороны — обычный JSON.
create table if not exists public.intervals_activity_streams (
  activity_id text primary key
    references public.intervals_activities(activity_id) on delete cascade,

  -- Длина рядов. Все три обязаны совпадать по длине — провайдер отдаёт их
  -- параллельными; расхождение означает битую выгрузку и ловится при записи.
  point_count integer not null,

  -- Секунды от старта.
  time_s jsonb not null,
  -- Пульс поточечно, null там, где датчик молчал. NULL всей колонкой — ряда нет.
  heartrate jsonb,
  -- Сглаженная скорость, м/с. Темп считается из неё на чтении, а не хранится
  -- вторым рядом: два представления одной величины разъезжаются.
  velocity_smooth jsonb,

  fetched_at timestamptz not null default now()
);

comment on table public.intervals_activity_streams is
  'Посекундные ряды активности: одна строка на тренировку, ряды массивами в jsonb. Строка-на-точку отвергнута сознательно — см. комментарий в миграции 20260926000000.';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Как в остальных таблицах проекта: RLS включён, политик для anon и
-- authenticated НЕТ (значит, доступа нет вовсе), всё читает и пишет серверный
-- код под service_role. Для student_data_sources это не формальность: в ней
-- лежат личные ключи учеников.
alter table public.student_data_sources enable row level security;
alter table public.intervals_activities enable row level security;
alter table public.intervals_activity_streams enable row level security;

grant all on public.student_data_sources to service_role;
grant all on public.intervals_activities to service_role;
grant all on public.intervals_activity_streams to service_role;

-- ── updated_at ───────────────────────────────────────────────────────────────
create or replace function public.set_intervals_ingest_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_student_data_sources_updated_at on public.student_data_sources;
create trigger set_student_data_sources_updated_at
  before update on public.student_data_sources
  for each row execute function public.set_intervals_ingest_updated_at();

drop trigger if exists set_intervals_activities_updated_at on public.intervals_activities;
create trigger set_intervals_activities_updated_at
  before update on public.intervals_activities
  for each row execute function public.set_intervals_ingest_updated_at();
