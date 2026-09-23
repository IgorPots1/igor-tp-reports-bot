# Agent Layer Audit

Дата аудита: 2026-06-09

Ограничение сессии: архитектурный аудит и план. Код приложения не менялся.

## Карта текущего репозитория

`igor-tp-reports-bot` - Next.js/TypeScript приложение с Supabase как источником истины и Telegram/TrainingPeaks как интеграционными поверхностями. README фиксирует текущие правила: Web Admin и Supabase держат registry/review state, Telegram в основном notification/review слой, локальный Mac runner пишет TP cache/report artifacts в Supabase, Vercel не ходит в TrainingPeaks напрямую.

Крупные области:

- `src/app` - Next.js routes: admin UI, Telegram webhook, cron endpoints. Важные маршруты: `src/app/api/telegram/webhook/route.ts`, `src/app/api/cron/trainingpeaks-attention-digest/route.ts`, `/admin/reports`, `/admin/coach-os`, `/admin/coach-os/nutrition`.
- `src/features/telegram` - Telegram parser/client/command routing. `trainingpeaks.ts` содержит основной command/callback/business-message orchestration; есть legacy voice modules, но целевой слой должен быть text-only.
- `src/features/trainingpeaks` - основной Coach OS домен: students, reports, TP jobs, workout cache, health metrics cache, Telegram Business linking, message intent logs, context observer, Coach Memory, coach cases, reply drafts, operational signals, attention digest.
- `src/features/nutrition` - nutrition pilot: PDF intake, macros, methodology, weekly review, copy-only/admin flow. Это отдельный draft-approve-send паттерн, но не общий dialogue layer.
- `src/features/billing` - отдельный billing контур; для agent layer не является primary dependency.
- `supabase/migrations` - источник схемы: `trainingpeaks_students`, `trainingpeaks_weekly_reports`, `trainingpeaks_jobs`, `trainingpeaks_telegram_business_chats`, `trainingpeaks_message_intent_logs`, `trainingpeaks_telegram_context_observations`, `trainingpeaks_student_memory_items`, `trainingpeaks_student_context_snapshots`, `trainingpeaks_coach_cases`, `trainingpeaks_reply_drafts`, `trainingpeaks_student_contact_events`, `trainingpeaks_student_operational_signals`, nutrition tables.
- `scripts` - diagnostics/checks/backfills. Особенно релевантны `check-coach-memory-ingestion-coverage.ts`, `diagnose-student-communication-style.ts`, `check-trainingpeaks-reply-draft-context.ts`, `check-trainingpeaks-reply-draft-feedback.ts`, operational signal checks.
- `tools/trainingpeaks-export` - локальная TP automation: export/cache scan/report generation. Для conversational agent это источник кэша/состояния, но не runtime source of truth.

Данные Supabase, релевантные разговорному слою:

- `trainingpeaks_students`: ученик, Telegram link/delivery, `telegram_formality`, `telegram_context_notes`.
- `trainingpeaks_telegram_business_chats`: последние Business chats/linking metadata. Не является полноценной историей сообщений.
- `trainingpeaks_telegram_context_observations`: наблюдения из Telegram с labels, `text_preview`, `text_sha256`, metadata. Это не полный dialogue log.
- `trainingpeaks_message_intent_logs`: intent audit for business messages. Схема имеет `raw_text`, но writer сейчас передает `rawText: null`; есть preview/hash/normalized text.
- `trainingpeaks_student_memory_items`: semantic Student Context Layer; активные долговременные факты с `memory_type`, structured payload, validity fields.
- `trainingpeaks_student_operational_signals`: временные/actionable сигналы из сообщений: расписание, здоровье, переносы, ограничения, race context.
- `trainingpeaks_student_contact_events`: факт контакта coach/athlete/report/action без текста сообщения.
- `trainingpeaks_coach_cases` и `trainingpeaks_student_context_snapshots`: triage ledger и компактный контекст без raw athlete text.
- `trainingpeaks_reply_drafts`: AI draft, outcome, prompt/student/draft hashes, previews, full `draft_text`. Важно: это текст AI-черновика, не гарантированно финальный текст Игоря после ручной правки.
- `trainingpeaks_weekly_reports`: weekly report draft/review/send flow, включая edited report fields.
- `trainingpeaks_workout_cache`, `trainingpeaks_health_metrics_cache`, athlete baselines/template catalog: тренировочное состояние и методология.

Текущий вход Telegram:

- `src/app/api/telegram/webhook/route.ts` принимает обычные messages/callbacks и Business messages.
- Business incoming athlete DM идет в `handleTrainingPeaksTelegramBusinessMessage`:
  - сохраняет/обновляет Business chat;
  - пишет context observation;
  - пишет operational signals;
  - пишет contact event;
  - пытается распознать move-workout action;
  - пишет message intent log;
  - пишет coach case/snapshot;
  - auto reply draft сейчас только dry-run detection для `report_like`.
- Outgoing manual coach Business DM сейчас фиксируется как `coach_message` contact event, но без текста. Это годится для cadence, но не для style few-shot.

Текущий draft-approve-send:

- Weekly reports: review/edit/send через Web Admin, Telegram coach preview только preview.
- Reply drafts: command-only `/tp_reply_draft <student> <message>` генерирует draft, сохраняет в `trainingpeaks_reply_drafts`, показывает тренеру в Telegram; callbacks могут send/cancel. `/tp_draft_feedback` фиксирует used/edited/ignored, но edited хранит заметку, а не финальный edited text.
- Nutrition: copy-only admin workflow, без auto-send.

## Таблица: слой -> статус -> файлы/модули -> что делать

| Слой | Статус | Конкретные файлы/модули | Что делать |
|---|---|---|---|
| 1. Стиль письма | Новое + частично существующее | Есть: `communication-profile.ts`, `telegram-context.ts`, `diagnose-student-communication-style.ts`, `trainingpeaks_reply_drafts`, `trainingpeaks_student_contact_events`. Нет: corpus финальных исходящих текстов Игоря, style features, retrieval index. | Не смешивать стиль ученика/формальность с авторским стилем Игоря. Добавить отдельный `coach_style_*` контур: capture финальных outgoing text сообщений Игоря из Telegram Business/manual send, хранить direction/source/student/situation labels/text/hash. Затем извлекать style profile: бан-лист, типичные opening/closing, длина, пунктуация, emoji level, степень прямоты. Для dynamic few-shot добавить retrieval 3-5 прошлых ответов Игоря по похожей ситуации. Начать можно с lexical/label retrieval по существующим labels, потом embeddings/pgvector, если станет узким местом. |
| 2. Память: семантическая | Есть, переиспользовать | `context-observer.ts`, `coach-memory-extraction.ts`, `trainingpeaks_student_memory_items`, `communication-profile.ts`, scripts `backfill-coach-memory-v1.ts`, `check-coach-memory-ingestion-coverage.ts`. | Оставить как Student Context Layer. Использовать только active/relevant memory items через селектор. Не превращать в длинный prompt dump. Доработать retrieval/selection policy per message: top relevant by type, validity, recency, confidence, current labels. |
| 2. Память: эпизодическая | Частично есть, нужно новое | Частично: `trainingpeaks_telegram_context_observations`, `trainingpeaks_message_intent_logs`, `trainingpeaks_student_contact_events`, `trainingpeaks_coach_cases`. Нет: ordered dialogue event stream с inbound/outbound text. | Добавить отдельный immutable dialogue ledger для text-only Telegram: message id, student, direction, role, source, occurred_at, text or encrypted/private text policy, preview/hash, labels, linked case/draft/action. Не использовать contact events как историю диалога: они без текста и по назначению про cadence. |
| 2. Память: темпоральная | Частично есть | `trainingpeaks_student_memory_items.valid_from/valid_until`, `trainingpeaks_student_operational_signals.valid_from/valid_until`, lifecycle scripts `operational-signal-lifecycle-*`, `tp-completion-lifecycle-bridge.ts`. | Не строить новый temporal store сразу. Сначала формализовать selector: active operational signals + memory validity + supersession. Для травма->восстановление использовать существующие health lifecycle signal types. Добавить недостающие validity transitions только после проверки, что текущие lifecycle scripts не покрывают кейс. |
| 3. Сборка контекста per-message | Есть прототип, нужна генерализация | `reply-draft-context.ts`, `reply-draft-generator.ts`, `trainingpeaks/service.ts`, `coach-operational-signals.ts`, `operational-signals-inline.ts`, `workout-activity-classification.ts`, `athlete-training-baselines.ts`, `workout-template-catalog.ts`, nutrition methodology separately. | Создать общий `dialogue-context-builder`: input = incoming message/case/trigger; output = compact context packet. Переиспользовать `reply-draft-context.ts`, но убрать фиксированность на 7 дней и command-only. Включать: student identity, current TP cache summary, recent completed/planned workouts, active tp_signals, selected memory, relevant episodic snippets, style few-shot, methodology guardrails. Обязателен token budget и latency budget. |
| 4. Проактивность/тайминг | Частично есть | `attention-digest-run.ts`, `attention-telegram.ts`, `trainingpeaks_student_operational_signals`, `coach-operational-signals.ts`, `operational-follow-up.ts`, `recovery-alerts.ts`, `trainingpeaks_student_contact_status`. | Не начинать с авто-сообщений ученику. Сначала proactive draft queue для тренера: signal -> proposed message draft -> approve/send. Добавить policy: cooldown per student, quiet/mute preferences, max proactive touches, priority buckets, “why now”. Использовать existing tp_signals/attention snapshot как trigger source. |
| 5. Human-in-the-loop | Есть, но раздроблено | Weekly report Web Admin, `reply-draft-delivery.ts`, `trainingpeaks_reply_drafts`, `trainingpeaks_coach_actions_taken`, Telegram callbacks, nutrition copy-only. Нет общего dialogue inbox. | Расширить существующий review-first паттерн в единый “Dialogue Inbox”: draft list, context, approve/edit/send/ignore, feedback capture. Ключевая доработка: при edit хранить финальный отправленный текст, diff/metadata и использовать это как сигнал для style retrieval. Нагрузку/план менять только через существующие guarded actions, не через свободный диалоговый ответ. |

## Что НЕ добавлять и почему

- Не добавлять fine-tuning. Цель уже задана: style extraction + dynamic few-shot. Fine-tuning увеличит стоимость/операционный риск и плохо обновляется от новых правок.
- Не делать TrainingPeaks источником истины. TP остается output/cache/integration layer; источник состояния и review decisions - Supabase.
- Не строить второй Student Context Layer. Уже есть `trainingpeaks_student_memory_items`, observations, snapshots, cases, operational signals. Новый слой должен быть selector/retrieval поверх них, а не параллельная память.
- Не использовать `trainingpeaks_student_contact_events` как диалоговую историю. Там нет текста, это cadence/audit telemetry.
- Не считать `trainingpeaks_reply_drafts.draft_text` авторским стилем Игоря по умолчанию. Это AI draft; использовать для style corpus можно только если outcome sent/used без edit или если финальный edited text явно сохранен.
- Не включать все memory items/observations в prompt. Нужен per-message selective context; иначе будут latency, hallucination и privacy проблемы.
- Не автослать ученикам proactive messages на первом этапе. Сначала draft queue и approve/send.
- Не добавлять voice/audio в новый слой. В репозитории есть voice modules, но целевая архитектура text-only.
- Не строить отдельную “методологию диалога” поверх workout template/guardrails. Методология тренировок уже живет в template catalog, baselines, operational guards, recovery alerts. Диалоговый слой должен ссылаться на нее.
- Не хранить приватные переписки в логах/отчетах/diagnostics. Если нужен full text для retrieval, нужна явная privacy policy, ограничение доступа, retention и redaction.
- Не делать LLM router единственным gate для действий с нагрузкой. Существующие rule gates/action approval должны оставаться первыми предохранителями.

## Конфликты и риски

### Архитектурные конфликты

- Conversational agent может начать выглядеть как autonomous coach, но текущая философия - review-first/HITL. Решение: любая нагрузка, перенос, восстановление, медицински чувствительный ответ идут через draft/action approval.
- Style few-shot требует реальные исходящие тексты Игоря, а текущий privacy-conscious design часто хранит только preview/hash. Нужно явно решить, где допустимо хранить full text.
- TP cache удобен для контекста, но не должен стать source of truth. Context builder должен маркировать `cache_status` и не делать claims при stale/empty.
- Existing reply draft command требует ручного ввода student message; business DM auto-draft пока dry-run. Для цели нужен переход к inbound-message-driven queue, но без auto-send.
- `telegram_formality`/communication memory описывает, как обращаться к конкретному ученику, а не как пишет Игорь. Нельзя смешивать эти профили.

### Риски

- Латентность: per-message сборка может начать тянуть workouts, health, memory, observations, style retrieval и LLM. Нужны read-optimized selectors, capped results, возможно precomputed daily student state.
- Дублирование данных: если добавить dialogue ledger, не дублировать business chats/contact events/intent logs без четкой роли. Ledger должен быть canonical message event stream; остальные таблицы - derived/audit/workflow.
- Индексация few-shot: без embeddings сначала можно сделать label + student/situation + recency retrieval; embeddings/pgvector добавлять после proof of value. Если добавлять embeddings, хранить model/version и reindex path.
- Приватность: raw athlete/coach text является чувствительным. Нужны доступ только service_role/admin, no raw dumps in scripts, retention rules, redaction for diagnostics, explicit distinction preview/hash/full text.
- Style drift: few-shot на AI drafts ухудшит “пишет как я”. Нужны только финальные отправленные/одобренные тексты Игоря или verified samples.
- Safety: “человекоподобность” может конфликтовать с медицинскими/нагрузочными guardrails. System prompts и post-checks должны сохранять запрет диагнозов, плановых мутаций и уверенных claims без данных.
- Telegram Business ambiguity: outgoing coach message capture сейчас может определить факт контакта, но не текст и не всегда однозначно student mapping. Для style corpus нужны надежные direction/student/source fields.
- Admin UX debt: общего inbox для dialogue drafts нет; если оставить Telegram-only commands, масштабирование на 100+ учеников будет неудобным.

## Рекомендуемый порядок реализации с зависимостями

### 0. Зафиксировать контракты и границы

Цель: не размыть текущие решения.

- Описать state machine для dialogue draft: `incoming_message/trigger -> context_packet -> draft -> coach_edit/approve/ignore -> send -> feedback/style_sample`.
- Зафиксировать “no auto-send by default”, “no TP mutation from dialogue”, “text-only”, “Supabase source of truth”.
- Определить privacy policy для full text: какие тексты храним, сколько, кто видит, какие scripts могут печатать.

Зависимости: решение владельца продукта по privacy/full-text retention.

### 1. Захват финального исходящего текста Игоря

Самый быстрый скачок человечности начинается не с LLM, а с правильного корпуса.

- Добавить канонический dialogue event ledger или минимальный `coach_message_style_samples`.
- Сохранять финальный outgoing text при approve/send из reply drafts и weekly/nutrition flows, а также manual outgoing Business DM, если Telegram webhook reliably получает текст и privacy разрешает.
- Для edited drafts сохранять final edited text, not just note.
- Хранить direction, student_id, source, occurred_at, labels, linked_draft_id/case_id/action_id, text hash/preview/full text per policy.

Зависимости: privacy decision, UI/Telegram edit flow.

### 2. Единый Dialogue Inbox поверх существующего HITL

Без общего inbox агент останется command-only.

- Web Admin inbox: входящие relevant cases/messages, context snapshot, generated draft, approve/edit/send/ignore.
- Переиспользовать `trainingpeaks_reply_drafts`, но расширить metadata/final text semantics или добавить отдельную таблицу final messages.
- Telegram callbacks оставить быстрым каналом, но не единственным review UI.

Зависимости: шаг 0; частично шаг 1 для feedback capture.

### 3. Generalized context builder

Сделать из `reply-draft-context.ts` общий per-message context pipeline.

- Inputs: student, incoming text/trigger, trigger source, reference date.
- Selectors: TP cache current week/recent workouts, active operational signals, contact status, selected memory, relevant observations, methodology constraints, style few-shot.
- Output: structured packet + prompt text + hashes/version.
- Добавить cache status/no-hallucination contract.

Зависимости: существующие repositories; style retrieval может быть stub на первом этапе.

### 4. Style profile + retrieval few-shot v0

Начать без fine-tuning и без сложной vector infra.

- Из captured final texts считать простые profile features: median length, greeting/closing, punctuation, emoji, banned phrases, ты/вы compatibility, typical “коротко по делу” patterns.
- Retrieval v0: labels/situation type/student/source/recency + text similarity lexical.
- В prompt передавать 3-5 examples только если они final/verified and relevant.

Зависимости: шаг 1 corpus; шаг 3 context builder.

### 5. Proactive draft queue from tp_signals

Сначала proactive-to-coach, не proactive-to-student.

- Trigger sources: active operational signals, attention digest buckets, missed planned sessions, bad session/recovery flags.
- Add cooldown/mute preferences: per student, per signal type, per channel.
- Generate “why now” + draft + risk classification.
- Require approve/send.

Зависимости: шаг 2 inbox, шаг 3 context builder.

### 6. Feedback loop from edits

- При approve без edit: mark sample as accepted.
- При edit: store final text + diff summary; use as high-value style sample.
- При ignore: store reason/category; downrank similar generations.
- Periodically rebuild style profile/retrieval index.

Зависимости: шаг 1 final text capture, шаг 2 inbox.

### 7. Embeddings/pgvector только после v0

- Если lexical retrieval не хватает, добавить embeddings in Supabase with model/version/index.
- Не блокировать MVP на vector infra.

Зависимости: достаточный corpus и измеримые retrieval failures.

## Открытые вопросы ко мне

1. Можно ли хранить полный текст входящих и исходящих Telegram сообщений в Supabase для dialogue ledger/style retrieval, или нужен режим preview/hash + отдельное encrypted/private хранилище?
2. Какие исходящие тексты считать “золотым стилем Игоря”: только manual Telegram Business messages, edited drafts, approved drafts без правок, weekly report messages, nutrition drafts?
3. Нужен ли style profile один глобальный для Игоря или несколько режимов: короткий DM, workout feedback, injury/safety, race prep, admin/logistics?
4. Какой уровень автономности допустим для proactive layer на первом запуске: только draft in inbox, Telegram notification тренеру, или можно auto-send для low-risk поздравлений/ack?
5. Где должен жить основной review UI для диалога: Web Admin inbox, Telegram coach chat, или оба с единым state?
6. Нужна ли ученику возможность mute/pause proactive messages явно через Telegram, и как это должно выглядеть в UX?
7. Какой retention нужен для dialogue history: бессрочно, 90/180 дней, или только distilled memory + style samples?
8. Есть ли уже внешний архив реальных сообщений Игоря, который можно импортировать как seed corpus, или собирать корпус только с момента запуска?
9. Нужно ли conversation layer покрывать групповые топики Telegram наравне с Business DM, или первый MVP только 1:1 DM?
10. Какие ответы считаются “меняют нагрузку”: только переносы/план, или любые советы “сделай легче/отдохни/добавь” тоже должны требовать отдельного action approval?
