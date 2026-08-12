-- Анкеты участников бегового интенсива: таблица + приватный bucket под скриншоты.
--
-- НЕ ПРИМЕНЯЕТСЯ ЭТИМ НАРЯДОМ — только файл. Применяет Игорь.
--
-- ЗАЧЕМ. Анкету заполняет посторонний человек с публичной страницы /intensive/apply.
-- Данные попадают в базу ТОЛЬКО через серверный роут /api/intensive/apply под
-- service_role. Поэтому политик для anon здесь НЕТ ни одной: RLS включён, и без
-- политик анонимный ключ не может ни читать, ни писать. Это не забывчивость —
-- это и есть защита. Если когда-нибудь появится клиентская запись напрямую из
-- браузера, политику придётся заводить осознанно и узко, а не «чтобы заработало».
--
-- ЧУВСТВИТЕЛЬНОЕ. Три поля health_* — это медицинские сведения о живом человеке
-- (хронические болезни, травмы, операции). Они лежат в обычных колонках, но
-- обращаться с ними надо как с врачебной тайной: не выводить в списки, не слать
-- в Telegram-уведомления, не логировать. Уведомление о новой анкете намеренно
-- содержит только имя, город, цель и число скриншотов.

create table if not exists public.intensive_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Номер потока на момент подачи. Строкой, потому что в конфиге он может стать
  -- «28» / «28-осень» / «spring-29» — а исторические заявки должны остаться
  -- привязанными к тому набору, в который человек реально записывался.
  flow_number text,
  status text not null default 'new' check (status in ('new', 'confirmed', 'cancelled')),

  -- ── Шаг 1. О себе ──
  full_name text not null,
  birth_date date,
  sex text,
  height_cm int,
  weight_kg numeric,
  city text,

  -- ── Шаг 2. Здоровье (ЧУВСТВИТЕЛЬНОЕ) ──
  health_chronic text,
  health_injuries text,
  health_discomfort text,
  health_disclaimer_accepted boolean not null default false,

  -- ── Шаг 3. Опыт ──
  weekly_km text,
  max_distance text,
  pr_5k text,
  pr_10k text,
  pr_21k text,
  pr_42k text,
  current_training text,
  other_sports text,

  -- ── Шаг 4. Цель ──
  goal text,
  races_this_year text,
  why_intensive text,

  -- ── Шаг 5. Практика ──
  available_days text[],
  session_duration text,
  surfaces text[],
  gadgets text[],
  shoes text,
  strength text,

  -- [{path, name, size}] — путь в bucket, исходное имя, размер в байтах.
  screenshots jsonb not null default '[]'::jsonb,

  -- Заметка тренера из админки.
  admin_note text
);

comment on table public.intensive_applications is
  'Анкеты участников бегового интенсива. Пишутся только сервером под service_role (RLS без политик). Колонки health_* — медицинские сведения, в списки и уведомления не выводятся.';

comment on column public.intensive_applications.flow_number is
  'Номер потока на момент подачи, из src/lib/flow.ts. Строкой: исторические заявки должны остаться привязанными к своему набору, даже если формат номера изменится.';

comment on column public.intensive_applications.status is
  'new — пришла и ждёт тренера; confirmed — место подтверждено; cancelled — человек отказался или не подошёл. Место в потоке занимают new и confirmed, cancelled освобождает.';

comment on column public.intensive_applications.health_disclaimer_accepted is
  'Галочка «нет противопоказаний». Сервер не создаёт анкету без неё — проверка продублирована в /api/intensive/apply, потому что клиентскую валидацию обходят.';

comment on column public.intensive_applications.screenshots is
  'Массив [{path, name, size}]. path — ключ объекта в приватном bucket intensive-screenshots; сами файлы отдаются только подписанными ссылками из админки.';

-- Список в админке идёт по статусу и всегда свежими сверху.
create index if not exists intensive_applications_status_idx
  on public.intensive_applications (status);

create index if not exists intensive_applications_created_at_idx
  on public.intensive_applications (created_at desc);

alter table public.intensive_applications enable row level security;

-- Политик для anon/authenticated нет намеренно (см. шапку файла).
grant all on public.intensive_applications to service_role;

-- ── Storage ──
-- Приватный bucket: public = false. Скриншоты тренировок показывают режим дня,
-- маршруты и пульс конкретного человека — публичная раздача им противопоказана.
-- Читаются только подписанными ссылками, которые выдаёт админка на короткий срок.
insert into storage.buckets (id, name, public)
values ('intensive-screenshots', 'intensive-screenshots', false)
on conflict (id) do nothing;
