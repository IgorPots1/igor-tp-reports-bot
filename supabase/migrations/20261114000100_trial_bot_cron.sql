-- Тик пробной недели: pg_cron каждые 30 минут зовёт /api/trial-bot/cron через pg_net
-- (как race_bot_tick у «Забегов России»). Не Vercel cron: на Hobby только раз в сутки.
--
-- Пока в trial_bot_config нет cron_key, функция ничего не делает (возвращает null).
-- Пока TRIAL_BOT_ENABLED выключен, маршрут отвечает skipped и ничего не шлёт.
-- Применять ПОСЛЕ 20261114000000_trial_bot.sql.

create or replace function public.trial_bot_tick()
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare k text; rid bigint;
begin
  select value into k from public.trial_bot_config where key = 'cron_key';
  if k is null then
    return null;
  end if;
  select net.http_post(
    url := 'https://igorp.run/api/trial-bot/cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', k),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000) into rid;
  return rid;
end $$;

revoke all on function public.trial_bot_tick() from public, anon, authenticated;

-- На 11-й и 41-й минуте: не в одну минуту с race-bot-hourly (3-я). С тем же именем
-- cron.schedule перезаписывает задачу, повторный прогон безопасен.
select cron.schedule('trial-bot-30min', '11,41 * * * *', $$select public.trial_bot_tick()$$);
