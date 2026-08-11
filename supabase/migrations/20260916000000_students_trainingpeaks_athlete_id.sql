-- trainingpeaks_students: завести НАСТОЯЩУЮ колонку с id атлета TrainingPeaks.
--
-- НЕ ПРИМЕНЯЕТСЯ ЭТИМ НАРЯДОМ — только файл.
--
-- ЗАЧЕМ. Отдельной колонки с id атлета в trainingpeaks_students нет: id живёт внутри
-- trainingpeaks_athlete_url ("https://app.trainingpeaks.com/#calendar/athletes/5475968") и
-- достаётся разбором строки. На 16.08 в репозитории 31 независимая копия одной и той же
-- регулярки /athletes/(\d+)/ в 28 файлах — src/features/trainingpeaks (repository, service,
-- athlete-roster-import, group-workout-report-*), tools/trainingpeaks-export/scripts (scan-events,
-- fit-ingest-scan, health-metrics-scan, race-prediction-probe и другие), scripts/diagnose-*.
--
-- ЧЕМ ПЛОХО ИМЕННО ЗДЕСЬ. Связь рвётся МОЛЧА. Если TrainingPeaks поменяет формат ссылки,
-- regexp вернёт null, и код не упадёт, а просто перестанет находить ученика: ростер сожмётся,
-- недели не сгенерируются, метрика посчитается по меньшей выборке — и всё это без единой ошибки
-- в логах. Ровно такой класс отказов уже ловили в этом проекте (см. tp-enumeration-underfetch).
--
-- ЧТО ДЕЛАЕТ МИГРАЦИЯ:
--   1) добавляет trainingpeaks_athlete_id bigint;
--   2) заполняет его из URL один раз (на 16.08 разбирается 126 из 126 — потерь нет);
--   3) ставит уникальный индекс: один id — один ученик.
-- URL НЕ УДАЛЯЕТСЯ: он нужен для ссылок в интерфейсе, и снос колонки сломал бы 28 файлов разом.
--
-- ЧТО ОБЯЗАНО ПОЙТИ СЛЕДОМ, ОТДЕЛЬНЫМ НАРЯДОМ (в этом наряде код НЕ трогали):
--   - импорт ростера (src/features/trainingpeaks/athlete-roster-import.ts) должен ПИСАТЬ
--     trainingpeaks_athlete_id при вставке и обновлении, иначе новые ученики придут с null;
--   - 31 копия регулярки заменяется чтением колонки;
--   - после перевода всех чтений — NOT NULL на колонку, чтобы порванная связь падала громко,
--     а не молча. Сейчас NOT NULL ставить НЕЛЬЗЯ: писателя у колонки ещё нет.

alter table public.trainingpeaks_students
  add column if not exists trainingpeaks_athlete_id bigint;

comment on column public.trainingpeaks_students.trainingpeaks_athlete_id is
  'id атлета в TrainingPeaks. Заведён 16.08 вместо разбора trainingpeaks_athlete_url регуляркой (31 копия в 28 файлах). Писателя пока нет — заполняется бэкфиллом; NOT NULL ставить после перевода импорта ростера.';

update public.trainingpeaks_students
set trainingpeaks_athlete_id = (substring(trainingpeaks_athlete_url from 'athletes/([0-9]+)'))::bigint
where trainingpeaks_athlete_id is null
  and trainingpeaks_athlete_url ~ 'athletes/[0-9]+';

-- Один id — один ученик. Частичный индекс: пока колонка заполняется не всеми путями,
-- null-ы не должны мешать друг другу.
create unique index if not exists trainingpeaks_students_athlete_id_key
  on public.trainingpeaks_students (trainingpeaks_athlete_id)
  where trainingpeaks_athlete_id is not null;

-- ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ (ожидается 0 строк):
--   select id, trainingpeaks_athlete_url from public.trainingpeaks_students
--   where trainingpeaks_athlete_id is null;
