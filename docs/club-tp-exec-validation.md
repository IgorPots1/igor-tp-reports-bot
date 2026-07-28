# Club → TP execution — validation (Фаза 1)

Ветка `feature/club-tp-exec-validation`. Готовит исполнение пометок в TrainingPeaks и
проверяет guard/идемпотентность/откат. **Реальная запись в TP НЕ делалась** (рука Игоря).
Флаг `CLUB_TP_EXECUTION_ENABLED` — ВЫКЛ.

## 1.2 Guard: маркер и покрытие
**Строка-маркер совпадает буква в букву.** И планировщик, и guard используют ОДНУ константу
`CLUB_MARKER_TITLE_SENTINEL = "клубная пометка"` (`cache-guard.ts:29`): планировщик добавляет
` · клубная пометка` к каждой не-гоночной пометке (`tp-execution.ts:221`), guard ищет `includes("клубная пометка")`.
Расхождения строки нет по построению.

**Где guard отсекает служебные пометки (проверено по коду):**
| Место | Вердикт | Точка |
|---|---|---|
| Лента (клубный чокпоинт loadClubWorkoutRows) | ✅ есть | `service.ts:406` `.not(title ilike %sentinel%)` |
| Лента (keyset feed loadFeedCandidates) | ⚠️→✅ починил | было только `is_completed=true` (маркеры planned, не попадали); добавил фильтр sentinel как защиту |
| Красавчики/челлендж/статистика/дневные+недельные агрегаты/materialize | ✅ есть | всё через loadClubWorkoutRows |
| Сигнал «пропущенная» | ✅ есть | `trainingpeaks/service.ts:5976` `if (isClubMarkerTitle(row.title)) continue` |
| Дайджест | ✅ есть | наследует снапшот сигнала |
| Реконструкция рекордов | ✅ есть | только из loadClubWorkoutRows (records.ts — чистые вычисления) |
| Питание (plan-week context) | ✅ есть | `nutrition/context.ts:1129` фильтр isClubMarkerTitle |
| Питание (проба no-training-week, соседние ±4 нед) | ⚠️→✅ починил | `context.ts:1380` считал маркер тренировкой; добавил `!isClubMarkerTitle` |
| Фидбек-планировщик | ✅ не течёт по построению | источник — derived_metrics `workout_type=run`; маркер Other(100) без FIT/метрик туда не попадает. Явного guard нет, утечки нет. |

Итог 1.2: строка-маркер корректна; две latent-точки (keyset feed, nutrition-сосед) закрыты фильтром.

## 1.3 Формат заголовка пометки (константа)
`CLUB_MARKER_TITLE_STYLE` в `tp-execution.ts` — одна правка меняет вид:
- `"text"` (ДЕФОЛТ) → префикс `[Клуб]`: «[Клуб] Выходной день (заявка ученика) · клубная пометка».
- `"emoji"` → 🛌/🎯/📝/🏁.
**Дефолт text, почему:** портируемо и надёжно (эмодзи может искажаться TP-API/экспортами/клиентами),
совпадает с no-emoji конвенцией мини-аппа клуба, тренер всё равно видит «[Клуб]». Guard якорится на
текстовый sentinel, поэтому детект не зависит от стиля. Хочешь глифы — поставь `"emoji"`.

## 1.4 Целевое время забега (totalTimePlanned)
**Единица — ЧАСЫ, по факту:** кэш хранит `completed_time_raw` в часах (`rawHoursToSeconds = raw*3600`,
`service.ts:623`), поле времени TP — часы. Значит для цели пишем `targetSeconds/3600`.
Константа `CLUB_RACE_SET_PLANNED_TIME` (ДЕФОЛТ false): пока не подтверждено write+readback пробой,
целевое время идёт ТОЛЬКО в описание (как сейчас). Планировщик уже умеет писать в поле — переключить
после пробы.
**Capability probe (рука Игоря):** создать один забег с `totalTimePlanned=1.5` (1ч30м), прочитать
обратно, сверить сохранённое значение/единицу; если TP хранит и возвращает — `CLUB_RACE_SET_PLANNED_TIME=true`,
описание останется дублем. (Write в TP — не автоном.)

## 1.5 РОВНО ОДНА пометка Other(100) — команда (НЕ запускал)
Скрипт `scripts/club-execute-one.ts` (готов, dry-run по умолчанию, реальная запись за тремя гейтами:
arg entryId + `--apply` + `CLUB_TP_EXECUTION_ENABLED=true`).

Шаги:
1. Создать одну approved-запись (пример: `scripts/club-calendar-seed-test.ts` сеет 4 тестовых на строке
   `CLUB_COACH_PARTICIPANT_STUDENT_ID`; возьми id нужной из вывода/БД).
2. Посмотреть план (в TP ничего): `node --experimental-strip-types --loader ./scripts/_alias-loader.mjs --env-file=.env.local scripts/club-execute-one.ts <entryId>`
3. Создать РОВНО ОДНУ (твоя рука): тот же вызов `+ --apply`, окружение с `CLUB_TP_EXECUTION_ENABLED=true`.
4. Проверить в TP: открой календарь ученика на дату — пометка «[Клуб] … · клубная пометка», тип Other; план дня на месте.
5. Убедиться, что guard отсёк: дождись скана (строка вернётся в `trainingpeaks_workout_cache`) →
   `scripts/smoke-club.ts` или проверь, что её нет в ленте/красавчиках; фактически строку с «клубная пометка»
   исключают все чокпоинты (см. 1.2).
6. Удалить: `... club-execute-one.ts <entryId> --rollback` (нужен `--apply` + флаг) — delete_workout по
   applied_tp_workout_id + очистка колонки + статус назад в approved.

## 1.6 Откат (delete_workout + очистка + возврат статуса)
- delete_workout ЕСТЬ и подтверждён: `deleteWorkout(host, athleteId, workoutId)` (`tp-api-client.ts:626`),
  исполнитель `tools/trainingpeaks-export/scripts/tp-write-executor-once.ts:425`, `buildRollbackPlan`
  create→delete (`tp-write-action-types.ts:77`).
- **БЫЛ ПРОБЕЛ:** `applied_tp_workout_id` НИКОГДА не записывался, статус `applied` не выставлялся, отката
  БД не было (только dry-run это описывал). **Починил:** `markCalendarEntryApplied(entryId, tpWorkoutId)` и
  `rollbackCalendarEntryApplied(entryId)` в `calendar.ts` (только БД, без TP): write-back ставит
  `applied_tp_workout_id`+`applied_at`+статус `applied`; откат чистит их и возвращает `approved`.
  Скрипт `club-execute-one.ts` вызывает их вокруг create/delete.
- Проверка фактом БД-половины требует seeded-записи (см. 1.1). Код скомпилирован (tsc), SQL корректен
  (update по id со сторожем по статусу). TP-delete подтверждён эмпирически ранее (комментарий клиента).

## 1.7 Идемпотентность — проверено фактом
Планировщик пропускает применённые записи: тест `test-idempotency.ts` (pure) — свежая запись планируется,
запись с `appliedTpWorkoutId` возвращает «уже применено … идемпотентно пропущено», повторный прогон дубль
не создаёт. **ВАЖНО:** идемпотентность работает ТОЛЬКО если `applied_tp_workout_id` реально пишется —
до 1.6 он не писался; теперь write-back (`markCalendarEntryApplied`) закрывает это.

## 1.1 Dry-run на реальных данных
`scripts/club-calendar-tp-dryrun.ts` перегенерирован — синтетические примеры теперь с text-заголовками и
sentinel. **Реальные строки НЕ засеяны:** `CLUB_COACH_PARTICIPANT_STUDENT_ID` не задан в .env.local и
сервис-аккаунтов ученика в БД нет — не смог определить «твою строку». Готов `scripts/club-calendar-seed-test.ts`
(seed/--clean на строке из env). Для полного DB-backed прогона: задай env (или дай id) → seed → dry-run → --clean.

## 1.8 STOP
`CLUB_TP_EXECUTION_ENABLED` НЕ включаю. Мясо готово (планировщик, guard, write-back, откат, идемпотентность,
константы). Дальше — твоя ручная проверка ОДНОЙ записи (1.5), потом команда на пакет.

## Проверки Фазы 1
tsc 0, eslint 0, build OK, auth 8/8, тире/эмодзи в интерфейсе клуба нет. Идемпотентность и guard-строка —
проверены фактом; DB write-back/откат — код готов, фактический round-trip ждёт seeded-записи.
