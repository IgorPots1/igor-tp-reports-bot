-- Бот «Забеги России»: одно живое меню на человека (наряд 13.10.2026, «меню всегда последнее»).
-- menu_message_id — сообщение с кнопками, которое бот правит на месте (editMessageText);
-- menu_message_at — когда оно отправлено: старше 48 часов не правим, шлём новое.
-- Новое сообщение бота (дайджест, напоминание, ответ на текст) сначала снимает кнопки со старого меню.
alter table public.race_bot_users add column if not exists menu_message_id bigint;
alter table public.race_bot_users add column if not exists menu_message_at timestamptz;
-- browse_ctx — что человек сейчас листает по сезонам: «город|типы|дистанции» (поиск «трейл Казань»
-- листается без смены своего города). null — свой город и свои фильтры.
alter table public.race_bot_users add column if not exists browse_ctx text;
