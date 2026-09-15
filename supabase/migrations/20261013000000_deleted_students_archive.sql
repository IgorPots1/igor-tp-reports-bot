-- Архив удалённых учеников: «удалил не того» перестаёт быть необратимым.
--
-- ПОЧЕМУ ЭТО НУЖНО ИМЕННО СЕЙЧАС. Кнопка удаления уже стоит в карточке, и
-- однажды она встанет рядом с человеком, у которого три месяца истории: план,
-- отметки о каждой тренировке, переписка с тренером. Три барьера (пароль, имя
-- буква в букву, функция в базе) уменьшают вероятность промаха, но не делают
-- его обратимым. Архив делает.
--
-- ЧТО ХРАНИМ. Всё, что нельзя восстановить: карточку, источник, анкету,
-- предзаполнение, циклы и тренировки плана, чек-ины, тексты тренера,
-- прогрессию, напоминания.
--
-- ЧЕГО НЕ ХРАНИМ: привезённые тренировки. Их бывает несколько тысяч на
-- человека, и это ЕДИНСТВЕННЫЕ данные в списке, которые не наши: они лежат в
-- Intervals.icu и приедут снова, если человек подключится. Вместо самих строк
-- храним их число и границы окна — чтобы было видно, что именно утрачено.
--
-- СРОК. Полгода: столько же, сколько человек обычно помнит, что тренировался,
-- и достаточно, чтобы заметить ошибку. Автоматической чистки нет: истечение
-- срока видно по expires_at, а удаляет archive-sweep, который запускают руками.
create table if not exists public.deleted_students_archive (
  id uuid primary key default gen_random_uuid(),

  student_uuid uuid not null,
  student_key text not null,
  student_name text not null,
  coaching_platform text,

  payload jsonb not null,

  deleted_at timestamptz not null default now(),
  deleted_by text,
  expires_at timestamptz not null default (now() + interval '6 months')
);

comment on table public.deleted_students_archive is
  'Снимок удалённого ученика Intervals. Существует, чтобы удаление можно было отменить руками в течение полугода.';

create index if not exists deleted_students_archive_expires_idx
  on public.deleted_students_archive (expires_at);
create index if not exists deleted_students_archive_key_idx
  on public.deleted_students_archive (student_key, deleted_at desc);

alter table public.deleted_students_archive enable row level security;
grant all on public.deleted_students_archive to service_role;

-- Удаление теперь пишет архив В ТОЙ ЖЕ ТРАНЗАКЦИИ.
--
-- ПОЧЕМУ ВНУТРИ ФУНКЦИИ, А НЕ В КОДЕ ПЕРЕД ВЫЗОВОМ. Снимок, сделанный отдельным
-- запросом, живёт на честном слове: если между ним и удалением что-то упадёт,
-- останется либо архив без удаления, либо удаление без архива. Второе — ровно
-- та беда, от которой архив и заводится.
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
  v_payload jsonb;
  v_source_ids uuid[];
  v_cycle_ids uuid[];
  v_activities_count int;
  v_activities_from timestamp;
  v_activities_to timestamp;
begin
  select coaching_platform, student_name, student_id
    into v_platform, v_name, v_key
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

  delete from trainingpeaks_students where id = p_student_uuid;

  return jsonb_build_object('deleted', true, 'student_name', v_name, 'archived', true);
end;
$$;

revoke all on function public.delete_intervals_student(uuid, text) from public;
grant execute on function public.delete_intervals_student(uuid, text) to service_role;

-- Старая версия функции (без архива) делала вызов с ОДНИМ аргументом
-- неоднозначным: Postgres не мог выбрать между ней и новой, у которой второй
-- аргумент со значением по умолчанию. Оставить её значит держать рабочий путь,
-- который удаляет БЕЗ архива. Строк данных это не касается: у функции их нет.
drop function if exists public.delete_intervals_student(uuid);
