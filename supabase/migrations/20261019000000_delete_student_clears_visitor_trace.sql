-- Удаление ученика должно снимать и след «постучался в бота», а не только карточку.
--
-- ── БАГ, КОТОРЫЙ ЭТО ЧИНИТ ───────────────────────────────────────────────────
--
-- intervals_bot_visitors и intervals_enrollment_drafts ключуются telegram_user_id
-- напрямую, а не через student_id/source_id — ни один внешний ключ их с
-- trainingpeaks_students не связывает, и удаление ученика их не задевало вообще.
--
-- Из-за этого удалённый человек не может постучаться заново: noticeUnknownVisitor
-- (src/features/intervals/enroll-dialog.ts) при первом же сообщении апсертит
-- строку в intervals_bot_visitors и шлёт тренеру «Незнакомый человек написал»
-- РОВНО ОДИН РАЗ — дальше проверяет notified_at и молчит. У удалённого ученика
-- notified_at уже стоит с его самого первого обращения, и молчание длится
-- НАВСЕГДА: тренер никогда не узнает, что человек написал снова.
--
-- ── ЧТО ДЕЛАЕТ ПРАВКА ────────────────────────────────────────────────────────
--
-- 1. Снимок этих двух таблиц (если telegram_user_id вообще известен) уходит в
--    тот же архивный payload, что и остальное — та же полугодовая обратимость,
--    что и у всего остального удаляемого.
-- 2. Обе строки удаляются по telegram_user_id. После этого следующее сообщение
--    от того же человека снова считается «незнакомый» и снова уведомляет.
create or replace function public.delete_intervals_student(
  p_student_uuid uuid,
  p_deleted_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_platform text;
  v_name text;
  v_key text;
  v_telegram_user_id bigint;
  v_payload jsonb;
  v_source_ids uuid[];
  v_cycle_ids uuid[];
  v_activities_count int;
  v_activities_from timestamp;
  v_activities_to timestamp;
begin
  select coaching_platform, student_name, student_id, telegram_user_id
    into v_platform, v_name, v_key, v_telegram_user_id
  from trainingpeaks_students where id = p_student_uuid;

  if v_platform is null then
    raise exception 'ученик % не найден', p_student_uuid using errcode = 'no_data_found';
  end if;

  if v_platform is distinct from 'intervals' then
    raise exception 'карточка «%» на площадке «%» — эта функция удаляет только учеников Intervals',
      v_name, coalesce(v_platform, 'не задана') using errcode = 'raise_exception';
  end if;

  select array_agg(id) into v_source_ids from student_data_sources where student_id = p_student_uuid;
  select array_agg(id) into v_cycle_ids from intervals_plan_cycles
    where source_id = any(coalesce(v_source_ids, '{}'::uuid[]));

  select count(*), min(start_date_local), max(start_date_local)
    into v_activities_count, v_activities_from, v_activities_to
  from intervals_activities where student_id = p_student_uuid;

  select jsonb_build_object(
    'card', (select to_jsonb(s) from trainingpeaks_students s where s.id = p_student_uuid),
    'sources', coalesce((select jsonb_agg(to_jsonb(x)) from student_data_sources x
                         where x.student_id = p_student_uuid), '[]'::jsonb),
    'answers', coalesce((select jsonb_agg(to_jsonb(x)) from intervals_onboarding_answers x
                         where x.source_id = any(coalesce(v_source_ids, '{}'::uuid[]))), '[]'::jsonb),
    'prefill', coalesce((select jsonb_agg(to_jsonb(x)) from intervals_onboarding_prefill x
                         where x.source_id = any(coalesce(v_source_ids, '{}'::uuid[]))), '[]'::jsonb),
    'cycles', coalesce((select jsonb_agg(to_jsonb(x)) from intervals_plan_cycles x
                        where x.source_id = any(coalesce(v_source_ids, '{}'::uuid[]))), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(to_jsonb(x)) from intervals_plan_sessions x
                          where x.cycle_id = any(coalesce(v_cycle_ids, '{}'::uuid[]))), '[]'::jsonb),
    'checkins', coalesce((select jsonb_agg(to_jsonb(x)) from intervals_checkins x
                          where x.source_id = any(coalesce(v_source_ids, '{}'::uuid[]))), '[]'::jsonb),
    'coach_messages', coalesce((select jsonb_agg(to_jsonb(x)) from intervals_coach_messages x
                                where x.source_id = any(coalesce(v_source_ids, '{}'::uuid[]))), '[]'::jsonb),
    'progression', coalesce((select jsonb_agg(to_jsonb(x)) from intervals_beginner_progression x
                             where x.source_id = any(coalesce(v_source_ids, '{}'::uuid[]))), '[]'::jsonb),
    'reminders', coalesce((select jsonb_agg(to_jsonb(x)) from intervals_reminders x
                           where x.source_id = any(coalesce(v_source_ids, '{}'::uuid[]))), '[]'::jsonb),
    'bot_visitor', case when v_telegram_user_id is null then null
      else (select to_jsonb(x) from intervals_bot_visitors x where x.telegram_user_id = v_telegram_user_id) end,
    'enrollment_drafts', case when v_telegram_user_id is null then '[]'::jsonb
      else coalesce((select jsonb_agg(to_jsonb(x)) from intervals_enrollment_drafts x
                     where x.telegram_user_id = v_telegram_user_id), '[]'::jsonb) end,
    'activities_summary', jsonb_build_object(
      'count', v_activities_count,
      'from', v_activities_from,
      'to', v_activities_to,
      'note', 'сами тренировки не сохранены: они лежат в Intervals.icu и приедут снова при подключении'
    )
  ) into v_payload;

  insert into deleted_students_archive (student_uuid, student_key, student_name, coaching_platform, payload, deleted_by)
  values (p_student_uuid, v_key, v_name, v_platform, v_payload, p_deleted_by);

  delete from trainingpeaks_coach_cases where student_id = p_student_uuid;
  delete from trainingpeaks_reply_drafts where student_id = p_student_uuid;
  delete from autoplanner_shadow_results where student_id = p_student_uuid;

  -- СЛЕД «ПОСТУЧАЛСЯ В БОТА» — ПОСЛЕДНИМ, ДО УДАЛЕНИЯ КАРТОЧКИ. Обе таблицы
  -- ключуются telegram_user_id, а не student_id, поэтому FK-каскад их не видит
  -- вообще: без явного удаления здесь человек навсегда останется «уже
  -- уведомляли» и не сможет постучаться заново.
  if v_telegram_user_id is not null then
    delete from intervals_bot_visitors where telegram_user_id = v_telegram_user_id;
    delete from intervals_enrollment_drafts where telegram_user_id = v_telegram_user_id;
  end if;

  delete from trainingpeaks_students where id = p_student_uuid;

  return jsonb_build_object('deleted', true, 'student_name', v_name, 'archived', true);
end;
$$;

revoke all on function public.delete_intervals_student(uuid, text) from public;
grant execute on function public.delete_intervals_student(uuid, text) to service_role;
