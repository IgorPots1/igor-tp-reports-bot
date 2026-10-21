-- Страница плана ученицы по секретной ссылке (igorp.run/plan/<slug>/<token>)
-- вместо мини-аппа /m/run. Пилот: Валентина. Всё аддитивно.
--
-- Данные у страницы те же, что у /m/run (intervals_*): отдельного плана нет.
-- Здесь только то, чего у /m/run не было: ссылка, поверхность и скриншоты в
-- отчёте, «увидела ответ», признак разбора недели, сообщения тренеру.

-- ── Ссылка на страницу ─────────────────────────────────────────────────────
--
-- ОДНА ЖИВАЯ НА УЧЕНИЦУ, ОТЗЫВАЕМАЯ. Утекла — тренер выпускает новую, старая
-- получает revoked_at и перестаёт открываться. Строка не удаляется: по ней
-- видно, когда и кем ссылка была выпущена и отозвана. Единственность живой
-- держит частичный уникальный индекс, а не аккуратность кода.
--
-- Токены живут ЗДЕСЬ, не в коде: репозиторий публичный.
create table if not exists public.intervals_plan_links (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.student_data_sources(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9-]{2,40}$'),
  token text not null unique check (token ~ '^[a-f0-9]{32,64}$'),
  created_at timestamptz not null default now(),
  created_by text not null,
  revoked_at timestamptz,
  revoked_by text
);
create unique index if not exists intervals_plan_links_one_live
  on public.intervals_plan_links(source_id) where revoked_at is null;

comment on table public.intervals_plan_links is
  'Секретные ссылки на страницу плана. Живая одна на источник (revoked_at is null); отзыв — revoked_at, строка не удаляется.';

-- ── Отчёт: где бегала, скриншоты, уведомление о боли ──────────────────────
--
-- surface — признак ТРЕНИРОВКИ, а не человека: по нему форма решает, что
-- спрашивать (дорожка → скорость с панели, улица → дистанция). null — отчёт
-- пришёл до появления поля или из мини-аппа.
alter table public.intervals_checkins
  add column if not exists surface text check (surface is null or surface in ('street', 'treadmill')),
  add column if not exists file_paths text[] not null default '{}',
  add column if not exists pain_coach_notified_at timestamptz;

comment on column public.intervals_checkins.surface is
  'street | treadmill — где бегала эту тренировку. null: до поля или из мини-аппа.';
comment on column public.intervals_checkins.file_paths is
  'Скриншоты к отчёту, пути в бакете intervals-checkin-files.';
comment on column public.intervals_checkins.pain_coach_notified_at is
  'Когда тренеру ушло уведомление о боли. null при pain = true — ещё не ушло (тихие часы): утром первым в очереди.';

-- ── Ответ тренера: увидела ли, разбор ли недели ────────────────────────────
alter table public.intervals_coach_messages
  add column if not exists seen_by_student_at timestamptz,
  add column if not exists is_week_review boolean not null default false;

comment on column public.intervals_coach_messages.seen_by_student_at is
  'Когда ученица увидела ответ на странице. null — точка «новое».';
comment on column public.intervals_coach_messages.is_week_review is
  'Разбор недели, а не ответ на одну тренировку: в боте кнопка ведёт на вкладку «Тренер».';

-- ── Сообщения ученицы тренеру ──────────────────────────────────────────────
--
-- СВОЯ ТАБЛИЦА [решение Игоря, 21.10.2026], не trainingpeaks_telegram_context_observations:
-- там журнал наблюдений по всем чатам, а здесь адресное сообщение, у которого
-- есть «тренеру сказали» и «тренер прочитал».
create table if not exists public.intervals_student_messages (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.student_data_sources(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 4000),
  origin text not null check (origin in ('page', 'bot')),
  telegram_message_id text,
  created_at timestamptz not null default now(),
  coach_notified_at timestamptz,
  coach_read_at timestamptz
);
create index if not exists intervals_student_messages_source_idx
  on public.intervals_student_messages(source_id, created_at desc);

comment on table public.intervals_student_messages is
  'Сообщения ученицы тренеру: со страницы (page) или текстом боту (bot). coach_notified_at null — уведомление отложено тихими часами.';

-- ── Доступ: только серверные ручки через service role ──────────────────────
alter table public.intervals_plan_links enable row level security;
alter table public.intervals_student_messages enable row level security;
revoke all on public.intervals_plan_links, public.intervals_student_messages from anon, authenticated;
grant select, insert, update, delete on public.intervals_plan_links, public.intervals_student_messages to service_role;

-- ── Скриншоты: приватный бакет, отдаются подписанными ссылками ─────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('intervals-checkin-files', 'intervals-checkin-files', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
