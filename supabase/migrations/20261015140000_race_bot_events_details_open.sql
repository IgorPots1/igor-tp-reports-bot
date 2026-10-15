-- Событие details_open: нажатие «Всё о старте» в карточке бота (вариант Б, наряд 15.10.2026),
-- ветка воронки в /stats. Только расширение check-констрейнта: список значений взят из базы
-- (pg_constraint на 15.10.2026), плюс details_open. Существующие строки не меняются.
alter table public.race_bot_events drop constraint race_bot_events_event_check;
alter table public.race_bot_events add constraint race_bot_events_event_check check (event = any (array[
  'start', 'city_chosen', 'filters_done', 'list_shown', 'search', 'follow', 'unfollow', 'open_calendar',
  'click_registration', 'click_site', 'consult_offer_shown', 'consult_click', 'digest_sent',
  'digest_opened_list', 'settings_less', 'pause', 'unsubscribe', 'delete', 'blocked',
  'expected_watch', 'expected_announced', 'pick_city', 'nudge_sent', 'tap', 'card_open', 'miniapp',
  'details_open'
]::text[]));
