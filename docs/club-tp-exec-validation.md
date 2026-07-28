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
tsc 0, eslint 0, build OK, auth 8/8, тире/эмодзи в интерфейсе клуба нет. Идемпотентность и guard-строка -
проверены фактом; DB write-back/откат - код готов, фактический round-trip ждёт seeded-записи.

---

# Исправление типов TP (после ручной проверки Игоря)

Ручной тест показал: TP имеет РОДНОЙ тип «Day off». Старое сопоставление слало day_off как Other(100).

## Value_id типов - ПРОБА ФАКТОМ (из реального кэша)
Прогнал distinct workout_type_value_id по кэшу (read-only). Подтверждено фактом:
- **Run = 3**, **Other = 100**, **Day off = 7** (строка value_id=7, title "Отдых"/"Работа", is_planned=false,
  is_completed=false), Cross-Train = 5 (Эллипс), XC-Ski = 11, Swim = 1, Bike = 2, Strength = 9, Walk = 13.
- **Custom = 10** - в данных нет ни одной строки; значение из документированного enum TP, НЕ подтверждено фактом.

## Новое сопоставление
- **day_off → тип 7 (Day off, родной)** - вместо Other(100).
- note (заметка) → **Other(100)**: у TP нет типа «заметка». Custom(10) не подтверждён в данных, Other(100) -
  подтверждённый catch-all (create проверен ручным тестом). Выбор: Other(100).
- preference (пожелание по типу) → то же, **Other(100)** (та же причина).
- race → **Run(3)** с дистанцией (без изменений, верно).

## Guard на Day off - проверено фактом, сохраняется
Тип 7 ДЕРЖИТ произвольный заголовок: 3 реальные строки value_id=7 с title "Отдых", "Работа" (т.е. кастомный
текст, не фикс). Значит sentinel «клубная пометка» в заголовке сохраняется → guard по заголовку работает и
для Day off. Условие «если заголовок не держится - другой якорь» НЕ наступило.
Бонус: тип 7 приходит is_planned=false / is_completed=false → сам по себе не считается ни planned, ни completed,
ни попадает в ленту (is_completed=true). То есть Day off даже БЕЗ guard не течёт в подсчёты/ленту/пропущенные.
Обрезка заголовка в календаре TP - это ОТОБРАЖЕНИЕ (UI); скан читает полный STORED-заголовок, sentinel цел.
(id-anchor доступен как запас: loadClubMarkerWorkoutIds + applied_tp_workout_id уже пишется - если понадобится.)

## Короткие заголовки (сохранён маркер)
| kind | было | стало |
|---|---|---|
| day_off | [Клуб] Выходной день (заявка ученика) · клубная пометка | **[Клуб] Выходной · клубная пометка** |
| preference | [Клуб] Пожелание: интервальная · клубная пометка | **[Клуб] Пожелание: интервальная · клубная пометка** |
| note | [Клуб] Заметка ученика · клубная пометка | **[Клуб] Заметка · клубная пометка** |
| race | (имя забега) | без изменений (Run, без sentinel) |
Стиль/эмодзи - константой CLUB_MARKER_TITLE_STYLE (дефолт text).

## Point 6 - Day off в кэше не считается тренировкой
Тип 7 приходит is_planned=false, is_completed=false (факт по 3 реальным строкам). Проверено:
- planned/completion подсчёты (красавчики/челлендж/статистика/агрегаты) - нужен is_planned/is_completed → не считается.
- лента (is_completed=true) → не попадает.
- сигнал «пропущенная» (planned-not-completed) → is_planned=false → не сигналит.
- классификатор: тип 7 НЕ в authoritative-map → падает на title-эвристики; заголовок «Выходной» не содержит
  токенов «отдых/day off» → не помечается как day_off-семья, не как run. Плюс guard-sentinel исключает раньше.
- reply-draft-context: family=="day_off" - лишь текстовая метка «отдых», не счётчик.
Вывод: Day off безопаснее прежнего Other(100) (тот был is_planned=true и ТРЕБОВАЛ guard в подсчётах).

## Проверка ОДНОЙ записи Day off (команда - рука Игоря)
Засеяна свежая approved day_off запись (2027-01-15, id 1c38952a-f2c2-42cd-bde6-8b92f67d8dd0). execute-one dry-run
даёт payload: type 7, title «[Клуб] Выходной · клубная пометка». Реальную запись НЕ делал. Команды - в ответе/чате.
Старую запись Игоря (Other 100, 11 янв, id ba1428e4…, статус applied) откатить отдельной командой.

---

# Гонка как Event + разведка Events API (после ручной проверки)

Ручная проверка: забег создался как Run 21.1 км. Но у TP есть родная сущность Event («Add Event»),
и забег должен быть ею. Разобрался с Events API и перевёл race на Event за флагом.

## Task 1 - почему probe вернул 500 (разведка)
Старый probe бил `POST .../events` (МНОЖЕСТВЕННОЕ) с телом `{athleteId, name, eventDate, eventType:"Other", description}`.
Причины 500 (все сразу):
- **Эндпоинт**: надо `POST /fitness/v6/athletes/{id}/event` (ЕДИНСТВЕННОЕ `/event`).
- **Поле**: `personId` (id атлета), НЕ `athleteId`.
- **eventType**: реальный тип `"RunningRoad"`, НЕ `"Other"`.
- **Не хватало полей**: distance/distanceUnits/goals/legs/workouts/results.
Правильный контракт - `docs/tp-write-payloads.md §2` (из UI-захвата, ответ 200, event id 39611915).

**Проверено фактом (read-only):** `getEvents(3102415, ...)` прочитал событие 39611915 (RunningRoad, 2026-07-25,
dist=5000). Ключи события: id, personId, eventDate, name, eventType, description, comment, results, legs,
workouts, goals, atpPriority, atpId, atpWeekId, raceTypeDuration, isHidden, isLocked, externalEventSource,
externalEventId, ctlTarget, distance, distanceUnits.
- **Type**: `RunningRoad` (в данных только он). Приоритет A/B/C - отдельное поле `atpPriority` (int|null).
- **Goals**: объект с полями `{distance, time, place, finish, pr, written, ...}` → **целевое время идёт в `goals.time`**
  (поле ЕСТЬ). Но приём `goals.time` на CREATE не проверен (в захвате было `goals:{}`).

## Task 2 - race → Event за флагом CLUB_RACE_AS_EVENT
- Флаг `CLUB_RACE_AS_EVENT` (ВЫКЛ по умолчанию → Run как сейчас; ВКЛ → Event). Откат = флаг обратно.
- Планировщик: при флаге строит `create_event` c payload из §2 (name, eventType RunningRoad, eventDate,
  personId, distance/units, atpPriority=null, description=[дистанция·город·цель], goals, results). Цель времени -
  в описании; в `goals.time` только при CLUB_RACE_SET_PLANNED_TIME (поле есть, приём на create не проверен).
- `createEvent`/`deleteEvent` в tp-api-client (POST/DELETE `/event`). execute-one диспетчит create_event vs
  create_workout; откат - deleteEvent vs deleteWorkout (определяет пере-планированием).
- Проверено фактом (dry-run, в TP не писал): при CLUB_RACE_AS_EVENT=true payload = create_event RunningRoad
  distance=42200 personId=3102415; при флаге OFF - create_workout type 3. Оба чисто.
- КАВЕАТ отката: deleteEvent endpoint (`DELETE /event/{id}`) не проверен end-to-end - подтвердить первым откатом.

## Task 3 - Event НЕ попадает в кэш тренировок (факт)
Событие 39611915 в `trainingpeaks_workout_cache` - **0 строк** (скан читает /workouts, события - отдельный
ресурс). Значит гонка-Event НЕ считается тренировкой нигде, а клуб всё равно видит старт из
`club_calendar_entries` (источник истины). Это лучший вариант: ни фиктивной тренировки, ни риска подсчётов.

## Task 4 - родной сущности для заметки НЕТ (разведка)
В событиях только тип RunningRoad; отдельного «note»-типа события не видно - events API про ГОНКИ/события,
не про заметки на день. Раздел «Add Other» в диалоге я захватить не могу (нужен браузер-захват сети у тебя).
Без подтверждённого контракта note/preference ОСТАЮТСЯ Other(100) + guard (guard проверен на реальных данных -
отсекается везде). Если сделаешь UI-захват «Add Other» - переведу.

## Проверки
tsc 0, eslint 0, build OK, auth 8/8, тире/эмодзи чисто. Events read - фактом (getEvents OK). Реальную запись в TP
не делал. Свежая approved race-запись для теста Event: 2027-01-16, id a79d5500-e538-4429-8bc0-032087219c7b.
