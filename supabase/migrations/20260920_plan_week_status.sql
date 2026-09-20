-- Статус НЕДЕЛИ, а не только цикла [20.09.2026].
--
-- ЛОВУШКА, КОТОРУЮ ЭТО ЗАКРЫВАЕТ. Единицей публикации был ЦИКЛ: нажал «Показать
-- ученице» — и всё, что лежит в цикле, стало видно. Дальше любая правка будущей
-- недели уезжала человеку МГНОВЕННО, включая недоделанную: тренер открывал
-- неделю, менял две строки из шести, отвлекался — и ученица уже видела
-- полуфабрикат. Второго нажатия, которым можно сказать «вот теперь готово», не
-- существовало.
--
-- ТРИ СОСТОЯНИЯ:
--   generated — собрана машиной, человек её НЕ видит. Значение по умолчанию:
--               всё, что сгенерировано, считается черновиком, пока не сказано
--               обратное;
--   editing   — тренер взял в работу. От generated отличается только тем, что
--               это видно в списке: «занято, не трогай»;
--   released  — отдана ученице, она её видит.
--
-- ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ КОЛОНКА В СЕССИЯХ. Статус принадлежит НЕДЕЛЕ.
-- Колонка в intervals_plan_sessions означала бы шесть копий одного значения,
-- которые обязаны совпадать, — и разойдутся на первой же правке одной строки.
--
-- БЭКФИЛЛ СОХРАНЯЕТ ТО, ЧТО ЛЮДИ ВИДЯТ СЕЙЧАС. Все недели уже опубликованных
-- циклов помечаются released, включая будущие. Спрятать их «ради порядка»
-- значило бы у живого человека в понедельник утром обнулить план, который он
-- вчера видел. Новое правило действует на то, что создаётся дальше, а не задним
-- числом.

create table if not exists public.intervals_plan_weeks (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.intervals_plan_cycles(id) on delete cascade,
  week_start date not null,
  status text not null default 'generated'
    check (status in ('generated', 'editing', 'released')),
  -- Когда неделя отдана. NULL — ещё не отдавали ни разу.
  released_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (cycle_id, week_start)
);

comment on table public.intervals_plan_weeks is
  'Состояние отдельной недели плана. Единица публикации — неделя, а не цикл целиком.';
comment on column public.intervals_plan_weeks.status is
  'generated — машина собрала, ученик не видит; editing — тренер в работе; released — отдана ученику.';

create index if not exists intervals_plan_weeks_cycle_idx
  on public.intervals_plan_weeks (cycle_id, week_start);

alter table public.intervals_plan_weeks enable row level security;
grant all on public.intervals_plan_weeks to service_role;

-- ── Бэкфилл ─────────────────────────────────────────────────────────────────
-- Опубликованные циклы: всё, что у них есть, человек уже видит — released.
insert into public.intervals_plan_weeks (cycle_id, week_start, status, released_at)
select distinct s.cycle_id, s.week_start, 'released', c.published_at
from public.intervals_plan_sessions s
join public.intervals_plan_cycles c on c.id = s.cycle_id
where c.status = 'published'
on conflict (cycle_id, week_start) do nothing;

-- Черновики циклов: ученик их не видит и так — generated.
insert into public.intervals_plan_weeks (cycle_id, week_start, status)
select distinct s.cycle_id, s.week_start, 'generated'
from public.intervals_plan_sessions s
join public.intervals_plan_cycles c on c.id = s.cycle_id
where c.status <> 'published'
on conflict (cycle_id, week_start) do nothing;
