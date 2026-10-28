-- Пробная неделя: права service_role на таблицы trial_bot_* (28.10.2026).
-- Таблицы из 20261114000000_trial_bot.sql создались без SELECT/INSERT/UPDATE/DELETE
-- для service_role (в проекте отозваны default privileges), поэтому и бот, и
-- scripts/trial-bot-cron-key.ts падали с «permission denied for table trial_bot_config».
-- Только добавление прав, данные не трогаются. anon/authenticated доступа не получают.
grant select, insert, update, delete on table
  public.trial_bot_config,
  public.trial_bot_users,
  public.trial_bot_sessions,
  public.trial_bot_sends,
  public.trial_bot_events
to service_role;

grant usage, select on sequence
  public.trial_bot_events_id_seq,
  public.trial_bot_sends_id_seq,
  public.trial_bot_sessions_id_seq
to service_role;
