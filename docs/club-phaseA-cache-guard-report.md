# Club Phase A — защита кэша от служебных клубных записей (отчёт)

Ветка `feature/club-cache-guard`, застекована на `feature/club-final-docs` (вершина прошлого стека).
БЛОКЕР включения `CLUB_TP_EXECUTION_ENABLED`: пока эта фаза не в main, включать исполнение НЕЛЬЗЯ —
служебные пометки загрязнят подсчёты. Всё за существующими флагами; общие модули тронуты минимально
(только фильтр, описано ниже).

## A1. Разведка последствий (фактом по коду)
Клубная пометка = запланированная тренировка типа Other(100), не завершена, описание-только. Корень
проблемы: `classifyBySportTitle` (workout-activity-classification.ts:281-327) по ключевым словам в
названии («интерв», «длительн», «темп», «бег») ставит `isRunning=true` для типа 100, у которого
authoritative-классификатор возвращает unknown. Итог по пунктам:

| Потребитель | Течёт? | Где |
|---|---|---|
| Клубная лента | НЕТ | getClubFeed → loadFeedCandidates `.eq(is_completed,true)` + isFeedRow (service.ts:401,1462) |
| **% выполнения / planned (красавчики/челлендж/статистика/агрегаты)** | **ДА** | performerCountsFromRows (1137), computeDailyAggregates (1230), computeWeekRollups (1324) — единственный гейт `isRunning`; «Пожелание: интервальная/длительная» → isRunning=true → считается planned |
| **Сигнал «пропущенная тренировка»** | **ДА** | trainingpeaks/service.ts:5963-5980: planned+not-completed+isRunning → missed → coach-desk + утренний дайджест (attention-telegram.ts:287,320) |
| Фидбек-планировщик | НЕТ | feedback-enqueue.ts:332,501 ключуется на derived_metrics.workout_type='run'; у пометки нет derived-строки |
| Реконструкция рекордов | НЕТ | buildRecordInputs (1010): isCompleted && isRunning && distance>0 && duration>0 |
| Дайджест | ДА (через missed) | тот же путь, что #3 |
| **Nutrition plan-week context** | **ДА (условно)** | nutrition/context.ts:1115 plannedOnly тянет пометку; type-100 исключается только при профиль-флаге excludeOtherActivities=ON |

Пометки «Выходной»/«Заметка»/«Пожелание: отдых» (isRunning=false) сами по себе НЕ считались planned,
но исключаю их тоже (единый фильтр по маркеру — надёжнее, чем полагаться на классификатор).

## A2. Надёжный признак служебной записи (оба сигнала)
`src/features/club/cache-guard.ts`:
- **Маркер в названии** — `CLUB_MARKER_TITLE_SENTINEL = "клубная пометка"`, добавляется к КАЖДОМУ
  не-гоночному маркеру в планировщике (`planCalendarEntryAction`, tp-execution.ts). `isClubMarkerTitle(title)`.
- **Обратная ссылка** — `loadClubMarkerWorkoutIds()` из `club_calendar_entries.applied_tp_workout_id`
  (авторитетно, переживает правку названия). `isClubMarkerCacheRow(row, ids)` — по названию ИЛИ по id.
Гонки маркера НЕ несут (клубная гонка = реальный запланированный бег, считается как настоящий).

## A3. Исключения (минимально; общие модули — с описанием)
- **Клубный чокпоинт (свой модуль):** `loadClubWorkoutRows` — SQL-фильтр `.not("title","ilike","%клубная
  пометка%")`. ОДНА точка закрывает все клубные подсчёты (performers, дневные/недельные агрегаты,
  materialize, рекорды) — и сырой путь, и материализованный, т.к. оба читают через loadClubWorkoutRows.
- **Общий модуль trainingpeaks/service.ts (missed-сигнал):** одна строка `if (isClubMarkerTitle(row.title)) continue;`
  в цикле missed (5964). ПОЧЕМУ правка общего модуля: сигнал «пропущенная» читает кэш напрямую и
  ложно срабатывал бы на «Пожелание: интервальная». Импорт — чистая leaf-функция (cache-guard тянет
  только supabase, без trainingpeaks → цикла нет).
- **Общий модуль nutrition/context.ts (plan-week):** `baseRows = allRows.filter(r => !isClubMarkerTitle(r.title))`
  до всех подсчётов. ПОЧЕМУ: при excludeOtherActivities=OFF пометка попадала в totalSessions/
  plannedSessions/runningSessions/keyWorkouts. Одна строка фильтра.
Обратная ссылка (`loadClubMarkerWorkoutIds`) предоставлена модулем и используется как второй сигнал в
`isClubMarkerCacheRow`; на клубном чокпоинте достаточно названия (маркер ставится при создании).

## A4. Проверка фактом
Скрипт вставил ОДНУ тестовую пометку (худший случай: «🎯 Пожелание: интервальная · клубная пометка»,
type 100, planned, not-completed) и проверил:
- планировщик даёт названия с маркером, все три детектируются; гонка — без маркера; обычный бег не
  ловится ложно (9/9);
- в кэше сейчас 0 строк с маркером (загрязнения нет — Фаза 11 не исполнялась);
- тестовая пометка БЫ классифицировалась как бег (гейт нужен), но **исключена из loadClubWorkoutRows**;
- дневные агрегаты: `plannedRunning=0` за день пометки.
Итог **9 passed, 0 failed**. Тестовая строка удалена через RPC
`reconcile_trainingpeaks_workout_cache_planned_rows` (service_role не имеет DELETE на кэше — известное
ограничение; вставка была, чистка через reconcile; проверено: 0 строк с маркером осталось).
Прочее: `smoke-feedback-sweep` PASSED (регрессия для правки trainingpeaks/service.ts), in-memory
aggregates-parity **0** (моя правка алгебраически нейтральна). realdb-parity показал 2 расхождения —
это СТАРЕНИЕ материализованной таблицы (авто-цель челленджа 2510 live vs 2520 в таблице; clubKm/топы/
personal совпадают), лечится свежим `materialize --all` перед включением флага, к маркерам отношения нет.

## A5. Альтернатива: писать в TP что-то безвредное вместо фиктивной тренировки
Оценка по коду write-клиента (Фаза 11 разведка): **сейчас безвредной альтернативы нет проверенным путём.**
- TP-клиент умеет создавать ТОЛЬКО workout. Отдельного «комментария к дню»/annotation/event — нет
  проверенного API (probe POST /events вернул 500).
- «Дописать в description существующего дня» = update_workout существующей тренировки — это ПРАВКА
  существующего плана (наряд запрещает трогать), и день может не иметь тренировки, к которой привязаться.
**Предпочтительный путь (если довести):** доказать events/annotation API (createEvent) живым захватом
payload. Событие/заметка NOT входит в trainingpeaks_workout_cache как planned workout → загрязнения нет
вовсе, и cache-guard для пометок становится не нужен. До этого — фиктивная пометка-workout + этот guard
единственный безопасный путь. Рекомендация в отчёте Фазы 11 уже есть; здесь — подтверждение, что guard
необходим именно потому, что безвредная запись пока недоступна.

## Проверки (все пять)
`tsc` 0, `eslint` 0, `build` OK (циклов импорта нет), `check-initdata-auth` 8/8, `smoke-feedback-sweep`
PASSED. Плюс guard-верификация 9/9, in-memory parity 0. Защищённые общие модули (валидатор initData,
резолверы desk/n, /m/layout) НЕ тронуты — правки только в missed-сигнале и nutrition-контексте (описаны).

## Итог для Фазы H (порядок включения)
`CLUB_TP_EXECUTION_ENABLED` НЕЛЬЗЯ включать, пока эта ветка не в main: иначе исполнённые пометки
вернутся кэшем и (до guard) ложно посчитаются planned + дадут ложный «пропуск» + попадут в nutrition.
Порядок: влить Фазу A → (свежий materialize --all) → только потом любое включение исполнения Фазы 11.
