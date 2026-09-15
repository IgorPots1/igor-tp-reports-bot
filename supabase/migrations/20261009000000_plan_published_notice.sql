-- Уведомление «план готов» как ещё один вид напоминания.
--
-- ПОЧЕМУ В ТОЙ ЖЕ ТАБЛИЦЕ, А НЕ В НОВОЙ. Это ровно то же самое событие по
-- смыслу: бот один раз написал человеку по поводу конкретного дня, и повтор
-- недопустим. Уникальный ключ (источник, вид, местная дата) уже стоит там и
-- защищает от двойной отправки, если тренер нажмёт «Показать ученице» дважды.
--
-- Расширение check-констрейнта аддитивно: ни одно существующее значение не
-- убрано, старые строки остаются валидными.
alter table public.intervals_reminders
  drop constraint if exists intervals_reminders_kind_check;

alter table public.intervals_reminders
  add constraint intervals_reminders_kind_check
  check (kind in ('today_session', 'checkin_nudge', 'missed_nudge', 'plan_published'));

comment on column public.intervals_reminders.kind is
  'today_session — утром что сегодня; checkin_nudge — вечером отметиться после состоявшейся тренировки; missed_nudge — вечером «всё ли в порядке», когда тренировки не было; plan_published — разовое «план готов».';
