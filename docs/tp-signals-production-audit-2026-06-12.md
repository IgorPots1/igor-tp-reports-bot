# TP Signals / Coach OS — Production Architecture Audit

Дата: 2026-06-12
Репозиторий: `igor-tp-reports-bot` (origin `github.com/IgorPots1/igor-tp-reports-bot`, branch `main`)
Тип сессии: **read-only архитектурный аудит**. Код приложения не менялся. Никаких записей в БД, Telegram или TrainingPeaks.

Подтверждение, что это правильный prod-репозиторий: присутствуют `src/features/trainingpeaks/**`, `src/features/telegram/**`, `src/app/admin/coach-os/**`, `tools/trainingpeaks-export/**`, `supabase/migrations/**`, команды `/tp_signals` / `/tp_attention` / `/tp_digest_now`. См. раздел 9 (запущенные команды).

---

## 1. Executive summary

Система TP-сигналов хрупкая не из-за отдельных багов, а из-за **отсутствия единой модели сигнала и единого state machine**. То, что задумано как «observation → signal → lifecycle → presentation», на практике реализовано как **четыре несогласованных словаря состояний и две параллельные подсистемы доказательств (evidence)**, поверх которых наложен **первый-матч-побеждает каскад из ~50 строковых предикатов** на русском языке (`coach-operational-signals.ts`, 2925 строк).

Главные структурные причины повторяющихся поломок:

1. **Четыре разных словаря «состояния» сигнала**, которые никто не сводит в один источник истины:
   - SQL `status`: `active | consumed | expired | cancelled | dismissed` (миграция `20260601131000`);
   - SQL `lifecycle_state`: `active_problem | return_planned | return_trial_completed | monitoring_after_return | resolved` (миграция `20260606093000`);
   - follow-up state: `none | pending_future | pending_due | pending_overdue | resolved_or_non_pending` (`operational-follow-up.ts`);
   - **display** lifecycle: `active_problem | monitoring_after_return | ready_for_coach_close | stale_needs_review` (`service.ts:696`).
   Запрошенный целевой словарь (`needs_review`, `close_candidate`, `hidden`, `stale_needs_review`) — это **пятый** словарь. Каждый патч добавляет ещё одно состояние вместо того, чтобы чинить одно.

2. **Дедуп-ключ привязан к `source_observation_id`** (`operational-signals-inline.ts:130-157`, уникальный индекс в миграции `20260601131000` строки 57-59). Каждое новое сообщение про ту же проблему создаёт **новую строку сигнала**, а не обновляет существующую. «Свежесть» потом приходится восстанавливать постфактум через supersede/evidence-склейку — и она работает только для части типов.

3. **Supersession есть только health→health** (`operational-signals-inline.ts:271-279`). `pain_injury` и любые `schedule_*` сигналы **никогда не вытесняются** более свежим сообщением. Поэтому «всё ок» после боли/травмы (кейсы 3, 4) не закрывает старый сигнал, а старое расписание (кейсы 5, 8) висит.

4. **Человекочитаемый summary «замораживается» в момент классификации** одного сообщения (`buildHealthSummary`, `coach-operational-signals.ts:1112-1228`). Позже сложный lifecycle-движок может поменять *статус*, но **текст**, который видит тренер в `/tp_signals`, остаётся от исходного сообщения, если только новое сообщение не переклассифицировалось и не вытеснило старое.

5. **Доказательная база (evidence) расщеплена на два несогласованных пути.** «Позитив» (recovery) ищется без условий (`findOperationalSignalRecoveryMessage`, `service.ts:6714`), а «негатив» ищется **только если уже есть завершённая тренировка в TP-кэше** (`findOperationalSignalNegativeAfterCompletion`, `service.ts:6731-6757`). Плюс есть второй, отдельный «latestNegative» путь в display-слое. Позитив и негатив таким образом не симметричны — система структурно склонна к ложному закрытию.

6. **Нет negative-intent фильтра вообще.** В операционном классификаторе нет ни одного упоминания платёжных/бытовых слов (`оплачу`, `зп`, `зарплата` и т.п. отсутствуют в `src/features/trainingpeaks/*` кроме несвязанного billing-repo). Погодный контекст обрабатывается только внутри health-классификатора (`coach-operational-signals.ts:1359-1375`), но **не** в schedule-классификаторе. Поэтому платёж (кейс 7) и жара (кейс 6) попадают в «ограничения».

7. **Сырой текст сообщения не хранится.** Observations держат только `text_preview` ≤ **120 символов** (`telegram-context.ts:12`) + `text_sha256`; `message_intent_logs.raw_text` пишется как null. Весь downstream (классификатор и постфактум-детекция негатива/позитива) работает по обрезанному preview. Это системная потеря доказательств для длинных сообщений.

8. **Stale-cleanup нет как отдельной подсистемы.** Истечение считается «на лету» в presentation (`isExpiredScheduleOperationalSignal`, `service.ts:4758`) и только на уровне целого сигнала по `valid_until`. Habitual-weekday сигналы (`Ср`, кейс 5) **никогда не получают конкретный `valid_until`** (`buildScheduleCandidate` weekday-ветка `:2367`, `resolveDefaultValidUntil` для schedule-типов возвращает null `:259-261`), поэтому формально не истекают. А внутри ещё живого сигнала прошлые даты (`10.06`, кейс 8) **не вычищаются по-датно**.

Косвенное, но громкое доказательство «патчи вместо модели»: в `package.json` около **40** отдельных `check-*` / `diagnose-*` скриптов вокруг operational signals, и в `src/features/trainingpeaks/` **девять** файлов `operational-signal-*` плюс отдельные supersede/recovery/false-positive/lifecycle-apply слои. Это не модель — это слои заплат вокруг одной таблицы.

**Вывод executive-уровня:** продолжать точечные строковые фиксы — путь к бесконечному повторению. Нужна нормализация в один state machine с единым словарём, симметричной evidence-моделью и одним stale-sweeper. Но делать это нужно **поэтапно, с regression-фикстурами из реальных кейсов**, а не большим rewrite. План — раздел 7.

---

## 2. Repo / system map

| Area | Files / functions | Responsibility | Risk |
|---|---|---|---|
| Intake / observation | `context-observer.ts`, `telegram-context.ts` (`buildTelegramContextTextPreview`, `TELEGRAM_CONTEXT_TEXT_PREVIEW_MAX_LENGTH=120`) | Принять Telegram-сообщение, навесить labels, записать observation (preview+hash) | **High** — теряет сырой текст (120 симв.), labels грубые |
| Classifier (детерминированный) | `coach-operational-signals.ts` (2925 строк): `classifyCoachOperationalSignal`, `classifyCoachOperationalSignals`, `buildScheduleCandidate`, `buildHealthSummary`, `buildPainInjuryCandidate`, `classifyHealthLifecycleSignal` | Превратить текст в кандидаты сигналов + заморозить display summary | **Critical** — first-match-wins ладдер из ~50 фраз-предикатов, без negative-intent gate |
| Persistence / dedupe / supersede | `operational-signals-inline.ts` (`persistOperationalSignalsForObservation`, `buildDedupeKey`, `healthSupersessionTargets`), `repository.ts` (`upsert…FromCandidate`, `consumeActive…`) | upsert сигналов, дедуп, вытеснение | **Critical** — dedupe на observation_id; supersede только health→health |
| Data model | `supabase/migrations/20260601131000…`, `…20260605173000…`, `…20260606093000…`, `…20260522200000…` | Таблицы `…operational_signals`, `…lifecycle_transitions`, `…context_observations` | **High** — два enum состояния в одной строке, нет `last_seen_at`/`expires_at` |
| Lifecycle engine (детерминированный) | `operational-signal-lifecycle.ts` (`evaluateOperationalSignalLifecycle`, `classifyTpWorkoutEvidence`, `hasReliableRunningCompletionAfterOpen`) | По evidence-пакету предложить переход lifecycle | **Medium** — логика разумная, но зависит от качества входного evidence |
| Lifecycle apply / transitions | `operational-signal-lifecycle-apply.ts`, `operational-signal-lifecycle-close.ts`, `operational-signal-supersede-apply.ts`, `operational-signal-recovery-episode-apply.ts` | Применить переход, записать transition, безопасное закрытие | **High** — несколько apply-путей, дублирующие правила |
| Evidence gathering (display) | `service.ts`: `findOperationalSignalRecoveryMessage` (`:6714`), `findOperationalSignalNegativeAfterCompletion` (`:6731`), `buildOperationalSignalLifecycleInputFromCache` (`:6759`), `isOperationalPositiveObservation`/`isOperationalNegativeObservation` (`:6650`/`:6655`), pattern-массивы `:6583`/`:6606` | Собрать «свежие» позитив/негатив наблюдения для lifecycle и display | **Critical** — асимметрия gate-ов, два разных negative-пути |
| Stale / expiry (presentation) | `service.ts`: `isExpiredScheduleOperationalSignal` (`:4758`), `areAllPlannedTrainingDatesExpired` (`:4730`), `isStaleGenericScheduleUnavailabilitySignal` (`:4707`) | Скрыть истёкшие schedule-сигналы | **High** — only-whole-signal, weekday никогда не истекает, нет per-date |
| Schedule display | `operational-schedule-display.ts` (`formatScheduleOperationalSignalText`, `buildCanonicalEpisodeScheduleDisplayText`) | Формат строки расписания | **High** — печатает все `unavailable_dates` без фильтра прошлого |
| Presentation / Telegram | `service.ts`: `buildMonitoringLifetimeDisplayLines` (`:6903`), `formatOperationalSignal*`, `telegram-visual-ux.ts` | Построить текст `/tp_signals` | **High** — UX-строки маскируют состояние |
| Snapshot / command | `service.ts`: `getTrainingPeaksOperationalSignalsSnapshot` (`:8957`), `buildTrainingPeaksOperationalSignalsSnapshotFromSignals` | Загрузить active-сигналы, собрать снапшот | **Medium** |
| Attention / digest | `attention-telegram.ts`, `attention-digest-run.ts`, `morning-digest-follow-up-filter.ts` | `/tp_attention`, morning digest поверх той же модели | **Medium** — наследует те же баги |
| AI-review (advisory) | `scripts/diagnose-operational-signals-ai-review.ts` → `reports/operational-signals-ai-review/*` | Read-only советник, пишет отчёт на диск | **Low** — не мутирует, но и не интегрирован в lifecycle |
| Completion bridge | `tp-completion-lifecycle-bridge.ts` | Связать TP-completion и lifecycle | **Medium** |
| Diagnostics (≈40 шт.) | `scripts/check-*`, `scripts/diagnose-*` operational/attention/signal | Регрессии/диагностика | сам объём = индикатор накопленных заплат |

---

## 3. Current dataflow

```text
Telegram (Business DM / private / group topic)
  │
  ▼
context-observer.ts ──> observation row
  • labels (грубые: noise_or_ack / possibly_pain_or_health / …)
  • text_preview (≤120 симв.)  ← сырой текст ТЕРЯЕТСЯ
  • text_sha256
  │
  ▼
persistOperationalSignalsForObservation (operational-signals-inline.ts)
  │   classifyCoachOperationalSignals (coach-operational-signals.ts)
  │     first-match-wins каскад ~50 предикатов
  │     → candidate(s) + display_summary/latest_summary ЗАМОРОЖЕН здесь
  │   buildDedupeKey = hash(... source_observation_id ...)   ← новый msg = новая строка
  │   upsert → trainingpeaks_student_operational_signals (status='active')
  │   healthSupersessionTargets → consume старых ТОЛЬКО health→health
  │
  ▼
[читается только при рендере /tp_signals и /tp_attention — НЕТ постоянного фонового lifecycle]
  │
getTrainingPeaksOperationalSignalsSnapshot (service.ts:8957)
  │  listTrainingPeaksOperationalSignals(status='active', limit 250)
  │  buildOperationalSignalDisplayEvidenceMap:
  │     ├─ findOperationalSignalRecoveryMessage  (позитив, БЕЗ gate)
  │     └─ findOperationalSignalNegativeAfterCompletion (негатив, GATE: нужна TP-completion)
  │  evaluateOperationalSignalLifecycle (operational-signal-lifecycle.ts)
  │  isExpiredScheduleOperationalSignal / staleness (только whole-signal, по valid_until)
  │  buildMonitoringLifetimeDisplayLines → UX-строки
  │
  ▼
Telegram output (/tp_signals, /tp_attention, morning digest)
```

**Где смешаны уровни (главное):**

- **Классификация и презентация смешаны**: `display_summary` строится фразами в классификаторе (`buildHealthSummary`) — это данные презентации, попавшие в persistence-слой.
- **Lifecycle и evidence смешаны**: «истина о состоянии» вычисляется заново при каждом рендере из сырых observations, а не хранится. `status`/`lifecycle_state` в БД и display-state расходятся.
- **Stale-cleanup живёт в presentation**, а не в модели данных — поэтому «починка» всегда выглядит как presentation-фильтр.
- **Дедуп и свежесть смешаны**: дедуп на observation_id означает, что «один и тот же эпизод» физически размазан по нескольким строкам, и «свежий evidence» приходится склеивать эвристиками постфактум.

---

## 4. Recurring failure classes

| # | Failure class | Пример | Вероятная зона кода | Severity | Предлагаемый фикс |
|---|---|---|---|---|---|
| F1 | Stale schedule даты остаются видимыми | Кейс 5 (`Ср`), кейс 8 (`10.06`) | `buildScheduleCandidate:2367`, `resolveDefaultValidUntil:259`, `isExpiredScheduleOperationalSignal:4758` | High | Нормализовать weekday→конкретная дата + `valid_until`; per-date фильтр прошлого; единый sweeper |
| F2 | Свежий feedback не попадает в lifecycle | Кейсы 1,3,4 | dedupe на observation_id; supersede только health→health (`inline:271`) | Critical | Эпизод-ключ; evidence-refresh для всех типов |
| F3 | Позитив «ок» не даёт close-candidate | Кейсы 3,4 | `pain_injury` не вытесняется; нет `close_candidate` статуса | High | `close_candidate_after_ok_feedback` для pain/injury (без жёсткого auto-resolve) |
| F4 | Негатив после болезни → «новых жалоб нет» | Кейс 1 | асимметрия evidence: negative gated на completion (`:6731`), positive не gated (`:6714`); `buildMonitoringLifetimeDisplayLines:6944` | Critical | Симметричная evidence-модель; негатив имеет приоритет над позитивом |
| F5 | Admin/billing классифицируется как restriction | Кейс 7 | нет negative-intent gate в `classifyCoachOperationalSignal` | High | Negative-intent классификатор до schedule-ветки |
| F6 | Weather/free-time как жёсткое ограничение | Кейс 6 | weather-обработка только в health (`:1359`), не в schedule | High | Перенести weather/soft-context gate в schedule-ветку |
| F7 | Дублированный action-copy | Кейс 4 («уточнить…» дважды) | `buildMonitoringLifetimeDisplayLines` + summary конкатенация | Medium | Дедуп строк action на уровне рендера |
| F8 | Presentation-фильтры прячут симптом вместо фикса состояния | общий | `shouldAutoHideCleanIllnessRecoveryFromTpSignals:6518`, `visible_in_tp_signals` | High | Чинить state, не visibility |
| F9 | AI-advisory не интегрирован в детерминированный lifecycle | общий | `diagnose-operational-signals-ai-review.ts` пишет в `reports/` | Medium | Структурный evidence-pack → advisory JSON для coach notes |
| F10 | Нет regression-фикстур из реальных поломок | общий | `scripts/check-*` синтетические | High | Фикстуры из этих 8 кейсов (Phase 1) |
| F11 | Нет explainability/source-trace в `/tp_signals` | Кейс 8 («откуда 10.06?») | снапшот не отдаёт source observation ids/snippets | High | `diagnose:tp-signals-explain` (раздел «Diagnostic proposal») |
| F12 | Date-нормализация без явных `valid_from`/`valid_until`/`expires_at` | Кейсы 5,8 | weekday→null `valid_until`; нет `expires_at`/`last_seen_at` | High | Явная date-validity модель в payload и колонках |
| F13 | Старые observations «побеждают» более свежие | Кейсы 1,3,4 | заморозка summary в классификаторе; нет latest-wins по эпизоду | High | Latest-evidence-wins по episode_key |
| F14 | Dedupe/idempotency держит мёртвые строки живыми | общий | unique idx `(source_observation_id, signal_type, dedupe_key)` | High | Дедуп по `(student_id, episode_key, signal_type)` |
| F15 | Потеря сырого текста (preview 120) | риск для длинных сообщений | `telegram-context.ts:12` | Medium | Хранить полный текст (приватно) или поднять лимит для health/schedule |
| F16 | Четыре несогласованных словаря состояния | корневая | миграции + `operational-follow-up.ts` + `service.ts:696` | Critical | Один канонический lifecycle enum |

---

## 5. Case-by-case audit (8 свежих кейсов)

Для каждого: что сейчас в выводе → что вероятно в источнике → где сломалось → целевое состояние → фикстура → слой фикса.

### Кейс 1 — Rizatdinova Elvira (негатив после болезни) — **Critical**
- **Сейчас:** «После болезни: пробежка была, новых жалоб нет / закрыть после проверки».
- **Источник:** «сегодня решила побегать, но меня хватило минут на 20, потом голова кружилась, в сон клонит, а так норм».
- **Где сломалось:** строка `/голова\s+круж/` **есть** в `OPERATIONAL_NEGATIVE_OBSERVATION_PATTERNS` (`service.ts:6631`) — но негатив учитывается только через `findOperationalSignalNegativeAfterCompletion`, у которого жёсткий gate `if (!input.completionDate) return null` (`:6737`) и порог `observedAt ≥ max(openedAt, completionStart)`. Рендер пошёл по ветке `hasCleanReportAfterRun` (`service.ts:6944`), т.е. `latestPositiveText && !latestNegativeText`. Негатив не был подставлен, хотя паттерн на «голова кружится» существует — доказательство, что детекция негатива расщеплена и асимметрична относительно позитива.
- **Целевое состояние:** `monitoring_after_return` / `needs_review`; summary честно: «после болезни пробежка прервана (20 мин), головокружение/сонливость — не закрывать». Негатив должен иметь приоритет над позитивом в одном сообщении.
- **Фикстура:** observation с этим текстом + открытый illness-сигнал → ожидать `needs_review`, `latestNegativeText != null`, запрет close-candidate.
- **Слой:** evidence-модель (симметрия) + lifecycle + presentation.

### Кейс 2 — Alexander Ivanov (после пробежки недомогания не было) — **Medium**
- **Сейчас:** «После болезни: пробежка 11.06 была / проверить самочувствие после пробежки».
- **Источник:** после пробежки реально всё нормально (нет негатива, нет явного «всё ок»).
- **Где сломалось:** без явного позитивного сообщения lifecycle остаётся в `monitoring_after_return` (`evaluateTpCompletion` для `confirmed_illness` → monitoring, `operational-signal-lifecycle.ts:606-616`), и рендер выдаёт «проверить самочувствие» (`service.ts:6966`). Система не умеет трактовать «молчание после чистой беговой пробежки» как мягкий close-candidate.
- **Целевое состояние:** `close_candidate` («можно закрыть после проверки»), не «проверить самочувствие» бесконечно.
- **Фикстура:** illness-сигнал + чистая running-completion после открытия + отсутствие негатива N дней → `close_candidate`.
- **Слой:** lifecycle (правило «чистая пробежка + нет негатива ≥ N дней → close_candidate»).

### Кейс 3 — Alexander Lavrentyev (pain lifecycle, свежий «всё ок») — **High**
- **Сейчас:** «Лёгкий дискомфорт стопы / наблюдать, уточнить если усилится».
- **Источник:** тренер спросил сегодня, ученик ответил «всё ок».
- **Где сломалось:** сигнал типа `pain_injury`. Supersession-таргеты для не-health типов пусты (`healthSupersessionTargets`, `inline:271-279` возвращает `[]` для всего, кроме improving/resolved). Свежий «всё ок» **не вытесняет** pain-сигнал, и summary остаётся замороженным «наблюдать».
- **Целевое состояние:** `close_candidate` («можно закрыть после проверки»). Auto-resolve боли жёстко нельзя (правило CLAUDE.md), но close-candidate — можно.
- **Фикстура:** pain-сигнал + последующий positive observation «всё ок» → `close_candidate`, summary обновлён.
- **Слой:** supersede/evidence-refresh + lifecycle (`close_candidate_after_ok_feedback` для pain без auto-resolve).

### Кейс 4 — Anna Chernysheva (ноготь, дублированный copy) — **High**
- **Сейчас:** «Ноготь после удара/отрыва / уточнить, мешает ли бегу / уточнить, болит ли сейчас и мешает ли тренировкам».
- **Источник:** побегала; тренер спросил про палец; ответ «всё ок».
- **Где сломалось:** (а) тот же pain-не-вытесняется баг, что и кейс 3; (б) дублированный action-copy — две почти одинаковые «уточнить…» строки конкатенируются (summary + `buildMonitoringLifetimeDisplayLines`).
- **Целевое состояние:** `close_candidate`; одна строка action.
- **Фикстура:** nail/pain сигнал + positive «всё ок» → `close_candidate` + ровно одна «уточнить…» строка.
- **Слой:** supersede + presentation-дедуп.

### Кейс 5 — Alexander Lavrentyev (stale schedule «Ср») — **High**
- **Сейчас:** «Ср не может тренироваться / учесть перенос/альтернативу» (сегодня 12.06, среда 10.06 прошла).
- **Где сломалось:** weekday-ветка `buildScheduleCandidate` (`:2367`) ставит `date_certainty='habitual_weekdays'` и **не** ставит `valid_until` (если нет «сегодня»). `resolveDefaultValidUntil` для `schedule_unavailability_window` возвращает null (`:259-261`). Значит `isExpiredScheduleOperationalSignal` уходит в `isExpiredPlannedTrainingDatesSignal`, который для unavailability без planned-дат всегда false → сигнал не истекает. `isStaleGenericScheduleUnavailabilitySignal` оценивает только `createdAt + 7 дней`, а не реальную прошедшую среду.
- **Целевое состояние:** прошлый weekday-слот → `resolved`/`hidden` (одноразовый) или явный повтор с конкретным `valid_until`.
- **Фикстура:** unavailability `среда` создан 09.06, as-of 12.06 → скрыт/закрыт.
- **Слой:** classifier (weekday→дата+valid_until) + stale sweeper. **Не** presentation-string-hack.

### Кейс 6 — Aleksandra Tararova (жара, не ограничение) — **High**
- **Сейчас:** «ограничение (до 14.06): завтра тоже 34😂 но я утром свободна, выходной. побегу, попробую…».
- **Где сломалось:** schedule-классификатор ловит дату («до 14.06») + интент и помечает restriction. Weather-gate (`coach-operational-signals.ts:1359-1375`) живёт **только** в health-ветке, в schedule его нет. Фраза вообще про доступность («утром свободна… побегу»), а не ограничение.
- **Целевое состояние:** не restriction; максимум мягкий planning-context («жара 34°» как soft note), либо availability, а не «ограничение».
- **Фикстура:** этот текст → НЕ `plan_generation_constraint`/restriction.
- **Слой:** classifier (weather/soft-context gate в schedule; разделить «ограничение» и «доступность»).

### Кейс 7 — Elena Vasileva (платёж, не TP) — **High**
- **Сейчас:** «ограничение: …можно завтра оплачу, как зп придёт… (до 14.06)».
- **Где сломалось:** **нет negative-intent фильтра**. В `classifyCoachOperationalSignal` нет ветки, отбрасывающей billing/admin. Слова `оплачу`/`зп`/`зарплата` отсутствуют в операционном домене (`rg` подтвердил). «завтра» + «до 14.06» матчат schedule-эвристики.
- **Целевое состояние:** `skip` (билинг/админ исключён из TP operational signals).
- **Фикстура:** платёжный текст → `skip`, ноль persistable-кандидатов.
- **Слой:** classifier — negative-intent gate **в начале** каскада: `оплач|оплат|зп|зарплат|перевед|абонемент|карт|чек|деньги|реквизит` → skip.

### Кейс 8 — Polyakova Anastasia (старая дата + нет explainability) — **High**
- **Сейчас:** «недоступна: 10.06 / планирует: 15.06» (10.06 прошло, непонятен источник).
- **Где сломалось:** `formatScheduleOperationalSignalText` печатает все `unavailable_dates` (`operational-schedule-display.ts:752`) без фильтра прошлого. Whole-signal expiry не срабатывает, потому что `planned_training_dates=[15.06]` ещё в будущем (`areAllPlannedTrainingDatesExpired:4738` → false). Per-date stale-фильтра нет. Источник (observation id/snippet) нигде не показывается.
- **Целевое состояние:** скрыть `10.06`; для `15.06` показать source text, normalized date, confidence, category.
- **Фикстура:** signal с unavailable `[10.06]` + planned `[15.06]`, as-of 12.06 → в выводе только `планирует 15.06` + explainability.
- **Слой:** schedule-display (per-date past-filter) + explainability (diagnostic) + stale sweeper.

---

## 6. Architecture recommendation (без большого rewrite)

Цель: один источник истины о состоянии сигнала, симметричный evidence, один sweeper, явная explainability. Делается слоями поверх существующих таблиц (новые колонки, не drop).

1. **Canonical observation layer.** Хранить полный текст health/schedule сообщений (приватно, вне git) или поднять preview-лимит для этих labels; добавить `episode_key` ещё на intake, чтобы сообщения одного эпизода связывались сразу.

2. **Один `operational_signal` state machine.** Свести четыре словаря к одному lifecycle:
   `active → needs_review → monitoring_after_return → close_candidate → resolved`, плюс боковые `hidden`, `stale_needs_review`. SQL `status` оставить как технический (`active/consumed`), но **источником истины делает lifecycle**, а display-state выводится из него детерминированно, не вычисляется заново эвристиками.

3. **Source evidence window.** Для открытого сигнала evidence = все observations с `observedAt ≥ episode.openedAt`, отсортированные, **latest-wins**. Один и тот же набор используют и lifecycle, и display (сейчас они расходятся).

4. **Явная date-validity модель:** `source_date`, `target_date`, `valid_from`, `valid_until`, **`expires_at`**, **`last_seen_at`**. Weekday-слова нормализуются в конкретные даты на intake; нет конкретной даты → нет «жёсткого ограничения».

5. **Deterministic safety первым, AI вторым.** Сохранить правила CLAUDE.md: боль/травма/illness/cycle → минимум `needs_review`; никакого жёсткого auto-resolve боли (только `close_candidate`). Негатив **перебивает** позитив в одном окне.

6. **Симметричный evidence:** позитив и негатив детектируются **одним** проходом по окну, оба **без** обязательного TP-completion gate (TP-completion — усиливающее, не необходимое условие). Сейчас негатив зависит от completion — это и есть источник кейса 1.

7. **Negative-intent классификатор** для не-тренировочных сообщений (billing/admin/погода/бытовое) — gate в начале каскада.

8. **Единый stale sweeper** (read-only сначала): по `expires_at`/`valid_until`/прошедшим датам помечает `stale_needs_review`/`hidden`; per-date чистка прошлого внутри живых schedule-сигналов.

9. **Explainability:** каждый видимый сигнал в diagnostics отдаёт `source_observation_ids`, `source_snippets`, `normalized_dates`, `why_visible`, `why_not_closed`.

10. **Regression-suite из реальных кейсов** (эти 8) как обязательный CI-гейт.

Чего **не** делать (по ASK и CLAUDE.md): не «пусть AI всё решает»; AI — только advisory read-only вторым проходом; не давать AI мутировать БД/Telegram/TP; не делать giant rewrite первым шагом.

---

## 7. Production hardening plan (фазы 0–5)

### Phase 0 — diagnostics only (без записей)
- Никаких записей в БД/Telegram/TP.
- Добавить read-only `diagnose:tp-signals-explain` (см. раздел ниже), который для каждого видимого сигнала печатает source ids/snippets, normalized dates, latest evidence, why_visible/why_not_closed, recommended_state, suspected_bug_class.
- Прогнать его на 8 именах и приложить вывод к ревью (заменяет «слепой» Telegram-дебаг).

### Phase 1 — regression fixtures
- Фикстуры под 8 кейсов (см. раздел 8 список).
- Unit-тесты: classifier (кейсы 6,7), evidence-симметрия (кейс 1), supersede pain (кейсы 3,4), date-expiration (кейсы 5,8).
- Зафиксировать ожидаемые `status`/`lifecycle`/action-copy.

### Phase 2 — stale schedule + negative intent (узкие, тестируемые)
- Negative-intent gate в начале `classifyCoachOperationalSignal` (billing/admin/погода) → кейсы 6,7.
- Weekday→конкретная дата + `valid_until`; per-date past-filter в schedule-display; единый sweeper помечает прошлое → кейсы 5,8.
- **Без** broad string-only presentation-хаков.

### Phase 3 — lifecycle / evidence refresh
- Симметричный evidence-проход (позитив+негатив, latest-wins, без обязательного completion-gate) → кейс 1.
- `close_candidate` для illness/pain при чистой пробежке + нет негатива → кейсы 2,3,4 (для pain — без auto-resolve).
- Эпизод-ключ + evidence-refresh для всех типов (не только health→health).

### Phase 4 — AI-review integration (advisory)
- AI получает структурный evidence-pack; возвращает advisory JSON; **не** мутирует БД; **не** перебивает детерминированные safety-блоки; результат — только заметки для coach review.

### Phase 5 — admin/review UX
- Показ source/evidence/reason в карточке сигнала; кнопки close/keep/recompute (позже); снизить слепой Telegram-дебаг.

---

## 8. Concrete code hotspots (что трогать первым)

1. `src/features/trainingpeaks/coach-operational-signals.ts`
   - `classifyCoachOperationalSignal` (`:2601`) — добавить negative-intent gate **в начало** (кейсы 6,7).
   - `buildScheduleCandidate` (`:2185`) — weekday→дата+`valid_until`; weather/soft-context gate (кейсы 5,6).
   - `buildHealthSummary` (`:1112`) — вынести из persistence в presentation (расцепить классификацию и текст).
2. `src/features/trainingpeaks/operational-signals-inline.ts`
   - `buildDedupeKey` (`:130`) + `healthSupersessionTargets` (`:271`) — эпизод-ключ; supersede для pain/schedule (кейсы 3,4,5,8).
3. `src/features/trainingpeaks/service.ts`
   - `findOperationalSignalNegativeAfterCompletion` (`:6731`) / `findOperationalSignalRecoveryMessage` (`:6714`) — сделать симметричными, снять completion-gate (кейс 1).
   - `buildMonitoringLifetimeDisplayLines` (`:6903`) — приоритет негатива; дедуп action-copy (кейсы 1,4).
   - `isExpiredScheduleOperationalSignal` (`:4758`) / `areAllPlannedTrainingDatesExpired` (`:4730`) — per-date + единый sweeper (кейсы 5,8).
4. `src/features/trainingpeaks/operational-schedule-display.ts`
   - `formatScheduleOperationalSignalText` (`:702`) — фильтр прошлых дат при печати (кейс 8).
5. Data model (миграции, additive): добавить `expires_at`, `last_seen_at`, `episode_key`; договориться об одном lifecycle-enum.

---

## 9. Commands run and results

```bash
pwd                      # /Users/igor/igor-tp-reports-bot
git remote -v            # origin github.com/IgorPots1/igor-tp-reports-bot.git
git branch --show-current# main
git status --short        # см. ниже (nutrition-фичи и playwright-логи uncommitted; не трогались)
git log -5 --oneline     # ff64443 … нутришн-коммиты

find src/features/trainingpeaks -maxdepth 3 -type f | sort   # 65 файлов; 9 × operational-signal-*
find tools/trainingpeaks-export/scripts -maxdepth 2 -type f  # export/E-predictor/strength toolchain
ls supabase/migrations   # …operational_signals (601131000), expand types (605173000), lifecycle apply (606093000)

rg "оплач|зарплат|\bзп\b|перевед|абонемент"  src/features/trainingpeaks
  # ТОЛЬКО repository.ts (billing reverify), НИ ОДНОГО в operational-классификаторе → подтверждён F5/кейс 7

rg "жара|погод|34|градус"  src/features/trainingpeaks
  # weather-обработка только coach-operational-signals.ts:1359-1375 (health-ветка) → подтверждён F6/кейс 6

# package.json: ~40 check-*/diagnose-* скриптов вокруг operational signals → индикатор накопленных заплат
```

Ключевые прочитанные файлы: миграции `20260601131000` / `20260605173000` / `20260606093000` / `20260522200000`; `operational-signal-lifecycle.ts`; `operational-follow-up.ts`; `operational-signals-inline.ts`; `coach-operational-signals.ts` (классификатор, schedule, health-summary, entrypoint); `service.ts` (evidence-функции `:6399-6788`, display `:6903-6989`, expiry `:4707-4770`, snapshot `:8957`); `operational-schedule-display.ts`; `telegram-context.ts` (preview=120).

**Никакой live-прогон против БД/Telegram/TP не выполнялся** (нет записей, соблюдены hard constraints).

---

## 10. Final recommendation

- **Продолжать патчить текущий код — нет.** Это даст ещё один виток тех же поломок. Точечные строковые фиксы уже исчерпали себя (≈40 диагностик-скриптов, 4 словаря состояния).
- **Минимальный структурный рефактор:** (1) один lifecycle state machine как источник истины; (2) симметричная evidence-модель (позитив=негатив, latest-wins, без обязательного TP-completion gate); (3) эпизод-ключ вместо дедупа по observation_id + supersede для всех типов; (4) negative-intent gate; (5) единый stale sweeper + явные `expires_at`/`last_seen_at`; (6) расцепить классификацию и display-текст. Всё — additive, поверх текущих таблиц, фазами 0–3.
- **До включения большей автоматизации обязательно:** explainability-диагностика (Phase 0) и regression-suite из этих 8 кейсов (Phase 1) должны быть зелёными; lifecycle должен быть стабилен на них.
- **Заблокировать до стабилизации lifecycle:** любой auto-close боли/травмы/illness без coach review; любая запись AI напрямую в БД/Telegram/TP; расширение auto-matching/auto-reply; новые presentation-only хаки, скрывающие симптом вместо починки состояния.

---

## Appendix — Diagnostic proposal (Phase 0, read-only)

Предлагаемая команда (только чтение, без записей), переиспользующая уже экспортируемые из `service.ts` хелперы (`resolveOperationalSignalDisplaySummary`, `resolveOperationalSignalDisplayLifecycleState`, `buildOperationalSignalDisplayEvidenceMap`, `resolveOperationalSignalDisplayDebugInfo`) — то есть это тонкая обёртка вокруг уже существующего `diagnose-operational-signals-ai-review.ts`, а не новый pipeline:

```bash
npm run diagnose:tp-signals-explain -- \
  --date=2026-06-12 \
  --names="Rizatdinova Elvira,Alexander Ivanov,Alexander Lavrentyev,Anna Chernysheva,Aleksandra Tararova,Elena Vasileva,Polyakova Anastasia" \
  --no-write
```

Ожидаемый вывод на каждый видимый сигнал:

```json
{
  "student": "...",
  "visible_output": "...",
  "signal_id": "...",
  "category": "...",
  "status": "...",
  "source_observation_ids": ["..."],
  "source_snippets": ["..."],
  "normalized_dates": { "source_date": "...", "target_date": "...", "valid_until": "..." },
  "latest_followup_evidence": ["..."],
  "why_visible": "...",
  "why_not_closed": "...",
  "recommended_state": "...",
  "suspected_bug_class": "F1..F16 (см. раздел 4)"
}
```

Назначение: заменить слепой Telegram-дебаг трассируемым объяснением каждого видимого сигнала и привязать каждую поломку к классу из раздела 4. Команда **только читает** observations/signals/workout-cache; не пишет в БД, Telegram, TrainingPeaks.

---

No code changes. Audit document only. No push. No DB writes. No Telegram sends. No TrainingPeaks writes.
