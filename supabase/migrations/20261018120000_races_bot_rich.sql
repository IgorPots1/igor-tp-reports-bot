-- Rich-сообщения в боте «Забеги России» (наряд 18.10.2026).
--   race_bot_users.rich_off — человек выбрал «Текстовая версия» (или у него старый Telegram): бот шлёт
--   ему обычный HTML; снимается в настройках «Красивое оформление».
--   race_bot_events: событие rich_off (кнопка, настройки, старый клиент по WebApp.version) для /stats.
-- Флаг включения rich_for (owner | new | all | off) и rich_since — строки race_bot_config, ставятся при выкатке
-- отдельным SQL (без них rich выключен у всех). Только добавление.

alter table public.race_bot_users add column if not exists rich_off boolean not null default false;
comment on column public.race_bot_users.rich_off is 'true — слать обычный HTML вместо rich-сообщений (кнопка «Текстовая версия», настройки или старый клиент)';

-- check-констрейнт событий: список из базы (pg_constraint на 18.10.2026) плюс rich_off
alter table public.race_bot_events drop constraint race_bot_events_event_check;
alter table public.race_bot_events add constraint race_bot_events_event_check check (event = any (array[
  'start', 'city_chosen', 'filters_done', 'list_shown', 'search', 'follow', 'unfollow', 'open_calendar',
  'click_registration', 'click_site', 'consult_offer_shown', 'consult_click', 'digest_sent',
  'digest_opened_list', 'settings_less', 'pause', 'unsubscribe', 'delete', 'blocked',
  'expected_watch', 'expected_announced', 'pick_city', 'nudge_sent', 'tap', 'card_open', 'miniapp',
  'details_open', 'rich_off'
]::text[]));
