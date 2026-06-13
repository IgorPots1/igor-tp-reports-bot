import { getNutritionAdminLocalDate } from "@/features/nutrition/plan-week-policy";
import type { TrainingPeaksTelegramFormality } from "@/features/trainingpeaks/repository";
import type { NutritionNextWeekPlan, NutritionNextWeekPlanDay, NutritionPlanDayType } from "@/features/nutrition/weekly-plan-formulas";
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
    case "race":
      return "🟥";
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
  if (formality === "vy") {
    return `Здравствуйте, ${athleteName}!`;
  }
  return `${athleteName}, привет!`;
}

function formatPlanFocusSectionHeading(mode: NutritionPlanTargetWeekMode): string {
  return mode === "current_week" ? "📌 Фокус на эту неделю" : "📌 Фокус на следующую неделю";
}

function resolveDayLabel(day: NutritionNextWeekPlanDay): string {
  if (day.training_type !== "long_run") {
    return day.training_label || dayTypeRu(day.training_type).toLowerCase();
  }
  const distanceMatch = (day.workout_title ?? day.training_label ?? "").match(/(\d+(?:[,.]\d+)?)\s*(?:км|km)\b/i);
  return distanceMatch ? `длительная ${distanceMatch[1].replace(".", ",")} км` : "длительная";
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

function buildMiniTable(input: {
  nextWeekPlan: NutritionNextWeekPlan;
  planWeekMode: NutritionPlanTargetWeekMode;
  todayLocalDate?: string;
  mode?: "athlete_remaining_only" | "full_week";
}): string[] {
  const days = resolveMiniTableDays(input);
  return days.map((day) => {
    const kcal =
      day.display_target?.kcal_min != null && day.display_target?.kcal_max != null
        ? `~${Math.round(day.display_target.kcal_min)}-${Math.round(day.display_target.kcal_max)} ккал`
        : day.target_kcal != null
          ? formatNutritionAthleteKcal(day.target_kcal, { mode: "target" })
          : "ккал н/д";
    const carbs =
      day.display_target?.carbs_g_min != null && day.display_target?.carbs_g_max != null
        ? `${Math.round(day.display_target.carbs_g_min)}-${Math.round(day.display_target.carbs_g_max)}У`
        : day.carbs_g != null
          ? `${Math.round(day.carbs_g)}У`
          : "У н/д";
    const protein = day.protein_g != null ? `${Math.round(day.protein_g)}Б` : "Б н/д";
    const fat = day.fat_g != null ? `${Math.round(day.fat_g)}Ж` : "Ж н/д";
    return `${dayTypeEmoji(day.training_type)} ${day.weekday_ru} (${formatDateRu(day.date)}) · ${resolveDayLabel(day)} · ${kcal} · ${protein} · ${fat} · ${carbs}`;
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
    "Главный шаг на этой неделе - поднять энергию и углеводы в дни нагрузки, особенно перед ключевой тренировкой.",
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
