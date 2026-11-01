-- trainingpeaks_students.trainingpeaks_athlete_id: повторный бэкфилл из URL.
--
-- ЗАЧЕМ. Миграция 20260916000000 завела колонку и заполнила её один раз, но писателя у колонки
-- не было: insertTrainingPeaksStudent (импорт ростера и форма «добавить ученика») её не писал.
-- Все, кого завели после 16.09, пришли с null: на 01.11 это 34 строки (33 активных, 1 архивная),
-- заведены 15.09, 22.10 и 26.10. Писатель добавлен в том же наряде (repository.ts).
--
-- ПРАВИЛО ТО ЖЕ, ЧТО В 20260916000000: id из 'athletes/<цифры>' в trainingpeaks_athlete_url,
-- только там, где колонка пуста. Маркер интервалов 'intervals://athlete/…' под правило не попадает.
-- Столкновений с уникальным индексом trainingpeaks_students_athlete_id_key на 01.11 нет (проверено).
--
-- ПРИМЕНЯТЬ ТОЛЬКО ПО ОТДЕЛЬНОМУ «ДА» ИГОРЯ: это UPDATE существующих строк.
-- ПРИМЕНЕНА 01.11.2026 по «да» Игоря через Supabase-MCP: задето 34 строки, после — 0 с null
-- при url, 160/160 id совпадают с url; версия 20261101120000 зарегистрирована в schema_migrations.

update public.trainingpeaks_students
set trainingpeaks_athlete_id = (substring(trainingpeaks_athlete_url from 'athletes/([0-9]+)'))::bigint
where trainingpeaks_athlete_id is null
  and trainingpeaks_athlete_url ~ 'athletes/[0-9]+';

-- ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ (ожидается 0 строк):
--   select id, student_name, trainingpeaks_athlete_url from public.trainingpeaks_students
--   where trainingpeaks_athlete_id is null and trainingpeaks_athlete_url ~ 'athletes/[0-9]+';
