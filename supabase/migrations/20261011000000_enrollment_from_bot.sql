-- Заведение ученика из бота: состояние диалога и «кто-то постучался».
--
-- ЗАЧЕМ ЭТО ВООБЩЕ. Сейчас ученик заводится строкой в терминале, и это упирается
-- в вопрос, на который нет ответа: откуда тренер возьмёт telegram id ЧЕЛОВЕКА,
-- который ему ещё не писал. Ниоткуда. Единственный надёжный источник id — само
-- её сообщение боту. Поэтому правильный порядок обратный: она пишет, бот
-- показывает тренеру, кто постучался, тренер жмёт «завести».
--
-- ── ДИАЛОГ ──────────────────────────────────────────────────────────────────
--
-- Состояние держим в базе, а не в памяти процесса: прод живёт на вебхуках, и
-- каждое сообщение может прийти в другой инстанс. Память между сообщениями там
-- не переживает даже одного вопроса.
create table if not exists public.intervals_enrollment_drafts (
  id uuid primary key default gen_random_uuid(),

  -- Чат тренера: диалог идёт именно в нём, и отвечать на вопросы может только он.
  coach_chat_id text not null,

  -- Кого заводим.
  telegram_user_id bigint not null,
  telegram_username text,
  suggested_name text,

  student_name text,
  step text not null default 'name'
    check (step in ('name', 'goal', 'days', 'continuity', 'health', 'confirm', 'done', 'cancelled')),

  goal_kind text check (goal_kind is null or goal_kind in ('race', 'regular', 'improve', 'start_running')),
  days_per_week smallint check (days_per_week is null or (days_per_week between 2 and 7)),
  can_run_continuously boolean,
  health_limits text,

  created_student_uuid uuid references public.trainingpeaks_students(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.intervals_enrollment_drafts is
  'Состояние пошагового заведения ученика через бота. Живёт до завершения диалога.';

-- ОДИН ОТКРЫТЫЙ ДИАЛОГ НА ТРЕНЕРА. Иначе следующий ответ («3») невозможно
-- отнести к нужному человеку: у текста нет адреса, только у кнопки.
create unique index if not exists intervals_enrollment_one_open_per_coach
  on public.intervals_enrollment_drafts (coach_chat_id)
  where step not in ('done', 'cancelled');

create index if not exists intervals_enrollment_user_idx
  on public.intervals_enrollment_drafts (telegram_user_id, created_at desc);

-- ── КТО ПОСТУЧАЛСЯ ──────────────────────────────────────────────────────────
--
-- Нужна ровно для дедупликации: человек пишет боту пять сообщений подряд, а
-- тренер должен получить ОДНО уведомление, а не пять. Заодно это список «кто
-- приходил и что с ним стало».
create table if not exists public.intervals_bot_visitors (
  telegram_user_id bigint primary key,
  chat_id text,
  first_name text,
  username text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  notified_at timestamptz,
  -- enrolled — завели; ignored — тренер отказался; new — ждёт решения.
  status text not null default 'new' check (status in ('new', 'enrolled', 'ignored'))
);

comment on table public.intervals_bot_visitors is
  'Незнакомые люди, написавшие боту. Существует, чтобы тренер получил одно уведомление на человека, а не по одному на сообщение.';

alter table public.intervals_enrollment_drafts enable row level security;
alter table public.intervals_bot_visitors enable row level security;
grant all on public.intervals_enrollment_drafts to service_role;
grant all on public.intervals_bot_visitors to service_role;
