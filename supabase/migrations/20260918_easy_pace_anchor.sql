-- Якорь лёгкого темпа, названный тренером, рядом с порогом [18.09.2026].
--
-- ЗАЧЕМ. У сегмента без подключаемых часов истории не будет никогда, значит
-- измерить темп лёгкого не из чего. До сих пор его можно было передать только
-- флагом --easy-pace на генерации, и он НИГДЕ НЕ СОХРАНЯЛСЯ: следующая
-- генерация снова оставалась без якоря, и весь цикл уходил в отказ
-- no_easy_anchor_and_no_fallback. У Валентины так отказались все 36 сессий.
--
-- ПОЧЕМУ РЯДОМ С ПОРОГОМ, А НЕ В АНКЕТЕ. Это то же самое по природе: число про
-- бег, которое знает тренер, с происхождением и датой. Анкета — то, что ответил
-- человек; смешивать туда тренерские числа уже пробовали, и именно на этом
-- флаги затирали ответы ученицы (фикс 17.09.2026).
--
-- ТРИ ПОЛЯ ВМЕСТЕ ИЛИ НИ ОДНОГО, как у порога: число без происхождения и даты —
-- это темп из ниоткуда, и через полгода никто не скажет, откуда он взялся.

alter table student_data_sources
  add column if not exists easy_pace_sec_per_km integer,
  add column if not exists easy_pace_source text,
  add column if not exists easy_pace_set_at timestamptz;

comment on column student_data_sources.easy_pace_sec_per_km is
  'Темп лёгкого бега, с/км. Назван тренером для тех, у кого истории не будет: измерить не из чего. Доверие ниже измеренного якоря.';
comment on column student_data_sources.easy_pace_source is
  'Происхождение якоря лёгкого. coach_manual — тренер назвал число сам.';
comment on column student_data_sources.easy_pace_set_at is
  'Когда якорь поставлен. Без даты нельзя понять, насколько он устарел.';

-- Границы те же, что у порога в скрипте простановки: опечатка должна отлетать,
-- а не уезжать в план. Лёгкий медленнее порога, поэтому верхняя граница шире.
alter table student_data_sources
  drop constraint if exists student_data_sources_easy_pace_sane;
alter table student_data_sources
  add constraint student_data_sources_easy_pace_sane
  check (easy_pace_sec_per_km is null or (easy_pace_sec_per_km between 180 and 900));

alter table student_data_sources
  drop constraint if exists student_data_sources_easy_pace_source_known;
alter table student_data_sources
  add constraint student_data_sources_easy_pace_source_known
  check (easy_pace_source is null or easy_pace_source in ('coach_manual'));

-- Три поля вместе или ни одного.
alter table student_data_sources
  drop constraint if exists student_data_sources_easy_pace_complete;
alter table student_data_sources
  add constraint student_data_sources_easy_pace_complete
  check (
    (easy_pace_sec_per_km is null and easy_pace_source is null and easy_pace_set_at is null)
    or (easy_pace_sec_per_km is not null and easy_pace_source is not null and easy_pace_set_at is not null)
  );
