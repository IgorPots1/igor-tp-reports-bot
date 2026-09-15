-- Цикл развития (intent='develop') не мог записаться в базу.
--
-- ЧТО БЫЛО. Тип CycleIntent в коде расширили значением 'develop' вместе с
-- целью «улучшать результаты», а check-констрейнт в базе остался со старым
-- списком. Генератор честно собирал 41 тренировку на 12 недель, а INSERT падал
-- на последнем шаге:
--   new row for relation "intervals_plan_cycles" violates check constraint
--   "intervals_plan_cycles_intent_check"
--
-- То есть вся ветка «уже бегает, хочу улучшать результаты» физически не могла
-- дойти до базы НИ РАЗУ. Поймано первым живым прогоном сценария: дымовой
-- проверки генерации для этого мало, она останавливается до записи.
--
-- Расширение аддитивное: ни одно существующее значение не убрано.
alter table public.intervals_plan_cycles
  drop constraint if exists intervals_plan_cycles_intent_check;

alter table public.intervals_plan_cycles
  add constraint intervals_plan_cycles_intent_check
  check (intent in ('5k', '10k', 'half', 'marathon', 'maintenance', 'develop'));

comment on column public.intervals_plan_cycles.intent is
  'Назначение цикла: дистанция старта, maintenance (держим объём) или develop (растём без старта). Список обязан совпадать с CycleIntent в training-cycle.ts.';
