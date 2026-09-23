-- Правка своего чек-ина: что было и что стало [23.09.2026].
--
-- ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ КОЛОНКА В ЧЕК-ИНЕ. Сама строка чек-ина
-- перезаписывается при правке (upsert по ключу источник+день, так было с
-- самого начала ради двойного тапа). Значит прежние значения живут ровно до
-- следующего нажатия, и если их не переложить в другое место, они пропадут
-- молча. Тренеру нужно не «текущее состояние», а факт изменения: человек
-- сказал «болело», потом убрал — это разговор, а не опечатка.
--
-- ДОПИСЫВАЕМ, НИКОГДА НЕ ПРАВИМ. У таблицы нет пути update: каждая правка это
-- новая строка. История, в которой можно задним числом переписать, историей
-- быть перестаёт.
--
-- ЗАПИСЫВАЕМ НЕ ВСЁ ПОДРЯД. Строка появляется только если что-то РЕАЛЬНО
-- изменилось: повторная отправка тех же ответов (двойной тап, возврат на экран)
-- не должна выглядеть как передумал.

create table if not exists public.intervals_checkin_edits (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null references public.intervals_checkins(id) on delete cascade,

  edited_at timestamptz not null default now(),

  -- Что именно поменялось: 'effort', 'pain', 'comment'. Массив, потому что за
  -- одну отправку человек может поправить и то и другое.
  changed text[] not null default '{}'::text[],

  effort_rpe_before numeric,
  effort_label_before text,
  effort_rpe_after numeric,
  effort_label_after text,

  pain_before boolean,
  pain_after boolean,

  comment_before text,
  comment_after text,

  created_at timestamptz not null default now()
);

create index if not exists intervals_checkin_edits_checkin_idx
  on public.intervals_checkin_edits (checkin_id, edited_at desc);

comment on table public.intervals_checkin_edits is
  'Правки ученицей собственного чек-ина: снимок «было → стало». Только вставка, строки не обновляются.';

comment on column public.intervals_checkin_edits.changed is
  'Что изменилось за эту правку: effort / pain / comment. Пустым не бывает — правка без изменений не записывается.';

alter table public.intervals_checkin_edits enable row level security;

grant all on public.intervals_checkin_edits to service_role;
