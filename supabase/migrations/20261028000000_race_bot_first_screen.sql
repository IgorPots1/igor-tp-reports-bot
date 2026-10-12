-- Бот «Забеги России»: первый экран с двумя путями и одно напоминание через 30 минут (наряд 12.10.2026).
--
-- 1) События pick_city («📍 Выбрать город») и nudge_sent (напоминание ушло). Список значений
--    взят из pg_constraint живой базы, не из прежней миграции, и только расширен.
-- 2) race_bot_nudge_tick: как race_bot_tick, но с телом {"only":"nudge"} — маршрут шлёт только
--    напоминания. Раз в 10 минут: «через 30 минут» выходит 30–40 минут, а не 30–90 с почасовым тиком.

alter table public.race_bot_events drop constraint if exists race_bot_events_event_check;
alter table public.race_bot_events add constraint race_bot_events_event_check check (event = any (array[
  'start', 'city_chosen', 'filters_done', 'list_shown', 'search', 'follow', 'unfollow', 'open_calendar',
  'click_registration', 'click_site', 'consult_offer_shown', 'consult_click', 'digest_sent',
  'digest_opened_list', 'settings_less', 'pause', 'unsubscribe', 'delete', 'blocked',
  'expected_watch', 'expected_announced',
  'pick_city', 'nudge_sent'
]::text[]));

create or replace function public.race_bot_nudge_tick()
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare k text; rid bigint;
begin
  select value into k from public.race_bot_config where key = 'cron_key';
  if k is null then
    return null;
  end if;
  select net.http_post(
    url := 'https://igorp.run/api/races-bot/cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', k),
    body := '{"only":"nudge"}'::jsonb,
    timeout_milliseconds := 30000) into rid;
  return rid;
end $$;

revoke all on function public.race_bot_nudge_tick() from public, anon, authenticated;

-- Каждые 10 минут, со сдвигом от почасового (3-я минута). cron.schedule с тем же именем перезаписывает.
select cron.schedule('race-bot-nudge', '1-59/10 * * * *', $$select public.race_bot_nudge_tick()$$);
