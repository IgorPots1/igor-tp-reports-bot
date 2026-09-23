# METHODOLOGY AUDIT: Nutrition Text Generation Pipeline
**Дата**: 2026-06-10  
**Статус**: Read-only, без мутаций  
**Контекст**: Аудит качества генерируемых текстов, не data flow (data flow — в AUDIT_nutrition_2026-06-10.md)  
**Спека-референс**: coachos-nutrition-final-spec.md v4.1 (описана в промпте, не найдена в репо)

---

## 1. Резюме

**Главные отличия текущей генерации от эталона:**

1. **LLM пишет монолит, не куски** — для stored review (`athlete_message_draft`) LLM возвращает полный готовый текст. Renderer существует, но он работает параллельно в combined message path, а не поверх AI output. Два пути генерации текста создают расхождение.

2. **`coach_context_ru` и `athlete_report_signals` не существуют в коде** — LLM никогда не получает ни ручных заметок тренера об ученике, ни keyword-сигналов из отчёта ученика. Эти высоколевериджные поля из спеки отсутствуют полностью.

3. **Фиксированная фраза "Посмотрел"** (masculine) зашита в renderer вместо персонализированной вводной. Для female-coach не подойдёт.

4. **Race-week mode отсутствует** — тип `race` обрабатывается per-day, но нет week-level флага, меняющего тон и содержание всего разбора.

5. **Week-over-week сравнение — мёртвый код**: логика есть, но поле `previous_weeks_context` никогда не заполняется, поэтому сравнение никогда не показывается.

6. **Pre-training блок не дифференцирован по времени тренировки** — всегда показываются оба варианта (утро и вечер) вместо выбора на основе реального расписания.

7. **`nutritionGoal` ученика не попадает в LLM для review** — есть в контексте, но не в factsPayload.

---

## 2. Pipeline as-is

```
[PDF/text upload]
      ↓
[file-intake.ts] extractNutritionRowsFromFatSecretPdfText
      ↓ NormalizedManualMacroRow[]
[context.ts] buildNutritionStudentContext
  - TP cache: past week (completed_only) + next week (all)
  - manualMacroRows, dataQuality, reportStatus
  - communicationProfile, coachMemoryItems (available but NOT in LLM payload)
  - nutritionGoal (available but NOT in LLM payload for review)
      ↓ NutritionStudentContext
[methodology.ts] buildNutritionMethodologyContext
  - per-day NutritionDailyAnalysis (join macro×TP by date)
  - energyAvailability, energyFloor, macroGuardrails per day
  - focusCandidateSignals (longRunUnderfueling, hardSessionUnderfueling, etc.)
  - selectNutritionWeeklyFocus → NutritionOneFocus (category + statementRu)
      ↓ NutritionMethodologyContext
[draft-generator.ts] generateNutritionWeeklyAnalysis
  ┌─── AI path (OpenAI, temp=0.2) ────────────────────────────────────────────┐
  │ systemPrompt: 18 rules (see §2a)                                          │
  │ factsPayload: {student, tp_context, data_quality, daily_analysis,         │
  │               training_nutrition_links, one_focus, methodology_signals,   │
  │               safety_flags}                                                │
  │ → LLM returns COMPLETE JSON:                                               │
  │   {coach_summary_text, day_by_day_analysis_text, athlete_message_draft,   │
  │    quality_notes, do_not_send_reasons}                                     │
  └───────────────────────────────────────────────────────────────────────────┘
  ┌─── Fallback path ──────────────────────────────────────────────────────────┐
  │ buildFallbackCoachSummary (template-based)                                 │
  │ buildFallbackDayByDay → buildDetailedDayObservationLines                  │
  │ buildFallbackAthleteDraft (address block + day lines + focus + step)       │
  └───────────────────────────────────────────────────────────────────────────┘
      ↓ Upsert → nutrition_weekly_analyses (student_id, week_from, week_to)
      ↓ stored: nutrition_summary.{coach_summary_text, day_by_day_analysis_text,
                                   athlete_message_draft, daily_analysis}

[weekly-plan-generator.ts] generateAndSaveNutritionWeeklyPlan
  - weekly-plan-formulas.ts: buildNutritionNextWeekPlan (formula from bodyweight)
  - AI: plan_focus, key_training_days, simple_actions, athlete_message_draft
  - Fallback: buildFallbackPlanFocus, buildFallbackKeyTrainingDays, buildFallbackAthleteDraft

[combined-message.ts] buildDerivedNutritionCombinedMessage  ← PRIMARY COPY PATH
  - getDailyFactsLines(review): DETERMINISTIC from canonical daily_analysis
  - filterFactsToReviewWeek: filters to review.weekFrom..weekTo
  - renderNutritionTelegramMessage (telegram-renderer.ts):
      Greeting + "Посмотрел...") [HARDCODED]
      + comparisonLine (if hasPreviousWeeksContext, currently always null)
      + dayComments (DETERMINISTIC code, not LLM)
      + weekSummary (DETERMINISTIC from canonical)
      + focusLines (from plan.planSummary.plan_focus)
      + planLines (mini-table or day-type targets)
      + preTrainingBlock [HARDCODED both morning/evening variants]
      + "На следующем разборе..." [HARDCODED closing]
  - cleanupPlainText: strips markdown, em-dashes→"-", "TrainingPeaks"→"план тренировок"
  - validateTelegramReadyNutritionMessage: checks em-dashes, markdown, internal terms, etc.
```

---

## 3. Сравнительная таблица со спекой v4.1

| Аспект спеки | Состояние в коде | Файл:строка | Gap |
|---|---|---|---|
| Двухслойная архитектура: ретроспектива vs прогноз | Частично — review (past) и plan (next) разделены. Но stored `athlete_message_draft` из AI не проходит через renderer | `draft-generator.ts:596`, `combined-message.ts:844` | Stored review draft — монолит без renderer |
| Один фокус на неделю с приоритетом | Реализован: `selectNutritionWeeklyFocus` с 8 категориями + приоритет | `methodology.ts:176`, `draft-generator.ts:711` | Частичный: `maintenance` ← fallback без чёткого порядка |
| Хеджированная причинность | В system prompt: "Разрешённые хеджи: может, могло..." | `draft-generator.ts:610` | Только для AI; fallback-тексты могут нарушать (нет проверки) |
| ты/вы handling | В system prompt + шаблоны через `formality`. Validator не проверяет смешение. | `draft-generator.ts:605`, `telegram-renderer.ts:120` | Нет runtime-валидации на mixed ты/вы; "Посмотрел твой" — ты-форма захардкожена даже при formality=vy |
| Pre-training два варианта (утро vs вечер) | `buildPreTrainingBlock` всегда показывает ОБА варианта без выбора | `telegram-renderer.ts:197–208` | **Нет выбора по времени тренировки.** Всегда оба варианта |
| Week-over-week сравнение (одна строка max) | Логика есть, validator проверяет. Но `hasPreviousWeeksContext` всегда false — поле `previous_weeks_context` никогда не записывается | `combined-message.ts:779`, `telegram-renderer.ts:238` | **Мёртвый код.** Поле не заполняется ни одним генератором |
| coach_context_ru поле | **Отсутствует** — не определено ни в context, ни в factsPayload | — | **Critical gap** |
| athlete_report_signals (keyword detection) | **Отсутствует** — нет keyword scanning по тексту отчёта | — | **Critical gap** |
| Race-week mode (week-level) | Per-day тип `race` обрабатывается. Week-level флага нет | `methodology.ts:401` | **Нет week-level race_week=true** |
| Decision matrix для дневных комментариев | Двойная реализация: `buildHintForComment` в methodology.ts + `renderNutritionDayComment` в combined-message.ts + LLM пишет свои | `methodology.ts:876`, `combined-message.ts:385` | **Три параллельных decision matrix.** Могут расходиться |
| Формулы плана от веса | Реализованы: `buildNutritionNextWeekPlan` считает kcal/g/kg от bodyweightKg | `weekly-plan-formulas.ts:578` | Работает; нет обработки случая bodyweight=null (показывает "н/д") |
| Запрет "TrainingPeaks" в тексте | `cleanupPlainText` заменяет на "план тренировок". Validator проверяет. | `telegram-renderer.ts:110`, `235` | Только в combined path; stored `athlete_message_draft` напрямую не проходит cleanup |
| Запрет диагностических терминов | В system prompt: "RED-S, REDs, LEA, анемия, расстройство..." | `draft-generator.ts:606` | Только для AI; fallback не проверяется программно |
| Запрет restriction language | В system prompt: "похудеть, сбросить вес, урезать..." | `draft-generator.ts:607` | Validator проверяет. Fallback — не проверяется |
| Запрет em-dashes (—) | `cleanupPlainText`: `[—–]→"-"`. Validator: `error` если em-dash | `telegram-renderer.ts:112`, `229` | Только в combined path. Stored review не чистится |
| Запрет markdown ** | `cleanupPlainText` + validator | `telegram-renderer.ts:104`, `232` | Аналогично — только combined path |
| Запрет латиницы | **Частично** — validator проверяет только конкретные слова ("TrainingPeaks", "AI", "JSON"). Общего запрета латиницы нет | `telegram-renderer.ts:235` | Нет общего Cyrillic-only check |
| long_run_underfuelling как категория шаблона | `NutritionFocusCategory.long_run_underfueling` и `buildHintForComment("long_run_low")` | `methodology.ts:178`, `876` | Реализовано. Категория есть, hint есть |
| Alignment check (низкий день на ключевой) | `buildHintForComment("low_for_load")` и `hardSessionUnderfueling` signal | `methodology.ts:887`, `1574` | Реализовано. Но нет explicit "alignment_mismatch" label в output |
| LLM пишет куски, renderer композирует | **Только в combined path** — renderer детерминирован. Stored review — LLM пишет монолит | `combined-message.ts:879`, `draft-generator.ts:596` | **Гибридная архитектура, не единая** |
| `nutritionGoal` в factsPayload | Используется только для safety check | `draft-generator.ts:700` | **Не передаётся в LLM для review generation** |
| Coach memory items в factsPayload | Доступны в context, но НЕ в factsPayload | `context.ts:660`, `draft-generator.ts:625` | **Не передаются в LLM** |

---

## 4. Примеры реальных разборов

**Доступных fixture-файлов с примерами готовых разборов не найдено** (только strength-workout fixtures в tools/). Анализ — по коду и вышедшим данным диагностики.

### 4.1 Полякова (из diagnose-output)

Stored review (fallback mode) содержал фразы из `buildDetailedDayObservationLines`:
```
🔹 Пн (02.06) — день без тренировки в TrainingPeaks
~1683 ккал · белок 94 г · жиры 87 г · углеводы 137 г.
Комментарий: по качеству данных здесь возможна неполная картина. Нагрузка и питание в целом согласованы; можно дать краткий поддерживающий комментарий.
```

**Найденные ляпы**:
- "день без тренировки в TrainingPeaks" — название упоминает TP прямо в тексте (нарушение спеки)
- "Комментарий:" — стейлая служебная фраза (уже детектируется как stale phrase в page-consistency.ts)
- "можно дать краткий поддерживающий комментарий" — это `hintForComment` из кода, который должен быть внутренним, но попал в athlete-visible fallback text
- "Нагрузка и питание в целом согласованы" — robot-generic, не тёплый

### 4.2 Структурный анализ fallback текста

`buildFallbackAthleteDraft` генерирует:
```
{greeting}

По неделе в целом питание [нормальное/выглядит рабочим], но есть моменты/точки, где нагрузка и питание расходились.
{dayLines.join("\n")} ← может быть пустым
На этой неделе главный фокус: {normalizedFocus}.
{progressionStepText}
Делаем небольшой шаг без резких скачков и без жёстких цифр.
На следующем разборе посмотрим, как это повлияло на энергию и восстановление.
```

**Проблемы**:
- "По неделе в целом питание нормальное" — слово "нормальное" шаблонное
- Intro sentence не менялся вне зависимости от реальных данных недели
- "На следующем разборе посмотрим" — closing одинаковый для всех учеников
- Нет персонализации под конкретного ученика (нет имени в тексте если `profile.preferredGreeting` пустой)

### 4.3 Combined renderer — структура итогового текста

```
{Имя}, привет!  ← или Здравствуйте, {Имя}!

Посмотрел твой отчёт за неделю и сопоставил его с тренировками.  ← HARDCODED

🔹 Разбор по дням
{дни из canonical daily_analysis — DETERMINISTIC}

📌 Итог недели
{weekSummaryRu — DETERMINISTIC из canonical}

📌 Фокус на следующую неделю / Фокус на эту неделю
{focusLines из plan.planSummary.plan_focus}
Цифры ниже - ориентиры, не обязательство. Не нужно резко прыгать к ним за один день.  ← HARDCODED
Главный шаг на этой неделе - поднять энергию и углеводы в дни нагрузки, особенно перед ключевой тренировкой.  ← HARDCODED

📋 Мини-таблица / План на неделю по типам дней
{planLines — DETERMINISTIC формулы}

🍽 Перед ключевыми тренировками  ← всегда если есть hard/long_run
Если тренировка утром: ...  ← HARDCODED
Если тренировка днём или вечером: ...  ← HARDCODED

На следующем разборе посмотрим, как это отразится на энергии и восстановлении.  ← HARDCODED
```

---

## 5. Жёстко зашитые тексты

| Фраза | Файл:строка | Проблема |
|---|---|---|
| `"Посмотрел твой отчёт за неделю и сопоставил его с тренировками."` | `telegram-renderer.ts:292` | Мужской род (Посмотрел), ты-форма (твой). Не адаптируется к formality=vy; не учитывает пол тренера |
| `"По неделе держим курс на ровную энергию и восстановление без резких просадок."` | `telegram-renderer.ts:301`, `combined-message.ts:701` | Generic fallback — одинаков для всех учеников независимо от реальной картины недели |
| `"Цифры ниже - ориентиры, не обязательство. Не нужно резко прыгать к ним за один день."` | `telegram-renderer.ts:305`, `weekly-plan-generator.ts:639` | Всегда одинаков; дубликат в двух местах |
| `"Главный шаг на этой неделе - поднять энергию и углеводы в дни нагрузки, особенно перед ключевой тренировкой."` | `telegram-renderer.ts:306`, `weekly-plan-generator.ts:640` | Всегда одинаков — даже если у ученика нет ключевых тренировок на след. неделе; дубликат |
| `"На следующем разборе посмотрим, как это отразится на энергии и восстановлении."` | `telegram-renderer.ts:312` | Closing всегда одинаков |
| `"На следующем разборе посмотрим, как это повлияло на энергию и восстановление."` | `draft-generator.ts:128,135,142` | Аналог выше в fallback — три копии |
| `"Если тренировка утром: углеводный ужин накануне и лёгкий перекус за 30-60 минут."` | `telegram-renderer.ts:204` | Всегда оба варианта, нет выбора по времени TP workout |
| `"Если тренировка днём или вечером: нормальный приём пищи за 2-3 часа..."` | `telegram-renderer.ts:205` | Аналогично |
| `"По неделе в целом питание выглядит рабочим..."` / `"питание нормальное"` | `draft-generator.ts:495–496` | Intro к fallback draft — robot-generic |
| `"день без тренировки в TrainingPeaks"` | `methodology.ts:840` | Называет "TrainingPeaks" напрямую в training label |
| `"По белку у тебя/вас всё хорошо, здесь ничего не меняем."` | `draft-generator.ts:126,133` | Одинаков для всех учеников с proteinSufficient=true |
| `"Начинаем с простого шага: не занижаем углеводы..."` | `draft-generator.ts:164` | strategy=small_step — одинаков для всех |

---

## 6. Gap-анализ по категориям A–E

### (A) Отсутствующие данные на входе

LLM физически не получает нужные данные:

| Поле | Описание | Влияние |
|---|---|---|
| `coach_context_ru` | Заметки тренера: травма, предстоящий старт, жизненное событие | LLM не знает контекст — генерирует generic текст |
| `athlete_report_signals` | Ключевые слова из текста отчёта ученика ("устала", "болела", "не поела до тренировки") | LLM не видит self-reported сигналы ученика |
| `nutritionGoal` | Цель ученика (накачаться, похудеть, бегать лучше) | Присутствует в context, не в factsPayload для review |
| `coachMemoryItems` | race_or_goal, health_status, load_tolerance, schedule_constraint | Присутствуют в context, не в factsPayload |
| `previous_week_summary` | Сравнительный контекст (avg kcal, training load прошлой недели) | `hasPreviousWeeksContext` всегда false → сравнение никогда не показывается |
| `sex` (пол ученика) | Используется в EA формулах, но не передаётся LLM явно | LLM не может адаптировать тон/формулировки |
| `training_time_of_day` | Время тренировок (утром/вечером) из TP | pre-training блок не персонализирован |
| `race_week_flag` | Week-level флаг "это рейс-неделя" | Нет — нет изменения тона разбора для race-week |

### (B) Слабый prompt

Данные есть, инструкции слабые или отсутствуют:

| Gap | Описание | Текущий промпт |
|---|---|---|
| Нет decision matrix для дней | LLM не знает приоритет: сначала energy, потом protein, потом fat | Только "используй hints из facts" |
| Нет race-week instruction | Нет инструкции "если статус недели race — сократить day-by-day, добавить recovery-акцент" | Отсутствует |
| Нет ограничения длины day-by-day | LLM может написать слишком длинный разбор | "3-7 дневных наблюдений" — есть, но нет ограничения длины на комментарий |
| Нет instruction по week-over-week | LLM не знает можно ли сравнивать с прошлой неделей | Нет |
| Нет explicit "athlete_name usage" rule | LLM может не использовать имя ученика или использовать его слишком часто | Только "допускается при наличии в facts" |
| Нет instruction "не повторять шаблонные закрывающие фразы" | LLM может добавить свой closing, который дублирует hardcoded closing в renderer | Нет |
| Запрет латиницы — нет общего rule | Validator проверяет только конкретные слова | System prompt: нет general "только кириллица" rule |

### (C) Отсутствующий/неполный renderer

| Gap | Описание |
|---|---|
| Stored `athlete_message_draft` не проходит cleanupPlainText | AI-ответ сохраняется as-is. em-dashes, markdown, "TrainingPeaks" в stored draft не чистятся до отображения |
| Stored draft не валидируется | `validateTelegramReadyNutritionMessage` вызывается только в combined path, не при сохранении review |
| Нет проверки на mixed ты/вы в рантайме | Validator не проверяет смешение форм обращения в финальном тексте |
| `buildDetailedDayObservationLines` включает `hint_for_comment` as-is | В fallback path `hint_for_comment` (внутренняя метка) попадает в athlete-visible текст после "Комментарий:" |

### (D) Архитектура (LLM делает то, что должен делать код)

| Gap | Описание |
|---|---|
| LLM генерирует `day_by_day_analysis_text` целиком | По спеке: LLM должен писать интерпретацию, код — форматировать. Сейчас для stored review LLM пишет финальный day-by-day включая структуру |
| LLM генерирует `athlete_message_draft` полностью | Combined path использует детерминированный renderer — это правильно. Но stored draft из AI используется в fallback "Служебный черновик из БД" |
| Pre-training блок — hardcoded, не из LLM | Это правильно (deterministic). Но содержание не адаптировано к training time |
| Greeting — hardcoded | "Посмотрел твой отчёт" — не из LLM. Это правильно (deterministic). Но не адаптирован к полу/formality |

### (E) Шаблоны/категории (нет category-based генерации)

| Gap | Описание | Файл |
|---|---|---|
| Race-week category template | Нет week-level "race week" mode с другим шаблоном | Нет |
| Athlete-specific closing | Closing всегда одинаков; нет personalised variant | `telegram-renderer.ts:312` |
| Week summary templates по категориям | `getReviewWeekSummaryLine` — детерминированный, хороший. Но нет rich category-based variants | `combined-message.ts:642` |
| "Похвала" template для хорошей недели | Нет шаблона для "ученик всё сделал правильно" — только universal generic | Нет |

---

## 7. Приоритизированный план приведения к спеке

### P0 — без этого даже при fix RC-1 текст не станет эталоном

**P0-1: Убрать `hint_for_comment` из athlete-visible fallback text**  
Файл: `draft-generator.ts:454–462` (`buildDetailedDayObservationLines`)  
Описание: `cautiousPrefix + hint` — hint это "можно дать краткий поддерживающий комментарий" — внутренняя метка, не для ученика. Заменить hint на deterministic comment из той же логики что в `renderNutritionDayComment` (combined-message.ts:385).  
Размер: S (один файл, ~30 строк)

**P0-2: Убрать "день без тренировки в TrainingPeaks" из training label**  
Файл: `methodology.ts:840`  
Описание: Заменить "день без тренировки в TrainingPeaks" на "день без тренировки" или "день отдыха".  
Размер: XS (одна строка)

**P0-3: Прогнать stored `athlete_message_draft` через cleanupPlainText перед отображением**  
Файл: `src/app/admin/coach-os/nutrition/[studentId]/page.tsx:998–1003` или при сохранении в `draft-generator.ts:676`  
Описание: Вызывать `cleanupPlainText` на `athlete_message_draft` при сохранении или перед рендером. Это уберёт em-dashes, markdown и "TrainingPeaks" из stored drafts.  
Размер: S

**P0-4: Убрать дублирование hardcoded фраз в двух файлах**  
Файлы: `telegram-renderer.ts:305–306` + `weekly-plan-generator.ts:639–640`  
Описание: Константы используются в двух местах с разными вариациями. Нужна единая константа или условный рендер.  
Размер: XS

---

### P1 — необходимо для соответствия спеке

**P1-1: Добавить `coach_context_ru` в factsPayload**  
Файлы: `src/features/nutrition/context.ts`, `draft-generator.ts:625`  
Описание: Добавить поле `coachContextNotes` (из `nutritionContextItems` с типом `note` + `telegramContextNotes`) в factsPayload. Добавить правило в system prompt: "Если есть coach_context_ru — используй как высокоприоритетный контекст для интерпретации недели."  
Размер: M (2 файла, ~20 строк кода + system prompt rule)

**P1-2: Передать `nutritionGoal` и `coachMemoryItems` в factsPayload**  
Файл: `draft-generator.ts:625`  
Описание: `context.nutritionGoal` и `context.coachMemoryItems` (race_or_goal, health_status, pain_or_injury) доступны в context, но не в factsPayload. Добавить как `student.goal` и `student.context_notes`.  
Размер: S

**P1-3: Исправить "Посмотрел твой отчёт"**  
Файл: `telegram-renderer.ts:292`  
Описание: Сделать эту фразу зависимой от formality и убрать "твой" при formality=vy. Пример: "Посмотрел отчёт за неделю и сопоставил его с тренировками." — нейтральная форма без ты/вы.  
Размер: XS

**P1-4: Реализовать week-level race_week flag**  
Файл: `methodology.ts`, `draft-generator.ts`  
Описание: Добавить `isRaceWeek: boolean` в `NutritionMethodologyContext` — true если любой день недели имеет `canonicalTrainingType === "race"`. Добавить в factsPayload и в system prompt rule "при race_week=true разбор короче, акцент на восстановление".  
Размер: M

**P1-5: Добавить `athlete_report_signals` (keyword scanning)**  
Файл: `file-intake.ts` или новый `nutrition/report-signals.ts`  
Описание: При загрузке PDF/text сканировать rawText на ключевые слова ("устала", "болела", "не поела", "плохо бежалось", "давление"). Сохранять в `report.data_quality.athlete_signals` или как отдельное поле. Передавать в factsPayload.  
Размер: M

**P1-6: Дифференцировать pre-training блок по времени тренировки**  
Файл: `telegram-renderer.ts:197`  
Описание: Добавить в `NutritionNextWeekPlanDay` поле `workout_time_hint` ("morning" | "afternoon" | "evening" | "unknown") из TP cache (`workout.plannedText` анализ). В `buildPreTrainingBlock` — показывать только один вариант. При `unknown` — показывать оба (текущее поведение).  
Размер: M

**P1-7: Добавить runtime-валидацию на mixed ты/вы**  
Файл: `telegram-renderer.ts:219`  
Описание: В `validateTelegramReadyNutritionMessage` добавить check: если formality=vy и текст содержит "твой/твоя/твои/тебе/ты " — warning. Если formality=ty и текст содержит "вас/вам/вашей/вы " — warning.  
Размер: S

**P1-8: Добавить general Cyrillic-only check**  
Файл: `telegram-renderer.ts:219`  
Описание: Добавить rule в validator: если текст содержит слова >3 символов с латиницей кроме разрешённых (числа, km, кг и т.д.) — warning.  
Размер: S

---

### P2 — можно отложить

**P2-1: Реализовать `previous_weeks_context` накопление**  
Файл: `weekly-plan-generator.ts` / `draft-generator.ts`  
Описание: При генерации нового review сохранять snapshot текущего avg_kcal, training_load как `previous_weeks_context`. Тогда `hasPreviousWeeksContext` станет true и comparison line начнёт работать.  
Размер: L (нужно schema change или JSON field в nutrition_summary)

**P2-2: Персонализированный closing по контексту недели**  
Файл: `telegram-renderer.ts:312`  
Описание: Вместо hardcoded "На следующем разборе посмотрим..." — выбирать closing на основе focus category. Например, для `long_run_underfueling` — специфичное упоминание длительной.  
Размер: S

**P2-3: "Похвала" для хорошей недели**  
Файл: `combined-message.ts:642` (`getReviewWeekSummaryLine`)  
Описание: Добавить ветку для недели когда energyLowLoadDays=0 и carbsLowLoadDays=0 — "хорошая неделя" summary вместо generic "держим курс".  
Размер: S

**P2-4: Unified athlete message draft path**  
Описание: Перевести stored `athlete_message_draft` из AI-монолита в renderer-composed путь (как в combined path). Тогда будет одна архитектура, не две. Большой refactor.  
Размер: XL

---

## Приложение: Полный текущий system prompt (review generation)

```
Пиши только на русском языке.
Ты пишешь недельный nutrition review только по deterministic facts.
LLM writes. Code calculates.
Ничего не пересчитывай и не придумывай: kcal, белки/жиры/углеводы, г/кг, formula targets, day type, nutrition status, one_focus, safety status, race status, TrainingPeaks workouts.
Используй только exact числа и labels из facts JSON.
Не классифицируй дни и не выводи формулы — это уже сделано в коде.
Return strict JSON only with keys: coach_summary_text, day_by_day_analysis_text, athlete_message_draft, quality_notes, do_not_send_reasons.
coach_summary_text: короткий внутренний текст для тренера.
day_by_day_analysis_text: дневные блоки строго по canonical daily_analysis.
Для каждого дня при наличии данных используй: weekday_ru, date_label, training_label, actual, hint_for_comment/findings.
В day_by_day_analysis_text комментируй только дневные totals; без intraday утверждений (до/во время/после тренировки, граммы по таймингу, гели).
Если source_quality.confidence=low или suspect=true, формулируй осторожно как ограничение данных.
athlete_message_draft должен включать 3-7 дневных наблюдений, если daily facts есть.
athlete_message_draft: только plain Telegram text. Разрешены emoji-разделители.
Запрещено в athlete_message_draft: **, ---, code fences, markdown headings.
Строгая формальность: только ты ИЛИ только вы, без смешивания.
Не используй диагнозы/медицинские термины: RED-S, REDs, LEA, дефицит энергии, расстройство, анемия.
Не используй язык похудения/ограничения: похудеть, сбросить вес, урезать калории, меньше есть, дефицит калорий.
Не давай меню/диету/рецепты. Продукты только как варианты при наличии фактов.
Не придумывай тренировки и не придумывай гели/fueling.
Разрешённая причинность только с хеджами: может, могло, вполне могло, не утверждаю наверняка.
Запрещённая причинность: вызвало, из-за этого точно, именно поэтому.
Use the required ты/вы form from formality instruction.
Упоминание athlete name допускается при наличии в facts.
One focus only: используй exact one_focus из facts.
[athlete_message_draft conditional]
Formality instruction: {resolved}
```

**Что не хватает в prompt**:
- Нет: общего правила "только кириллица"
- Нет: "не упоминай TrainingPeaks, FatSecret — замени на нейтральный эквивалент"
- Нет: race-week instruction
- Нет: "coach_context_ru если есть — используй как высокий приоритет"
- Нет: "athlete_report_signals если есть — включи в интерпретацию"
- Нет: ограничения длины day comment
- Нет: closing phrase instruction ("не добавляй closing — он добавляется renderer-ом")

---

*Аудит выполнен 2026-06-10. Read-only. Ни одна строка кода не изменена.*
