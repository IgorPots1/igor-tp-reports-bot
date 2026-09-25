-- Тренер узнаёт, что ученица написала [25.09.2026].
--
-- ПОВОД. 23.09 тренер отправил ученице три вопроса про боль в пятке. Она
-- ответила через восемь часов, в личку. Ответ лёг в
-- trainingpeaks_telegram_context_observations, привязался к её карточке, был
-- помечен меткой pain_or_health — и пролежал два дня, потому что сказать о нём
-- было некому, а в карточке Intervals переписки не видно.
--
-- ЧТО ХРАНИМ. Одну строку на источник: когда звякали в прошлый раз и что
-- отложено на утро. Не журнал — журнал уже есть, это сами наблюдения. Здесь
-- только состояние «о чём тренеру уже сказали».
--
-- ПОЧЕМУ pending_* ОТДЕЛЬНЫМИ КОЛОНКАМИ, А НЕ ОЧЕРЕДЬЮ. Ночью может прийти
-- пять сообщений, но утром это всё равно ОДИН разговор и один повод открыть
-- карточку. Храним время первого и счётчик, а не пять строк, которые утром
-- превратятся в пять одинаковых звонков.

create table if not exists public.intervals_inbound_notices (
  source_id uuid primary key references public.student_data_sources(id) on delete cascade,

  -- Когда тренеру в последний раз сказали про входящее от этого человека.
  last_notified_at timestamptz,

  -- Отложено тихими часами: время самого раннего неотданного сообщения,
  -- сколько их накопилось и первая строка последнего.
  pending_since timestamptz,
  pending_count integer not null default 0,
  pending_preview text,

  updated_at timestamptz not null default now()
);

comment on table public.intervals_inbound_notices is
  'Состояние уведомлений тренеру о входящих от ученика: когда звякали и что ждёт утра. Одна строка на источник.';

comment on column public.intervals_inbound_notices.pending_count is
  'Сколько сообщений накопилось за тихие часы. Утром уходит ОДНО уведомление с этим числом, а не столько же звонков.';

alter table public.intervals_inbound_notices enable row level security;

grant all on public.intervals_inbound_notices to service_role;
