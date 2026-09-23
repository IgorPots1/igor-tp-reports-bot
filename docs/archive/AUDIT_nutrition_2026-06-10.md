# AUDIT: Nutrition Admin Module — Coach OS
**Дата**: 2026-06-10  
**Статус**: Read-only, без мутаций  
**Ветка**: main, HEAD 0d41be1  
**Метод**: Статический trace-аудит кода + запуск существующих diagnostic-скриптов

---

## 1. Резюме

**Главные проблемы (в порядке приоритета):**

1. **Рассинхрон недели отчёта (root cause)**: При загрузке PDF FatSecret-отчёта за Пн–Вс 2 июня – 7 июня 2026 г. `nutrition_reports.week_from/week_to` записываются как `2026-06-08..2026-06-14` (UI-выбор Игоря). Но `nutrition_daily_macros.day` содержат реальные даты из PDF — `2026-06-02..2026-06-07`. Это постоянное несоответствие распространяется на все вышестоящие слои.

2. **Daily analysis показывает только дни отдыха**: Дата-join макросов (Jun 2–7) с TP workouts (Jun 8–14) не даёт совпадений → все дни помечаются как `rest`, хотя в TP-кэше есть 3 реальные тренировки.

3. **Стейлый fallback-review**: Обзор от 2026-06-09 создан в режиме `fallback` (без AI), содержит старые фразы `"Комментарий:"`, в нём нет `macroGuardrails`/`energyAvailability` → не соответствует текущей методике.

4. **Coach details всегда берут `coachSummaryText` из storage** (не выводится заново). Если review stale — details stale навсегда до перегенерации.

5. **Key workout classifier**: Для прошлой недели режим `completed_only` правильно исключает `"6 х 5 мин"` (only `planned`, not completed). Но для плана/следующей недели режим `all` считает её key. Сохранённый в плане snapshot `0 workouts · key 3` противоречит текущим данным — нужна проверка в БД.

---

## 2. Карта слоёв

| Слой | Файл | Роль |
|------|------|------|
| UI page | `src/app/admin/coach-os/nutrition/[studentId]/page.tsx` | Получает `weekFrom/weekTo` из query params или `getNutritionStudentDefaultWeek`. Вызывает `getNutritionAdminStudentCard`. Строит combined message и coach details |
| Student card loader | `src/features/nutrition/admin.ts:39` | `getNutritionAdminStudentCard` — параллельно загружает profile, reports (для selected week), weekly analyses (для selected week), строит student context |
| Selected week resolution | `page.tsx:199–211` | Приоритет: `?weekFrom` param → `getNutritionStudentDefaultWeek` (last analysis > last report) → current calendar week |
| Default report picker | `src/features/nutrition/admin-labels.ts:287` | `pickDefaultNutritionReport` — приоритет: URL `?reportId` → `ready_for_analysis` → `needs_review` → первый по списку |
| PDF parser | `src/features/nutrition/file-intake.ts:576` | `extractNutritionRowsFromFatSecretPdfText` — RU-detailed parser (пн/вт/… → дата) или tabular. Парсит реальные даты из PDF-контента |
| Report metadata | `src/features/nutrition/admin.ts:180` | `saveNutritionManualMacros` / `saveNutritionFileReportAction` — `week_from/week_to` берётся из UI-выбора, NOT из parsed dates |
| TP cache reader | `src/features/nutrition/repository.ts:1416` | `getNutritionTrainingPeaksCacheWindow` → `listTrainingPeaksWorkoutCacheForStudentDateRange` за `weekFrom..weekTo` |
| Key workout classifier | `src/features/nutrition/context.ts:496` | `isKeyWorkout(row, mode)` — `completed_only` для прошлой недели, `all` для следующей |
| Daily analysis join | `src/features/nutrition/draft-generator.ts:~280` | `buildNutritionDailyFactsForNarrative` — join macro rows × TP workouts по date string |
| Source quality | `src/features/nutrition/draft-generator.ts:379` | Inline объект `{hasNutritionData, hasTrainingContext, confidence, notes}` в каждом daily fact |
| Review generator | `src/features/nutrition/draft-generator.ts:694` | `generateNutritionWeeklyAnalysis` — AI или fallback. Upsert в `nutrition_weekly_analyses` по `(student_id, week_from, week_to)` |
| Storage upsert | `src/features/nutrition/repository.ts:1142` | `createNutritionWeeklyAnalysis` — upsert с `onConflict: "student_id,week_from,week_to"` |
| Combined message | `src/features/nutrition/combined-message.ts:844` | `buildDerivedNutritionCombinedMessage` — DERIVED из canonical daily_analysis + plan, не из storage напрямую |
| Coach day-by-day | `src/features/nutrition/combined-message.ts:631` | `buildDerivedNutritionCoachDayByDayText` — rebuilds из canonical daily_analysis через `filterFactsToReviewWeek` |
| Page render: primary text | `page.tsx:348` | `combinedMessage.renderResult.text` — derived |
| Page render: coach details | `page.tsx:869–871` | `coachSummaryText` — ВСЕГДА из `review.nutritionSummary.coach_summary_text` (stored only) |
| Page render: day-by-day display | `page.tsx:357` | `derivedCoachDayByDayText ?? dayByDayAnalysisText` — предпочитает derived, fallback — stored |
| Page consistency checker | `src/features/nutrition/page-consistency.ts:144` | `analyzeNutritionPageConsistency` — детектирует stale phrases, date mismatches, TP-join mismatches |

---

## 3. Найденные root causes

### RC-1: `week_from/week_to` в nutrition_reports ≠ фактические даты в PDF
**Категория**: wrong report week (UI vs uploaded)  
**Файл**: `src/features/nutrition/actions.ts` → `saveNutritionFileReportAction` → `saveNutritionManualMacros` (admin.ts:180)  
**Уверенность**: Высокая — подтверждена диагностикой `diagnose-nutrition-report-date-coverage`

`nutrition_reports.week_from/week_to` = UI-выбранная неделя (`input.weekFrom/weekTo`), НЕ диапазон дат из PDF. При этом `nutrition_daily_macros.day` содержат реальные parsed даты из PDF. В случае Polyakova:
- `report.week_from/week_to` = `2026-06-08..2026-06-14`  
- `daily_macros.day` min/max = `2026-06-02..2026-06-07`

Все 6 дат **за пределами** выбранной недели. Совпадений нет.

**Симптом в UI**: Daily analysis показывает дни 2–7 июня как `rest` (нет TP workouts в эти даты); TP-context за 8–14 июня видит 3 тренировки, но join не происходит.

---

### RC-2: Daily analysis join по дате не проверяет несоответствие макросов и TP-контекста
**Категория**: parser date bug / missing validation  
**Файл**: `src/features/nutrition/draft-generator.ts` → `buildNutritionDailyFactsForNarrative`  
**Уверенность**: Высокая

Функция строит `workoutTitles = Map<date, title>` из `context.tpPastWeek.workouts` (Jun 8–14), затем матчит по датам из `context.manualMacroRows` (Jun 2–7). Совпадений 0 → все дни получают `trainingType = rest`.

Нет предупреждения о том, что даты макросов и даты TP-кэша полностью расходятся.

**Симптом в UI**: Дневной разбор содержит только "день отдыха", хотя в TP явно есть тренировки (6 х 5 мин, легкий бег).

---

### RC-3: Стейлый fallback-review с устаревшей методикой
**Категория**: stale fallback / stored review  
**Файл**: `src/features/nutrition/page-consistency.ts:166` (обнаружение) / `draft-generator.ts:465` (генерация)  
**Уверенность**: Высокая — подтверждена диагностикой

Review от 2026-06-09 создан в режиме `fallback` (нет AI ключа или ошибка). Содержит:
- `generation_mode = "fallback"` 
- Нет `macroGuardrails` / `energyAvailability` в daily items
- `day_by_day_analysis_text` содержит фразу `"Комментарий:"` (старый шаблон)

Методика из коммита `e2e554e` требует `macroGuardrails`; из `0b9ab13` — `energyAvailability`. Review создан ДО обоих коммитов.

**Симптом в UI**: Coach details block показывает старый текст. Consistency checker выдаёт `review_fallback_mode` + `review_stale_methodology` warnings.

---

### RC-4: `coachSummaryText` всегда из storage, никогда не выводится заново
**Категория**: UI source confusion (primary vs coach details разные источники)  
**Файл**: `page.tsx:300–303`  
**Уверенность**: Высокая

```typescript
const coachSummaryText =
  typeof weeklyNutritionSummary.coach_summary_text === "string"
    ? weeklyNutritionSummary.coach_summary_text : null;
```

Это берётся из `card.weeklyAnalysis.nutritionSummary.coach_summary_text` — stored blob в БД. При этом `primaryText` (combined message) строится **заново** из `canonical_daily_analysis` при каждом рендере страницы. Два слоя живут в разных "временных плоскостях".

**Симптом в UI**: Primary combined text может содержать актуальный derived текст; coach details block показывает stale stored текст от времени последней генерации review.

---

### RC-5: Key workout — planned-only исключается для прошлой недели
**Категория**: TP key classifier (неожиданное поведение, не баг per se)  
**Файл**: `src/features/nutrition/context.ts:496–510`  
**Уверенность**: Высокая

Для `tpPastWeek` используется `keyWorkoutMode: "completed_only"` (строка 640).  
Тренировка `"6 х 5 мин"` (2026-06-11) имеет `isCompleted = false` → `isKeyWorkout` возвращает `false` → `keyWorkouts = []` для прошлой недели.

Для `tpNextWeek` / при генерации плана — режим `all` → тренировка считается key.

**Симптом в UI**: В coach details "TP прошлой недели" видны 3 тренировки, но key = 0. В плане может быть сохранён key = 3 (если генерация была с mode="all" и другими датами).

---

### RC-6: Snapshot плана `0 workouts · key 3` — внутреннее противоречие
**Категория**: stale snapshot / возможный баг генерации плана  
**Файл**: `src/features/nutrition/weekly-plan-generator.ts` → `buildNutritionWeeklyPlanTrainingContextSnapshot`  
**Уверенность**: Средняя — требует проверки в БД

Diagnostic `diagnose-nutrition-page-consistency` показал:
```
target week TP context count: 0 workouts · key 3
```
Свежий TP кэш за ту же неделю показывает `workouts: 3 · key: 0` (mode=all) или `key: 1` (для "6 х 5 мин"). Значение `key: 3` не воспроизводится. Возможные причины:
- План был сгенерирован когда TP кэш содержал другие данные
- Snapshot был сохранён из другого date range (возможно tpNextWeek вместо planWeek)

**Симптом в UI**: Метрика "ключевые тренировки" в плане неверна.

---

## 4. Проверка гипотез A–F

| Гипотеза | Вердикт | Файл:строка |
|----------|---------|-------------|
| **A: Рассинхрон слоёв** (primary живой, coach details stale) | **Подтверждена частично** — `coachSummaryText` ВСЕГДА из storage (page.tsx:300). Day-by-day предпочитает derived, но derived тоже берёт stale данные (Jun 2–7) | `page.tsx:300`, `combined-message.ts:631` |
| **B: parsed report week ≠ selected week** | **Подтверждена полностью** — `report.week_from/week_to=Jun 8–14`, `daily_macros.day=Jun 2–7`, 100% mismatch | `admin.ts:180`, `repository.ts:701` |
| **C: Key workout overclassification** | **Частично: NOT overclassification — underclassification** для прошлой недели (`completed_only` mode). Snapshot плана `key=3` — нужна БД для финального вывода | `context.ts:496`, `context.ts:640` |
| **D: sourceQuality=low из date mismatch** | **Подтверждена косвенно** — daily items имеют `hasTrainingContext=false` (нет TP workout для Jun 2–7), что не вызывает `low` напрямую, но cautiousPrefix появляется при `hasNutritionCompletenessIssue` | `draft-generator.ts:379`, `combined-message.ts:534` |
| **E: Fallback/template затирает живой review** | **Подтверждена** — review сгенерирован в режиме `fallback`, upsert по `(student_id, week_from, week_to)` перезаписывает. При fallback `athlete_message_draft` может быть null → отображается "мало данных" | `repository.ts:1142`, `draft-generator.ts:465` |
| **F: TP planned-only counted as completed** | **Опровергнута** — `completedSessions` считается отдельно от `plannedSessions`; `isKeyWorkout(mode=completed_only)` явно фильтрует по `row.isCompleted` | `context.ts:497`, `context.ts:528–530` |

---

## 5. Конкретный кейс Polyakova Anastasia, week 2026-06-08..2026-06-14

### Что происходит сейчас

1. **Загруженный отчёт**: `b9c363d1`, создан `2026-06-10T13:10`, source_type=`pdf`. `week_from/week_to = 2026-06-08..2026-06-14` (UI-выбор).

2. **Парсер PDF** (`extractNutritionRowsFromFatSecretPdfText`, file-intake.ts:576): правильно извлёк даты из PDF — `Понедельник, Июнь 2, 2026 .. Воскресенье, Июнь 7, 2026`. Сохранено в `nutrition_daily_macros` с реальными датами Jun 2–7.

3. **Report metadata vs macros**: несоответствие создано. `report.week_from=Jun 8`, `daily_macros.day=Jun 2..7`.

4. **Review generation** (`5e3dfd65`, создан `2026-06-09`, т.е. **ДО** загрузки нового отчёта!): 
   - контекст строится с `weekFrom=Jun 8..14`
   - `tpPastWeek` = TP cache за Jun 8–14 (3 тренировки, Jun 9 completed, Jun 11/13 planned)
   - `manualMacroRows` = макросы из report — Jun 2–7 (если review генерировался с тем же reportId) ИЛИ пустые (если без reportId)
   - Daily join: макросы Jun 2–7 × TP Jun 8–14 → 0 совпадений → все дни `rest`
   - Режим: `fallback` (AI unavailable или ошибка)

5. **Page render**:
   - `primaryText`: `buildDerivedNutritionCombinedMessage` → `filterFactsToReviewWeek(review, facts)` → фильтрует `canonical_daily_analysis` по `review.weekFrom/weekTo = Jun 8–14` → 0 строк совпадают (все факты Jun 2–7) → `hasOutsideWeekFacts = true` → warning "Даты daily_analysis не попадают в выбранную неделю обзора"
   - `coachSummaryText`: stored — stale fallback-текст про Jun 8–14 без реальных данных
   - `coachDayByDayDisplayText`: `buildDerivedNutritionCoachDayByDayText` → тоже 0 строк (все Jun 2–7 отфильтрованы) → null → fallback на `dayByDayAnalysisText` → stale stored с "Комментарий:"

### Что должно происходить

Если FatSecret-отчёт за неделю Jun 2–7 загружается в UI, `weekFrom` в форме должен быть выставлен тоже **Jun 2–7**, и `nutrition_reports.week_from/week_to` должны отражать реальный диапазон PDF-данных, а не UI-выбор.

### Откуда "мало данных"

- `page.tsx:1005` — "Черновик скрыт (блок безопасности или мало данных)" — когда `card.weeklyAnalysis.athleteMessageDraft` null/empty. В fallback режиме `buildFallbackAthleteDraft` может вернуть пустую строку если совсем нет данных.
- `combined-message.ts:400` — "Данные по питанию за день неполные, поэтому вывод короткий." — `cautiousPrefix` при `hasNutritionCompletenessIssue=true`.
- `combined-message.ts:424` — "Данные по питанию за день выглядят неполными или нетипичными…" — при `nutritionStatus = "suspect"`.

---

## 6. Рекомендации

### P0 — Operational (Игорь может сделать прямо сейчас)

**RC-1 (date mismatch для Polyakova)**:  
Загрузить PDF ещё раз, но **выставить `weekFrom = 2026-06-02`, `weekTo = 2026-06-07`** в форме недели перед загрузкой. После этого отчёт и макросы окажутся в одной неделе. Затем перегенерировать review с нужной неделей.

**RC-3 (stale review)**:  
На странице Polyakova нажать "Перегенерировать обзор" — это пересоздаст review с AI (или актуальным fallback) по текущей методике.

---

### P1 — Code fix

**RC-1: Валидация и предупреждение при несоответствии дат**  
Файл: `src/app/admin/coach-os/nutrition/actions.ts` (action `saveNutritionFileReportAction`)  
Что сделать: После парсинга PDF вычислить `actualMinDate` / `actualMaxDate` из `extractedRows`. Если они не попадают в `weekFrom..weekTo` — сохранить разницу в `report.data_quality.date_range_mismatch = true` и вернуть предупреждение в UI. Это позволит детектировать без изменения логики сохранения.

**RC-2: Детект Date-overlap в daily analysis builder**  
Файл: `src/features/nutrition/draft-generator.ts` → `buildNutritionDailyFactsForNarrative`  
Что сделать: После построения `workoutTitles` и перед основным циклом добавить проверку: если все `macro.day` даты не попадают в `context.tpPastWeek.periodFrom..periodTo` — логировать предупреждение (warning field) и/или вернуть `source_quality.confidence = "low"` для всех дней.

**RC-4: Coach summary text — derived fallback**  
Файл: `src/features/nutrition/combined-message.ts`  
Что сделать: Добавить функцию `buildDerivedNutritionCoachSummaryText(review)` аналогично `buildDerivedNutritionCoachDayByDayText`. Использовать её на странице вместо прямого чтения из storage.

**RC-5: Документировать режим `completed_only` в UI**  
Файл: `src/app/admin/coach-os/nutrition/[studentId]/page.tsx` (блок TP контекст)  
Что сделать: Добавить подпись рядом с полем "key workouts": "(только выполненные)" для прошлой недели, "(включая запланированные)" для следующей.

---

### P2 — UI warnings

**Баннер date mismatch**: Если `report.data_quality.date_range_mismatch = true` — показывать на странице:
> ⚠️ Даты из PDF ({min_date}..{max_date}) не совпадают с выбранной неделей ({weekFrom}..{weekTo}). Обзор и разбор по дням могут быть некорректными. Загрузите отчёт с правильной неделей.

**Баннер stale coach summary**: Если `hasStaleReviewIssues(pageConsistencyIssues) === true` — в секции "Детали для тренера" показывать explicit label: "⚠️ Coach summary устарел — данные ниже не соответствуют актуальному черновику".

---

## 7. Что нельзя установить без доступа к БД

1. **Откуда `key=3` в плане Polyakova** (`plan.trainingContextSnapshot.keyWorkouts`): нужно `SELECT training_context_snapshot FROM nutrition_weekly_plans WHERE id='2d123971-9edd-4fa0-b7d9-db522e03923a'` и посмотреть полный JSON.

2. **Какой именно отчёт был source при генерации review** `5e3dfd65`: `review.reportId` — если null, review был сгенерирован без привязки к отчёту → макросы были пустые → объясняет `athlete_message_draft = null`.

3. **История генераций**: Сколько раз перегенерировался review для этой недели — в upsert-сценарии только одна запись, история не хранится.

4. **Аналогичные записи для Kristina**: проверить `nutrition_reports` для Kristina — совпадают ли `week_from/week_to` с реальными датами в `nutrition_daily_macros`.

5. **Состояние `daily_macros` для review week у Polyakova**: выполнить `SELECT day, kcal FROM nutrition_daily_macros WHERE student_id='eb073a94-...' ORDER BY day` — убедиться что действительно только Jun 2–7.

6. **Source report при генерации планов**: Нужно ли указать `source_analysis_id` при генерации плана и влияет ли отсутствие связи на качество snapshot.

---

## 8. Предложенные новые diagnostics

### 8.1 `diagnose:nutrition-full-trace` (наиболее важный)

```
npm run diagnose:nutrition-full-trace -- --student-name "X" --week-from YYYY-MM-DD --week-to YYYY-MM-DD
```

**Что печатает** — полная цепочка слоёв:
```
[uploaded_report]   file=..., source_dates=Jun 2..7, report_week=Jun 8..14, MISMATCH=yes
[parsed_macros]     dates=Jun 2..7, total_days=6, inside_selected_week=0
[selected_week]     from_query=yes/no, from_report=no, from_default=..., resolved=Jun 8..14
[tp_workouts]       dates=Jun 9,11,13 · key=0 (completed_only) / 1 (all)
[daily_analysis]    macro_dates=Jun 2..7 · tp_dates=Jun 8..14 · overlap=0 · all_rest=yes
[date_mismatch]     parsed ∩ selected=∅ · parsed − selected={Jun 2..7}
[source_quality]    reported_days=6, expected=7, flag=date_mismatch
[stored_review]     exists=yes, created_at=..., mode=fallback, stale_phrases=Комментарий:
[plan]              exists=yes, dates=Jun 8..14, created_at=..., key_from_snapshot=3
[primary_text]      source=derived, daily_lines=0 (outside_week), warning=outside_week_facts
[coach_details]     coach_summary_text=stored, day_by_day=derived_empty→stored_stale
[mismatch_check]    primary_derived_vs_stored: differs
```

**Псевдокод**:
```typescript
const report = await selectLatestReportForStudent(studentId, weekFrom, weekTo);
const macros = await getMacrosForReport(report.id);
const review = await getReviewForWeek(studentId, weekFrom, weekTo);
const plan = await getPlanForWeek(studentId, planWeekFrom, planWeekTo);
const freshTp = await getTpCacheForRange(studentId, weekFrom, weekTo);
// print each block
```

**Какую проблему ловит**: RC-1 (date mismatch) виден сразу без ручной интерпретации.

---

### 8.2 `diagnose:nutrition-week-date-alignment`

```
npm run diagnose:nutrition-week-date-alignment -- [--student-name "X"]
```

**Что печатает** — для каждого отчёта в БД:
```
student=Polyakova  report_week=Jun 8..14  macro_min=Jun 2  macro_max=Jun 7  MISMATCH=YES
student=Kristina   report_week=Jun 2..7   macro_min=Jun 2  macro_max=Jun 7  OK
```

**Псевдокод**:
```typescript
const reports = await listAllNutritionReports({ limit: 100 });
for (const report of reports) {
  const macros = await getMacrosForReport(report.id);
  const macroMin = min(macros.map(m => m.day));
  const macroMax = max(macros.map(m => m.day));
  const inside = macros.filter(m => m.day >= report.weekFrom && m.day <= report.weekTo);
  console.log(report.studentName, report.weekFrom, macroMin, macroMax, inside.length === 0 ? 'MISMATCH' : 'ok');
}
```

**Какую проблему ловит**: Массовое обнаружение RC-1 по всем ученикам.

---

### 8.3 `diagnose:nutrition-review-freshness`

```
npm run diagnose:nutrition-review-freshness -- [--student-name "X"]
```

**Что печатает** — состояние review для каждого ученика:
```
student=Polyakova  week=Jun 8..14  mode=fallback  stale_phrases=Комментарий:  methodology=missing  age=1d
student=Kristina   week=Jun 2..7   mode=ai         stale_phrases=none          methodology=ea_macro_narrative_v1  age=3h
```

**Псевдокод**:
```typescript
for (const review of latestReviews) {
  const summary = review.nutritionSummary;
  const mode = summary.generation_mode ?? 'unknown';
  const dailyRows = summary.daily_analysis ?? [];
  const hasModernMethodology = dailyRows.some(d => d.macroGuardrails && d.energyAvailability);
  const stale = STALE_PHRASES.filter(p => review.athleteMessageDraft?.includes(p));
  const age = formatAge(review.updatedAt);
  console.log(review.studentName, review.weekFrom, mode, stale, hasModernMethodology ? 'modern' : 'stale', age);
}
```

**Какую проблему ловит**: RC-3 (stale fallback reviews) по всем ученикам; сигнализирует кому нужна перегенерация.

---

## 9. Приложение: результаты diagnostic скриптов

### `npm run lint`
11 warnings, 0 errors. Только `_from`/`_to` unused variable warnings в nutrition/page-consistency.ts:587.

### `diagnose:nutrition-page-consistency` (Polyakova, Jun 8–14)
```
Selected report:   b9c363d1  week=2026-06-08..2026-06-14
Selected review:   5e3dfd65  mode=fallback  stale=yes (Комментарий:)
                   all days labeled rest: yes
Fresh TP cache:    workouts=3 · key=0 (completed_only)
Daily analysis dates: 2026-06-02..2026-06-07 (0/6 inside selected week)
coach_summary_text: stored (never derived)
day-by-day display: stored stale (contains Комментарий:)
```

### `diagnose:nutrition-report-date-coverage` (Polyakova, Jun 8–14)
```
report.week_from/week_to: 2026-06-08..2026-06-14
macro_min/max dates:      2026-06-02..2026-06-07
missing inside selected:  all 7 days (Jun 8..14)
outside selected week:    all 6 days (Jun 2..7)
complete week coverage:   NO
```

### `diagnose:nutrition-tp-key-classification` (Polyakova, Jun 8–14)
```
workouts: 3 total · key 1 (all mode) · key 0 (completed_only mode)
6 х 5 мин (Jun 11): planned only, isKey=yes (mode=all), isKey=no (mode=completed_only)
```

### `check-nutrition-page-consistency` / `check-nutrition-combined-message`
```
PASS (unit tests — проверяют только логику без DB)
```

---

*Аудит выполнен 2026-06-10. Read-only. Ни одна строка кода не изменена. Ни одна запись в БД не создана/изменена/удалена. Git: без коммитов.*
