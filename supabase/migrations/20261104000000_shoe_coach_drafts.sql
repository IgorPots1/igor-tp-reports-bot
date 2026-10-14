-- Черновики тренерского каталога кроссовок и их проверка Игорем
-- (страница /admin/shoes-review, решение 14.10.2026).
--
-- Черновик — то, что прочитано в обзорах источников, прошедших гейт условий
-- использования: значения по полям, у каждого — цитаты и ссылки на обзоры.
-- В подбор черновик не идёт. Игорь проходит модель за моделью: «верно»,
-- «поправить», «не знаю». Решение по полю пишется в fields с decided_by igor.
--
-- Цитаты здесь хранить можно: страница только для Игоря, за авторизацией
-- админки. В карточку подбора уходят только названия площадок и ссылки.
--
-- Пишет сервер (service role): загрузка черновиков из конвейера и решения
-- со страницы проверки. Клиенту таблица не видна.

create table if not exists public.shoe_coach_drafts (
  id text primary key,
  brand text not null,
  model text not null,
  kind text not null default 'reviewed' check (kind in ('reviewed', 'manual')),
  batch integer not null,
  position integer not null default 0,
  confidence text check (confidence in ('normal', 'low')),
  note text,
  fields jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.shoe_coach_drafts is
  'Черновики тренерского каталога кроссовок: вердикты из обзоров с цитатами, подтверждение Игорем по полям. В подбор идёт только confirmed.';
comment on column public.shoe_coach_drafts.kind is
  'reviewed — из обзоров; manual — пустая карточка (китайские бренды), заполняет Игорь.';
comment on column public.shoe_coach_drafts.fields is
  'По полю: value, draft_value, status (draft | confirmed | unknown), decided_by, decided_at, evidence [{source_title, url, quote}].';

create index if not exists shoe_coach_drafts_batch_idx on public.shoe_coach_drafts (batch, position);

alter table public.shoe_coach_drafts enable row level security;
revoke all on public.shoe_coach_drafts from anon, authenticated;
grant select, insert, update on public.shoe_coach_drafts to service_role;
