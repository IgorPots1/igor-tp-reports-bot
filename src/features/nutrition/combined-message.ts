import type { NutritionWeeklyAnalysis, NutritionWeeklyPlan } from "@/features/nutrition/repository";
import type { TrainingPeaksTelegramFormality } from "@/features/trainingpeaks/repository";
import type { NutritionNextWeekPlan, NutritionNextWeekPlanDay, NutritionPlanDayType } from "@/features/nutrition/weekly-plan-formulas";

type CanonicalDailyFact = {
  date?: unknown;
  weekday_ru?: unknown;
  weekdayRu?: unknown;
  date_label?: unknown;
  dateLabel?: unknown;
  training_label?: unknown;
  trainingLabel?: unknown;
  actual_kcal?: unknown;
  actual?: unknown;
  protein_g?: unknown;
  fat_g?: unknown;
  carbs_g?: unknown;
  carbs_g_per_kg?: unknown;
  hint_for_comment?: unknown;
  hintForComment?: unknown;
  findings?: unknown;
};

export type NutritionCombinedMessageResult = {
  status: "ready" | "missing_review" | "missing_plan" | "blocked_safety" | "needs_review";
  athleteMessageDraft: string | null;
  warnings: string[];
  sourceReviewId: string | null;
  sourcePlanId: string | null;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function compactText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized || null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatDateRu(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return isoDate;
  }
  return `${match[3]}.${match[2]}`;
}

function formatDecimalRu(value: number, digits = 1): string {
  return value.toFixed(digits).replace(".", ",");
}

function dayTypeEmoji(dayType: NutritionPlanDayType): string {
  switch (dayType) {
    case "rest":
      return "🟦";
    case "easy":
      return "🟩";
    case "hard":
      return "🟧";
    case "pre_long":
      return "🟪";
    case "long_run":
    case "race":
      return "🟥";
    case "strength":
      return "🟩";
    default:
      return "🟩";
  }
}

function dayTypeRu(dayType: NutritionPlanDayType): string {
  switch (dayType) {
    case "rest":
      return "День отдыха";
    case "easy":
      return "Лёгкий день";
    case "hard":
      return "Ключевая нагрузка";
    case "pre_long":
      return "День перед длительной";
    case "long_run":
      return "Длительная";
    case "strength":
      return "Силовая";
    case "race":
      return "Соревнование";
    default:
      return "День недели";
  }
}

function getCanonicalDailyFacts(review: NutritionWeeklyAnalysis): CanonicalDailyFact[] {
  const summary = asObject(review.nutritionSummary);
  const daily = summary.daily_analysis;
  if (!Array.isArray(daily)) {
    return [];
  }
  return daily.filter((item): item is CanonicalDailyFact => Boolean(item && typeof item === "object" && !Array.isArray(item)));
}

function getDailyFactsLines(review: NutritionWeeklyAnalysis): string[] {
  const facts = getCanonicalDailyFacts(review);
  if (facts.length === 0) {
    return [];
  }
  return facts
    .map((item) => {
      const date = typeof item.date === "string" ? item.date : null;
      const weekday = typeof item.weekday_ru === "string" ? item.weekday_ru : typeof item.weekdayRu === "string" ? item.weekdayRu : null;
      const dateLabel =
        typeof item.date_label === "string" ? item.date_label : typeof item.dateLabel === "string" ? item.dateLabel : date ? formatDateRu(date) : null;
      const trainingLabel =
        typeof item.training_label === "string" ? item.training_label : typeof item.trainingLabel === "string" ? item.trainingLabel : "день недели";
      const actual = asObject(item.actual);
      const kcal = toFiniteNumber(item.actual_kcal) ?? toFiniteNumber(actual.kcal);
      const protein = toFiniteNumber(item.protein_g) ?? toFiniteNumber(actual.proteinG);
      const fat = toFiniteNumber(item.fat_g) ?? toFiniteNumber(actual.fatG);
      const carbs = toFiniteNumber(item.carbs_g) ?? toFiniteNumber(actual.carbsG);
      const carbsPerKg = toFiniteNumber(item.carbs_g_per_kg) ?? toFiniteNumber(actual.carbsGPerKg);
      const hintRaw =
        typeof item.hint_for_comment === "string"
          ? item.hint_for_comment
          : typeof item.hintForComment === "string"
            ? item.hintForComment
            : "";
      const findings = asStringArray(item.findings);
      const comment = compactText(hintRaw) ?? compactText(findings[0]) ?? "Сохраняй ровный режим питания в течение дня.";
      if (!weekday || !dateLabel || kcal == null || protein == null || fat == null || carbs == null) {
        return null;
      }
      const carbsKgText = carbsPerKg != null ? ` (~${formatDecimalRu(carbsPerKg)} г/кг)` : "";
      return `🔹 ${weekday} (${dateLabel}) — ${trainingLabel}
~${Math.round(kcal)} ккал · белок ${Math.round(protein)} г · жиры ${Math.round(fat)} г · углеводы ${Math.round(carbs)} г${carbsKgText}.
${comment}`;
    })
    .filter((line): line is string => Boolean(line));
}

function getReviewWeekSummaryLine(review: NutritionWeeklyAnalysis): string {
  const summary = asObject(review.nutritionSummary);
  const oneFocus = asObject(summary.one_focus);
  const statement = compactText(typeof oneFocus.statement_ru === "string" ? oneFocus.statement_ru : null);
  const coachSummary = compactText(typeof summary.coach_summary_text === "string" ? summary.coach_summary_text : null);
  return statement ?? coachSummary ?? "По неделе держим курс на ровную энергию и восстановление без резких просадок.";
}

function getPlanFocusLines(plan: NutritionWeeklyPlan): string[] {
  const planSummary = asObject(plan.planSummary);
  const focus = asObject(planSummary.plan_focus);
  const title = compactText(typeof focus.title === "string" ? focus.title : null);
  const explanation = compactText(typeof focus.explanation === "string" ? focus.explanation : null);
  if (title && explanation) {
    return [title, explanation];
  }
  if (title) {
    return [title];
  }
  if (explanation) {
    return [explanation];
  }
  const draft = compactText(plan.athleteMessageDraft);
  return draft ? [draft] : ["Фокус на следующую неделю не сформирован."];
}

function getNextWeekPlan(plan: NutritionWeeklyPlan): NutritionNextWeekPlan | null {
  const planSummary = asObject(plan.planSummary);
  const nextWeekPlan = asObject(planSummary.next_week_plan);
  if (!nextWeekPlan || Object.keys(nextWeekPlan).length === 0) {
    return null;
  }
  const formulaVersion = typeof nextWeekPlan.formula_version === "string" ? nextWeekPlan.formula_version : null;
  const days = Array.isArray(nextWeekPlan.days) ? nextWeekPlan.days : null;
  if (formulaVersion !== "nutrition_next_week_plan_v1" || !days) {
    return null;
  }
  return nextWeekPlan as unknown as NutritionNextWeekPlan;
}

function buildDayTypeTargetsLines(nextWeekPlan: NutritionNextWeekPlan): string[] {
  const targets = nextWeekPlan.day_type_targets;
  const ordered: Array<{ key: NutritionPlanDayType; target: NutritionNextWeekPlan["day_type_targets"]["rest"] }> = [
    { key: "rest", target: targets.rest },
    { key: "easy", target: targets.easy },
    { key: "hard", target: targets.hard },
    { key: "pre_long", target: targets.pre_long },
    { key: "long_run", target: targets.long_run },
    { key: "strength", target: targets.strength },
  ];
  return ordered
    .map(({ key, target }) => {
      if (!target) {
        return null;
      }
      return `${dayTypeEmoji(key)} ${dayTypeRu(key)} — ~${target.target_kcal} ккал · ${target.protein_g} г Б · ${target.fat_g} г Ж · ${target.carbs_g} г У`;
    })
    .filter((line): line is string => Boolean(line));
}

function buildMiniTableLines(nextWeekPlan: NutritionNextWeekPlan): string[] {
  return nextWeekPlan.days.slice(0, 7).map((day: NutritionNextWeekPlanDay) => {
    const kcal = day.target_kcal != null ? `~${day.target_kcal} ккал` : "~ккал н/д";
    const protein = day.protein_g != null ? `${day.protein_g}Б` : "Б н/д";
    const fat = day.fat_g != null ? `${day.fat_g}Ж` : "Ж н/д";
    const carbs = day.carbs_g != null ? `${day.carbs_g}У` : "У н/д";
    return `${dayTypeEmoji(day.training_type)} ${day.weekday_ru} (${formatDateRu(day.date)}) · ${day.training_label} · ${kcal} · ${protein} · ${fat} · ${carbs}`;
  });
}

function resolveGreeting(formality: TrainingPeaksTelegramFormality, studentName: string): string {
  if (formality === "vy") {
    return `Здравствуйте, ${studentName}!`;
  }
  return `${studentName}, привет!`;
}

function extractReviewDoNotSendReasons(review: NutritionWeeklyAnalysis): string[] {
  const summary = asObject(review.nutritionSummary);
  const safety = asObject(review.safetyFlags);
  const fromSummary = asStringArray(summary.do_not_send_reasons);
  const fromSafety = asStringArray(safety.do_not_send_reasons);
  const hard = asStringArray(safety.hard_flags).map((flag) => `manual_review_required:${flag}`);
  return [...new Set([...fromSummary, ...fromSafety, ...hard].map((item) => item.trim()).filter(Boolean))];
}

function extractPlanDoNotSendReasons(plan: NutritionWeeklyPlan): string[] {
  const planSummary = asObject(plan.planSummary);
  const safety = asObject(plan.safetyFlags);
  const fromSummary = asStringArray(planSummary.do_not_send_reasons);
  const fromSafety = asStringArray(safety.do_not_send_reasons).concat(asStringArray(safety.doNotSendReasons));
  const hard = asStringArray(safety.hard_flags).map((flag) => `manual_review_required:${flag}`);
  return [...new Set([...fromSummary, ...fromSafety, ...hard].map((item) => item.trim()).filter(Boolean))];
}

function isReviewBlockedSafety(review: NutritionWeeklyAnalysis): boolean {
  if (review.status === "blocked_safety") {
    return true;
  }
  return extractReviewDoNotSendReasons(review).length > 0;
}

function isPlanBlockedSafety(plan: NutritionWeeklyPlan): boolean {
  if (plan.status === "blocked_safety") {
    return true;
  }
  const reasons = extractPlanDoNotSendReasons(plan);
  const safety = asObject(plan.safetyFlags);
  const hardFlags = asStringArray(safety.hard_flags);
  const blocked = typeof safety.blocked === "boolean" ? safety.blocked : false;
  if (blocked || hardFlags.length > 0 || reasons.length > 0) {
    return true;
  }
  if (!plan.athleteMessageDraft && reasons.length > 0) {
    return true;
  }
  return false;
}

function hasNeedsReviewStatus(review: NutritionWeeklyAnalysis, plan: NutritionWeeklyPlan): boolean {
  return review.status === "needs_review" || plan.status === "needs_review";
}

export function buildDerivedNutritionCombinedMessage(input: {
  review: NutritionWeeklyAnalysis | null;
  plan: NutritionWeeklyPlan | null;
  formality: TrainingPeaksTelegramFormality;
  studentName: string;
}): NutritionCombinedMessageResult {
  if (!input.review) {
    return {
      status: "missing_review",
      athleteMessageDraft: null,
      warnings: [],
      sourceReviewId: null,
      sourcePlanId: input.plan?.id ?? null,
    };
  }
  if (!input.plan) {
    return {
      status: "missing_plan",
      athleteMessageDraft: null,
      warnings: [],
      sourceReviewId: input.review.id,
      sourcePlanId: null,
    };
  }

  const review = input.review;
  const plan = input.plan;
  const blocked = isReviewBlockedSafety(review) || isPlanBlockedSafety(plan);
  const warnings: string[] = [];
  const nextWeekPlan = getNextWeekPlan(plan);
  const reviewDailyLines = getDailyFactsLines(review);

  if (!nextWeekPlan) {
    warnings.push("У этого фокуса нет canonical next_week_plan — пересоздайте фокус.");
  }
  if (reviewDailyLines.length === 0) {
    warnings.push("В обзоре нет canonical daily_analysis — использован fallback из текста обзора.");
  }

  if (blocked) {
    return {
      status: "blocked_safety",
      athleteMessageDraft: null,
      warnings,
      sourceReviewId: review.id,
      sourcePlanId: plan.id,
    };
  }

  const greeting = resolveGreeting(input.formality, input.studentName);
  const introLine = "Собрала полный текст: разбор недели, фокус на следующую неделю и питание вокруг ключевых тренировок.";
  const summary = asObject(review.nutritionSummary);
  const avgKcal = toFiniteNumber(summary.avg_kcal);
  const restKcal = nextWeekPlan?.day_type_targets.rest?.target_kcal ?? null;
  const comparisonLine =
    avgKcal != null && restKcal != null
      ? `По сравнению с прошлой неделей держим более ровную базу: среднее за неделю ~${Math.round(avgKcal)} ккал, ориентир для дня отдыха ~${restKcal} ккал.`
      : null;
  const dayByDaySection =
    reviewDailyLines.length > 0
      ? reviewDailyLines
      : [
          compactText(typeof summary.day_by_day_analysis_text === "string" ? summary.day_by_day_analysis_text : null) ??
            compactText(review.athleteMessageDraft) ??
            "Разбор по дням не сформирован — проверь исходный обзор вручную.",
        ];
  const weekSummary = getReviewWeekSummaryLine(review);
  const focusLines = getPlanFocusLines(plan);
  const planByDayTypeLines = nextWeekPlan ? buildDayTypeTargetsLines(nextWeekPlan) : [compactText(plan.athleteMessageDraft) ?? "План на неделю не сформирован."];
  const miniTableLines = nextWeekPlan ? buildMiniTableLines(nextWeekPlan) : [];
  const closing = "На следующем разборе посмотрим, как это отразится на энергии и восстановлении.";

  const lines: string[] = [
    greeting,
    "",
    introLine,
    ...(comparisonLine ? ["", comparisonLine] : []),
    "",
    "🔹 Разбор по дням",
    ...dayByDaySection,
    "",
    "📌 Итог недели",
    weekSummary,
    "",
    "📌 Фокус на следующую неделю",
    ...focusLines,
    "",
    "📋 План на неделю по типам дней",
    ...planByDayTypeLines,
    "",
    "🍽 Питание вокруг ключевых тренировок",
    "Если ключевая тренировка утром:",
    "- Накануне вечером — плотный углеводный ужин. Это часть дневной нормы, не сверху.",
    "- Утром за 30-60 минут — лёгкие углеводы: банан, тост с мёдом, небольшая порция каши или гель.",
    "",
    "Если ключевая тренировка днём или вечером:",
    "- За 2-3 часа — полноценный приём с углеводами и умеренным белком.",
    "- За 30-60 минут — если чувствуешь, что не хватит: банан, гель или сухофрукты.",
    "",
    "После ключевой тренировки — углеводы + белок в течение часа.",
    ...(miniTableLines.length > 0 ? ["", "📋 Мини-таблица", ...miniTableLines] : []),
    "",
    closing,
  ];

  return {
    status: hasNeedsReviewStatus(review, plan) ? "needs_review" : "ready",
    athleteMessageDraft: lines.join("\n").trim(),
    warnings,
    sourceReviewId: review.id,
    sourcePlanId: plan.id,
  };
}
