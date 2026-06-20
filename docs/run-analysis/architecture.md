# Architecture — Run Analysis

## Слой замера (клиент, без сервера)

```
src/features/run-analysis/
  types.ts                   — все типы фичи: RunnerProfile, RunMetrics, MetricStatus,
                               RunAnalysisApiPayload, RunAnalysisReport, RunAnalysisResult
  pose/
    pose-runner.ts           — initPoseLandmarker() + processVideoFile(); грузит MediaPipe WASM
                               с CDN (jsdelivr), модель pose_landmarker_full с Google Storage;
                               перебирает кадры seek'ом, рисует скелет (#facc15) на canvas;
                               возвращает NormalizedLandmark[][] + hero frame idx
  metrics/
    compute-metrics.ts       — computeMetrics({frames, fps, durationSec}): каденс через
                               count local-maxima по y-позиции лодыжки, угол колена через
                               векторную геометрию (hip→knee→ankle), наклон корпуса через угол
                               к вертикали, оверстрайд через Δx(стопа−бедро)/длину ноги,
                               тип приземления по разнице y(heel, foot_index) в момент опоры
    reference-ranges.ts      — пороги ok/attention/important для каждой метрики (TODO: тюнинг
                               с Игорем после первых реальных прогонов)
```

Все модули замера — чистые функции, нет React, нет сервера. Динамически импортируются из `RunAnalysisTool.tsx`, чтобы WASM не попал в SSR-бандл.

## LLM-слой (сервер, ключи только здесь)

```
src/features/run-analysis/llm/
  adapter.ts    — generateRunAnalysis(payload): выбирает провайдера по RUN_ANALYSIS_LLM_PROVIDER
                  (env, дефолт "claude"); возвращает {ok, report, provider, model}
  claude.ts     — raw fetch → api.anthropic.com/v1/messages; модель из RUN_ANALYSIS_CLAUDE_MODEL
                  (дефолт claude-opus-4-8); thinking выключен в Фазе 1 (env-флаг заложен);
                  3 попытки с экспоненциальным backoff 2/4/8 с
  openai.ts     — raw fetch → chat/completions; response_format json_object; поддержка
                  next-gen моделей (max_completion_tokens вместо max_tokens)
  prompt.ts     — SYSTEM_PROMPT (голос Игоря, ответить только JSON) + buildUserMessage(payload)
  parse.ts      — extractJsonOnly() + parseRunAnalysisReport(): defensive parse без Zod;
                  discriminated union {ok:true, report} | {ok:false, error}
```

LLM-слой не импортирует ничего из nutrition или других фич — паттерн скопирован, не переиспользован.

## UI (React, "use client")

```
src/app/admin/coach-os/run-analysis/
  page.tsx          — server component, metadata, рендер RunAnalysisTool
  RunAnalysisTool.tsx — стейт-машина form→processing→report→error; canvas всегда
                         в DOM (display:none вне processing) чтобы ref был валиден
                         до начала async-обработки
  ReportView.tsx    — hero img, summary, headline findings, metrics table,
                         metrics_commentary, recommendations + drills, disclaimer
```

CSS: `.admin-ra-*` блок добавлен в конец `src/app/globals.css` (canvas, progress bar, finding cards, drill lists, disclaimer). Стиль стандартный admin, без XO-бренда (он пойдёт только в PDF).

## API route

```
src/app/api/run-analysis/route.ts
  POST /api/run-analysis
    1. Admin-cookie check (hasValidAdminAccessCookie из @/lib/admin-auth)
       — dev-bypass если NODE_ENV=development и ADMIN_ACCESS_TOKEN не задан
    2. Size guard: 64 KB на body (content-length + текстовый буфер)
    3. Shape validation (runner_profile / computed_metrics / metric_statuses)
    4. generateRunAnalysis(payload) → LLM adapter
    5. Ответ: {report, provider, model} или {error, detail}
```

Видео на сервер не попадает никогда. Endpoint без CORS — только same-origin fetch из admin UI.

## Поток данных

```
Браузер (тренер)
  └─ выбор файла (File, blob, ≤30 МБ)
       └─ RunAnalysisTool.tsx
            ├─ initPoseLandmarker()   — WASM + модель с CDN, ~2–5 с первый раз
            ├─ processVideoFile()     — seek по кадрам, skeleton на canvas (live)
            ├─ computeMetrics()       — геометрия → RunMetrics + metricStatuses
            ├─ canvas.toDataURL()     — hero frame для отчёта (blob в памяти)
            └─ fetch POST /api/run-analysis
                  body: RunAnalysisApiPayload (JSON, ~2 КБ)
                    └─ сервер: validatePayload → generateRunAnalysis → LLM API
                         ответ: RunAnalysisReport (JSON)
            └─ parseRunAnalysisReport() → setResult → ReportView
```
