-- Бот «Забеги России»: дайджест «раз в месяц» (наряд 12.10.2026, понятные настройки).
-- digest_every_weeks: 1 — раз в неделю, 2 — раз в 2 недели, 4 — раз в месяц (каждый 4-й понедельник).
-- Только расширение check-констрейнта; прежние значения (1, 2) остаются допустимыми.

alter table public.race_bot_users drop constraint if exists race_bot_users_digest_every_weeks_check;
alter table public.race_bot_users add constraint race_bot_users_digest_every_weeks_check
  check (digest_every_weeks = any (array[1, 2, 4]));
