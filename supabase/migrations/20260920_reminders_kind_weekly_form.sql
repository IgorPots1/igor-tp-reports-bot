-- weekly_form в допустимых видах напоминания [20.09.2026].
--
-- ДЫРА, КОТОРУЮ ЭТО ЗАКРЫВАЕТ. Вид weekly_form завели в коде (ReminderKind), а
-- в констрейнте базы его не было. Последствие хуже, чем кажется: след в
-- intervals_reminders не записывался ВООБЩЕ, а именно по нему раннер понимает,
-- что сегодня уже отправлял. То есть в воскресное окно 10–12 он слал бы форму
-- КАЖДЫЕ ПОЛЧАСА и не останавливался: alreadySentKinds никогда не содержал бы
-- weekly_form.
--
-- Поймано на живой отправке: сообщение ушло, а след упал на констрейнте.
--
-- Расширение check-констрейнта, аддитивно: список видов только удлиняется.
alter table public.intervals_reminders
  drop constraint if exists intervals_reminders_kind_check;

alter table public.intervals_reminders
  add constraint intervals_reminders_kind_check
  check (kind in ('today_session', 'checkin_nudge', 'missed_nudge', 'plan_published', 'weekly_form'));
