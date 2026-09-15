-- Удаление ученика Intervals: по-настоящему, но только его.
--
-- ── ПОЧЕМУ ФУНКЦИЯ, А НЕ GRANT DELETE ───────────────────────────────────────
--
-- У service_role есть DELETE на всех таблицах контура, КРОМЕ trainingpeaks_students
-- (проверено по information_schema: 13 таблиц с DELETE, эта одна без). Отсюда
-- и висящие погашенные карточки: код гасил флагом, потому что удалить не мог.
--
-- Соблазн выдать GRANT DELETE и закрыть вопрос. Так делать нельзя: в этой
-- таблице живёт ростер TrainingPeaks, 114 действующих учеников, и любая ошибка
-- в любом раннере получила бы право стереть человека вместе с тремя годами
-- истории. Право удалять нужно ровно одному сценарию, а не всему серверу.
--
-- Поэтому удаление живёт в функции с SECURITY DEFINER, и у функции есть
-- ЕДИНСТВЕННЫЙ заслон, который нельзя забыть применить: она отказывается
-- работать с карточкой, у которой coaching_platform не равен 'intervals'.
-- «Ростер TP не задет» перестаёт быть обещанием кода и становится свойством
-- базы: физически невозможно.
--
-- ── ЧТО УДАЛЯЕТСЯ ───────────────────────────────────────────────────────────
--
-- Карточка, а за ней каскадом: источник данных, а за ним анкета,
-- предзаполнение, циклы плана, тренировки плана, чек-ины, тексты тренера,
-- прогрессия, напоминания, привезённые тренировки. Всё это уже описано
-- внешними ключами с on delete cascade, своими руками ничего не сносим.
--
-- Три таблицы стоят с RESTRICT и NO ACTION и заблокировали бы удаление
-- (случаи тренера, черновики ответов, теневые прогоны планировщика). У ученика
-- Intervals их не бывает, но падать на них молча нельзя, поэтому снимаем явно.
create or replace function public.delete_intervals_student(p_student_uuid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_platform text;
  v_name text;
begin
  select coaching_platform, student_name into v_platform, v_name
  from trainingpeaks_students where id = p_student_uuid;

  if v_platform is null then
    raise exception 'ученик % не найден', p_student_uuid using errcode = 'no_data_found';
  end if;

  if v_platform is distinct from 'intervals' then
    raise exception 'карточка «%» на площадке «%» — эта функция удаляет только учеников Intervals',
      v_name, coalesce(v_platform, 'не задана') using errcode = 'raise_exception';
  end if;

  delete from trainingpeaks_coach_cases where student_id = p_student_uuid;
  delete from trainingpeaks_reply_drafts where student_id = p_student_uuid;
  delete from autoplanner_shadow_results where student_id = p_student_uuid;

  delete from trainingpeaks_students where id = p_student_uuid;

  return jsonb_build_object('deleted', true, 'student_name', v_name);
end;
$$;

comment on function public.delete_intervals_student(uuid) is
  'Полное удаление ученика Intervals вместе со всеми его данными. Карточку ростера TrainingPeaks удалить не может: проверяет coaching_platform.';

revoke all on function public.delete_intervals_student(uuid) from public;
grant execute on function public.delete_intervals_student(uuid) to service_role;
