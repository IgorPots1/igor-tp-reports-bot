# Session Log — Run Analysis

Новые записи — сверху.

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
