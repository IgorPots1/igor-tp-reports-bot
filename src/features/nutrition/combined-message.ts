import type { NutritionWeeklyAnalysis, NutritionWeeklyPlan } from "@/features/nutrition/repository";
import type { TrainingPeaksTelegramFormality } from "@/features/trainingpeaks/repository";
import type { NutritionNextWeekPlan, NutritionNextWeekPlanDay, NutritionPlanDayType } from "@/features/nutrition/weekly-plan-formulas";

type CanonicalDailyFact = {
  date?: unknown;
  weekday_ru?: unknown;
  weekdayRu?: unknown;
  date_label?: unknown;
  dateLabel?: unknown;
  training_type?: unknown;
  trainingType?: unknown;
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
  nutrition_status?: unknown;
  nutritionStatus?: unknown;
  findings?: unknown;
  source_quality?: unknown;
  sourceQuality?: unknown;
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

function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function formatNutritionAthleteKcal(value: number | null | undefined, options?: { mode?: "actual" | "target" }): string {
  if (value == null || !Number.isFinite(value)) {
    return "ккал н/д";
  }
  return `~${roundToNearest(value, options?.mode === "target" ? 100 : 50)} ккал`;
}

export function formatNutritionAthleteMacro(value: number | null | undefined, options?: { approximate?: boolean }): string {
  if (value == null || !Number.isFinite(value)) {
    return "н/д";
  }
  const rounded = roundToNearest(value, 5);
  return `${options?.approximate ? "~" : ""}${rounded} г`;
}

export function formatNutritionAthletePlanMacro(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "н/д";
  }
  return `${Math.round(value)} г`;
}

export function formatNutritionAthletePerKg(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "н/д";
  }
  return `~${formatDecimalRu(value, 1)} г/кг`;
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

function normalizeStoredDailyFactItem(raw: unknown): CanonicalDailyFact | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const item = raw as Record<string, unknown>;
  const embedded = asObject(item.canonicalDailyAnalysis) ?? asObject(item.canonical_daily_analysis);
  const source = Object.keys(embedded).length > 0 ? embedded : item;
  const actualSource = asObject(source.actual);
  const actual =
    Object.keys(actualSource).length > 0
      ? actualSource
      : {
          kcal: item.kcal ?? source.kcal ?? item.actual_kcal ?? source.actual_kcal,
          proteinG: item.proteinG ?? source.proteinG ?? item.protein_g ?? source.protein_g,
          fatG: item.fatG ?? source.fatG ?? item.fat_g ?? source.fat_g,
          carbsG: item.carbsG ?? source.carbsG ?? item.carbs_g ?? source.carbs_g,
          carbsGPerKg: item.carbsGPerKg ?? source.carbsGPerKg ?? item.carbs_g_per_kg ?? source.carbs_g_per_kg,
        };
  const date = typeof source.date === "string" ? source.date : typeof item.date === "string" ? item.date : null;
  if (!date) {
    return null;
  }
  const weekday =
    typeof source.weekdayRu === "string"
      ? source.weekdayRu
      : typeof source.weekday_ru === "string"
        ? source.weekday_ru
        : typeof item.weekdayRu === "string"
          ? item.weekdayRu
          : null;
  const dateLabel =
    typeof source.dateLabel === "string"
      ? source.dateLabel
      : typeof source.date_label === "string"
        ? source.date_label
        : formatDateRu(date);
  const trainingType =
    typeof source.trainingType === "string"
      ? source.trainingType
      : typeof source.training_type === "string"
        ? source.training_type
        : typeof item.trainingType === "string"
          ? item.trainingType
          : "unknown";
  const trainingLabel =
    typeof source.trainingLabel === "string"
      ? source.trainingLabel
      : typeof source.training_label === "string"
        ? source.training_label
        : "день недели";
  const sourceQuality = asObject(source.sourceQuality) ?? asObject(source.source_quality);
  return {
    date,
    weekday_ru: weekday,
    date_label: dateLabel,
    training_type: trainingType,
    training_label: trainingLabel,
    actual,
    actual_kcal:
      toFiniteNumber(actual.kcal) ?? toFiniteNumber(item.actual_kcal) ?? toFiniteNumber(source.actual_kcal),
    protein_g: toFiniteNumber(actual.proteinG) ?? toFiniteNumber(item.protein_g) ?? toFiniteNumber(source.protein_g),
    fat_g: toFiniteNumber(actual.fatG) ?? toFiniteNumber(item.fat_g) ?? toFiniteNumber(source.fat_g),
    carbs_g: toFiniteNumber(actual.carbsG) ?? toFiniteNumber(item.carbs_g) ?? toFiniteNumber(source.carbs_g),
    carbs_g_per_kg:
      toFiniteNumber(actual.carbsGPerKg) ??
      toFiniteNumber(item.carbs_g_per_kg) ??
      toFiniteNumber(source.carbs_g_per_kg),
    nutrition_status:
      typeof source.nutritionStatus === "string"
        ? source.nutritionStatus
        : typeof source.nutrition_status === "string"
          ? source.nutrition_status
          : typeof item.nutritionStatus === "string"
            ? item.nutritionStatus
            : null,
    findings: source.findings ?? item.findings,
    source_quality: Object.keys(sourceQuality).length > 0 ? sourceQuality : undefined,
  };
}

function getCanonicalDailyFacts(review: NutritionWeeklyAnalysis): CanonicalDailyFact[] {
  const summary = asObject(review.nutritionSummary);
  const daily = summary.daily_analysis;
  if (!Array.isArray(daily)) {
    return [];
  }
  return daily
    .map((item) => normalizeStoredDailyFactItem(item))
    .filter((item): item is CanonicalDailyFact => Boolean(item));
}

function getDailyFactValue(item: CanonicalDailyFact, actual: Record<string, unknown>, snakeKey: keyof CanonicalDailyFact, camelKey: string): number | null {
  return toFiniteNumber(item[snakeKey]) ?? toFiniteNumber(actual[camelKey]);
}

function renderNutritionDayComment(input: {
  trainingType: string;
  trainingLabel: string;
  nutritionStatus: string | null;
  kcal: number;
  carbs: number;
  carbsPerKg: number | null;
  sourceConfidence: string | null;
  findings: string[];
}): string {
  const carbsText = formatNutritionAthleteMacro(input.carbs, { approximate: true });
  const kcalText = formatNutritionAthleteKcal(input.kcal, { mode: "actual" });
  const carbsKgText = input.carbsPerKg != null ? ` (${formatNutritionAthletePerKg(input.carbsPerKg)})` : "";
  const lowQuality = input.sourceConfidence === "low";
  const cautiousPrefix = lowQuality
    ? "По этому дню вывод делаю осторожно: данных может быть чуть меньше, чем нужно для точной оценки. "
    : "";

  if (input.nutritionStatus === "pre_long_low") {
    return `${cautiousPrefix}Это день перед длительной: углеводов получилось около ${carbsText}${carbsKgText}. Для такой подготовки это нижняя граница, поэтому накануне длинной работы лучше не просаживать углеводы.`;
  }
  if (input.nutritionStatus === "long_run_low") {
    return `${cautiousPrefix}На длинную работу день получился скромным по энергии: около ${kcalText}, углеводов около ${carbsText}${carbsKgText}. Не привязываю самочувствие только к этому, но запас топлива и восстановление могли быть лучше.`;
  }
  if (input.nutritionStatus === "low_for_load") {
    return `${cautiousPrefix}Углеводов за день получилось около ${carbsText}${carbsKgText} — для такой работы это нижняя граница. Не критично, но в ключевые дни лучше держать углеводы повыше, чтобы было больше топлива на тренировку и восстановление.`;
  }
  if (input.nutritionStatus === "suspect") {
    return "По этому дню вывод делаю осторожно: данных может быть чуть меньше, чем нужно для точной оценки.";
  }
  if (input.trainingType === "rest") {
    return `${cautiousPrefix}Для дня без ключевой нагрузки выглядит спокойно: энергии около ${kcalText}, явной проблемы по распределению здесь не видно.`;
  }
  if (input.trainingType === "easy") {
    return `${cautiousPrefix}Под лёгкую работу день выглядит нормально: энергии и углеводов достаточно, здесь ничего специально менять не нужно.`;
  }
  if (input.trainingType === "hard" || input.trainingType === "race") {
    return `${cautiousPrefix}Под эту ключевую работу питание выглядит согласованно: углеводов около ${carbsText}${carbsKgText}, сильной просадки по дню не видно.`;
  }
  if (input.trainingType === "long_run") {
    return `${cautiousPrefix}Под длинную работу день выглядит достаточно ровно: энергии около ${kcalText}, углеводов около ${carbsText}${carbsKgText}.`;
  }
  if (input.findings.includes("protein_sufficient")) {
    return `${cautiousPrefix}Белок в этот день закрыт хорошо, по нагрузке и питанию явного конфликта не видно.`;
  }
  return `${cautiousPrefix}День выглядит ровно, здесь ничего специально менять не нужно.`;
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
      const trainingType =
        typeof item.training_type === "string" ? item.training_type : typeof item.trainingType === "string" ? item.trainingType : "unknown";
      const trainingLabel =
        typeof item.training_label === "string" ? item.training_label : typeof item.trainingLabel === "string" ? item.trainingLabel : "день недели";
      const actual = asObject(item.actual);
      const kcal = getDailyFactValue(item, actual, "actual_kcal", "kcal");
      const protein = getDailyFactValue(item, actual, "protein_g", "proteinG");
      const fat = getDailyFactValue(item, actual, "fat_g", "fatG");
      const carbs = getDailyFactValue(item, actual, "carbs_g", "carbsG");
      const carbsPerKg = toFiniteNumber(item.carbs_g_per_kg) ?? toFiniteNumber(actual.carbsGPerKg);
      const findings = asStringArray(item.findings);
      const nutritionStatus =
        typeof item.nutrition_status === "string"
          ? item.nutrition_status
          : typeof item.nutritionStatus === "string"
            ? item.nutritionStatus
            : null;
      const sourceQuality = asObject(item.source_quality) ?? asObject(item.sourceQuality);
      const sourceConfidence = typeof sourceQuality.confidence === "string" ? sourceQuality.confidence : null;
      if (!weekday || !dateLabel || kcal == null || protein == null || fat == null || carbs == null) {
        return null;
      }
      const comment = renderNutritionDayComment({
        trainingType,
        trainingLabel,
        nutritionStatus,
        kcal,
        carbs,
        carbsPerKg,
        sourceConfidence,
        findings,
      });
      const carbsKgText = carbsPerKg != null ? ` (${formatNutritionAthletePerKg(carbsPerKg)})` : "";
      return `🔹 ${weekday} (${dateLabel}) — ${trainingLabel}
${formatNutritionAthleteKcal(kcal, { mode: "actual" })} · белок ${formatNutritionAthleteMacro(protein)} · жиры ${formatNutritionAthleteMacro(fat)} · углеводы ${formatNutritionAthleteMacro(carbs)}${carbsKgText}.
${comment}`;
    })
    .filter((line): line is string => Boolean(line));
}

function getReviewWeekSummaryLine(review: NutritionWeeklyAnalysis): string {
  const summary = asObject(review.nutritionSummary);
  const oneFocus = asObject(summary.one_focus);
  const statement = compactText(typeof oneFocus.statement_ru === "string" ? oneFocus.statement_ru : null);
  const coachSummary = compactText(typeof summary.coach_summary_text === "string" ? summary.coach_summary_text : null);
  const proteinSufficient = asObject(summary.methodology_signals).protein_sufficient === true;
  const dailyFacts = getCanonicalDailyFacts(review);
  const lowCarbKeyDays = dailyFacts
    .filter((day) => {
      const status = typeof day.nutrition_status === "string" ? day.nutrition_status : typeof day.nutritionStatus === "string" ? day.nutritionStatus : "";
      return status === "pre_long_low" || status === "long_run_low" || status === "low_for_load";
    })
    .map((day) => (typeof day.weekday_ru === "string" ? day.weekday_ru.toLowerCase() : typeof day.weekdayRu === "string" ? day.weekdayRu.toLowerCase() : null))
    .filter((day): day is string => Boolean(day));
  if (proteinSufficient || lowCarbKeyDays.length > 0) {
    const good = proteinSufficient ? "По белку всё спокойно — восстановление здесь закрыто хорошо." : "По базовой структуре недели есть на что опереться.";
    const pattern =
      lowCarbKeyDays.length > 0
        ? `Главный момент недели — распределение углеводов и энергии: самые заметные просадки пришлись на ${[...new Set(lowCarbKeyDays)].join(", ")}.`
        : "Главный момент недели — держать энергию ровнее вокруг ключевых тренировок.";
    return `${good} ${pattern} Не утверждаю, что самочувствие зависело только от этого, но это могло повлиять на запас энергии и восстановление. Фокус — не снижать углеводы перед длинной или ключевой работой.`;
  }
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
  const hasStrengthDay = nextWeekPlan.days.some((day) => day.training_type === "strength");
  const ordered: Array<{ key: NutritionPlanDayType; target: NutritionNextWeekPlan["day_type_targets"]["rest"] }> = [
    { key: "rest", target: targets.rest },
    { key: "easy", target: targets.easy },
    { key: "hard", target: targets.hard },
    { key: "pre_long", target: targets.pre_long },
    { key: "long_run", target: targets.long_run },
    ...(hasStrengthDay ? [{ key: "strength" as const, target: targets.strength }] : []),
  ];
  return ordered
    .map(({ key, target }) => {
      if (!target) {
        return null;
      }
      return `${dayTypeEmoji(key)} ${dayTypeRu(key)} — ${formatNutritionAthleteKcal(target.target_kcal, { mode: "target" })} · ${formatNutritionAthletePlanMacro(target.protein_g)} Б · ${formatNutritionAthletePlanMacro(target.fat_g)} Ж · ${formatNutritionAthletePlanMacro(target.carbs_g)} У`;
    })
    .filter((line): line is string => Boolean(line));
}

function buildMiniTableLines(nextWeekPlan: NutritionNextWeekPlan): string[] {
  return nextWeekPlan.days.slice(0, 7).map((day: NutritionNextWeekPlanDay) => {
    const kcal = day.target_kcal != null ? formatNutritionAthleteKcal(day.target_kcal, { mode: "target" }) : "ккал н/д";
    const protein = day.protein_g != null ? `${Math.round(day.protein_g)}Б` : "Б н/д";
    const fat = day.fat_g != null ? `${Math.round(day.fat_g)}Ж` : "Ж н/д";
    const carbs = day.carbs_g != null ? `${Math.round(day.carbs_g)}У` : "У н/д";
    return `${dayTypeEmoji(day.training_type)} ${day.weekday_ru} (${formatDateRu(day.date)}) · ${day.training_label} · ${kcal} · ${protein} · ${fat} · ${carbs}`;
  });
}

export function getNutritionAthleteDisplayName(student: { studentName?: string | null; profilePreferences?: Record<string, unknown> | null }): string {
  const preferences = asObject(student.profilePreferences);
  const preferred =
    compactText(typeof preferences.preferred_name === "string" ? preferences.preferred_name : null) ??
    compactText(typeof preferences.preferredName === "string" ? preferences.preferredName : null) ??
    compactText(typeof preferences.display_name === "string" ? preferences.display_name : null) ??
    compactText(typeof preferences.displayName === "string" ? preferences.displayName : null);
  if (preferred) {
    return preferred;
  }
  const rawName = compactText(student.studentName) ?? "Привет";
  const firstToken = rawName.split(/\s+/)[0] ?? rawName;
  const knownShortNames: Record<string, string> = {
    nadezhda: "Надя",
    надежда: "Надя",
  };
  return knownShortNames[firstToken.toLocaleLowerCase("ru")] ?? firstToken;
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
  profilePreferences?: Record<string, unknown> | null;
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

  const athleteName = getNutritionAthleteDisplayName({
    studentName: input.studentName,
    profilePreferences: input.profilePreferences ?? null,
  });
  const greeting = resolveGreeting(input.formality, athleteName);
  const introLine = "Посмотрел твой отчёт за неделю и сопоставил его с тренировками.";
  const summary = asObject(review.nutritionSummary);
  const avgKcal = toFiniteNumber(summary.avg_kcal);
  const restKcal = nextWeekPlan?.day_type_targets.rest?.target_kcal ?? null;
  const comparisonLine =
    avgKcal != null && restKcal != null
      ? `По сравнению с прошлой неделей держим более ровную базу: среднее за неделю ${formatNutritionAthleteKcal(avgKcal, { mode: "actual" })}, ориентир для дня отдыха ${formatNutritionAthleteKcal(restKcal, { mode: "target" })}.`
      : null;
  const dayByDaySection =
    reviewDailyLines.length > 0
      ? reviewDailyLines
      : ["Разбор по дням в этом черновике не детализирую: canonical daily_analysis не найден, поэтому лучше проверить исходный обзор вручную."];
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

  const athleteMessageDraft = lines.join("\n").trim();
  // #region agent log
  fetch("http://127.0.0.1:7521/ingest/adcbf755-c5c9-4a78-9e7d-4a590fbeae5c", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "4d2583" },
    body: JSON.stringify({
      sessionId: "4d2583",
      runId: "pre-fix",
      hypothesisId: "B,C,E",
      location: "combined-message.ts:buildDerivedNutritionCombinedMessage",
      message: "combined message built",
      data: {
        sourceReviewId: review.id,
        sourcePlanId: plan.id,
        reviewDailyLinesCount: reviewDailyLines.length,
        hasNextWeekPlan: Boolean(nextWeekPlan),
        firstLine: athleteMessageDraft.split("\n")[0] ?? null,
        containsCommentLabel: /Комментарий:/.test(athleteMessageDraft),
        containsMozhnoDat: /можно дать/.test(athleteMessageDraft),
        containsDecimalMacro: /\d+\.\d+\s*г/.test(athleteMessageDraft),
        usesStoredReviewDraft: review.athleteMessageDraft
          ? athleteMessageDraft.includes(review.athleteMessageDraft.trim())
          : false,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  return {
    status: hasNeedsReviewStatus(review, plan) ? "needs_review" : "ready",
    athleteMessageDraft,
    warnings,
    sourceReviewId: review.id,
    sourcePlanId: plan.id,
  };
}
