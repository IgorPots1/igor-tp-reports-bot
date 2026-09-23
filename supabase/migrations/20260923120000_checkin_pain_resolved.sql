-- Боль закрывает тренер, а не факт написанного текста [23.09.2026].
--
-- До этой правки сигнал боли на карточке гас, как только по чек-ину появлялся
-- ЛЮБОЙ ответ тренера. Получалось, что система считала вопрос закрытым,
-- потому что тренер что-то написал, — хотя написал он как раз вопрос и ждёт
-- ответа. Живой случай: 23.09 у ученицы заныла пятка, тренер отправил три
-- вопроса, сигнал погас, а вопрос остался открытым.
--
-- Теперь сигнал живёт до одного из двух событий: тренер нажал «разобрался»
-- (эта колонка) или пришёл следующий чек-ин без боли (считается на лету, в
-- базе ничего не помечается).
--
-- Пустая колонка = боль не закрыта. Старые строки остаются пустыми намеренно:
-- задним числом объявить разобранным то, чего никто не разбирал, нельзя.

alter table public.intervals_checkins
  add column if not exists pain_resolved_at timestamptz;

alter table public.intervals_checkins
  add column if not exists pain_resolved_by text;

comment on column public.intervals_checkins.pain_resolved_at is
  'Когда тренер сказал, что с болью разобрался. NULL — не разобрался. Ответ тренера сюда НЕ пишет: текст не закрывает вопрос.';

comment on column public.intervals_checkins.pain_resolved_by is
  'Кто закрыл: coach:admin. Отдельно от даты, чтобы через месяц было видно, чьё это решение.';

create index if not exists intervals_checkins_pain_open_idx
  on public.intervals_checkins (source_id, session_date desc)
  where pain = true and pain_resolved_at is null;
