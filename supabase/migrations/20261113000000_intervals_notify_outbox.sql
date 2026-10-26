-- Очередь уведомлений ученикам из базы [решение Игоря, 26.10.2026].
--
-- ЗАЧЕМ. Тренер ведёт неделю ученицы прямо в базе (из чата Claude) и не может
-- нажать кнопку админки. Он ставит строку сюда, раннер раз в 5 минут
-- отправляет её ТЕМИ ЖЕ функциями, что кнопки: notifyWeekReleased и
-- deliverCoachMessage, с теми же заслонами. Своего текста у очереди нет.
--
-- ВИДЫ:
--   plan_ready   — «План готов» на отданную неделю;
--   week_updated — «Поправил вашу неделю»;
--   coach_reply  — ответ тренера (первая строка + кнопка на страницу).
--
-- ОДИН ОБЪЕКТ — ОДИН РАЗ (частичные уникальные индексы ниже):
--   plan_ready и coach_reply — строго один раз на неделю / ответ;
--   week_updated — не чаще раза в сутки на неделю (request_day).
-- В индексе только pending и sent: строку в failed или skipped (пауза, сбой)
-- можно поставить заново, второй раз уйти она не сможет.
--
-- Без флага INTERVALS_NOTIFY_OUTBOX_ENABLED=true раннер очередь не трогает:
-- строки лежат pending. Не больше 5 отправок одной ученице за скользящие сутки:
-- сверх лимита строка ждёт pending. На паузе — skipped с причиной.
create table if not exists public.intervals_notify_outbox (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.student_data_sources(id) on delete cascade,
  kind text not null check (kind in ('plan_ready', 'week_updated', 'coach_reply')),

  -- Ссылка на объект — двумя колонками с внешними ключами, а не текстом:
  -- поставить в очередь несуществующую неделю или ответ база не даст.
  plan_week_id uuid references public.intervals_plan_weeks(id) on delete cascade,
  coach_message_id uuid references public.intervals_coach_messages(id) on delete cascade,
  constraint intervals_notify_outbox_object check (
    (kind in ('plan_ready', 'week_updated') and plan_week_id is not null and coach_message_id is null)
    or (kind = 'coach_reply' and coach_message_id is not null and plan_week_id is null)
  ),

  requested_by text not null check (length(btrim(requested_by)) > 0),
  requested_at timestamptz not null default now(),
  -- День постановки (UTC) — ключ «раз в сутки» для week_updated.
  request_day date not null default ((now() at time zone 'utc')::date),

  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  reason text,
  processed_at timestamptz,
  attempts smallint not null default 0
);

create unique index if not exists intervals_notify_outbox_once_plan_ready
  on public.intervals_notify_outbox(plan_week_id)
  where kind = 'plan_ready' and status in ('pending', 'sent');
create unique index if not exists intervals_notify_outbox_daily_week_updated
  on public.intervals_notify_outbox(plan_week_id, request_day)
  where kind = 'week_updated' and status in ('pending', 'sent');
create unique index if not exists intervals_notify_outbox_once_coach_reply
  on public.intervals_notify_outbox(coach_message_id)
  where kind = 'coach_reply' and status in ('pending', 'sent');

create index if not exists intervals_notify_outbox_pending
  on public.intervals_notify_outbox(requested_at) where status = 'pending';
create index if not exists intervals_notify_outbox_source_sent
  on public.intervals_notify_outbox(source_id, processed_at) where status = 'sent';

comment on table public.intervals_notify_outbox is
  'Очередь уведомлений ученицам из базы: раннер шлёт теми же функциями, что кнопки админки. Без INTERVALS_NOTIFY_OUTBOX_ENABLED лежит pending.';

alter table public.intervals_notify_outbox enable row level security;
revoke all on public.intervals_notify_outbox from anon, authenticated;
grant select, insert, update on public.intervals_notify_outbox to service_role;
