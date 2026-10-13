-- Статистика бота по дням (наряд 13.10.2026): каждое нажатие человека — событие.
-- tap — кнопка/команда/текст в боте (meta.k — что именно), card_open — открыта карточка старта,
-- miniapp — действие в календаре Mini App (meta.a: season, filter, open, reg, site, follow, unfollow).
-- Список значений — из pg_constraint живой базы, только расширен.
alter table public.race_bot_events drop constraint if exists race_bot_events_event_check;
alter table public.race_bot_events add constraint race_bot_events_event_check check (event = any (array[
  'start', 'city_chosen', 'filters_done', 'list_shown', 'search', 'follow', 'unfollow', 'open_calendar',
  'click_registration', 'click_site', 'consult_offer_shown', 'consult_click', 'digest_sent',
  'digest_opened_list', 'settings_less', 'pause', 'unsubscribe', 'delete', 'blocked',
  'expected_watch', 'expected_announced', 'pick_city', 'nudge_sent',
  'tap', 'card_open', 'miniapp'
]::text[]));
