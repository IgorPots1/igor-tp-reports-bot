# Session Log — Run Analysis

Новые записи — сверху.

---

## 2026-06-21 — Стратегия метрик: достоверность + каденс вручную

**Что сделано (НЕ закоммичено — валидация на превью):**
- Угол колена → flexion-конвенция (`180 − angleDeg`).
- Каденс убран из видео-замера; добавлено опциональное поле «каденс с часов» в форме, показ как контекст.
- Вертикальные колебания: амплитуда по циклам + детренд hip.y + калибровка роста + полоса low/medium/high.
- Per-метрика `{ value, confidence, reason }` (ok/low/unavailable); `CONFIDENCE_CONFIG` в reference-ranges.ts.
- Общий гейт «ролик не подходит» (мало доступных метрик) → экран пересъёмки, без частичного отчёта.
- pose-runner: смягчён hard-гейт `too_few_cycles` (хватает ~3 циклов; точную достоверность даёт confidence-слой).
- ReportView: confidence-aware рендер (unavailable → «не удалось определить» + причина; low → ориентир/полоса).
- LLM-промпт: приоритет приземление → колебания → осанка; каденс только если введён вручную; unavailable не трактуется.
- Payload: cadence убран из видео, computed_metrics — структура с confidence; unavailable = «не определено».
- Гейты зелёные. Дальше — прогон на хорошем и заведомо плохом ролике на превью.

**Файлы:** types.ts, metrics/{compute-metrics,reference-ranges}.ts, pose/pose-runner.ts, llm/prompt.ts, api/run-analysis/route.ts, admin UI {RunAnalysisTool,ReportView}.tsx, docs.

---

## 2026-06-20 — Харднинг авторизации + хендофф-док

**Что сделано:**
- Авторизация в `route.ts`: байпас теперь только при `NODE_ENV === "development"` (свой `isLocalDevBypass`, убрана зависимость от `isAdminAccessBypassedForLocalDev`). На Vercel preview/прод (`NODE_ENV=production`) admin-кука обязательна всегда, независимо от наличия токена.
- Проверен сквозной флоу `studentName`: форма → результат → шапка отчёта работает. Имя намеренно остаётся клиентским (не входит в `RunnerProfile`/серверный payload) — на сервер/LLM PII не уходит. Код не менялся.
- OpenAI-fallback дефолт `gpt-4o` → `gpt-5.5` (код + доки); `isNextGen`-ветка корректно отдаёт `max_completion_tokens`.
- Создан `docs/run-analysis-handoff.md` (короткая передача).
- Гейты зелёные: `npx tsc --noEmit`, `npm run lint` (0 ошибок), `npm run build`.

---

## 2026-06-20 — Фаза 1: экранный отчёт в AdminOS

**Что сделано:**
- Реализован полный флоу: форма (имя/рост/вес/темп/цель) → MediaPipe обработка с live-скелетом на canvas → compute-metrics → LLM-разбор → экранный отчёт.
- Инструмент перенесён из публичного `/tools/run-analysis` в AdminOS `/admin/coach-os/run-analysis` (решение принято в процессе — см. [decisions.md](decisions.md)).
- API route защищён admin-cookie (`hasValidAdminAccessCookie`).
- LLM-слой: raw fetch (без SDK), дефолт `claude-opus-4-8`, thinking заложен но выключен, OpenAI-fallback через env.
- Гейты зелёные: `npm run lint` / `npm run build` / `npx tsc --noEmit`.

**Что решено:**
- Без `@anthropic-ai/sdk` (тащит Zod, raw fetch достаточен).
- Без `output_config.format/json_schema` (beta, промпт+extractJsonOnly надёжнее).
- Thinking выключен в Фазе 1.
- Изоляция от nutrition: паттерн скопирован, не импортирован.
- PDF — отдельным шагом после живого теста.

**Что дальше:**
- Живой прогон на реальном видео (проверить скелет, метрики, LLM-текст).
- А/Б Opus vs Sonnet на одном видео → выбрать дефолт для прода.
- Тюнинг порогов в reference-ranges.ts.
