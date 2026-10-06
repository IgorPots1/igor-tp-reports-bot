-- Пауза ученика: напоминания молчат, укоров нет, пропуски не считаются [06.10.2026].
--
-- ПОВОД. 01.10 ученица написала тренеру в личку: «Неважно себя чувствую,
-- насморк + болит мышца после бега. Приостановите, пожалуйста, бота по
-- тренировкам.» Тренер ответил «выздоравливайте». Приостановить было НЕЧЕМ:
-- механизма паузы в контуре нет. На третий день болезни ей ушли два
-- напоминания, одно из них missed_nudge — «вы пропустили тренировку».
--
-- ПОЧЕМУ ТАБЛИЦА, А НЕ ФЛАГ НА ИСТОЧНИКЕ. Пауза это не состояние «сейчас
-- выключено», а ОТРЕЗОК ВРЕМЕНИ, и он нужен задним числом: неделя, в которую
-- человек болел, не должна читаться как неделя, в которую он забросил. Флаг
-- отвечает только на «сейчас», а вопрос чаще звучит «что было тогда».
--
-- ОТКРЫТАЯ ПАУЗА — ended_on IS NULL. Снимается тем же действием тренера:
-- в ended_on кладётся день возврата, строка остаётся историей.
--
-- ГРАНИЦЫ ВКЛЮЧИТЕЛЬНО. Человек говорит «с первого по пятое», и обе даты для
-- него внутри. Арифметика «по пятое не включая» здесь только плодила бы
-- ошибки на один день в обе стороны.

create table if not exists public.intervals_pauses (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.student_data_sources(id) on delete cascade,

  -- Местные даты ученика, границы включительно. ended_on NULL — пауза идёт.
  started_on date not null,
  ended_on date,

  -- Своими словами: «насморк», «отпуск», «спина». Пустым не бывает: через месяц
  -- «пауза без причины» неотличима от забытой кнопки.
  reason text not null check (length(btrim(reason)) > 0),

  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint intervals_pauses_dates_ordered check (ended_on is null or ended_on >= started_on)
);

-- ОДНА ОТКРЫТАЯ ПАУЗА НА ЧЕЛОВЕКА. Две открытые — это уже не состояние, а
-- загадка: какую снимать кнопкой «вернуть». Закрытых может быть сколько угодно.
create unique index if not exists intervals_pauses_one_open_uidx
  on public.intervals_pauses (source_id)
  where ended_on is null;

create index if not exists intervals_pauses_source_range_idx
  on public.intervals_pauses (source_id, started_on desc);

comment on table public.intervals_pauses is
  'Отрезки, когда ученик на паузе: напоминания молчат, пропуски не считаются укором. Границы включительно, ended_on NULL — пауза идёт.';

alter table public.intervals_pauses enable row level security;
grant all on public.intervals_pauses to service_role;
