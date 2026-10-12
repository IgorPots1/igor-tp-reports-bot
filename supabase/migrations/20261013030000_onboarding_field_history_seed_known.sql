-- Засев истории тем, что УЖЕ УДАЛОСЬ ДОКАЗАТЬ до её появления [12.10.2026].
--
-- ЗАЧЕМ. Таблица истории завелась сегодня, а два факта про анкету Валентины
-- установлены вчера — разбором на полчаса. Не записать их значит выбросить
-- именно ту работу, ради которой таблица и заводилась: через месяц разбор
-- придётся повторить с нуля, и повторить его будет уже нечем.
--
-- ПОЧЕМУ origin = 'reconstructed' У ОБЕИХ СТРОК. Это не правка, за которой
-- кто-то стоял в момент записи, а вывод задним числом по косвенным следам.
-- Отдельное значение источника нужно ровно для того, чтобы такие строки
-- НЕЛЬЗЯ было прочитать как свидетельство: «восстановлено» слабее, чем «со
-- слов», и это должно быть видно без чтения примечания.
--
-- ЧЕГО ЗДЕСЬ НЕТ. days_per_week 06.10 ходило 3 → 2 → 3 (сначала по наряду,
-- потом обратно, когда прогон показал, что при двух днях интервалы исчезают
-- вовсе). Порядок и момент этих шагов по следам не восстанавливаются, а
-- придуманная последовательность в таблице провенанса хуже её отсутствия —
-- поэтому строки нет. В анкете days_per_week_source = 'derived', и это всё,
-- что о нём известно наверняка.
--
-- Идемпотентно: вставка пропускается, если строка по этому полю и моменту уже
-- есть. Миграцию можно прогнать повторно.

insert into public.intervals_onboarding_field_history
  (source_id, field, value_before, value_after, changed_by, origin, note, changed_at)
select
  '40986bda-db39-43b8-aae3-86bce1b1f505'::uuid,
  'max_session_minutes',
  null,
  '80',
  'coach:igor',
  'reconstructed',
  'Восстановлено 12.10.2026. ТОЧНЫЙ МОМЕНТ УСТАНОВКИ НЕ ИЗВЕСТЕН: доказано '
    || 'лишь, что 80 действовало к 17.09.2026 15:31 — в цикле 48f8a017 сохранён '
    || 'peakCapAerobicMin = 230, а потолок аэробного режется как '
    || 'maxSessionMinutes × daysPerWeek; дней было 3, значит при 60 он стал бы '
    || '180, а не 230. Момент взят по created_at анкеты (это проверяемый факт о '
    || 'строке, а не о правке). Следов числа 60 в базе нет ни в один день; '
    || 'поле помечено в coach_set_fields, то есть задано тренером, а не ею. '
    || 'Наряд 12.10 говорил «в анкете было 60» — подтвердить это нечем, '
    || 'опровергнуть тоже: истории тогда не велось.',
  '2026-09-17T10:37:31.048486+00:00'::timestamptz
where exists (
  select 1 from public.student_data_sources
  where id = '40986bda-db39-43b8-aae3-86bce1b1f505'::uuid
)
and not exists (
  select 1 from public.intervals_onboarding_field_history
  where source_id = '40986bda-db39-43b8-aae3-86bce1b1f505'::uuid
    and field = 'max_session_minutes'
    and origin = 'reconstructed'
);

insert into public.intervals_onboarding_field_history
  (source_id, field, value_before, value_after, changed_by, origin, note, changed_at)
select
  '40986bda-db39-43b8-aae3-86bce1b1f505'::uuid,
  'self_reported_weekly_minutes',
  '185',
  '120',
  'coach:agent',
  'reconstructed',
  'Восстановлено 12.10.2026 по записи сессии 06.10, не по строке базы: '
    || 'расхождение базисов (в анкете 185, в цикле 120) приведено к 120 по '
    || 'наряду Игоря. Запись сделал агент, решение Игоря. Момент — updated_at '
    || 'анкеты (06.10.2026 16:43), это последняя запись в строку, и она моя. '
    || 'Значение «до» (185) взято из записи разбора, а не из сохранённой '
    || 'строки — проверить его в базе больше нечем.',
  '2026-10-06T16:43:37.643+00:00'::timestamptz
where exists (
  select 1 from public.student_data_sources
  where id = '40986bda-db39-43b8-aae3-86bce1b1f505'::uuid
)
and not exists (
  select 1 from public.intervals_onboarding_field_history
  where source_id = '40986bda-db39-43b8-aae3-86bce1b1f505'::uuid
    and field = 'self_reported_weekly_minutes'
    and origin = 'reconstructed'
);
