-- Недельная форма: что человек сам говорит про прошедшую неделю [20.09.2026].
--
-- ЗАЧЕМ ОТДЕЛЬНО ОТ ЧЕК-ИНА. Чек-ин — про ОДНУ тренировку: как далась, не
-- болело ли. Сигнал недели, который из них считается, знает только это. Но
-- «успела ли я по графику» и «накопилась ли усталость» — вопросы про НЕДЕЛЮ
-- целиком, и ответить на них может только человек. Из отметок по тренировкам
-- они не выводятся: три спокойные пробежки из шести запланированных дают
-- отличные RPE и молчат о том, что половина недели не состоялась.
--
-- ОДНА ФОРМА НА НЕДЕЛЮ, и это держит уникальный ключ в базе, а не аккуратность
-- кода — ровно по той же причине, что и у напоминаний.
--
-- ВСЁ АДДИТИВНОЕ: create table, create index, comment, grant, enable rls.

create table if not exists public.intervals_weekly_reports (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.student_data_sources(id) on delete cascade,

  -- Понедельник недели, ПРО КОТОРУЮ отчитались. Форма приходит в воскресенье и
  -- спрашивает про неделю, которая заканчивается, поэтому дата — её начало, а
  -- не день заполнения: по дню заполнения две формы одной недели не различить.
  week_start date not null,

  -- Как прошла неделя по графику. Три варианта, названные последствием.
  schedule_code text not null
    check (schedule_code in ('all_done', 'some_missed', 'almost_none')),

  -- Общее самочувствие за неделю. Это НЕ усилие одной тренировки (RPE чек-ина):
  -- человек отвечает про накопленное, а не про сегодня.
  wellbeing_code text not null
    check (wellbeing_code in ('fresh', 'normal', 'tired')),

  -- Свободное поле: пожелания и что сказать тренеру. Может быть пустым.
  comment_text text,

  created_at timestamptz not null default now(),

  unique (source_id, week_start)
);

comment on table public.intervals_weekly_reports is
  'Недельная форма ученика Intervals: график, самочувствие, свободный текст. Одна на неделю.';
comment on column public.intervals_weekly_reports.week_start is
  'Понедельник недели, про которую отчёт. Форма приходит в воскресенье этой же недели.';
comment on column public.intervals_weekly_reports.wellbeing_code is
  'Накопленное самочувствие за неделю, не усилие отдельной тренировки.';

create index if not exists intervals_weekly_reports_source_week_idx
  on public.intervals_weekly_reports (source_id, week_start desc);

alter table public.intervals_weekly_reports enable row level security;
grant all on public.intervals_weekly_reports to service_role;
