# Session Log — Run Analysis

Новые записи — сверху.

---

## 2026-06-26 — Фикс точности: первое касание вместо середины опоры

**Что сделано (НЕ закоммичено):**
- Диагноз подтверждён: `findLocalMaxima(ankleY)` давал MID-STANCE пики → нога уже плоская → foot_strike = "midfoot", оверстрайд ≈ 0, колено чрезмерно согнуто.
- Добавлена `findContactOnsets()` в compute-metrics.ts: сканирует назад от каждого пика до первого кадра, где голеностоп вышел из "зоны земли" (`groundProximity = 0.04`). Параметры в `CONFIDENCE_CONFIG`: `contactOnsetLookbackSec: 0.15`, `contactOnsetGroundProximity: 0.04` (TODO: тюнить на реальном материале).
- Knee/overstride/foot_strike → теперь meряются на onset-кадрах. Oscillation → по-прежнему на `contacts` (mid-stance, там нужны пики для цикла).
- `ComputeMetricsOutput` расширен `onsetFrameIndices: number[]` и `side: "left" | "right"`.
- `RunAnalysisResult` расширен `contactDiagnosticFrames?: string[]`.
- `captureOnsetDiagnostics()` в RunAnalysisTool.tsx: off-screen canvas 300×450, рисует: скелет, пунктир через таз (референс), стрелку оверстрайда (красная/зелёная), точки landmark'ов по цвету (жёлтый=таз, синий=колено, зелёный=голеностоп, пурпурный=пятка, голубой=мяч стопы), метку ПЯТКА/МИДФУТ/НОСОК.
- ReportView: новая секция «Диагностика: кадры первого касания» — ряд thumbnail'ов с пояснением легенды.

**Файлы:** reference-ranges.ts, compute-metrics.ts, types.ts, RunAnalysisTool.tsx, ReportView.tsx, docs.

**Гейты:** tsc ✅, lint ✅ (0 errors), build ✅.

**Следующий шаг:** прогон IMG_4933 (Филипп) и IMG_4932 (Александр), сравнить onset-кадры с mid-stance результатами ДО.

---

## 2026-06-26 — Форма: темп убран, рост/вес опциональны; горизонтальный детектор панорамы

**Что сделано (НЕ закоммичено):**
- Темп (pace) удалён: `paceMinPerKm` state + поле формы + `pace_min_per_km` из payload + тип `RunnerProfile`.
- Рост/вес опциональны: `height_cm / weight_kg` → `number | null`; кнопка блокируется только без видео; prompt — правило 5а о null полях.
- Горизонтальный детектор панорамы (из предыдущей сессии) — подтверждён на месте.

**Файлы:** types.ts, RunAnalysisTool.tsx, llm/prompt.ts, docs.

---

## 2026-06-26 — Тюнинг порогов + severity-lock + калибровка камеры

**Что сделано (НЕ закоммичено — прогон двух роликов):**
- Оверстрайд: 0–8% → ok, 8–20% → attention, >20% → important. 12% Фила теперь "attention", не "important".
- Camera motion: `oscCameraMotionLow` 0.6→1.2; `oscCameraMotionUnavailable` 1.5→5.0. Статичная с руки → "low" (полоса); панорама → "unavailable".
- `ApiMetric` расширен `severity?: MetricSeverity`; `toApiMetric()` проставляет его из `MetricStatus`.
- Prompt правило 7: severity-lock — LLM обязан брать `severity` из payload без переоценки.
- backlog.md: пункт 5 «Аннотированные кадры + PDF».

**Ожидаемый результат на тестах:**
- IMG_4933 (с руки): оверстрайд "внимание" + вертикальные колебания = полоса.
- IMG_4932 (панорама): колебания "не удалось определить".

**Файлы:** reference-ranges.ts, types.ts, RunAnalysisTool.tsx, llm/prompt.ts, docs/{decisions,backlog,session-log}.md.

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
