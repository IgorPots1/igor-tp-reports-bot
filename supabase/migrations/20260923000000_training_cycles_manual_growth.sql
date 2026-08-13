-- training_cycles: РУЧНОЙ ШАГ РОСТА и ЦЕЛЕВОЙ ОБЪЁМ К КОНЦУ ЦИКЛА.
--
-- НЕ ПРИМЕНЯЕТСЯ ЭТИМ НАРЯДОМ — только файл.
--
-- ЗАЧЕМ. Цель цикла целиком выводится из ПРОШЛОГО атлета: база — взвешенная середина между
-- медианой и p75 его же плановых недель, шаг — общая константа 1.06. Для человека, которому
-- тренер прямо сейчас решил поднимать объём, этого мало: из истории такое решение не выводится
-- вообще, потому что его в истории ещё нет. Игорь называет поимённо Кудрявцеву и Круглову.
--
-- ДВА СПОСОБА ЗАДАТЬ ОДНО И ТО ЖЕ, тренер выбирает удобный:
--   step_aerobic_manual / step_quality_manual — «расти по столько-то процентов в неделю»;
--   target_peak_weekly_min — «хочу к концу цикла столько-то минут в неделю», шаг система
--     подбирает сама так, чтобы пик ряда попал в это число.
-- Заданы оба — главнее ЦЕЛЕВОЙ ОБЪЁМ: он говорит про результат, а шаг лишь про способ.
--
-- ЧЕГО ЭТИ ПОЛЯ НЕ ОТМЕНЯЮТ. Ни одной защиты: предел одного перехода (x1.22, p90 практики,
-- n=1715), допуск доли качества (+-2 п.п. от личной обычной), полы сессий, потолок доли
-- работы (0.20 недели, p90), доля длительной (0.45 недели), потолок длительной. Ручной рост
-- задаёт НАМЕРЕНИЕ по объёму, а не право нарушать рамки.
--
-- ПОЧЕМУ ОТДЕЛЬНЫЕ КОЛОНКИ, А НЕ ПРАВКА step_aerobic. step_aerobic уже есть, но он NOT NULL
-- с дефолтом 1.060, и «тренер задал 1.06» неотличимо от «никто ничего не задавал». Ровно
-- по этой причине для базы завели пару base_aerobic_min / base_aerobic_min_manual — здесь
-- та же развилка и то же решение.
--
-- ПОМЕТКИ ИСТОЧНИКА:
--   [практика]      — измерено по данным Игоря
--   [решение Игоря] — принято тренером, практикой не подтверждается
--   [выведено]      — ни то ни другое

alter table public.training_cycles
  add column if not exists step_aerobic_manual numeric(4,3),
  add column if not exists step_quality_manual numeric(4,3),
  add column if not exists target_peak_weekly_min integer,
  add column if not exists growth_manual_reason text;

comment on column public.training_cycles.step_aerobic_manual is
  'Ручной недельный шаг роста аэробного объёма, заданный тренером. null — брать расчётный (step_aerobic). Выше предела одного перехода 1.220 не принимается: это p90 практики [практика, n=1715].';

comment on column public.training_cycles.step_quality_manual is
  'Ручной недельный шаг роста минут работы. null — брать расчётный (step_quality). Доля качества всё равно держится в пределах +-2 п.п. от личной обычной.';

comment on column public.training_cycles.target_peak_weekly_min is
  'Целевой ОБЩИЙ объём недели (аэробный + работа) к пику цикла, мин. Шаг подбирается системой так, чтобы пик ряда попал сюда; выше предела одного перехода не разгоняется. Главнее ручного шага, если заданы оба. [решение Игоря]';

comment on column public.training_cycles.growth_manual_reason is
  'Зачем тренер задал ускоренный рост. Уходит в отчёт рядом с числами, чтобы через месяц было видно, чьё это решение.';

-- Предел одного перехода — та же величина, что в коде (MAX_SINGLE_STEP = 1.22).
-- Ограничение стоит В БАЗЕ, а не только в коде: строку в таблицу тренер вставляет руками,
-- и опечатка «1.9» не должна доехать до генерации вообще.
alter table public.training_cycles
  add constraint training_cycles_step_aerobic_manual_range
    check (step_aerobic_manual is null or (step_aerobic_manual >= 1.000 and step_aerobic_manual <= 1.220));

alter table public.training_cycles
  add constraint training_cycles_step_quality_manual_range
    check (step_quality_manual is null or (step_quality_manual >= 1.000 and step_quality_manual <= 1.220));

alter table public.training_cycles
  add constraint training_cycles_target_peak_weekly_range
    check (target_peak_weekly_min is null or (target_peak_weekly_min > 0 and target_peak_weekly_min <= 1200));
