-- Петля до конца: ответ тренера виден ученице в приложении, и есть напоминания.
--
-- ── 1. ОТВЕТ ТРЕНЕРА В ПРИЛОЖЕНИИ ───────────────────────────────────────────
--
-- Раньше текст тренера жил только в телеграме, и только если включён killswitch
-- INTERVALS_COACH_SEND_ENABLED. То есть ученица отмечалась в приложении, а ответ
-- ждала в чате — и при выключенном флаге не получала вообще.
--
-- Новая колонка отделяет ДВА РАЗНЫХ СОБЫТИЯ, которые раньше были склеены в одно:
--   visible_to_student_at — тренер отдал текст ученице, и она видит его в
--                           приложении. Это и есть доставка.
--   sent_at / status      — ушло ли ещё и уведомление в телеграм. Это push, а не
--                           доставка, и он по-прежнему под killswitch-ем.
--
-- Почему колонка, а не новый статус: статус описывает судьбу ОТПРАВКИ, а
-- видимость в приложении — независимое свойство. Склеив их, мы получили бы
-- «sent, но не видно» и «видно, но не sent» в одном поле.
--
-- ВАЖНО ДЛЯ СТАРЫХ СТРОК: значение по умолчанию null, то есть все написанные до
-- этой миграции тексты остаются НЕвидимыми. Молча показать человеку то, что
-- тренер считал черновиком, нельзя.
alter table public.intervals_coach_messages
  add column if not exists visible_to_student_at timestamptz;

comment on column public.intervals_coach_messages.visible_to_student_at is
  'Когда текст стал виден ученице в приложении. null — она его не видит. Не путать с sent_at: то про уведомление в телеграм.';

create index if not exists intervals_coach_messages_visible_idx
  on public.intervals_coach_messages (source_id, visible_to_student_at desc)
  where visible_to_student_at is not null;

-- ── 2. НАПОМИНАНИЯ ──────────────────────────────────────────────────────────
--
-- Таблица нужна ровно для одного: НЕ НАПОМНИТЬ ДВАЖДЫ. Раннер просыпается
-- каждые полчаса, и без следа отправленного он слал бы напоминание при каждом
-- запуске, попавшем в окно. Уникальный ключ (источник, вид, местная дата) делает
-- повтор невозможным на уровне базы, а не на уровне аккуратности кода.
--
-- Местная дата, а не время сервера: ученица может быть в любой зоне, и «сегодня»
-- у неё своё. Дата считается по её часовому поясу и хранится как есть.
create table if not exists public.intervals_reminders (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.student_data_sources(id) on delete cascade,

  -- today_session  — утром: что сегодня по плану.
  -- checkin_nudge  — вечером: тренировка была, отметки нет.
  kind text not null check (kind in ('today_session', 'checkin_nudge')),

  local_date date not null,

  -- sent — ушло; skipped — решили не слать и записали почему (например, доставка
  -- у карточки выключена); failed — телеграм не принял. Пустой лог означал бы
  -- «напоминаний не было», а не «раннер молча падал».
  status text not null default 'sent' check (status in ('sent', 'skipped', 'failed')),
  detail text,
  chat_id text,
  telegram_message_id text,

  created_at timestamptz not null default now(),

  constraint intervals_reminders_once_per_day unique (source_id, kind, local_date)
);

comment on table public.intervals_reminders is
  'След отправленных напоминаний. Существует, чтобы одно и то же напоминание не ушло дважды: раннер просыпается каждые полчаса.';

create index if not exists intervals_reminders_source_idx
  on public.intervals_reminders (source_id, created_at desc);

-- RLS как у остальных таблиц контура: политик ноль, ходит только service_role.
-- Ученица читает свои данные исключительно через наш сервер, напрямую в базу
-- никто не ходит.
alter table public.intervals_reminders enable row level security;
grant all on public.intervals_reminders to service_role;
