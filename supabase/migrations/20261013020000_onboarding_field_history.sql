-- Провенанс анкетных полей: кто, когда, с какого значения на какое и ОТКУДА
-- взято [наряд Игоря, 12.10.2026].
--
-- ПОВОД. 12.10 не удалось ответить на простой вопрос о собственных данных:
-- «потолок одной тренировки 80 — кто его поставил?» В анкете стояло 80 и
-- пометка coach_set_fields, то есть «задал тренер», а КТО, КОГДА и из чего —
-- нигде. Доказать удалось только косвенно, через сохранённый потолок аэробного
-- в цикле от 17.09 (230; при потолке сессии 60 он был бы 180). Такой разбор
-- занял полчаса и дал вероятность, а не факт.
--
-- ОТКУДА ВЗЯТО — ОБЯЗАТЕЛЬНО ДЛЯ КОАЧСКИХ ПРАВОК, и это держит КОНСТРЕЙНТ, а
-- не договорённость. Разница существенная: «со слов», «из переписки» и «из
-- данных» — это три разные степени доверия к числу, и через месяц их не
-- восстановить. Правка ученицей источника не требует: она и есть источник.
--
-- ЗНАЧЕНИЯ ХРАНЯТСЯ ТЕКСТОМ. Поля анкеты разного типа (числа, строки, массивы
-- поверхностей, даты), и приводить их к одному типу значило бы либо потерять
-- часть, либо завести десять колонок под каждый вид. История читается глазами
-- и сравнивается на равенство — текста достаточно.
create table if not exists public.intervals_onboarding_field_history (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.student_data_sources(id) on delete cascade,
  field text not null,
  value_before text,
  value_after text,
  changed_by text not null,
  origin text,
  note text,
  changed_at timestamptz not null default now(),

  -- КОАЧСКАЯ ПРАВКА БЕЗ ИСТОЧНИКА НЕ ЗАПИСЫВАЕТСЯ ВООБЩЕ. Это и есть смысл
  -- наряда: пометка «задал тренер» без «откуда» — ровно то состояние, из
  -- которого мы сегодня не смогли выбраться.
  constraint intervals_onboarding_field_history_coach_needs_origin
    check (changed_by not like 'coach%' or origin is not null),

  constraint intervals_onboarding_field_history_origin_known
    check (origin is null or origin in (
      'student_answer',   -- ученик сам ответил в анкете
      'coach_words',      -- со слов ученика, тренер записал
      'coach_dm',         -- из переписки
      'coach_data',       -- из данных: истории тренировок, отчётов, расчёта
      'reconstructed'     -- восстановлено задним числом по косвенным следам
    ))
);

create index if not exists intervals_onboarding_field_history_source_idx
  on public.intervals_onboarding_field_history (source_id, changed_at desc);

alter table public.intervals_onboarding_field_history enable row level security;
grant select, insert on public.intervals_onboarding_field_history to service_role;

comment on table public.intervals_onboarding_field_history is
  'Кто, когда и откуда менял поля анкеты. Коачская правка без origin отбивается констрейнтом.';
comment on column public.intervals_onboarding_field_history.origin is
  'student_answer | coach_words | coach_dm | coach_data | reconstructed. Обязателен, когда changed_by начинается с coach.';
