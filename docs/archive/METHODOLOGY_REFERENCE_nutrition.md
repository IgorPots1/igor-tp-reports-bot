# METHODOLOGY REFERENCE — Nutrition (Coach OS)

**Дата**: 2026-06-14
**Назначение**: единая справка по методике питания — как отчёт разбирается, что учитывается при расчёте, как формируется план на следующую неделю и обратная связь за прошлую.
**Версия методики в коде**: `ea_macro_narrative_v1` (`methodology.ts:21`)
**Статус**: справочный документ (read-only, без мутаций кода).

> Главный принцип всей фичи: **«LLM writes. Code calculates.»** Все числа, классификации дней, формулы, статусы, фокус и safety-решения считает код. LLM (и детерминированный рендерер) только переформулируют готовые факты словами.

---

## 0. Сквозной пайплайн

```
[PDF/CSV/TXT отчёт]
   -> file-intake.ts            ккал/Б/Ж/У по дням, даты из PDF = источник истины
   -> context.ts               + TP-кэш (прошлая неделя completed_only, следующая all),
                                 профиль, цель, вес, заметки, safety-флаги
   -> methodology.ts           EA, energy floors, macro guardrails, canonical daily targets,
                                 сигналы, выбор ОДНОГО фокуса недели
   -> draft-generator.ts       review: AI-путь (OpenAI temp=0.2) или fallback-шаблон
                                 -> nutrition_weekly_analyses (upsert по student_id+week)
   -> weekly-plan-formulas.ts  план на следующую неделю по табличным формулам от веса
   -> combined-message.ts      DERIVED-текст из canonical daily_analysis (primary copy path)
   -> telegram-renderer.ts     финальное сообщение ученику + валидация
```

---

## 1. Что вытаскивается из отчёта

Из FatSecret-PDF (`file-intake.ts`) по каждому дню парсятся: **ккал, белок, жир, углеводы** (+ автоматически г/кг). Даты берутся из самого PDF и являются источником истины (`df63b83`), а не из выбранной в UI недели.

Каждый день по дате джойнится с тренировкой из TrainingPeaks-кэша → получается пара «день + тренировка».

---

## 2. Что учитывается при расчёте (ядро методики, `methodology.ts`)

### 2.1 Energy Availability (EA) — главный показатель

```
EA = (intake_kcal − exercise_energy_kcal) / FFM
```

- **FFM (безжировая масса)**: измеренная, либо оценка = вес × коэффициент по полу — жен. `0.78`, муж. `0.82`, неизвестно `0.8` (`ffmCoefficientForSex`, строки 611–619).
- **Энергия тренировки** (`estimateExerciseEnergyKcal`, 575–609): нет тренировки → 0; длительная → `км × вес`; интервалы/темп/гонка/лёгкая → `часы × вес × 9`; иначе → `missing`.
- **Зоны** (`zoneForEa`, 621–632): `< 30` красная, `30–45` жёлтая, `≥ 45` зелёная.
- **Confidence**: `high` только если FFM измерена И энергия из реального TP-кэала; иначе `medium`/`low`.

### 2.2 Энергетические «полы» (минимум ккал/день от веса, `calculateNutritionEnergyFloorFacts`, 701–749)

| День | Порог |
|------|-------|
| отдых | 25 × вес |
| нагрузка / силовая / кросс | 30 × вес |
| тяжёлая / длительная / гонка | 35 × вес |

Ниже порога → флаг `below*Floor`.

### 2.3 Макро-гардрейлы по дням (`buildMacroGuardrails`, 1071–1213)

- **Белок г/кг**: `<1.1` мало, `<1.5` на границе, `1.5–2.0` ок, `>2.0` высоко (`PROTEIN_GUARD_*`, 293–296).
- **Жир г/кг**: `<0.8` низко, `<1.0` граница, ок, `>1.6` или `≥40%` энергии — высоко (`NUTRITION_FAT_PERCENT_HIGH_THRESHOLD=40`, borderline `37`). Высокий жир — coach-only по умолчанию.
- **Углеводы г/кг**: сравниваются с диапазоном под тип дня (band — ориентир, не предписание).

### 2.4 Canonical daily target по углеводам (`buildCanonicalTarget`, 819–921)

| Тип дня | Углеводы г/кг | Доп. |
|---------|---------------|------|
| нет контекста | 3–5 | `limited_context` |
| отдых | 3–4.5 | |
| лёгкая | 3.5–5 | |
| тяжёлая / гонка | 5–6.5 | |
| pre-long | 5.5–6 | |
| длительная | 6–7 | kcal_min 35×вес |
| длинная выносливость | 6–8 | kcal_min 35×вес |
| силовая | 4–6 | kcal_min 30×вес, protein_min 1.6×вес |
| кросс | 5–7 | kcal_min 30×вес |

### 2.5 Один фокус недели (`selectNutritionWeeklyFocus`, 1873–1946)

Выбирается **ровно один** фокус по жёсткому приоритету (первый сработавший):

`blocked_safety` → `limited_data` → `severe energy availability` (≥2 дней: красная зона / ниже пола / `<1300` ккал / `<90` г углеводов) → `long_run_underfueling` → `hard_session_underfueling` → `post_hard_recovery_support` → `carbs_around_key_sessions` → `weekly_consistency` → `protein_support` → `maintenance`.

К фокусу прикрепляется `progressionStrategy` (`small_step` / `moderate_step` / `toward_reference_band` / `maintain`) — «насколько резко двигать углеводы».

### 2.6 Блок безопасности (`buildNutritionSafetyFlags`, `context.ts:585–634`)

**Hard-флаги → полная блокировка текста ученику** (`athlete_message_draft = null`, статус `blocked_safety`):
РПП/анорексия/булимия; компенсация/наказание едой; мед.состояния (диабет, беременность, послеродовой, аменорея, менструация); стресс-перелом/повторные травмы; **≥2 дней `<1300` ккал**; **≥3 дней `<90` г углеводов**; **потеря веса `≥4%`**.
**Soft-флаг**: кето / интервальное голодание + беговая нагрузка.

---

## 3. Формирование плана на следующую неделю (`weekly-plan-formulas.ts`)

Тренировки следующей недели из TP → классифицируются в тип дня → применяется табличная формула на кг веса (`DAY_TYPE_TARGETS`, строки 178–185):

| Тип дня | ккал/кг | белок/кг | жир/кг | углеводы/кг |
|---------|---------|----------|--------|-------------|
| отдых | 35 | 1.6 | 1.1 | 4.5 |
| лёгкая | 39 | 1.6 | 1.15 | 5.2 |
| тяжёлая | 43 | 1.7 | 1.15 | 6.0 |
| pre-long | 39 | 1.6 | 1.15 | 5.5 |
| длительная / длинная выносл. | 45 | 1.7 | 1.15 | 7.0 |
| силовая | 39 | 1.8 | 1.15 | 5.2 |
| кросс | 39 | 1.6 | 1.15 | 5.2 |

Округление: ккал до 50, углеводы до 10, белок/жир до 5. Ключевые дни = `hard` / `long_run` / `long_endurance` / `race` (`isKeyWorkout`, 329–330).

---

## 4. Формирование обратной связи (разбор за прошлую неделю)

### 4.1 Статус каждого дня (детерминированно, `methodology.ts`)

Порог «низко» — относительный для недели: второй снизу день по ккал/углеводам (`getLowThresholds`, 751–760). Правила присвоения `nutritionStatus` (1316–1395):

- день **перед** ключевой + мало углеводов → `low_for_load`;
- **ключевой** день + мало ккал/углеводов → `low_for_load`;
- длительная на одном из самых низких по энергии дней → `low_for_load`;
- силовая, ккал `< 30×вес` → `low_for_strength`;
- кросс, ккал `< 30×вес` → `low_for_cross_training`;
- **восстановление** после тяжёлой + мало (или белок `<95` г) → `moderate_for_load`;
- отдых с низким приёмом, не рядом с ключевой → `rest_ok`;
- ключевой день с устойчивой энергией → `ample`;
- нет данных → `missing`; подозрительные цифры → `suspect`.

### 4.2 Текст комментария по дню (детерминированно)

`composeNutritionDayComment` (`narrative-composer.ts:1172`) + `buildDayMacroSentence` (`combined-message.ts:280`) собирают фразу из статуса дня + статусов гардрейлов + роли дня. Политика по жирам — `coach_only` по умолчанию (высокий жир ученику не озвучивается). Есть `cautiousPrefix` при неполных данных и анти-повтор формулировок.

### 4.3 Два пути генерации текста

- **AI-путь** (`generateNutritionWeeklyReviewNarrative`): OpenAI, temp 0.2, строгий JSON → сохраняется в `nutrition_weekly_analyses`.
- **Fallback** (без ключа/ошибка): `buildFallbackCoachSummary` / `buildFallbackDayByDay` / `buildFallbackAthleteDraft` из тех же canonical-фактов.
- **Финальное сообщение ученику** собирает **детерминированный рендерер** (`renderNutritionTelegramMessage`) из canonical `daily_analysis`, а не сырой вывод LLM.

### 4.4 Известные слабые места

1. **Сравнение неделя-к-неделе — мёртвый код**: `previous_weeks_context` всегда `null` (`draft-generator.ts:944`), хотя рендерер умеет показывать `weekComparisonLineRu`. Динамика прошлых отчётов в фидбек не попадает.
2. **Stored vs derived**: текст от LLM в storage и derived-текст рендерера живут в разных «временных плоскостях» — без перегенерации обзора coach summary устаревает.
3. **EA почти всегда `medium`**: энергия тренировки оценочная (км/часы × вес), а не из реальных калорий TP.
4. **FFM почти всегда оценочная**: нет поля для замеров состава тела.

---

## 5. Код verbatim

### 5.1 Системный промпт + сборка `factsPayload` — `draft-generator.ts:660–750`

```typescript
async function generateNutritionWeeklyReviewNarrative(input: {
  context: NutritionStudentContext;
  dailyAnalysis: Array<Record<string, unknown>>;
  trainingNutritionLinks: string[];
  oneFocus: {
    category: string;
    statement_ru: string;
    progression_strategy: CarbProgressionStrategy;
  };
  methodologySignals: {
    protein_sufficient: boolean;
    carb_reference_band_used: true;
    carb_reference_not_prescriptive: true;
    long_run_fueling_instruction_detected: boolean;
    during_run_fuel_planned: boolean;
  };
  safetyFlags: { hard_flags: string[]; soft_flags: string[]; blocked: boolean };
}): Promise<NutritionAiNarrative | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  const allowAthleteDraft = !input.safetyFlags.blocked;
  const formalityInstruction = getTrainingPeaksReplyDraftFormalityInstruction(
    input.context.resolvedCommunicationProfile.formality
  );
  const systemPrompt = [
    "Пиши только на русском языке.",
    "Ты пишешь недельный nutrition review только по deterministic facts.",
    "LLM writes. Code calculates.",
    "Ничего не пересчитывай и не придумывай: kcal, белки/жиры/углеводы, г/кг, formula targets, day type, nutrition status, one_focus, safety status, race status, TrainingPeaks workouts.",
    "Используй только exact числа и labels из facts JSON.",
    "Не классифицируй дни и не выводи формулы — это уже сделано в коде.",
    "Return strict JSON only with keys: coach_summary_text, day_by_day_analysis_text, athlete_message_draft, quality_notes, do_not_send_reasons.",
    "coach_summary_text: короткий внутренний текст для тренера.",
    "day_by_day_analysis_text: дневные блоки строго по canonical daily_analysis.",
    "Для каждого дня при наличии данных используй: weekday_ru, date_label, training_label, actual, hint_for_comment/findings.",
    "В day_by_day_analysis_text комментируй только дневные totals; без intraday утверждений (до/во время/после тренировки, граммы по таймингу, гели).",
    "Если source_quality.confidence=low или suspect=true, формулируй осторожно как ограничение данных.",
    "athlete_message_draft должен включать 3-7 дневных наблюдений, если daily facts есть.",
    "athlete_message_draft: только plain Telegram text. Разрешены emoji-разделители.",
    "Запрещено в athlete_message_draft: **, ---, code fences, markdown headings.",
    "Строгая формальность: только ты ИЛИ только вы, без смешивания.",
    "Не используй диагнозы/медицинские термины: RED-S, REDs, LEA, энергодоступность, дефицит энергии, медицинский риск, диагноз, расстройство, анемия.",
    ...NUTRITION_REVIEW_NARRATIVE_PROMPT_LINES,
    "Не используй язык похудения/ограничения: похудеть, сбросить вес, урезать калории, меньше есть, дефицит калорий.",
    "Не давай меню/диету/рецепты. Продукты только как варианты при наличии фактов.",
    "Не придумывай тренировки и не придумывай гели/fueling.",
    "Разрешённая причинность только с хеджами: может, могло, вполне могло, не утверждаю наверняка.",
    "Запрещённая причинность: вызвало, из-за этого точно, именно поэтому.",
    "Use the required ты/вы form from formality instruction.",
    "Упоминание athlete name допускается при наличии в facts.",
    "One focus only: используй exact one_focus из facts.",
    "coach_context_ru — high-priority interpretation context for coach summary only. Do not quote coach_context_ru verbatim to athlete.",
    "athlete_report_signals — coach summary / review caution only. Do not cite or diagnose in athlete_message_draft.",
    "If illness/cycle/injury signals present, recommend coach review in coach_summary_text and quality_notes.",
    "Do not write medical claims or diagnostic conclusions in athlete_message_draft.",
    allowAthleteDraft
      ? "athlete_message_draft is required and must be useful Telegram-ready text."
      : "Hard safety flags present: athlete_message_draft must be null and coach-only text should explain manual review need.",
    `Formality instruction: ${formalityInstruction}`,
  ].join("\n");

  const dailyFacts = buildNutritionDailyFactsForNarrative({
    context: input.context,
    dailyAnalysis: input.dailyAnalysis,
  });
  const coachMemory = buildCoachMemoryFactsPayload(input.context);
  const factsPayload = {
    student: {
      name: input.context.studentName,
      formality: input.context.resolvedCommunicationProfile.formality,
      nutrition_goal: input.context.nutritionGoal,
      coach_context_ru: input.context.coachContextRu,
      coach_memory: coachMemory,
      narrative_preferences: nutritionContextNarrativePreferences(input.context),
    },
    athlete_report_signals: input.context.athleteReportSignals,
    tp_context: {
      past_week: input.context.tpPastWeek,
      next_week: input.context.tpNextWeek,
    },
    data_quality: input.context.dataQuality,
    daily_analysis: dailyFacts,
    daily_analysis_raw: input.dailyAnalysis,
    training_nutrition_links: input.trainingNutritionLinks,
    one_focus: input.oneFocus,
    methodology_signals: input.methodologySignals,
    safety_flags: input.safetyFlags,
    allow_athlete_draft: allowAthleteDraft,
  };
```

### 5.2 Доп. правила промпта — `narrative-guardrails.ts:31–51`

```typescript
export const NUTRITION_REVIEW_NARRATIVE_PROMPT_LINES = [
  "coach_context_ru — high-priority coach interpretation context. Не цитируй coach_context_ru дословно ученику.",
  "athlete_report_signals — только coach summary / review caution. Не пиши медицинские выводы ученику по сигналам illness/cycle/injury.",
  "EA/energyAvailability — только coach screening. Не пиши ученику: RED-S, REDs, LEA, энергодоступность, дефицит энергии, медицинский риск, диагноз.",
  "Допустимо ученику: «энергии для такого дня маловато», «для дня с нагрузкой это нижняя граница», «лучше поддержать питание вокруг нагрузки».",
  "macroGuardrails детерминированы в facts: не пересчитывай г/кг и не переопределяй protein ok как оправдание низкой энергии/углеводов.",
  "Если weekly protein avg >= 1.5, summary может сказать, что белок в целом ближе к норме; borderline days — мягко.",
  "Жиры: «низковаты / на нижней границе» без гормональных/медицинских объяснений.",
  "High fat / high fat percent — coach-only by default (fatFeedbackPolicy=coach_only). Athlete-facing high-fat только при fatFeedbackPolicy=normal и в связке с углеводами под нагрузку.",
  "Не пиши ученику про high fat, если fatFeedbackPolicy coach_only/suppress_athlete/soften.",
  "Практические ориентиры — step from previous week, не ideal target как обязательство. Не предлагай резкий прыжок carbs/kcal к идеалу за один день.",
  "Padel => падел; Cycling => вело/велосипед. Cross-training — нагрузка, но не hard interval без evidence.",
  "Ключевые тренировки: интервалы, темп/порог, long_run по правилу (>70 мин или explicit title), combined high-load day.",
] as const;

export const NUTRITION_PLAN_NARRATIVE_PROMPT_LINES = [
  "Практический target — шаг от прошлой недели, ideal target — ориентир, не обязательство.",
  "Обязательные формулировки в athlete draft: «Цифры ниже — ориентиры, не обязательство.» и «Не нужно резко прыгать к ним за один день.»",
  "Главный шаг — поднять энергию и углеводы в дни нагрузки; не презентуй ideal kcal/carbs как must-hit за день.",
  "No RED-S/REDs/LEA/энергодоступность/дефицит энергии/медицинский риск/диагноз in athlete draft.",
] as const;
```

### 5.3 `renderNutritionTelegramMessage` — `telegram-renderer.ts:427–486`

```typescript
export function renderNutritionTelegramMessage(input: NutritionTelegramRendererInput): NutritionTelegramRenderResult {
  const comparisonLine = input.hasPreviousWeeksContext ? input.interpretation.weekComparisonLineRu : null;
  const canUseMiniTable =
    input.hasTargetWeekTrainingContext && !input.forceDayTypePlan && Boolean(input.nextWeekPlan?.days.length);
  const planHeading = canUseMiniTable ? "📋 Мини-таблица" : "📋 План на неделю по типам дней";
  const planLines = canUseMiniTable && input.nextWeekPlan
    ? buildMiniTable({
        nextWeekPlan: input.nextWeekPlan,
        planWeekMode: input.planWeekMode,
        todayLocalDate: input.todayLocalDate,
        mode: input.miniTableMode ?? "athlete_remaining_only",
      })
    : buildPlanByDayTypes(input.nextWeekPlan, input.fallbackPlanLines);
  const keyTrainingPresent = hasKeyTraining(input.nextWeekPlan);
  const mainStepLine = buildNutritionTargetWeekMainStepLine(input.nextWeekPlan, input.planWeekMode, {
    todayLocalDate: input.todayLocalDate,
    miniTableMode: input.miniTableMode ?? "athlete_remaining_only",
  });
  const lines = [
    resolveGreeting(input.formality, input.athleteName),
    "",
    "Посмотрел твой отчёт за неделю и сопоставил его с тренировками.",
    ...(comparisonLine ? ["", comparisonLine] : []),
    "",
    "🔹 Разбор по дням",
    ...(input.interpretation.dayComments.length > 0
      ? input.interpretation.dayComments
      : ["Разбор по дням в этом черновике не детализирую: canonical daily_analysis не найден, поэтому лучше проверить исходный обзор вручную."]),
    "",
    "📌 Итог недели",
    input.interpretation.weekSummaryRu ?? "По неделе держим курс на ровную энергию и восстановление без резких просадок.",
    "",
    formatPlanFocusSectionHeading(input.planWeekMode),
    ...(input.interpretation.focusLinesRu.length > 0 ? input.interpretation.focusLinesRu : ["Фокус на неделю не сформирован."]),
    "Цифры ниже - ориентиры, не обязательство. Не нужно резко прыгать к ним за один день.",
    mainStepLine,
    "",
    planHeading,
    ...planLines,
    ...(keyTrainingPresent ? ["", ...buildPreTrainingBlock(input.nextWeekPlan)] : []),
    "",
    "На следующем разборе посмотрим, как это отразится на энергии и восстановлении.",
  ];

  const text = cleanupPlainText(lines.join("\n"));
  const issues = validateTelegramReadyNutritionMessage({
    text,
    hasPreviousWeeksContext: input.hasPreviousWeeksContext,
    hasTargetWeekTrainingContext: input.hasTargetWeekTrainingContext,
    hasKeyTraining: keyTrainingPresent,
    longRunTargetKcalText: getLongRunTargetKcalText(input.nextWeekPlan),
  });
  const ok = !issues.some((issue) => issue.severity === "error");
  return {
    ok,
    text: ok ? text : null,
    issues,
    charCount: text.length,
  };
}
```

### 5.4 `validateTelegramReadyNutritionMessage` — `telegram-renderer.ts:359–425`

```typescript
export function validateTelegramReadyNutritionMessage(input: {
  text: string;
  hasPreviousWeeksContext: boolean;
  hasTargetWeekTrainingContext: boolean;
  hasKeyTraining: boolean;
  longRunTargetKcalText?: string | null;
}): NutritionTelegramRenderIssue[] {
  const issues: NutritionTelegramRenderIssue[] = [];
  const text = input.text;

  if (/[—–]/.test(text)) {
    pushIssue(issues, "error", "plain_dashes", "В тексте есть длинное тире.");
  }
  if (/\*\*|__|```|^\s*-{3,}\s*$/m.test(text)) {
    pushIssue(issues, "error", "markdown", "В тексте остались markdown-разметка или разделители.");
  }
  if (/TrainingPeaks|FatSecret|OpenAI|\bJSON\b|\bAI\b/.test(text)) {
    pushIssue(issues, "error", "internal_terms", "В тексте есть внутренние или технические термины.");
  }
  if (!input.hasPreviousWeeksContext && /прошл[а-я]+\s+недел|по сравнению с прошл/i.test(text)) {
    pushIssue(issues, "error", "phantom_previous_comparison", "Сравнение с прошлой неделей запрещено без сохранённого контекста.");
  }
  if (input.hasPreviousWeeksContext && !/прошл[а-я]+\s+недел|по сравнению с прошл/i.test(text)) {
    pushIssue(issues, "warning", "missing_previous_comparison", "Есть контекст прошлых недель, но сравнение не показано.");
  }
  if (/Комментарий:|можно дать|указать факт|hint_for_comment|source_quality/.test(text)) {
    pushIssue(issues, "error", "raw_internal_phrase", "В тексте осталась служебная формулировка.");
  }
  const cautiousMatches = text.match(/по этому дню вывод делаю осторожно/gi) ?? [];
  if (cautiousMatches.length > 1) {
    pushIssue(issues, "error", "repeated_data_thin_caution", "Осторожная оговорка по качеству данных повторяется больше одного раза.");
  }
  const longRunTargetKcalText = input.longRunTargetKcalText ?? "~2500 ккал";
  const longRunGenericLine = text
    .split("\n")
    .some((line) => /Бег по пульсу/.test(line) && line.includes(longRunTargetKcalText) && !/длительн/i.test(line));
  if (longRunGenericLine) {
    pushIssue(issues, "error", "long_run_label", "Длительная не должна отображаться как общий «Бег по пульсу».");
  }
  const redEasyRows = text
    .split("\n")
    .filter((line) => line.startsWith("🟥"))
    .filter((line) => /л[её]гк(?:ий|ая)\s+бег|л[её]гк(?:ий|ая)\s+день/i.test(line));
  if (redEasyRows.length > 0) {
    pushIssue(issues, "error", "red_easy_row", "В мини-таблице найдено несоответствие: 🟥 с лёгким днём.");
  }
  if (input.hasTargetWeekTrainingContext && /План на неделю по типам дней/.test(text) && /Мини-таблица|План по датам/.test(text)) {
    pushIssue(issues, "error", "plan_and_mini_table", "При доступном TP-контексте нельзя одновременно показывать типы дней и dated plan.");
  }
  if (text.length > 4096) {
    pushIssue(issues, "warning", "telegram_length", "Текст длиннее одного Telegram-сообщения; при ручной отправке разделите на 2 части.");
  }
  if (
    /дефицит калорий|дефицит энергии|энергодоступность|опасная зона|медицинский риск|урезать|похудеть|RED-S|LEA|анемия|расстройство пищевого/i.test(
      text
    )
  ) {
    pushIssue(issues, "error", "forbidden_safety_language", "В тексте есть запрещённая safety-лексика.");
  }
  if (!input.hasKeyTraining && /Перед ключевыми тренировками/.test(text)) {
    pushIssue(issues, "warning", "pre_training_without_key", "Блок перед тренировками показан без hard/long_run.");
  }
  if (input.hasTargetWeekTrainingContext && !/Мини-таблица|План по датам/.test(text)) {
    pushIssue(issues, "warning", "missing_mini_table", "Есть TP-контекст целевой недели, но нет dated mini-table.");
  }
  return issues;
}
```

---

## 6. Ключевые файлы

| Слой | Файл |
|------|------|
| Парсинг отчёта | `src/features/nutrition/file-intake.ts` |
| Контекст ученика + safety | `src/features/nutrition/context.ts` |
| Методика (EA, floors, guardrails, focus) | `src/features/nutrition/methodology.ts` |
| Генерация обзора (AI + fallback) | `src/features/nutrition/draft-generator.ts` |
| Правила промпта | `src/features/nutrition/narrative-guardrails.ts` |
| Формулы плана | `src/features/nutrition/weekly-plan-formulas.ts` |
| Генератор плана | `src/features/nutrition/weekly-plan-generator.ts` |
| Derived combined message | `src/features/nutrition/combined-message.ts` |
| Telegram-рендерер + валидация | `src/features/nutrition/telegram-renderer.ts` |
| Композитор дневных комментариев | `src/features/nutrition/narrative-composer.ts` |

*Справка собрана 2026-06-14 статическим разбором кода. Номера строк указаны на момент сборки и могут сместиться при правках.*
