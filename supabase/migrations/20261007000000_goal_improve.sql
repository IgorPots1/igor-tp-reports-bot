-- Третья цель: «бегаю регулярно, хочу улучшать результаты».
--
-- ЗАЧЕМ ОТДЕЛЬНАЯ ЦЕЛЬ, А НЕ РАСШИРЕНИЕ regular. regular означает честное
-- поддержание для тех, кому рост не нужен, и цикл под ним не растёт намеренно.
-- improve — цикл развития: рост плюс разгрузки, но без обратного отсчёта и без
-- подводки, потому что старта нет. Слить их в одну цель значило бы навязать
-- рост человеку, который о нём не просил.
--
-- Аддитивно: ограничение только РАСШИРЯЕТСЯ, ни одно значение не убрано.
alter table public.intervals_onboarding_answers
  drop constraint if exists intervals_onboarding_answers_goal_kind_check;
alter table public.intervals_onboarding_answers
  add constraint intervals_onboarding_answers_goal_kind_check
  check (goal_kind is null or goal_kind in ('race', 'regular', 'improve', 'start_running'));

alter table public.intervals_onboarding_prefill
  drop constraint if exists intervals_onboarding_prefill_goal_kind_check;
alter table public.intervals_onboarding_prefill
  add constraint intervals_onboarding_prefill_goal_kind_check
  check (goal_kind is null or goal_kind in ('race', 'regular', 'improve', 'start_running'));

comment on column public.intervals_onboarding_answers.goal_kind is
  'Цель. race — подготовка к старту; improve — бегает регулярно и хочет улучшать результаты (цикл развития: рост плюс разгрузки, без подводки); regular — честное поддержание без роста; start_running — методика новичка. NULL — не спрашивали и тренер не задал, читается как поддерживающий цикл.';
