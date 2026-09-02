-- Онбординг нового ученика: анкета, стартовая точка и сгенерированный цикл.
--
-- НЕ ПРИМЕНЯЕТСЯ ЭТИМ НАРЯДОМ — только файл. Применяет Игорь.
--
-- ГЕНЕРАТОР НЕ НОВЫЙ. Недели и циклы считает тот же код, что и для ростера
-- TrainingPeaks: training-cycle.ts (математика цикла, forecast) и
-- autoplanner-week.ts (раскладка недели по дням). Здесь только ВХОД для него —
-- анкета и стартовая точка из истории Intervals — и МЕСТО, куда лечь результату.
--
-- ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА ЦИКЛА, А НЕ training_cycles. Та таблица держит
-- trainingpeaks_athlete_id bigint NOT NULL и читается живым сборщиком недель
-- (cycle-reader.loadActiveCycles ходит по TP-идентификаторам). Класть туда
-- строки без TP-атлета — значит менять контракт таблицы, которую каждую ночь
-- читает работающий код, ради ученика, которого в TP нет вообще. Модель цикла
-- при этом ОДНА: параметры здесь те же самые, и считает их тот же модуль.

-- ── 1. Анкета ────────────────────────────────────────────────────────────────
--
-- Состав намеренно короткий. Критерий включения один: без этого поля план
-- получается ХУЖЕ, а не просто беднее. Всё, что можно посчитать по истории,
-- в анкете отсутствует — частота, объём и наличие пульса считаются из
-- intervals_activities, и спрашивать их значит заставлять человека угадывать
-- то, что мы и так знаем точнее него.
create table if not exists public.intervals_onboarding_answers (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null unique
    references public.student_data_sources(id) on delete cascade,

  -- ЦЕЛЬ. Определяет тип цикла целиком: у старта есть подводка и обратный отсчёт
  -- недель, у «просто бегать» — ни того ни другого (intent = maintenance).
  -- Без этого поля пришлось бы гадать, к чему готовим, и любая догадка меняет
  -- и длину цикла, и профиль последних недель.
  -- start_running — сегмент «Хочу начать бегать» из методики новичка
  -- (coach_igor_true_beginner). У него своя лестница шаг-бега, свой потолок
  -- беговых дней и своя первая, диагностическая тренировка.
  goal_kind text not null check (goal_kind in ('race', 'regular', 'start_running')),

  -- ДАТА СТАРТА. Из неё считается длина цикла (сколько недель осталось) и куда
  -- встаёт подводка. Без даты цикл нельзя сфазировать: подводка — это последние
  -- 1–3 недели ПЕРЕД конкретным днём, а не абстрактный хвост.
  race_date date,

  -- ДИСТАНЦИЯ. Через intentFromDistance превращается в тип цикла (5k/10k/half/
  -- marathon), а он задаёт целевую длительную, профиль подводки и потолок роста
  -- длительной. Полумарафон и марафон отличаются не «сложностью», а именно этими
  -- числами — без дистанции они берутся наугад.
  race_distance_km numeric,

  -- ДНЕЙ В НЕДЕЛЮ. Скелет недели (сколько качественных, где длительная, сколько
  -- лёгких) считается ОТ ЧИСЛА ДНЕЙ. У новичка истории частоты может не быть
  -- вовсе, а у пришедшего с историей его готовность бегать чаще или реже, чем он
  -- бегал, — это решение человека, а не факт из данных. Единственное поле, где
  -- анкета имеет право спорить с историей.
  days_per_week integer not null check (days_per_week between 2 and 7),

  -- ТЕКУЩИЙ ОБЪЁМ СО СЛОВ, минут в неделю. Используется ТОЛЬКО когда истории
  -- нет: цикл растёт от базы, и без базы расти неоткуда. Когда история есть,
  -- поле игнорируется — измеренный объём точнее самооценки.
  self_reported_weekly_minutes integer
    check (self_reported_weekly_minutes is null or self_reported_weekly_minutes between 0 and 1200),

  -- НЕДОСТУПНЫЕ ДНИ, 0=Пн … 6=Вс. Сборщик расставляет роли по дням; без запретов
  -- он поставит длительную на день, в который человек физически не бегает, и
  -- план развалится на первой же неделе. Это не «пожелание», а жёсткое
  -- ограничение календаря.
  unavailable_weekdays smallint[] not null default '{}',

  -- ПРЕДПОЧТИТЕЛЬНЫЙ ДЕНЬ ДЛИТЕЛЬНОЙ, 0..6 или NULL («всё равно»).
  -- У пришедшего с историей день длительной виден в данных, и поле не нужно.
  -- У новичка гистограммы нет вовсе — без подсказки длительная встанет в
  -- произвольный день, а это единственная сессия недели, которую человек
  -- планирует вокруг остальной жизни.
  preferred_long_weekday smallint check (preferred_long_weekday between 0 and 6),

  -- МОЖЕТ ЛИ ЧЕЛОВЕК БЕЖАТЬ НЕПРЕРЫВНО. Развилка методики новичка, а не
  -- уточнение: от неё зависит первая, диагностическая тренировка — 5x(4+2) с
  -- шагом или 20–25 минут непрерывно. Спросить это дешевле и честнее, чем
  -- угадать: у человека без истории данных, из которых это выводится, нет.
  -- NULL — вопрос не задавали (не сегмент новичка).
  can_run_continuously boolean,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Цель «старт» без даты и дистанции — это не цель, а намерение. Такой строкой
  -- нельзя сфазировать цикл, и пускать её нельзя.
  constraint intervals_onboarding_race_needs_details
    check (goal_kind <> 'race' or (race_date is not null and race_distance_km is not null)),

  -- Методика новичка ограничивает три беговыми днями в неделю в первые 12
  -- недель. Констрейнт стоит здесь, чтобы анкету с четырьмя днями нельзя было
  -- завести вообще: отказ должен случаться на входе, а не при генерации.
  constraint intervals_onboarding_beginner_days_cap
    check (goal_kind <> 'start_running' or days_per_week <= 3),

  -- У новичка развилка обязана быть заполнена: без неё неизвестно, какую
  -- диагностическую тренировку назначать.
  constraint intervals_onboarding_beginner_needs_continuity
    check (goal_kind <> 'start_running' or can_run_continuously is not null)
);

comment on table public.intervals_onboarding_answers is
  'Анкета онбординга: то, что человек сказал о себе. Всё, что можно посчитать по истории Intervals (частота, объём, наличие пульса), здесь намеренно ОТСУТСТВУЕТ.';

-- ── 2. Сгенерированный цикл ──────────────────────────────────────────────────
create table if not exists public.intervals_plan_cycles (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.student_data_sources(id) on delete cascade,
  answers_id uuid references public.intervals_onboarding_answers(id) on delete set null,

  intent text not null check (intent in ('5k', '10k', 'half', 'marathon', 'maintenance')),
  target_date date,
  first_week_start date not null,
  length_weeks integer not null check (length_weeks between 1 and 40),
  days integer not null check (days between 2 and 7),

  base_aerobic_min integer not null check (base_aerobic_min >= 0),
  base_quality_min integer not null check (base_quality_min >= 0),

  -- ОТКУДА ВЗЯЛАСЬ СТАРТОВАЯ ТОЧКА. Не украшение: план из истории и план из
  -- анкеты — это два разных обещания, и тренер должен видеть, какое перед ним,
  -- не заглядывая в jsonb.
  start_point_source text not null check (start_point_source in ('history', 'questionnaire')),

  -- УРОВЕНЬ ДАННЫХ на момент генерации. Определяет, чем вообще можно ставить
  -- цели. Пульсовых целей генератор не выдаёт ни при каком значении — цели
  -- всегда по темпу или по ощущению; поле нужно, чтобы было видно, на каких
  -- данных цикл построен, и чтобы разбор потом не рассуждал об интенсивности.
  data_level text not null check (data_level in ('heartrate', 'pace_only', 'none')),

  -- Как именно посчитана стартовая точка: окна, числа, чем измеряли. Тренер
  -- обязан иметь возможность проверить цифру, а не поверить ей.
  start_point jsonb not null,
  -- Черновик цикла целиком (CycleDraft) и развёртка по неделям (forecast).
  draft jsonb not null,
  week_forecast jsonb not null,

  created_at timestamptz not null default now()
);

comment on table public.intervals_plan_cycles is
  'Сгенерированный цикл ученика Intervals. Математика — общая с ростером TP (training-cycle.ts); отдельная таблица потому, что training_cycles держит NOT NULL trainingpeaks_athlete_id и читается живым сборщиком.';

create index if not exists intervals_plan_cycles_source_idx
  on public.intervals_plan_cycles (source_id, created_at desc);

-- ── 3. Сессии, разложенные по дням ───────────────────────────────────────────
create table if not exists public.intervals_plan_sessions (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.intervals_plan_cycles(id) on delete cascade,

  week_index integer not null check (week_index >= 1),
  week_start date not null,
  session_date date not null,
  day_idx smallint not null check (day_idx between 0 and 6),

  role text not null,
  title text not null,
  minutes integer not null check (minutes >= 0),
  preset_code text,
  description text,

  -- ЦЕЛЬ СЕССИИ. target_mode принимает pace и rpe. Значения 'hr' здесь нет и не
  -- должно появиться: пульсовые зоны требуют порога по пульсу, которого у
  -- новичка в Intervals нет, а выдуманная зона выглядит как измеренная.
  target_mode text check (target_mode in ('pace', 'rpe')),
  pace_fast_s integer,
  pace_slow_s integer,
  rpe numeric(3,1),

  anchor_source text,
  confidence text,
  -- Сессия, которую сборщик отказался ставить (например, качество без порога),
  -- сохраняется С ПРИЧИНОЙ, а не выбрасывается: дыра в неделе должна быть
  -- объяснимой.
  deferred boolean not null default false,
  defer_reason text,

  warnings jsonb not null default '[]'::jsonb,
  coach_review jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),

  -- Одна сессия на день недели цикла. Повторная генерация того же цикла
  -- обновляет строку, а не кладёт вторую.
  unique (cycle_id, week_index, day_idx)
);

comment on table public.intervals_plan_sessions is
  'Цикл, разложенный по дням: одна строка — одна тренировка с датой. Отказные сессии сохраняются с причиной, а не выбрасываются.';

create index if not exists intervals_plan_sessions_cycle_date_idx
  on public.intervals_plan_sessions (cycle_id, session_date);

-- ── 4. Состояние прогрессии новичка ─────────────────────────────────────────
--
-- Прогрессия по лестнице шаг-бега управляется ОБРАТНОЙ СВЯЗЬЮ, а не номером
-- недели: человек переходит на следующую ступень, когда две сессии подряд дались
-- на RPE 2–3 без боли, и повторяет ступень сколько понадобится. Поэтому
-- состояние нельзя вывести из цикла — его надо хранить.
create table if not exists public.intervals_beginner_progression (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null unique
    references public.student_data_sources(id) on delete cascade,

  -- Версия методики, по которой человек идёт. Хранится СТРОКОЙ рядом с
  -- состоянием: правила меняются, а ученик, начавший по v2, должен доходить по
  -- v2 — иначе его ступень внезапно означает другую нагрузку.
  methodology_id text not null,
  methodology_version text not null,

  -- Ступень 1…7 из BEGINNER_LADDER (src/features/methodology/beginner.ts).
  current_step integer not null default 1 check (current_step between 1 and 7),
  -- Сколько сессий уже отработано НА ЭТОЙ ступени. Обнуляется при переходе.
  sessions_at_step integer not null default 0 check (sessions_at_step >= 0),
  last_transition_at date,

  -- Обратная связь последних сессий, свежие первыми:
  -- [{ date, rpe, pain, step }]. Хранится ряд, а не последнее значение:
  -- правило перехода смотрит на две сессии подряд, а правило отката — на две
  -- тяжёлые подряд.
  recent_sessions jsonb not null default '[]'::jsonb,

  -- Ответ анкеты на момент старта: он определил первую тренировку.
  can_run_continuously boolean,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.intervals_beginner_progression is
  'Где человек находится на лестнице шаг-бега. Прогрессия управляется обратной связью (RPE + боль), а не календарём, поэтому состояние хранится, а не вычисляется из цикла.';

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.intervals_beginner_progression enable row level security;
grant all on public.intervals_beginner_progression to service_role;

drop trigger if exists set_intervals_beginner_progression_updated_at
  on public.intervals_beginner_progression;
create trigger set_intervals_beginner_progression_updated_at
  before update on public.intervals_beginner_progression
  for each row execute function public.set_intervals_ingest_updated_at();

alter table public.intervals_onboarding_answers enable row level security;
alter table public.intervals_plan_cycles enable row level security;
alter table public.intervals_plan_sessions enable row level security;

grant all on public.intervals_onboarding_answers to service_role;
grant all on public.intervals_plan_cycles to service_role;
grant all on public.intervals_plan_sessions to service_role;

drop trigger if exists set_intervals_onboarding_answers_updated_at
  on public.intervals_onboarding_answers;
create trigger set_intervals_onboarding_answers_updated_at
  before update on public.intervals_onboarding_answers
  for each row execute function public.set_intervals_ingest_updated_at();
