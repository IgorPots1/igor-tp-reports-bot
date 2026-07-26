# Club → TrainingPeaks: DRY-RUN (Фаза 3)

Что БЫ произошло при исполнении накопленных ОДОБРЕННЫХ заявок. Ничего не исполнено,
ничего не поставлено в очередь, статусы не изменены, в TP не записано. Флаг
`CLUB_TP_EXECUTION_ENABLED` — ВЫКЛ. Планы строятся ЧИСТЫМ модулем tp-execution.ts;
реальный путь — createTrainingPeaksAction(action_type=create_workout, status=pending_coach)
→ существующий пайплайн: dry-run → подтверждение тренером → локальный раннер → verify → откат.

## Итог

- Одобренных стартов: 0 (спланировано в create_workout: 0)
- Одобренных выходных: 0 (все → ручной review-case, см. ниже)

## Старты (club_races, approved)

_нет одобренных стартов_

## Выходные (club_dayoff_requests, approved)

_нет одобренных выходных_

## Пример плана старта (синтетический — форма payload)

- ✅ [start] Старт: Сочи Марафон → 2026-11-01 → action_type=create_workout, payload={"athleteId":123456,"workoutDay":"2026-11-01","title":"Сочи Марафон","workoutTypeValueId":3,"workoutSubTypeId":null,"description":"42.2 км, Сочи, Россия","coachComments":null,"distancePlanned":42195,"totalTimePlanned":null,"structure":null} · unresolved: totalTimePlanned (единица totalTimePlanned на write-payload не подтверждена — целевое время НЕ проставлено)

## Как это исполнилось бы (когда флаг ВКЛ)

1. План → `createTrainingPeaksAction` (action_type=create_workout, execution_status=not_started).
2. Пакетное подтверждение тренером СПИСКОМ, но исполнение — по одному.
3. Dry-run готовит точный payload; байт-в-байт ревалидация перед реальной отправкой.
4. Локальный раннер применяет; verify (readback) подтверждает; при провале — откат (create→delete).
5. Результат → club_races.sync_result_ref + status (applied/failed), виден тренеру и ученику.

Выходные: TP-представление отдыха не подтверждено (нет type-id, деструктив не фабрикуется),
поэтому они остаются ручным review-case до появления проверенного day-off типа.
