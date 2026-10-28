-- Пробная неделя в основном боте (вход из рилсов: t.me/<бот>?start=trial_<источник>).
-- Код: src/features/trial-bot/*, вебхук src/app/api/telegram/webhook/route.ts,
-- тик src/app/api/trial-bot/cron/route.ts. Всё за флагом TRIAL_BOT_ENABLED.
--
-- ТОЛЬКО ДОБАВЛЕНИЕ: четыре новые таблицы и одна служебная, существующее не трогается.
-- Идемпотентно (if not exists).
--
-- RLS включён без политик: пишет и читает только сервер на service_role
-- (как 20261026160000_enable_rls_ai_call_logs_desk_perf.sql).
--
-- ЗДОРОВЬЕ: из шестого вопроса теста хранится ТОЛЬКО флаг health_flag. Что именно
-- человек отметил (сердце, беременность, травма...), не пишется никуда: ни сюда, ни в
-- answers, ни в события, ни в уведомление тренеру.

create table if not exists public.trial_bot_users (
  telegram_user_id bigint primary key,
  chat_id bigint not null,
  first_name text,
  username text,
  first_source text,
  last_source text,
  stage text not null default 'intro'
    check (stage in ('intro', 'test', 'health_stop', 'already_runner', 'result', 'declined', 'choose_days', 'week', 'post', 'done')),
  test_q smallint,
  -- ответы на вопросы 1-5 (коды кнопок), без вопроса про здоровье
  answers jsonb not null default '{}'::jsonb,
  health_flag boolean,
  result_type text check (result_type in ('clean_start', 'too_fast', 'no_system', 'comeback')),
  start_rung smallint,
  weekly_runs smallint check (weekly_runs in (2, 3)),
  days_pattern text,
  week_start date,
  test_started_at timestamptz,
  test_completed_at timestamptz,
  week_opted_at timestamptz,
  week_declined_at timestamptz,
  offer4_at timestamptz,
  day7_at timestamptz,
  base_requested_at timestamptz,
  followup8_at timestamptz,
  followup10_at timestamptz,
  channel_at timestamptz,
  -- человек остановил бота (403): тик его больше не трогает, пока он сам не нажмёт кнопку или /start
  stopped_at timestamptz,
  last_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trial_bot_users_stage_idx on public.trial_bot_users (stage) where stopped_at is null;
create index if not exists trial_bot_users_first_source_idx on public.trial_bot_users (first_source);

create table if not exists public.trial_bot_sessions (
  id bigserial primary key,
  telegram_user_id bigint not null references public.trial_bot_users (telegram_user_id) on delete cascade,
  idx smallint not null check (idx between 1 and 3),
  scheduled_date date not null,
  rung smallint,
  preset_code text,
  title text,
  body text,
  checkin text check (checkin in ('easy', 'ok', 'hard', 'miss', 'pain')),
  checkin_at timestamptz,
  morning_sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (telegram_user_id, idx)
);

create index if not exists trial_bot_sessions_date_idx on public.trial_bot_sessions (scheduled_date);

create table if not exists public.trial_bot_events (
  id bigserial primary key,
  telegram_user_id bigint not null,
  kind text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists trial_bot_events_kind_created_idx on public.trial_bot_events (kind, created_at desc);
create index if not exists trial_bot_events_user_idx on public.trial_bot_events (telegram_user_id, created_at desc);

-- Дедуп плановых отправок: ключ захватывается вставкой ДО отправки, повторный тик упирается в unique.
create table if not exists public.trial_bot_sends (
  id bigserial primary key,
  telegram_user_id bigint not null,
  send_key text not null,
  sent_at timestamptz not null default now(),
  unique (telegram_user_id, send_key)
);

-- Ключ тика для pg_cron (пишет scripts/trial-bot-cron-key.ts; значение выводится из токена бота).
create table if not exists public.trial_bot_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.trial_bot_users enable row level security;
alter table public.trial_bot_sessions enable row level security;
alter table public.trial_bot_events enable row level security;
alter table public.trial_bot_sends enable row level security;
alter table public.trial_bot_config enable row level security;

comment on table public.trial_bot_users is 'Пробная неделя в основном боте: участник воронки из рилсов (стадия, ответы теста без здоровья, неделя).';
comment on table public.trial_bot_sessions is 'Пробная неделя: 2-3 тренировки участника, что выдано утром и отметка «как прошло».';
comment on table public.trial_bot_events is 'Пробная неделя: события воронки (вход, тест, неделя, оффер, клики).';
comment on table public.trial_bot_sends is 'Пробная неделя: захваченные ключи плановых отправок (дедуп тика).';
comment on table public.trial_bot_config is 'Пробная неделя: служебные значения (cron_key для pg_cron).';
