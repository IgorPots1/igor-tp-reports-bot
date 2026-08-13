-- athlete_week_preferences — ПОЖЕЛАНИЯ УЧЕНИКА КАК ВХОД ПЛАНИРОВЩИКА.
--
-- НЕ ПРИМЕНЯЕТСЯ ЭТИМ НАРЯДОМ — только файл.
--
-- ЗАЧЕМ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ ЧТЕНИЕ ПАМЯТИ. Инвентаризация 13.08
-- (docs/athlete-preferences-inventory.md) показала: пожелания в базе ЕСТЬ, но только
-- прозой. В trainingpeaks_student_memory_items 314 строк релевантных типов, колонка
-- structured заполнена у 313 из них — и внутри всегда {"note": "свободный текст"}.
-- Ни дней недели, ни ролей, ни окон дат. При этом в одном типе schedule_constraint
-- лежат вперемешку настоящее правило («Интервалы не ставить на вторник и пятницу»),
-- одноразовый факт («вторник пропустила, сложная неделя») и сломанное извлечение
-- («может бегать в дни 4, 5, 6» — это дни плана, а не дни недели). Источник —
-- ai_extraction с доверием 0.7–1.0, тренером не подтверждённый.
--
-- Кормить форму недели такой прозой нельзя: одно неверное извлечение молча ломает неделю,
-- и разобраться потом невозможно. Поэтому память остаётся ИСТОЧНИКОМ ПОДСКАЗОК, а
-- пожелание становится РЕШЕНИЕМ ТРЕНЕРА с автором, датой и машиночитаемыми полями.
-- Та же развилка и то же решение, что были у базы цикла: base_aerobic_min против
-- base_aerobic_min_manual.
--
-- ПОМЕТКИ ИСТОЧНИКА:
--   [практика]      — измерено по данным Игоря
--   [решение Игоря] — принято тренером
--   [выведено]      — ни то ни другое

create table if not exists public.athlete_week_preferences (
  id uuid primary key default gen_random_uuid(),
  trainingpeaks_athlete_id bigint not null,

  -- ── ЧТО ЗА ПОЖЕЛАНИЕ ──
  -- Четыре вида, ровно те, что назвал наряд. Пятого не заводим: вид, который нечем
  -- исполнить в сборщике недели, — это пожелание, о котором тренер думает, что оно
  -- работает, а оно не работает.
  kind text not null check (kind in (
    'day_unavailable',      -- день недоступен
    'role_day',             -- роль привязана ко дню («длинное только в воскресенье»)
    'max_days_per_week',    -- максимум беговых дней в неделе
    'day_max_minutes'       -- ограничение длительности в конкретный день
  )),

  -- ── ПАРАМЕТРЫ ──
  -- day_of_week: 0=Пн … 6=Вс. Та же нумерация, что в dayHistogram сборщика — иначе
  -- рассинхрон обнаружится не здесь, а в готовой неделе.
  day_of_week smallint check (day_of_week is null or day_of_week between 0 and 6),
  role text check (role is null or role in ('long', 'quality', 'easy')),
  max_days smallint check (max_days is null or max_days between 1 and 7),
  max_minutes smallint check (max_minutes is null or max_minutes between 10 and 300),

  -- ── ОКНО ДЕЙСТВИЯ ──
  -- Обе даты null = пожелание ПОСТОЯННОЕ. Иначе действует включительно в этих границах.
  -- Окно нужно для «в отпуске с 31 августа по 12 сентября»: такое пожелание обязано
  -- само истечь, иначе оно останется в силе навсегда и никто об этом не вспомнит.
  active_from date,
  active_to date,

  -- ── ЧЬЁ РЕШЕНИЕ ──
  -- Пожелание всегда заводит ТРЕНЕР. source_memory_item_id — ссылка на подсказку из
  -- памяти, если тренер завёл его, подтвердив её. Ссылка нужна ровно для одного:
  -- чтобы через месяц было видно, откуда взялось правило.
  created_by text not null default 'coach',
  reason text,
  source_memory_item_id uuid references public.trainingpeaks_student_memory_items (id) on delete set null,

  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- ── ЦЕЛОСТНОСТЬ ВИДА И ПАРАМЕТРОВ ──
  -- Без этих проверок в таблицу ляжет 'role_day' без дня или 'max_days_per_week' без
  -- числа, и сборщик получит пожелание, которое нечем исполнить. Он тогда обязан будет
  -- либо молча его пропустить (худший исход), либо отказать в неделе. Ловим на входе.
  constraint pref_day_unavailable_shape check (
    kind <> 'day_unavailable' or (day_of_week is not null and role is null and max_days is null and max_minutes is null)),
  constraint pref_role_day_shape check (
    kind <> 'role_day' or (day_of_week is not null and role is not null and max_days is null and max_minutes is null)),
  constraint pref_max_days_shape check (
    kind <> 'max_days_per_week' or (max_days is not null and day_of_week is null and role is null and max_minutes is null)),
  constraint pref_day_max_minutes_shape check (
    kind <> 'day_max_minutes' or (day_of_week is not null and max_minutes is not null and role is null and max_days is null)),
  constraint pref_window check (active_from is null or active_to is null or active_to >= active_from)
);

create index if not exists athlete_week_preferences_athlete_idx
  on public.athlete_week_preferences (trainingpeaks_athlete_id)
  where is_active = true;

comment on table public.athlete_week_preferences is
  'Пожелания ученика по форме недели, заведённые ТРЕНЕРОМ. Машиночитаемый слой поверх прозы из trainingpeaks_student_memory_items: та проза приходит из ai_extraction, не подтверждена и содержит ошибки извлечения, поэтому напрямую в планировщик не идёт. См. docs/athlete-preferences-inventory.md.';

comment on column public.athlete_week_preferences.kind is
  'Вид пожелания: day_unavailable (день недоступен), role_day (роль привязана ко дню), max_days_per_week (максимум беговых дней), day_max_minutes (потолок длительности в этот день).';
comment on column public.athlete_week_preferences.day_of_week is
  '0=Пн … 6=Вс — та же нумерация, что в dayHistogram сборщика.';
comment on column public.athlete_week_preferences.active_from is
  'Начало окна действия включительно. null вместе с active_to = пожелание постоянное.';
comment on column public.athlete_week_preferences.active_to is
  'Конец окна действия включительно. Нужен, чтобы «в отпуске до 12 сентября» истекало само, а не оставалось в силе навсегда.';
comment on column public.athlete_week_preferences.source_memory_item_id is
  'Подсказка из памяти, которую тренер подтвердил, заводя это пожелание. null — завёл с нуля. Нужна, чтобы через месяц было видно происхождение правила.';
