-- Потолок длительности тренировки и часовой пояс ученика.
--
-- Всё аддитивное: add column, comment. Ни одного drop/delete/truncate, ни
-- одного ужесточения ограничений.

-- ── 1. Сколько времени человек реально может выделить ────────────────────────
--
-- ЗАЧЕМ. Генератор считал длительность от объёма недели и не знал ни одного
-- ограничения сверху, кроме пожеланий тренера по конкретным дням. Человеку,
-- у которого есть час, он мог выдать длительную на семьдесят минут: формально
-- корректную, практически невыполнимую. Невыполненная тренировка хуже короткой,
-- потому что человек считает виноватым себя.
--
-- Хранится ЧИСЛОМ, а не диапазоном («45–60»): потолок должен сравниваться, а
-- не разбираться. NULL — потолка нет.
alter table public.intervals_onboarding_answers
  add column if not exists max_session_minutes integer;

alter table public.intervals_onboarding_answers
  drop constraint if exists intervals_onboarding_max_session_check;
alter table public.intervals_onboarding_answers
  add constraint intervals_onboarding_max_session_check
  check (max_session_minutes is null or max_session_minutes between 20 and 300);

comment on column public.intervals_onboarding_answers.max_session_minutes is
  'Потолок длительности ОДНОЙ тренировки в минутах. NULL — потолка нет. Генератор обязан его соблюдать: аэробные сессии режутся штатным механизмом day_max_minutes, а сессии с фиксированным форматом (каталожная качественная, ступень лестницы новичка) не режутся и помечаются тренеру.';

alter table public.intervals_onboarding_prefill
  add column if not exists max_session_minutes integer;

alter table public.intervals_onboarding_prefill
  drop constraint if exists intervals_onboarding_prefill_max_session_check;
alter table public.intervals_onboarding_prefill
  add constraint intervals_onboarding_prefill_max_session_check
  check (max_session_minutes is null or max_session_minutes between 20 and 300);

-- ── 2. Часовой пояс ученика ─────────────────────────────────────────────────
--
-- ЗАЧЕМ. «Сегодня» в контуре считалось по зоне ТРЕНЕРА (Europe/Belgrade). Пока
-- все рядом, это работает; ученик из Москвы в 23:30 по своему времени увидел бы
-- ещё сегодняшний план вместо завтрашнего, а ученик из Владивостока утром —
-- вчерашний. Хуже того, его чек-ин лёг бы на чужой день, то есть на чужую
-- ступень: прогрессия двигается по дню.
--
-- Живёт НА КАРТОЧКЕ ЧЕЛОВЕКА, а не в анкете: это свойство человека, оно не
-- меняется от переписывания анкеты и нужно всему, что про него считает время.
--
-- NULL — не определён; читатель берёт зону тренера и об этом знает.
alter table public.trainingpeaks_students
  add column if not exists timezone text;

comment on column public.trainingpeaks_students.timezone is
  'Часовой пояс ученика, имя IANA («Europe/Moscow»). Определяется САМ из мини-приложения (Intl браузера) и спрашивается только если определить не удалось. NULL — не определён, читатель падает на зону тренера Europe/Belgrade и обязан это понимать.';

-- ── 3. Пояс тоже можно задать заранее ───────────────────────────────────────
alter table public.intervals_onboarding_prefill
  add column if not exists timezone text;

comment on column public.intervals_onboarding_prefill.timezone is
  'Часовой пояс, заданный тренером заранее. Применяется к карточке при заведении; автоопределение из приложения его НЕ перетирает — тренер знает, где человек живёт, а браузер знает лишь, где он сейчас.';
