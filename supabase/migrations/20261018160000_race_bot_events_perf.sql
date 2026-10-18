-- Замер скорости бота (наряд 18.10.2026): событие perf на каждое нажатие и сообщение — тайминги
-- (ответ на нажатие, экран, итого), число и время запросов к базе и к Telegram, холодный старт.
-- В /stats — строка «Скорость». Только расширение check-констрейнта; список берётся из базы перед
-- применением, плюс perf. Существующие строки не меняются.
alter table public.race_bot_events drop constraint race_bot_events_event_check;
alter table public.race_bot_events add constraint race_bot_events_event_check check (event = any (array[
  'start', 'city_chosen', 'filters_done', 'list_shown', 'search', 'follow', 'unfollow', 'open_calendar',
  'click_registration', 'click_site', 'consult_offer_shown', 'consult_click', 'digest_sent',
  'digest_opened_list', 'settings_less', 'pause', 'unsubscribe', 'delete', 'blocked',
  'expected_watch', 'expected_announced', 'pick_city', 'nudge_sent', 'tap', 'card_open', 'miniapp',
  'details_open', 'rich_off', 'menu_resend', 'tg_error', 'perf'
]::text[]));
