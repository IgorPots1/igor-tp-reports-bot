-- Учёт сбоев бота (наряд 18.10.2026, проверка на глюки): события menu_resend (меню пришло новым
-- сообщением: правка не удалась / нажали в старом / старше 48 часов) и tg_error (Telegram не принял
-- rich-разметку, бот показал экран текстом). Видны в /stats. Только расширение check-констрейнта:
-- список значений берётся из базы перед применением, плюс два новых. Существующие строки не меняются.
-- race_bot_users.webapp_version — WebApp.version из мини-приложения при каждом открытии: режим
-- rich_for = capable даёт rich только тем, у кого она известна и не ниже 10.1.

alter table public.race_bot_users add column if not exists webapp_version text;
comment on column public.race_bot_users.webapp_version is 'WebApp.version (версия Bot API в Telegram человека) при последнем открытии мини-приложения; null — не открывал';

alter table public.race_bot_events drop constraint race_bot_events_event_check;
alter table public.race_bot_events add constraint race_bot_events_event_check check (event = any (array[
  'start', 'city_chosen', 'filters_done', 'list_shown', 'search', 'follow', 'unfollow', 'open_calendar',
  'click_registration', 'click_site', 'consult_offer_shown', 'consult_click', 'digest_sent',
  'digest_opened_list', 'settings_less', 'pause', 'unsubscribe', 'delete', 'blocked',
  'expected_watch', 'expected_announced', 'pick_city', 'nudge_sent', 'tap', 'card_open', 'miniapp',
  'details_open', 'rich_off', 'menu_resend', 'tg_error'
]::text[]));
