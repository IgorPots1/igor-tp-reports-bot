-- Подключение Intervals.icu в одно нажатие: OAuth вместо копирования ключа.
--
-- ЗАЧЕМ. Сейчас ученик идёт в Developer Settings, копирует ключ и присылает его
-- тренеру. Для новичка это три незнакомых действия подряд с секретом в руках, и
-- отваливаться будут именно здесь, ещё до первой тренировки.
--
-- Всё аддитивное: create table, add column, index, comment, grant.

-- ── 1. Одноразовое состояние потока авторизации ──────────────────────────────
--
-- ЗАЧЕМ ТАБЛИЦА, А НЕ ПОДПИСАННАЯ СТРОКА. state должен отвечать на два вопроса:
-- «наш ли это возврат» и «чей он». Подписанный токен ответил бы на оба, но не
-- дал бы ОДНОРАЗОВОСТИ: перехваченная ссылка возврата сработала бы второй раз.
-- Строка в базе гасится при использовании, и повтор виден.
create table if not exists public.intervals_oauth_states (
  state text primary key,

  -- Кому мы выдали ссылку. На возврате сверяем с этим, а не с тем, что пришло
  -- в параметрах: всё, что пришло из браузера, под контролем того, кто подсунул
  -- ссылку.
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,

  created_at timestamptz not null default now(),
  -- Отметка гашения. Повторный возврат с тем же state отклоняется.
  used_at timestamptz,
  -- Чем закончилось: пригодится, когда человек скажет «я нажимал, ничего не вышло».
  outcome text check (outcome is null or outcome in ('connected', 'denied', 'failed', 'expired', 'replayed'))
);

comment on table public.intervals_oauth_states is
  'Одноразовые state для OAuth-потока Intervals. Гасятся при возврате: подписанной строки не хватило бы, она не даёт одноразовости и перехваченная ссылка сработала бы дважды.';

create index if not exists intervals_oauth_states_student_idx
  on public.intervals_oauth_states (student_id, created_at desc);

alter table public.intervals_oauth_states enable row level security;
grant all on public.intervals_oauth_states to service_role;

-- ── 2. Состояние подключения на источнике ────────────────────────────────────
--
-- ТОКЕНЫ INTERVALS НЕ ПРОТУХАЮТ [проверено по их документации 14.09.2026].
-- Ответ обмена — {token_type, access_token, scope, athlete} — не содержит ни
-- expires_in, ни refresh_token, и в объявлении OAuth про срок жизни не сказано
-- ничего: новый токен выдаётся при новой авторизации и ЗАМЕЩАЕТ прежний.
--
-- Значит обновлять нечего, и механизма обновления здесь нет. Но доступ всё
-- равно может кончиться: человек отзовёт его в настройках Intervals или
-- переавторизует приложение в другом месте. Снаружи это выглядит одинаково —
-- 401/403 на обычном запросе. Вот это и записываем, чтобы раннер не падал молча.
alter table public.student_data_sources
  add column if not exists auth_failed_at timestamptz;

alter table public.student_data_sources
  add column if not exists auth_failure_reason text;

comment on column public.student_data_sources.auth_failed_at is
  'Когда провайдер перестал принимать наш доступ (401/403). NULL — всё в порядке. Токены Intervals не имеют срока жизни, поэтому отказ означает отзыв или переавторизацию, а не протухание: чинится повторным подключением, а не обновлением токена.';

alter table public.student_data_sources
  add column if not exists connected_at timestamptz;

alter table public.student_data_sources
  add column if not exists oauth_scope text;

comment on column public.student_data_sources.oauth_scope is
  'Права, которые провайдер реально выдал. Хранится ОТВЕТ ПРОВАЙДЕРА, а не то, что мы просили: человек мог снять галочку, и тогда запрошенное и выданное расходятся.';

create index if not exists student_data_sources_auth_failed_idx
  on public.student_data_sources (auth_failed_at)
  where auth_failed_at is not null;
