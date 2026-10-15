-- Правки тренера к поставленной неделе — обратная связь для генератора
-- (рабочий процесс «раскидать → правки в TP → публикуй», решение 15.10.2026).
--
-- Между «раскидать» (неделя записана скрытой) и «публикуй» Игорь правит неделю прямо
-- в TrainingPeaks. Перед публикацией неделя перечитывается из TP, и разница
-- «что поставили → что он сделал» пишется сюда построчно: одно поле — одна строка.
--
-- Таблица ТОЛЬКО КОПИТСЯ: по ней ничего не чинится и не подстраивается автоматически.
-- Через несколько недель из неё будет видно, что генератор делает не так, — по фактам.
--
-- Пишет сервер (service role) из tools/trainingpeaks-export/scripts/precedent/week-ops.ts.
-- Клиенту таблица не видна. Применяется вместе с влитием ветки feature/repeat-plus-delta.

create table if not exists public.coach_plan_edits (
  id uuid primary key default gen_random_uuid(),
  run_id text not null,
  trainingpeaks_athlete_id bigint not null,
  week_start date not null,
  workout_date date not null,
  trainingpeaks_workout_id bigint not null,
  field text not null check (field in ('длительность', 'формат', 'описание', 'день недели', 'удаление', 'добавление')),
  before_value text,
  after_value text,
  detected_at timestamptz not null default now()
);

comment on table public.coach_plan_edits is
  'Что тренер изменил в поставленной генератором неделе между «раскидать» и «публикуй». Только копится, ничего не чинит.';
comment on column public.coach_plan_edits.run_id is
  'Прогон «раскидать» (манифест reports/precedent/runs/<run_id>.json).';
comment on column public.coach_plan_edits.field is
  'длительность | формат (заголовок) | описание | день недели | удаление (тренировка удалена тренером) | добавление (тренер добавил свою).';
comment on column public.coach_plan_edits.before_value is
  'Что поставил генератор; null для «добавления».';
comment on column public.coach_plan_edits.after_value is
  'Что стало в TP перед публикацией; null для «удаления».';

create index if not exists coach_plan_edits_athlete_week_idx on public.coach_plan_edits (trainingpeaks_athlete_id, week_start);
create index if not exists coach_plan_edits_run_idx on public.coach_plan_edits (run_id);

alter table public.coach_plan_edits enable row level security;
revoke all on public.coach_plan_edits from anon, authenticated;
grant select, insert on public.coach_plan_edits to service_role;
