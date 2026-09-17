-- Как проходит обычная пробежка: три варианта из формы /m/run (см. src/app/m/run/page.tsx),
-- а не «может ли она бежать непрерывно» (то норматив, это факт про вчерашний день).
--
-- can_run_continuously остаётся: методика новичка (decideNextStep/diagnosticSession) читает
-- именно его, и переписывать эту логику здесь не нужно. Но boolean схлопывает "иногда перехожу
-- на шаг" и "пока больше хожу" в одно false — тренер в анкете хочет видеть, какой из трёх
-- вариантов человек реально выбрал [решение Игоря, 17.09.2026]. Аддитивно: новая nullable
-- колонка рядом со старой, ничего не переписывается и не удаляется.
alter table intervals_onboarding_answers
  add column if not exists run_style text;

alter table intervals_onboarding_answers
  add constraint intervals_onboarding_answers_run_style_check
  check (run_style is null or run_style in ('continuous', 'walk_breaks', 'mostly_walk'));

comment on column intervals_onboarding_answers.run_style is
  'Как сейчас проходит обычная пробежка (форма /m/run): continuous / walk_breaks / mostly_walk. '
  'NULL — не отвечала или отвечала до появления этой колонки (можно только грубо восстановить из can_run_continuously).';
