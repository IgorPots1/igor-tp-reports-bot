# Phase 1 — Экранный отчёт в AdminOS

**Статус:** реализовано, гейты зелёные (`npm run lint` / `npm run build` / `npx tsc --noEmit`). Готово к живому тесту на превью.

---

## Что реализовано

Полный флоу: форма ввода → MediaPipe обработка с live-skeleton на canvas → вычисление метрик → LLM-разбор → экранный отчёт.

---

## Файлы

**Новые:**
```
src/features/run-analysis/
  types.ts
  pose/pose-runner.ts
  metrics/compute-metrics.ts
  metrics/reference-ranges.ts
  llm/adapter.ts
  llm/claude.ts
  llm/openai.ts
  llm/prompt.ts
  llm/parse.ts

src/app/api/run-analysis/route.ts
src/app/admin/coach-os/run-analysis/page.tsx
src/app/admin/coach-os/run-analysis/RunAnalysisTool.tsx
src/app/admin/coach-os/run-analysis/ReportView.tsx

docs/run-analysis/  ← этот файл и остальные
```

**Изменённые:**
```
package.json           — добавлен @mediapipe/tasks-vision
src/app/globals.css    — добавлен блок .admin-ra-* в конец
```

---

## Как запустить локально

```bash
# В .env.local добавить:
ANTHROPIC_API_KEY=sk-ant-...
# Опционально:
RUN_ANALYSIS_LLM_PROVIDER=claude        # claude (дефолт) | openai
RUN_ANALYSIS_CLAUDE_MODEL=claude-opus-4-8
RUN_ANALYSIS_OPENAI_MODEL=gpt-5.5
RUN_ANALYSIS_THINKING_ENABLED=false     # true для adaptive thinking (Фаза 2)

npm run dev
# Открыть: http://localhost:3000/admin/coach-os/run-analysis
# В dev без ADMIN_ACCESS_TOKEN — без авторизации (bypass)
```

Видео: MP4 или MOV, строго сбоку, 5–10 секунд непрерывного бега, бегун полностью в кадре.

---

## Env для Vercel Preview

Минимальный набор:
```
ADMIN_ACCESS_TOKEN=...       # уже должен быть
ANTHROPIC_API_KEY=sk-ant-... # новый
```

---

## Что проверить при живом тесте

1. **MediaPipe загружается** — прогресс-бар и canvas со скелетом появляются (WASM + модель ~15 МБ, первый раз медленно).
2. **Скелет визуально корректен** — жёлтые точки и линии на суставах, подходящий ракурс.
3. **Метрики разумны** — каденс ~160–185 для среднего бегуна, углы в рабочих диапазонах.
4. **LLM-текст** — русский, тренерский голос, без выдуманных чисел, конкретные рекомендации.
5. **Hero frame** — лучший кадр с заметным скелетом, не смазанный.
6. **Ошибки** — видео без человека / слишком короткое → понятное сообщение + чеклист пересъёмки.
