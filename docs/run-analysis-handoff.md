# Run Analysis — Handoff (Фаза 1)

Краткая передача по фиче «Анализатор техники бега». Подробные доки — в [docs/run-analysis/](run-analysis/).

## Что это и где

Админский инструмент: **`/admin/coach-os/run-analysis`** (за admin-авторизацией, публичного роута нет). Тренер загружает короткое видео бега сбоку, получает на экране тренерский разбор техники.

**Приватность:** видео **не покидает браузер**. MediaPipe считает позу локально; на сервер уходит **только JSON метрик** (рост/вес/темп/цель + посчитанные числа). Имя ученика тоже не уходит на сервер — это клиентское поле, показывается только в шапке экранного отчёта.

## Архитектура

**Слой замера (клиент, без сервера)** — `src/features/run-analysis/`:
- `pose/pose-runner.ts` — MediaPipe Pose Landmarker (WASM с CDN), прогон по кадрам, live-скелет на canvas.
- `metrics/compute-metrics.ts` — геометрия: каденс, угол колена при опоре, наклон корпуса, вертикальная осцилляция, оверстрайд, тип приземления.
- `metrics/reference-ranges.ts` — пороги ok/attention/important (плейсхолдеры, тюнинг с Игорем после первых прогонов).

**LLM-слой (сервер, ключи только здесь)** — `src/features/run-analysis/llm/`:
- `adapter.ts` — выбор провайдера по `RUN_ANALYSIS_LLM_PROVIDER` (дефолт `claude`).
- `claude.ts` / `openai.ts` — **raw fetch** (без SDK), retry с backoff.
- `prompt.ts` — системный промпт, голос Игоря, «ответь только JSON».
- `parse.ts` — `extractJsonOnly` + defensive parse (без Zod).

**API** — `src/app/api/run-analysis/route.ts`: admin-cookie обязателен (см. ниже), size guard 64 КБ, валидация формы, вызов адаптера.

**UI** — `src/app/admin/coach-os/run-analysis/{page,RunAnalysisTool,ReportView}.tsx`. CSS — блок `.admin-ra-*` в конце `src/app/globals.css`.

## Решения

- **Без `@anthropic-ai/sdk`** — raw fetch, как в nutrition-провайдере (SDK тащит Zod, не нужен).
- **Без `output_config.format` / `json_schema`** (beta) → промпт «только JSON» + `extractJsonOnly` + defensive parse.
- **thinking выключен**, но параметр заложен: `RUN_ANALYSIS_THINKING_ENABLED=true` включает `thinking: { type: "adaptive" }`.
- **Модель**: дефолт `claude-opus-4-8`, переключение на `claude-sonnet-4-6` через `RUN_ANALYSIS_CLAUDE_MODEL` без правок кода. OpenAI-fallback (дефолт `gpt-5.5`) через `RUN_ANALYSIS_LLM_PROVIDER=openai`.
- **Авторизация**: байпас только при `NODE_ENV === "development"`. На Vercel (preview и прод, где `NODE_ENV=production`) валидная admin-кука обязательна **всегда**, независимо от наличия токена.

## Изоляция

Вся работа в ветке `feature/run-analysis`. **Nutrition не импортируется** — LLM-паттерн скопирован в свою папку, не переиспользован. Единственный общий импорт — `@/lib/admin-auth` (общая инфраструктура). Telegram/billing/trainingpeaks/supabase не затронуты.

## Как запустить локально

```bash
# .env.local:
ANTHROPIC_API_KEY=sk-ant-...
# опционально:
RUN_ANALYSIS_LLM_PROVIDER=claude          # claude (дефолт) | openai
RUN_ANALYSIS_CLAUDE_MODEL=claude-opus-4-8 # или claude-sonnet-4-6
RUN_ANALYSIS_OPENAI_MODEL=gpt-5.5
RUN_ANALYSIS_THINKING_ENABLED=false

npm run dev
# http://localhost:3000/admin/coach-os/run-analysis
# в dev (NODE_ENV=development) без токена — байпас авторизации
```

На Vercel preview/прод нужны `ADMIN_ACCESS_TOKEN` (уже есть) и `ANTHROPIC_API_KEY` (новый).

Видео: MP4/MOV, строго сбоку, 5–10 секунд непрерывного бега, бегун полностью в кадре.

## Отложено

- **Живой прогон на реальном видео** — проверить скелет, метрики, текст LLM.
- **А/Б Opus vs Sonnet** на одном видео → выбрать дефолт для прода.
- **Тюнинг порогов** в `src/features/run-analysis/metrics/reference-ranges.ts`.
- **PDF-экспорт** — основной продукт для отдачи клиенту (бренд XO Runners). Собирается клиентски из hero-кадра. Отдельным диффом, после подтверждения качества экранного отчёта.
