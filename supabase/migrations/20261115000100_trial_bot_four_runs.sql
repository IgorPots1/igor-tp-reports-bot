-- Пробная неделя: бот ведёт до 4 тренировок в неделю [решение Игоря, 29.10.2026].
--
-- ЗАЧЕМ. Ответ «4 и больше» у бегунов (цели «Бегать регулярно» и «Подготовиться к старту»)
-- теперь значит 4 тренировки: 2 лёгких, интервалы, длительная. Было: не больше 3
-- (weekly_runs 2 или 3, idx 1..3).
--
-- НЕ АДДИТИВНО: старые check-ограничения снимаются и ставятся заново с более широким
-- диапазоном. Строки не переписываются, тип колонок не меняется, ничего больше не трогается.
-- Применять только после отдельного «да» Игоря. Выкатывать ВМЕСТЕ с кодом ветки
-- feature/trial-free-week: без миграции запись 4-й тренировки упадёт на check.
--
-- Затронутые строки (чтение 29.10.2026): trial_bot_users 1 строка, у неё weekly_runs null;
-- trial_bot_sessions 0 строк. Новые ограничения шире старых, поэтому все существующие строки
-- им удовлетворяют.

alter table public.trial_bot_users drop constraint if exists trial_bot_users_weekly_runs_check;
alter table public.trial_bot_users
  add constraint trial_bot_users_weekly_runs_check check (weekly_runs in (2, 3, 4));

alter table public.trial_bot_sessions drop constraint if exists trial_bot_sessions_idx_check;
alter table public.trial_bot_sessions
  add constraint trial_bot_sessions_idx_check check (idx between 1 and 4);
