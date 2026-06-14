import { formatNutritionWorkoutLabelForAthlete, buildNutritionTargetWeekMainStepLine } from "@/features/nutrition/narrative-composer";
import { getNutritionAdminLocalDate } from "@/features/nutrition/plan-week-policy";
import type { TrainingPeaksTelegramFormality } from "@/features/trainingpeaks/repository";
import type {
  NutritionDayTypeTarget,
  NutritionNextWeekPlan,
  NutritionNextWeekPlanDay,
  NutritionPlanDayType,
} from "@/features/nutrition/weekly-plan-formulas";
import type { NutritionPlanTargetWeekMode } from "@/features/nutrition/plan-week-policy";

export type NutritionTelegramRenderIssue = {
  rule: string;
  message: string;
  severity: "error" | "warning";
};

export type NutritionTelegramRenderResult = {
  ok: boolean;
  text: string | null;
  issues: NutritionTelegramRenderIssue[];
  charCount: number;
};

export type NutritionMessageInterpretation = {
  dayComments: string[];
  weekSummaryRu: string | null;
  focusLinesRu: string[];
  weekComparisonLineRu: string | null;
};

export type NutritionTelegramRendererInput = {
  formality: TrainingPeaksTelegramFormality;
  athleteName: string;
  planWeekMode: NutritionPlanTargetWeekMode;
  interpretation: NutritionMessageInterpretation;
  nextWeekPlan: NutritionNextWeekPlan | null;
  fallbackPlanLines: string[];
  hasTargetWeekTrainingContext: boolean;
  hasPreviousWeeksContext: boolean;
  forceDayTypePlan?: boolean;
  todayLocalDate?: string;
  miniTableMode?: "athlete_remaining_only" | "full_week";
};

function formatDateRu(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return isoDate;
  }
  return `${match[3]}.${match[2]}`;
}

function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function formatNutritionAthleteKcal(value: number | null | undefined, options?: { mode?: "actual" | "target" }): string {
  if (value == null || !Number.isFinite(value)) {
    return "ккал н/д";
  }
  return `~${roundToNearest(value, options?.mode === "target" ? 100 : 50)} ккал`;
}

function formatNutritionAthletePlanMacro(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "н/д";
  }
  return `${Math.round(value)} г`;
}

function dayTypeEmoji(dayType: NutritionPlanDayType): string {
  switch (dayType) {
    case "rest":
      return "🟦";
    case "hard":
      return "🟧";
    case "pre_long":
      return "🟪";
    case "long_run":
    case "long_endurance":
    case "race":
      return "🟥";
    default:
      return "🟩";
  }
}

function resolveConsistentDayType(day: NutritionNextWeekPlanDay): NutritionPlanDayType {
  const declared = day.training_type;
  const label = (day.workout_title ?? day.training_label ?? "").toLocaleLowerCase("ru");
  const hasLongCue = /длительн|long\s*run|long\s*endurance|длинн|вело\s+\d+:\d{2}|лонг/.test(label);
  if (declared === "easy" || declared === "rest" || declared === "cross_training" || declared === "strength") {
    return declared;
  }
  if ((declared === "long_run" || declared === "long_endurance") && hasLongCue) {
    return declared;
  }
  if ((declared === "long_run" || declared === "long_endurance") && !hasLongCue) {
    return "easy";
  }
  if (declared === "hard" || declared === "pre_long" || declared === "race") {
    return declared;
  }
  return declared;
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
    case "long_endurance":
      return "Длительная";
    case "strength":
      return "Силовая";
    case "cross_training":
      return "Кросс-тренировка";
    case "race":
      return "Соревнование";
    default:
      return "День недели";
  }
}

export function cleanupPlainText(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\*\*|__/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*-{3,}\s*$/gm, "")
    .replace(/TrainingPeaks/g, "план тренировок")
    .replace(/FatSecret/g, "дневник питания")
    .replace(/[—–]/g, "-")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function resolveGreeting(formality: TrainingPeaksTelegramFormality, athleteName: string): string {
  const trimmed = athleteName.trim();
  if (!trimmed) {
    return formality === "vy" ? "Здравствуйте!" : "Привет!";
  }
  if (formality === "vy") {
    return `Здравствуйте, ${trimmed}!`;
  }
  return `${trimmed}, привет!`;
}

function formatPlanFocusSectionHeading(mode: NutritionPlanTargetWeekMode): string {
  return mode === "current_week" ? "📌 Фокус на эту неделю" : "📌 Фокус на следующую неделю";
}

function resolveDayLabel(day: NutritionNextWeekPlanDay): string {
  return formatNutritionWorkoutLabelForAthlete({
    trainingLabel: day.workout_title ?? day.training_label ?? dayTypeRu(resolveConsistentDayType(day)).toLowerCase(),
    trainingType: resolveConsistentDayType(day),
  });
}

function buildPlanByDayTypes(nextWeekPlan: NutritionNextWeekPlan | null, fallbackPlanLines: string[]): string[] {
  if (!nextWeekPlan) {
    return fallbackPlanLines.length > 0 ? fallbackPlanLines : ["План на неделю не сформирован."];
  }
  const targets = nextWeekPlan.day_type_targets;
  const hasStrengthDay = nextWeekPlan.days.some((day) => day.training_type === "strength");
  const hasCrossTrainingDay = nextWeekPlan.days.some((day) => day.training_type === "cross_training");
  const ordered: Array<{ key: NutritionPlanDayType; target: typeof targets.rest }> = [
    { key: "rest", target: targets.rest },
    { key: "easy", target: targets.easy },
    { key: "hard", target: targets.hard },
    { key: "pre_long", target: targets.pre_long },
    { key: "long_run", target: targets.long_run },
    ...(hasStrengthDay ? [{ key: "strength" as const, target: targets.strength ?? null }] : []),
    ...(hasCrossTrainingDay ? [{ key: "cross_training" as const, target: targets.cross_training ?? null }] : []),
  ];
  return ordered
    .map(({ key, target }) => {
      if (!target) {
        return null;
      }
      return `${dayTypeEmoji(key)} ${dayTypeRu(key)} - ${formatNutritionAthleteKcal(target.target_kcal, { mode: "target" })} · ${formatNutritionAthletePlanMacro(target.protein_g)} Б · ${formatNutritionAthletePlanMacro(target.fat_g)} Ж · ${formatNutritionAthletePlanMacro(target.carbs_g)} У`;
    })
    .filter((line): line is string => Boolean(line));
}

function resolveMiniTableDays(input: {
  nextWeekPlan: NutritionNextWeekPlan;
  planWeekMode: NutritionPlanTargetWeekMode;
  todayLocalDate?: string;
  mode?: "athlete_remaining_only" | "full_week";
}): NutritionNextWeekPlanDay[] {
  const all = input.nextWeekPlan.days.slice(0, 7);
  const mode = input.mode ?? "athlete_remaining_only";
  if (mode === "full_week" || input.planWeekMode !== "current_week") {
    return all;
  }
  const today = input.todayLocalDate ?? getNutritionAdminLocalDate();
  const remaining = all.filter((day) => day.date >= today);
  return remaining.length > 0 ? remaining : all;
}

function buildDisplayTargetFromTypeTarget(target: NutritionDayTypeTarget): {
  kcal_min: number;
  kcal_max: number;
  carbs_g_min: number;
  carbs_g_max: number;
  protein_g: number;
  fat_g: number;
} {
  return {
    kcal_min: roundToNearest(target.target_kcal - 50, 50),
    kcal_max: roundToNearest(target.target_kcal + 50, 50),
    carbs_g_min: roundToNearest(target.carbs_g - 20, 10),
    carbs_g_max: roundToNearest(target.carbs_g + 20, 10),
    protein_g: target.protein_g,
    fat_g: target.fat_g,
  };
}

function resolveTypeTargetFromPlan(
  plan: NutritionNextWeekPlan,
  dayType: NutritionPlanDayType
): NutritionDayTypeTarget | null {
  switch (dayType) {
    case "rest":
      return plan.day_type_targets.rest;
    case "easy":
      return plan.day_type_targets.easy;
    case "hard":
      return plan.day_type_targets.hard;
    case "pre_long":
      return plan.day_type_targets.pre_long;
    case "long_run":
      return plan.day_type_targets.long_run;
    case "long_endurance":
      return plan.day_type_targets.long_endurance ?? plan.day_type_targets.long_run;
    case "strength":
      return plan.day_type_targets.strength;
    case "cross_training":
      return plan.day_type_targets.cross_training ?? null;
    case "race":
      return plan.day_type_targets.long_run ?? plan.day_type_targets.hard;
    default:
      return null;
  }
}

function resolveMiniTableRowTargets(
  day: NutritionNextWeekPlanDay,
  dayType: NutritionPlanDayType,
  plan: NutritionNextWeekPlan
): {
  kcalMin: number | null;
  kcalMax: number | null;
  carbsMin: number | null;
  carbsMax: number | null;
  proteinG: number | null;
  fatG: number | null;
} {
  if (dayType !== day.training_type) {
    const typeTarget = resolveTypeTargetFromPlan(plan, dayType);
    if (typeTarget) {
      const display = buildDisplayTargetFromTypeTarget(typeTarget);
      return {
        kcalMin: display.kcal_min,
        kcalMax: display.kcal_max,
        carbsMin: display.carbs_g_min,
        carbsMax: display.carbs_g_max,
        proteinG: display.protein_g,
        fatG: display.fat_g,
      };
    }
  }
  return {
    kcalMin: day.display_target?.kcal_min ?? null,
    kcalMax: day.display_target?.kcal_max ?? null,
    carbsMin: day.display_target?.carbs_g_min ?? null,
    carbsMax: day.display_target?.carbs_g_max ?? null,
    proteinG: day.protein_g ?? null,
    fatG: day.fat_g ?? null,
  };
}

function buildMiniTable(input: {
  nextWeekPlan: NutritionNextWeekPlan;
  planWeekMode: NutritionPlanTargetWeekMode;
  todayLocalDate?: string;
  mode?: "athlete_remaining_only" | "full_week";
}): string[] {
  const days = resolveMiniTableDays(input);
  return days.map((day) => {
    const dayType = resolveConsistentDayType(day);
    const label = resolveDayLabel({ ...day, training_type: dayType });
    const targets = resolveMiniTableRowTargets(day, dayType, input.nextWeekPlan);
    const kcal =
      targets.kcalMin != null && targets.kcalMax != null
        ? `~${Math.round(targets.kcalMin)}-${Math.round(targets.kcalMax)} ккал`
        : day.target_kcal != null
          ? formatNutritionAthleteKcal(day.target_kcal, { mode: "target" })
          : "ккал н/д";
    const carbs =
      targets.carbsMin != null && targets.carbsMax != null
        ? `${Math.round(targets.carbsMin)}-${Math.round(targets.carbsMax)}У`
        : day.carbs_g != null
          ? `${Math.round(day.carbs_g)}У`
          : "У н/д";
    const protein = targets.proteinG != null ? `${Math.round(targets.proteinG)}Б` : "Б н/д";
    const fat = targets.fatG != null ? `${Math.round(targets.fatG)}Ж` : "Ж н/д";
    return `${dayTypeEmoji(dayType)} ${day.weekday_ru} (${formatDateRu(day.date)}) · ${label} · ${kcal} · ${protein} · ${fat} · ${carbs}`;
  });
}

function hasKeyTraining(nextWeekPlan: NutritionNextWeekPlan | null): boolean {
  return Boolean(nextWeekPlan?.days.some((day) => day.training_type === "hard" || day.training_type === "long_run" || day.training_type === "race"));
}

function getLongRunTargetKcalText(nextWeekPlan: NutritionNextWeekPlan | null): string | null {
  const targetKcal =
    nextWeekPlan?.day_type_targets.long_run?.target_kcal ??
    nextWeekPlan?.days.find((day) => day.training_type === "long_run")?.target_kcal ??
    null;
  return targetKcal != null ? formatNutritionAthleteKcal(targetKcal, { mode: "target" }) : null;
}

function buildPreTrainingBlock(nextWeekPlan: NutritionNextWeekPlan | null): string[] {
  if (!hasKeyTraining(nextWeekPlan)) {
    return [];
  }
  return [
    "🍽 Перед ключевыми тренировками",
    "",
    "Если тренировка утром: углеводный ужин накануне и лёгкий перекус за 30-60 минут.",
    "Если тренировка днём или вечером: нормальный приём пищи за 2-3 часа, при необходимости лёгкий перекус за 30-60 минут.",
    "После тренировки: углеводы + белок в течение часа.",
  ];
}

function pushIssue(
  issues: NutritionTelegramRenderIssue[],
  severity: "error" | "warning",
  rule: string,
  message: string
): void {
  issues.push({ severity, rule, message });
}

export type NutritionDayProseFacts = {
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  carbsGPerKg: number | null;
  proteinGPerKg: number | null;
  /** Optional plan orientation numbers allowed to appear in prose. */
  planTargetNumbers?: number[];
  nutritionStatus: string | null;
  findings: string[];
};

const NUTRITION_HARD_DAY_STATUSES = new Set<string>([
  "low_for_load",
  "below_energy_floor",
  "below_energy_availability",
  "low_for_strength",
  "low_for_cross_training",
  "pre_long_low",
  "long_run_low",
]);

const NUTRITION_HARD_DAY_FINDINGS = new Set<string>([
  "below_load_energy_floor",
  "below_cross_training_floor",
  "below_strength_floor",
  "ea_red_screen",
]);

const NUTRITION_UNDERSHOOT_MARKERS =
  /мал(?:о|ова)|низк|нижн|ниже|недостат|не\s*хвата|нехвата|подтян|добав|просад|недобор|поддерж|скромн|улучш/i;

function roundToNearestStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function buildAllowedNutritionProseNumbers(facts: NutritionDayProseFacts): number[] {
  const allowed: number[] = [];
  const push = (value: number | null | undefined) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      allowed.push(value);
    }
  };
  if (typeof facts.kcal === "number" && Number.isFinite(facts.kcal)) {
    allowed.push(facts.kcal, roundToNearestStep(facts.kcal, 50));
  }
  for (const macro of [facts.proteinG, facts.fatG, facts.carbsG]) {
    if (typeof macro === "number" && Number.isFinite(macro)) {
      allowed.push(macro, roundToNearestStep(macro, 5));
    }
  }
  push(facts.carbsGPerKg);
  push(facts.proteinGPerKg);
  for (const target of facts.planTargetNumbers ?? []) {
    push(target);
  }
  return allowed;
}

function allowedNutritionProseNumberMatches(allowed: number[], value: number): boolean {
  return allowed.some((candidate) => Math.abs(candidate - value) < 0.1);
}

/**
 * Per-day prose validator — the key backstop of the hybrid path (задача 4).
 * 1. number_not_in_facts: every number written in the model prose must be a fact
 *    of that day (kcal/Б/Ж/У/г-на-кг or a plan orientation number). Percentages
 *    are whitelisted. Guards against silent number invention.
 * 2. status_softened: if code assigned a hard day status, the prose must contain
 *    at least one undershoot marker; otherwise the model softened the verdict.
 * On any error the caller falls back to the deterministic comment for that day.
 */
export function validateNutritionDayProse(input: {
  prose: string;
  facts: NutritionDayProseFacts;
}): NutritionTelegramRenderIssue[] {
  const issues: NutritionTelegramRenderIssue[] = [];
  const prose = input.prose;
  const allowed = buildAllowedNutritionProseNumbers(input.facts);
  for (const match of prose.matchAll(/(\d+(?:[.,]\d+)?)(\s*%)?/g)) {
    if (match[2]) {
      continue; // percentages are whitelisted
    }
    const value = Number(match[1].replace(",", "."));
    if (!Number.isFinite(value)) {
      continue;
    }
    if (!allowedNutritionProseNumberMatches(allowed, value)) {
      pushIssue(
        issues,
        "error",
        "number_not_in_facts",
        `Число ${match[1]} в прозе дня отсутствует в фактах этого дня.`
      );
      break;
    }
  }

  const status = input.facts.nutritionStatus;
  const isHardDay =
    (typeof status === "string" && NUTRITION_HARD_DAY_STATUSES.has(status)) ||
    input.facts.findings.some((finding) => NUTRITION_HARD_DAY_FINDINGS.has(finding));
  if (isHardDay && !NUTRITION_UNDERSHOOT_MARKERS.test(prose)) {
    pushIssue(
      issues,
      "error",
      "status_softened",
      "Жёсткий статус дня не отражён в прозе — модель смягчила вывод."
    );
  }
  return issues;
}

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
