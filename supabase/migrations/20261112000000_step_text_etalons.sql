-- Эталоны текстов шагов и история правок тренировок [решение Игоря, 21.10.2026].
-- Всё аддитивно.
--
-- ── Эталон ──────────────────────────────────────────────────────────────────
--
-- Тренер правит текст шага в админке — правка становится эталоном для ключа
-- шага, ОБЩИМ ДЛЯ ВСЕХ учеников. Генератор берёт текст из эталона, если он
-- есть, иначе свой.
--
-- ТОЛЬКО ТЕКСТ. Числа (минуты, повторы, «усилие N из 10») эталоном не
-- становятся: их считает генератор. У отрезка эталон — описание ПОСЛЕ
-- «усилие N из 10». Диапазоны вида «5:30–6:00» отбивает сам редактор: текст
-- уходит в описание тренировки, и генератор разбирает описание обратно
-- (verifyRoundTrip) — диапазон в тексте сломал бы этот разбор.
--
-- ЖИВОЙ ЭТАЛОН ОДИН НА КЛЮЧ: частичный уникальный индекс. Снятый не удаляется
-- (retired_at): по нему видно, что и когда стояло.
--
-- Ключи. Дорожка и улица — разные ключи у основной части: на улице текст живёт
-- рядом с темпом, на дорожке вместо него. Новичок и диагностический тест пока
-- вне эталонов. Расширение списка — тоже аддитивно (новый check).
create table if not exists public.intervals_step_text_etalons (
  id uuid primary key default gen_random_uuid(),
  step_key text not null check (step_key in (
    'warmup_walk',          -- разминка: ходьба
    'warmup_easy',          -- разминка: лёгкий бег
    'warmup_strides',       -- разминка: ускорения перед работой
    'warmup_settle',        -- разминка: войти в ровный ритм
    'easy_main_treadmill',  -- лёгкая, основная часть, дорожка
    'easy_main_street',     -- лёгкая, основная часть, улица
    'long_main_treadmill',  -- длительная, основная часть, дорожка
    'long_main_street',     -- длительная, основная часть, улица
    'interval_work',        -- отрезок (описание после «усилие N из 10»)
    'interval_rest',        -- шаг между отрезками
    'cooldown'              -- заминка
  )),
  text text not null check (length(btrim(text)) between 1 and 600),
  set_at timestamptz not null default now(),
  set_by text not null,
  -- Откуда взят: тренировка, в которой тренер сделал правку. Тренировку могут
  -- удалить (пересборка недели) — эталон от этого не пропадает.
  source_session_id uuid references public.intervals_plan_sessions(id) on delete set null,
  retired_at timestamptz,
  retired_by text
);
create unique index if not exists intervals_step_text_etalons_one_live
  on public.intervals_step_text_etalons(step_key) where retired_at is null;

comment on table public.intervals_step_text_etalons is
  'Эталонные тексты шагов по ключу, общие для всех учеников. Только текст, без чисел. Живой один на ключ (retired_at is null).';

-- ── История правок тренировки ───────────────────────────────────────────────
--
-- «Было → стало, кто, когда» на каждое поле. Одна строка — одно поле: название,
-- заметка, текст шага, минуты шага. Внешнего ключа на тренировку НЕТ
-- намеренно: тренировки удаляются при пересборке недели, а история должна
-- пережить удаление. С ученицей связь каскадная: удаление ученицы чистит и её
-- историю (delete_intervals_student полагается на каскады).
create table if not exists public.intervals_session_edits (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.student_data_sources(id) on delete cascade,
  session_id uuid not null,
  session_date date not null,
  field text not null check (field in ('title', 'note', 'step_text', 'step_minutes')),
  step_index smallint,
  step_key text,
  value_before text,
  value_after text,
  edited_by text not null,
  edited_at timestamptz not null default now(),
  became_etalon boolean not null default false,
  constraint intervals_session_edits_step_has_index check (field not like 'step_%' or step_index is not null)
);
create index if not exists intervals_session_edits_session_idx on public.intervals_session_edits(session_id, edited_at desc);
create index if not exists intervals_session_edits_source_idx on public.intervals_session_edits(source_id, edited_at desc);

comment on table public.intervals_session_edits is
  'Правки тренировок из админки: поле, было → стало, кто, когда. Без FK на сессию: история переживает удаление тренировки.';

alter table public.intervals_step_text_etalons enable row level security;
alter table public.intervals_session_edits enable row level security;
revoke all on public.intervals_step_text_etalons, public.intervals_session_edits from anon, authenticated;
grant select, insert, update, delete on public.intervals_step_text_etalons, public.intervals_session_edits to service_role;
