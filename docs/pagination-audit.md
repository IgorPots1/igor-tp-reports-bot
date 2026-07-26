# Аудит пагинации по всему проекту (read-only)

Дата: 2026-07-26. Ветка `feature/pagination-audit` (от origin/main a93474d). Правок кода нет — только разведка (5 Explore-агентов по подсистемам + проверка объёмов через Supabase MCP + эмпирические замеры клиентом). Свипы: фидбек/сравнение, дайджест/сигналы, питание, plan/E-Predictor/TP-sync/repository, scripts/, tools/.

## Вердикт одной фразой
**Да — тихое усечение на 1000 строк УЖЕ активно во многих местах за пределами клуба, и как минимум три случая портят контент/решения, касающиеся учеников (черновик фидбека, выбор канала отправки, порог/VDOT). Плюс один write-баг плодит дубли памяти тренера.**

## ⚠️ Ключевой факт (проверено эмпирично, меняет оценку половины находок)
Порог **`db-max-rows = 1000` — ЖЁСТКИЙ серверный**, и `.limit()` его НЕ поднимает. Замер тем же клиентом на `trainingpeaks_workout_laps` (153k строк):
```
.limit(2000)      → 1000 строк
.limit(6000)      → 1000 строк
.range(1000,2999) → 1000 строк   (запрошено 2000 — отдано 1000)
```
Следствия:
1. **`.limit(N>1000)` — НЕ защита.** Любое такое чтение молча режется на 1000. Это переводит кучу «borderline» находок (фидбек `.limit(6000)/.limit(40000)`, память `.limit(10000)`, сигналы `.limit(4000)`) в **АКТИВНО усекаются всегда**.
2. **Страница листания должна быть ≤1000.** `.range(from, from+999)` = 1000 строк за страницу, листать пока `rows.length == 1000`. `pageSize > 1000` ломает цикл: страница вернёт 1000 < pageSize → цикл решит, что данные кончились, и оборвётся на первой странице (см. write-баг backfill-памяти).
3. `.maybeSingle()/.single()/{ head:true, count }` — вне риска.

## Размеры таблиц (MCP, 2026-07-26) и уже-превышение на ученика
| таблица | строк | на ученика (макс / скольких уже >1000) |
|---|---|---|
| trainingpeaks_workout_laps | 153 773 | **макс 7 375; у 62 >1000** |
| trainingpeaks_health_metrics_cache | 144 761 | **макс 3 418; у 56 >1000** (одна метрика: макс 375, 0) |
| trainingpeaks_workout_cache | 22 939 | окно 365д ≈ 20 609 всего |
| trainingpeaks_student_contact_events | 19 597 | макс 3 007; у 1 >1000 |
| trainingpeaks_workout_derived_metrics | 18 352 | **макс 747; 0 >1000** (per-student безопасно) |
| trainingpeaks_telegram_context_observations | 12 571 | за 30д: макс 1 310; у 1 >1000 |
| trainingpeaks_student_context_snapshots / scan_status | 8 893 / 8 403 | — |
| trainingpeaks_message_intent_logs / coach_cases | 4 675 / 3 566 | — |
| physio_load/readiness/durability | 34 564 / 19 329 / 4 846 | **вне зоны: этот код их НЕ читает** (другое приложение в той же БД) |

`derived_metrics` per-student безопасен (макс 747 < 1000); опасность — там, где читают **laps** и **health_metrics** широким батчем/чанком/по ученику.

---

## СВОДКА: активные баги, влияющие на учеников (чинить первыми)
| # | место | таблица | почему усекается | что портит (ученик-facing) |
|---|---|---|---|---|
| 1 | `feedback/feedback-enqueue.ts:182` | workout_laps | `.in(150)` **без limit** → 1000/чанк | темп/длительность в **ЧЕРНОВИКЕ ученику** (факт-чек) |
| 2 | `feedback/feedback-enqueue.ts:114` | derived_metrics | `.limit(6000)` **режется до 1000 всегда**, нет order | норма/базовые линии → неверные дельты «vs твоя норма» |
| 3 | `feedback/feedback-enqueue.ts:159` | health_metrics | `.limit(40000)` **→ 1000 всегда**, нет order/даты | health-baseline/усталость (пульс/сон у тренировки) |
| 4 | `repository.ts:3268` `getTrainingPeaksStudentInboundRecency` | context_observations | `.in(150)`+45д **без limit** | **канал отправки** ученику (Business-DM окно/группа) |
| 5 | `repository.ts:2262` `listTrainingPeaksWorkoutCacheForDateRange` | workout_cache | день×все ученики, **без limit/range** | утренний дайджест: «пропущенные тренировки» недобирает |
| 6 | `tools/…/tp-threshold-estimation.ts:397` | workout_laps | `.in(150)` **без limit** → 1000/чанк | **порог/VDOT** (соседний derived-блок листается, лапы забыли) |

## СВОДКА: write-side и латентные
| # | место | эффект |
|---|---|---|
| 7 | `scripts/backfill-coach-memory-v1.ts:516` | `.range()` c pageSize **5000 > 1000** → цикл рвётся после 1-й страницы → «уже влитых» недосчитывает → **повторно ингестит → ДУБЛИ памяти тренера** (есть отдельный `diagnose-coach-memory-duplicates` — вероятно, следствие) |
| 8 | `scripts/persist-coach-operational-signals.ts:592` | WRITE: `.limit(4000)`→1000 → операционные сигналы для части сообщений в окне НЕ создаются |
| 9 | латентные «по всем ученикам» без `.range()`: `repository.ts:10699` contact_status, `:2314` scan_status, `:2723/2740/2758` списки студентов, `:2363` health-eligible; `feedback-enqueue.ts:365` активный ростер | безопасны при ростере ~600, **молча выпадут за 1000** — вся подсистема дайджеста/фидбека начнёт терять учеников |

---

## ФИДБЕК + БАЗА СРАВНЕНИЯ (КРИТИЧНО)
`comparison/*` в БД не ходит — база сравнения кормится `history` из `feedback-enqueue.ts`. Всё листовое — через `fetchIn()` (стр. 64): чанкует `.in()` по 150, **результат чанка не листает**.

| severity | file:line | таблица | фильтры | усекается? | что неверно |
|---|---|---|---|---|---|
| **CRIT (ученику)** | `feedback-enqueue.ts:182` | workout_laps | `.in(cache_id,150)`+`source=fit`, нет limit/order | **ДА, ~каждый чанк** (150×~9–40=1.5–6k) | `rawLapAgg`→`avgPaceSecPerKm`/`durationS` текущей тренировки → факт-чек → **черновик ученику** |
| **ВЫС** | `feedback-enqueue.ts:114` | derived_metrics | `.in(student_id,150)`+`run`+`.limit(6000)`, нет order | **ДА всегда** (6000→1000; в свипе много учеников) | `historyByStudent` → норма/базовые линии/`compareWorkout`; строки произвольны (нет order) |
| **ВЫС** | `feedback-enqueue.ts:159` | health_metrics | `.in(student_id,150)`+4 метрики+`.limit(40000)`, нет order/даты | **ДА всегда** (40000→1000) | `healthByStudent` → health-baseline/усталость |
| сред | `feedback-enqueue.ts:142` | context_observations | `.in(150)`+30д+`order desc`+`.limit(8000)` | **ДА** (8000→1000) | слова ученика в промпт (старые в окне выпадают; newest сохраняется) |
| сред | `feedback-enqueue.ts:374` | context_observations | 48ч+`order desc`+`.limit(5000)`, `report_like` в JS | **ДА** (5000→1000) | при трафике >1000/48ч отчёты-репорты не попадут → run не сдрафтится |
| низ-лат | `feedback-enqueue.ts:365` | students | вся таблица, без limit | нет (ростер ~600) | при >1000 активные без черновиков |
| низ | `feedback-queue.ts:170` | jobs | `.in(150)`, без limit/статуса | борд-низ | пропуск блок-состояния → дубль enqueue (самолечится) |

## DIGEST / АТТЕНШН / СИГНАЛЫ
| severity | file:line (fn) | таблица | фильтры | усекается? | что неверно |
|---|---|---|---|---|---|
| **ВЫС (ученику)** | `repository.ts:3268` `getTrainingPeaksStudentInboundRecency` | context_observations | `.in(150)`+45д+`order desc`, нет limit/range | **ДА, вероятно уже** | recency inbound → **канал отправки** (Business-DM 24ч/группа); кормит `/api/m/desk/reports/list` |
| 🟠 борд-актив | `repository.ts:2262` `listTrainingPeaksWorkoutCacheForDateRange` | workout_cache | `from=to=вчера`, все ученики, нет limit/range | **ДА, борд.** (день×~600×план+факт≈1–1.5k) | дайджест недобирает «пропущенные тренировки» |
| лат | `:10699` contact_status; `:2314` scan_status; `:2723/2740/2758` students; `:2363` health-eligible | — | все ученики, order, нет limit | нет (~600) | при >1000 молча выпадают из каждого сигнала |
| ok | `repository.ts:9034` operational_signals | — | **`.range(offset,limit)`** (limit 200/250) | нет | корректно (200/250 — дизайн-кап, не баг) |

## PLAN / E-PREDICTOR / TP-SYNC / repository
`src/app/tools/plan/**` (VDOT) — чистая клиентская математика, чтений БД нет.

| severity | file:line | таблица | фильтры | усекается? | что неверно |
|---|---|---|---|---|---|
| 🔴 **АКТИВ** | `tools/…/tp-threshold-estimation.ts:397` | workout_laps | `.in(cache_id,150)`, нет range/limit/order | **ДА** (~1350/чанк) | порог/VDOT: агрегат лапов теряет ~26%/чанк; блок `:373` (derived) листается правильно — лапы забыли |
| 🟡 лат | `repository.ts:2622` health per-student range | health_metrics | `eq student`+date+opt metric_key, нет limit/range | ДА при широком окне без metric_key (до 3418/ученик) | recovery/reply-draft серии здоровья; прод-коллеры — короткие окна, сегодня ок |
| 🟡 | `tp-feedback-safety-net.ts:41/54` | derived/observations | `.limit(4000)/.limit(8000)`→1000 | ДА | диагностика «пропущенных репортов» недобирает |
| ✅ образец | `tp-comparison-key-backfill.ts:79-91` `fetchAll()` (pageSize **1000**, break на `<pageSize`), `tp-comparison-base-proof.ts:144` | — | **правильный шаблон листания** — опора для Наряда 2 | — | — |

## SCRIPTS/ (диагностики и бэкфиллы — питают решения Игоря; часть по расписанию)
| severity | file:line | таблица | фильтры | усекается? | вывод скрипта неверен |
|---|---|---|---|---|---|
| 🔴 **АКТИВ** | `check-trainingpeaks-context-coverage.ts:338`, `:354` | observations / contact_events | `.gte(≥30д)`, **без limit/range** | **ДА** | покрытие контекста: ученики за 1000 → «нет наблюдений» → ложные дыры/«пайплайн сломан» |
| 🔴 **АКТИВ** | `check-coach-memory-ingestion-coverage.ts:186/260/201` | observations / contact_events / memory_items(вся) | `.gte(30д)` / без фильтра, **без limit/range** | **ДА** | сравнивает усечённые массивы с реальными `head:true` count → внутренне противоречивый «% ингеста» |
| 🔴 **WRITE** | `backfill-coach-memory-v1.ts:516` | memory_items | `.range()` pageSize **5000>1000** → обрыв после 1-й стр. | **ДА** | «уже влитых» недосчитывает → **повторный ингест → ДУБЛИ памяти** |
| 🟠 WRITE | `persist-coach-operational-signals.ts:592` | observations | `.limit(4000)`→1000 (WRITE) | **ДА** | не создаёт операц-сигналы для части сообщений окна |
| 🟠 | `diagnose-coach-memory-{health:359/384, quality:299, duplicates:255}`, `review-coach-memory-contexts.ts:227/255` | memory_items / observations | `.in(все ученики)`+`.limit(10000/5000)`→1000 | **ДА** | память-диагностики недосчитывают → ложные «мало памяти»/«чисто от дублей» |
| 🟡 | `diagnose/…-operational-signals.ts:259`, `check-coach-memory-v1-*`/`run-…-write-once`/`probe-…-prefilter` | observations | `.limit(2000)`→1000 | **ДА** | оценка стоимости/покрытия и write-once на ≤1000 при вере в 2000 |
| ✅ образец | `replay-…-coach-cases.ts:183`, `check-…-identity-sources.ts:431…`, `tp-cases-triage.ts:383` | — | `.range()` pageSize **500** — корректно | — | — |

**Disguised `.in()`-вариант в scripts/ безвреден там, где `.in()` по PK (`id`)** — чанк ≤ размера чанка, >1000 не даёт (`cleanup-*`, `audit-*`, `tp-cases-triage:466`). Опасны — `.in(student_id, все)` + `.limit()` (не PK) и no-limit сканы.

## ПИТАНИЕ (не ученик-facing)
Все чтения — `nutrition/repository.ts`. Контент ученику (per-student/недельные/`.limit`-cap ≤40) НЕ усекается. Усечение только в дашборде тренера: `getDailyMacroCountsByStudent` (:1983), `getLatestReportsByStudent` (:1937), `getLatestAnalysesByStudent` (:1960) — `.in(все ученики)` без limit → `parsedDays=0` / нет «последнего отчёта» у части учеников. Средняя важность, тренер-facing.

---

## Итог для приоритизации (по ущербу)
1. **Ученик-facing контент/решения:** фидбек-лапы (`:182`), фидбек-норма/здоровье (`:114/:159`), inbound-recency→канал (`repository.ts:3268`). Чинить первыми.
2. **Прод-сигналы:** дайджест-cache (`:2262`), threshold/VDOT (`tp-threshold-estimation:397`).
3. **Write-баги:** backfill-памяти дубли (`:516`), persist-signals (`:592`).
4. **Диагностики покрытия/памяти** (ложные выводы Игорю) — массово, но не в проде.
5. **Латентные «за 1000 учеников»** — заложить единую обёртку, чтобы не рвануло при росте.

**Ключ к фиксу (Наряд 2 и вне клуба):** единая обёртка листания с pageSize **ровно 1000** и громким логом при «вернулось ровно 1000» как индикатором усечения; заменить ВСЕ `.limit(N>1000)` на листание; для чанк-`.in()` листать результат каждого чанка. Готовый образец — `fetchAll()` в `tp-comparison-key-backfill.ts`. `.limit(N)` как «подъём порога» из кода убрать — это иллюзия (проверено: 6000→1000).
