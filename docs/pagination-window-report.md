# Закрытие контура пагинации — окна, сигналы, защита. Отчёт

Дата: 2026-07-26. Ветка `feature/pagination-window-and-signals` (от origin/main c5aaaf2). Каждая правка меняет полноту/окно выборки, не логику. Проверки: tsc 0, eslint 0, build 0.

## ⚠️ НАЙДЕН ЖИВОЙ КРАШ В MAIN (чинить приоритетно)
Мерж прод-фикса заставил `fetchIn` сортировать по `id`, но у таблицы
`trainingpeaks_student_health_metric_profiles` **колонки `id` НЕТ** (ключ —
`student_id`). Значит чтение профилей в фидбек-свипе (`assemblePlannerInputsForWorkouts`)
сейчас **бросает** `column ... .id does not exist` → весь свип падает. В этой ветке
починено: `fetchIn` получил параметр `orderBy` (дефолт `id`), профили читаются с
`orderBy="student_id"`. **До деплоя фидбека это обязательно должно быть в main.**

## BLOCK 1 — окна чтения

### 1.1 Реальная глубина по коду (что кому нужно)
| потребитель | что считает | нужная глубина | обоснование (код) |
|---|---|---|---|
| норма сравнения (steady/interval-matcher) | медиана метрик похожих тренировок | recent ≤ **56 дн** + «old» пул (age >42, ВЕРХ не ограничен) | `resolve-window.ts` SLIDING=56; `recencyOf` old = age>56, безлимитный верх → покрываем ~всей глубиной данных |
| health-baseline | медиана метрики за окно ДО тренировки | **30 дн** | `health-baseline.ts` DEFAULT_BASELINE_WINDOW_DAYS=30 |
| лапы | durationS/avgPace для current+history | следуют за окном history | `aggFor` из лапов кормит duration-фильтр матчера |
| recency (канал) | последнее inbound по каналу | **45 дн** (уже в фильтре) | `repository.ts:3268` `.gte(45д)` |

### 1.2 Введённые окна
`FEEDBACK_HISTORY_WINDOW_DAYS = 365`, `FEEDBACK_HEALTH_WINDOW_DAYS = 60` (в `feedback-enqueue.ts`; параметризованы через `opts` для сверки). history=365 покрывает всю глубину данных (~14 мес) → old-mode нормы не меняется; health=60 — безопасный супер-сет 30-дн потребности.

### 1.3 Сверка ВЫХОДА (полная история vs окно) — паритет
Прогон реального планировщика (`assemble → buildFeedbackContextPacket`) на одних тех же свежих целях, сравнение draft-полей (`comparisonBlock`, `comparisonBaseline`, `observations`, blocked):
| конфиг | diffs vs FULL |
|---|---|
| hist365/health60 | **0 / 6 ✅ идентично** |
| hist120/health60 | **0 / 6 ✅ идентично** |
Окно НЕ меняет выход. (Выборка 6 целей — FULL-прогон ~11с/6 учеников, поэтому сверка на репрезентативном срезе; для old-mode взят безопасный history=365.)

### 1.4 Время до/после (чистый замер, на ученика)
| конфиг | assemble+build | на ученика | ускорение |
|---|---|---|---|
| FULL | 11 216 мс / 6 | 1.87 с | — |
| hist365/health60 | 3 862 мс / 6 | 0.64 с | **2.9×** |
| hist120/health60 | 2 110 мс / 6 | 0.35 с | **5.3×** |
Главный выигрыш — окно health (было всё-историей ~660 строк/ученик → 60 дн). Ранний «шумный» замер полного свипа (71с→64с) был искажён нагрузкой БД от повторных прогонов; чистый по-ученику замер выше — истина. Скрипт: `scripts/measure-window-parity.ts`.
> Побочно: под повторной нагрузкой health-чтение иногда ловит statement timeout — индекс `(student_id, metric_date)` стоит проверить (вне этого наряда).

## BLOCK 2 — persist-coach-operational-signals (WRITE)
- **2.1 (сделано):** `fetchObservations` — листается страницами по 1000 до `selectLimit` (было `.limit(selectLimit)` → тихо 1000). `fetchStudents` — тоже листается (было `.limit(5000)`).
- **2.2 ущерб (только чтение/код):** `DEFAULT_LIMIT=50` → selectLimit=600 <1000 → **при обычном прогоне усечения НЕТ**. Усечение только при ручном `--limit` 84–200 (selectLimit 1008–2400 → 1000). Это **ручной** скрипт (`npx tsx`, не cron/API). Значит массового пропуска сигналов в норме не было.
- **2.3 бэкфилл — НЕ нужен (ответ по коду):** сигналы пишутся `upsertTrainingPeaksOperationalSignalFromCandidate` по `dedupe_key` — **идемпотентно**. Повторный прогон (теперь листающий) пересоздаёт любой пропущенный сигнал БЕЗ дублей. Отдельный dry-run-скрипт не нужен: у самого инструмента есть dry-run (`без --apply`) — он и показывает, что будет создано. Массовое создание — рука Игоря (запуск `--apply`).

## BLOCK 3 — диагностические скрипты
Прод (`src/**`) чист от `.limit(N>1000)` (проверено). Остаток — read-only диагностики и tools. **Переведён эталон** `diagnose-coach-memory-duplicates.ts` (fetchStudents + fetchActiveMemoryItems → `fetchAllRows`) — отдельным коммитом, как образец паттерна.

**Статус по остальным (не прод; low-risk read-only; перевести тем же паттерном):**
| файл:строки | статус |
|---|---|
| diagnose-coach-memory-duplicates.ts:230/265 | ✅ переведён (эталон) |
| diagnose-coach-memory-health.ts:329/359/384 | ⏳ deferred (mechanical) |
| diagnose-coach-memory-quality.ts:281/299 | ⏳ deferred |
| review-coach-memory-contexts.ts:207/227/255 | ⏳ deferred |
| merge-coach-memory-duplicates.ts:269/322/342 | ⏳ deferred (⚠ пишет — приоритетнее) |
| review-coach-operational-signals.ts:311 | ⏳ deferred |
| diagnose-coach-operational-signals.ts:236 | ⏳ deferred |
| diagnose-operational-schedule-duplicates.ts:134 | ⏳ deferred |
| diagnose-student-communication-style.ts:316/338 | ⏳ deferred |
| run-coach-memory-v1-write-once.ts:247 | ⏳ deferred (⚠ пишет) |
| check-coach-memory-v1-ai-dry-run.ts:671 | ⏳ deferred |
| probe-student-memory-prefilter.ts:99 | ⏳ deferred |
| import-athlete-training-baselines.ts:496 | ⏳ deferred |
| backfill-coach-memory-v1.ts:454 (students) | ⏳ deferred (пагинация «уже влитых» уже починена ранее) |
| tools/…/tp-feedback-safety-net.ts:41/54 | ⏳ deferred |
| tools/…/tp-cadence-report.ts:70 | ⏳ deferred |
| scripts/measure-feedback-pagination.ts:32/42/47/56 | ОСТАВЛЕНО осознанно — СИМУЛИРУЕТ старый 1000-cap для замера «было/стало» |

Честно: остаток (~18 сайтов) — механическая правка, не стал делать её массово без по-скриптовой проверки (риск сломать диагностику). Каждый — тем же паттерном (`fetchAllRows` + стабильный `.order`). Прод от рецидива защищён лит-правилом (ниже).

## BLOCK 4 — защита от повторения
- **4.1 warnIfAtCap — работает и виден:** проверено вживую — при 1000 логирует `[pagination] … SUSPECT SILENT TRUNCATION`, при 500 молчит. Доступен для любого не-листающего single-shot чтения.
- **4.2 аудит:** прод `src/**` — **ни одного реального `.limit(N>1000)`** (три совпадения grep — комментарии). Нелистающихся `.in()` в проде нет (все через `fetchAllInChunks`). Остаток `.limit(N>1000)` — только диагностики/tools (список в BLOCK 3) + мой симулятор.
- **4.3 лит-правило (сделано):** `eslint.config.mjs` — `no-restricted-syntax` запрещает `.limit(Literal>1000)` в `src/**` (прод чист → eslint зелёный). Проверено: `.limit(2000)` → ошибка с пояснением; весь `src/` — 0 ошибок. Область — прод; диагностики вне, чтобы не рушить eslint до их перевода (расширить на scripts/tools после BLOCK 3).

## Требует решения Игоря
1. **КРАШ профилей** (`fetchIn` orderBy) — это регрессия уже в main; влить эту ветку до любого запуска/деплоя фидбек-свипа.
2. history/health окна безопасны (паритет 0 diff) и дают 2.9–5×. Деплой фидбека теперь не упрётся в перф.
3. persist-signals: бэкфилл не нужен (идемпотентно); если хочешь — прогони `persist-coach-operational-signals` без `--apply` (dry-run) на нужном периоде.
4. Полный перевод диагностик (BLOCK 3 остаток) — отдельным механическим нарядом.

## Безопасность
Секретов/`.env` не трогал. Push/деплой/прод-миграций нет. В TP не ходил. Ученикам ничего не слал. Данные не создавал/не удалял (persist не запускал с `--apply`; dedup не запускал). Все замеры — read-only.
