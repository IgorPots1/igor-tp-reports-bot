import type { NutritionPlanTargetWeekMode } from "@/features/nutrition/plan-week-policy";
import { isNutritionLongEnduranceWorkout, isNutritionLongRunWorkout } from "@/features/nutrition/long-run";
import type { NutritionNextWeekPlan, NutritionNextWeekPlanDay } from "@/features/nutrition/weekly-plan-formulas";

export type NutritionNarrativeWorkoutRole =
  | "key_interval"
  | "key_tempo"
  | "long_run"
  | "long_endurance"
  | "combined_load"
  | "cross_training"
  | "strength"
  | "easy_run"
  | "rest"
  | "unknown";

export type NarrativePatternId =
  | "low_energy_load"
  | "low_energy_cross"
  | "low_energy_strength"
  | "low_energy_key_interval"
  | "low_energy_key_tempo"
  | "low_carbs_load"
  | "rest_low_energy"
  | "macro_ok"
  | "long_run_low"
  | "pre_long_low";

const INTERVAL_REPEAT_PATTERN = /\b\d+\s*[xх]\s*\d+([,.]\d+)?\s*(мин|min|сек|sec|м|m|км|km)?/i;
const INTERVAL_DISTANCE_PATTERN = /\b\d+\s*[xх]\s*\d{2,4}\s*(м|m)?/i;
const INTERVAL_KEYWORD_PATTERN = /(интервал|interval|vo2|повтор|repeats?)/i;
const TEMPO_KEYWORD_PATTERN = /(темповая|темп|порог|tempo|threshold|lt|пано|панo)/i;

const KEY_ROLE_PRIORITY: NutritionNarrativeWorkoutRole[] = [
  "long_endurance",
  "key_interval",
  "key_tempo",
  "long_run",
  "combined_load",
  "strength",
  "cross_training",
  "easy_run",
  "rest",
  "unknown",
];

export function isKeyIntervalTitle(title: string): boolean {
  const haystack = title.trim();
  if (!haystack) {
    return false;
  }
  return (
    INTERVAL_REPEAT_PATTERN.test(haystack) ||
    INTERVAL_DISTANCE_PATTERN.test(haystack) ||
    INTERVAL_KEYWORD_PATTERN.test(haystack)
  );
}

export function isKeyTempoTitle(title: string): boolean {
  const haystack = title.trim();
  if (!haystack) {
    return false;
  }
  return TEMPO_KEYWORD_PATTERN.test(haystack);
}

export function isCombinedLoadLabel(label: string): boolean {
  const haystack = label.toLocaleLowerCase("ru");
  if (/\+|плюс/.test(haystack)) {
    return true;
  }
  const hasStrength = /силов/.test(haystack);
  const hasRun = /бег|run|пробеж/.test(haystack);
  const hasCross = /\bpadel\b|падел|вело|cycling|bike|кросс/.test(haystack);
  return (hasStrength && hasRun) || (hasCross && hasRun);
}

function extractDurationMinutesFromLabel(label: string): number | null {
  const match = label.match(/(\d+)\s*(?:мин|min)\b/i);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function isCrossTrainingType(trainingType: string, label: string): boolean {
  const haystack = `${trainingType} ${label}`.toLocaleLowerCase("ru");
  return (
    trainingType === "cross_training" ||
    /\bpadel\b|падел|cycling|bike|вело|кросс.?train|crosstrain/.test(haystack)
  );
}

function isStrengthType(trainingType: string, label: string): boolean {
  const haystack = `${trainingType} ${label}`.toLocaleLowerCase("ru");
  return trainingType === "strength" || /силов/.test(haystack);
}

export function resolveNutritionNarrativeWorkoutRole(input: {
  trainingType: string;
  trainingLabel: string;
  durationMinutes?: number | null;
  isCompleted?: boolean | null;
  mode?: "past_review" | "target_plan";
}): { role: NutritionNarrativeWorkoutRole; reason: string } {
  const label = input.trainingLabel.trim();
  const trainingType = input.trainingType;
  const mode = input.mode ?? "past_review";
  const durationMinutes = input.durationMinutes ?? extractDurationMinutesFromLabel(label);

  if (trainingType === "rest" || /день отдыха|день без тренировки/i.test(label)) {
    return { role: "rest", reason: "rest_day" };
  }

  if (isCombinedLoadLabel(label)) {
    return { role: "combined_load", reason: "combined_load_label" };
  }

  if (isKeyTempoTitle(label)) {
    return { role: "key_tempo", reason: "tempo_pattern" };
  }

  if (isKeyIntervalTitle(label)) {
    return { role: "key_interval", reason: "interval_pattern" };
  }
  if (trainingType === "hard" && /\b\d/.test(label)) {
    return { role: "key_interval", reason: "hard_day_numeric_pattern" };
  }

  if (
    trainingType === "long_run" ||
    isNutritionLongRunWorkout({
      title: label,
      durationMinutes,
      isCompleted: input.isCompleted,
      mode,
    })
  ) {
    return { role: "long_run", reason: "long_run_rule" };
  }

  const runLike = trainingType === "easy" || trainingType === "hard" || trainingType === "long_run";
  if (
    isNutritionLongEnduranceWorkout({
      title: label,
      durationMinutes,
      isRunLike: runLike,
    })
  ) {
    return { role: "long_endurance", reason: "long_endurance_rule" };
  }

  if (isStrengthType(trainingType, label)) {
    return { role: "strength", reason: "strength_type" };
  }

  if (isCrossTrainingType(trainingType, label)) {
    return { role: "cross_training", reason: "cross_training_type" };
  }

  if (trainingType === "easy" || trainingType === "unknown") {
    return { role: "easy_run", reason: "easy_type" };
  }

  if (trainingType === "race") {
    return { role: "key_tempo", reason: "race_day" };
  }

  if (trainingType === "hard") {
    return { role: "easy_run", reason: "hard_without_title_evidence" };
  }

  return { role: "unknown", reason: "unknown_type" };
}

export function humanizeNutritionTrainingLabel(trainingLabel: string, trainingType: string): string {
  const raw = trainingLabel.trim();
  if (!raw) {
    return trainingType === "rest" ? "день отдыха" : "день недели";
  }
  if (trainingType === "rest" || /день без тренировки/i.test(raw)) {
    return "день отдыха";
  }
  if (/^padel racket$/i.test(raw) || /\bpadel\b/i.test(raw)) {
    return "падел";
  }
  if (/^cycling$/i.test(raw) || /^bike$/i.test(raw)) {
    return "вело";
  }
  if (/^strength$/i.test(raw)) {
    return "силовая";
  }
  if (/бег в легком темпе/i.test(raw)) {
    return "лёгкий бег";
  }
  if (isCombinedLoadLabel(raw)) {
    return raw
      .replace(/\bCycling\b/gi, "вело")
      .replace(/\bBike\b/gi, "вело")
      .replace(/\bPadel Racket\b/gi, "падел")
      .replace(/\bPadel\b/gi, "падел")
      .replace(/\bStrength\b/gi, "силовая");
  }
  if (isKeyIntervalTitle(raw) || isKeyTempoTitle(raw)) {
    return raw;
  }
  if (trainingType === "long_run") {
    const distanceMatch = raw.match(/(\d+(?:[,.]\d+)?)\s*(?:км|km)\b/i);
    if (distanceMatch) {
      return `длительная ${distanceMatch[1].replace(".", ",")} км`;
    }
    if (/длитель|long\s*run|лонг/i.test(raw)) {
      return raw.replace(/long\s*run/gi, "длительная");
    }
    return "длительная";
  }
  if (/^cycling$/i.test(raw) || /^bike$/i.test(raw) || /вело/i.test(raw)) {
    return "вело";
  }
  return raw;
}

export type NutritionNarrativeDayRoleInfo = {
  role: NutritionNarrativeWorkoutRole;
  isKey: boolean;
  reason: string;
};

export function resolveWeekNarrativeDayRoles(
  days: Array<{
    date: string;
    trainingType: string;
    trainingLabel: string;
    durationMinutes?: number | null;
    isCompleted?: boolean | null;
    mode?: "past_review" | "target_plan";
  }>
): Map<string, NutritionNarrativeDayRoleInfo> {
  const resolved = new Map<string, NutritionNarrativeDayRoleInfo>();
  let weekKeyRole: NutritionNarrativeWorkoutRole | null = null;
  let weekKeyDate: string | null = null;

  for (const day of days) {
    const { role, reason } = resolveNutritionNarrativeWorkoutRole(day);
    resolved.set(day.date, { role, isKey: false, reason });
    if (role === "key_interval" || role === "key_tempo" || role === "long_run" || role === "long_endurance") {
      if (!weekKeyRole || KEY_ROLE_PRIORITY.indexOf(role) < KEY_ROLE_PRIORITY.indexOf(weekKeyRole)) {
        weekKeyRole = role;
        weekKeyDate = day.date;
      }
    }
  }

  if (weekKeyDate && weekKeyRole) {
    const current = resolved.get(weekKeyDate);
    if (current) {
      resolved.set(weekKeyDate, { ...current, isKey: true });
    }
  }

  return resolved;
}

export class NutritionNarrativeRepetitionState {
  readonly usedPatternCounts: Record<NarrativePatternId, number> = {
    low_energy_load: 0,
    low_energy_cross: 0,
    low_energy_strength: 0,
    low_energy_key_interval: 0,
    low_energy_key_tempo: 0,
    low_carbs_load: 0,
    rest_low_energy: 0,
    macro_ok: 0,
    long_run_low: 0,
    pre_long_low: 0,
  };

  readonly phraseCounts: Record<string, number> = {
    too_empty_day: 0,
    protein_closed: 0,
    energy_low: 0,
    carbs_low: 0,
  };

  private exactSentenceCounts = new Map<string, number>();

  bumpPattern(pattern: NarrativePatternId): number {
    this.usedPatternCounts[pattern] += 1;
    return this.usedPatternCounts[pattern];
  }

  canUsePhrase(key: keyof NutritionNarrativeRepetitionState["phraseCounts"], max: number): boolean {
    return this.phraseCounts[key] < max;
  }

  registerPhrase(key: keyof NutritionNarrativeRepetitionState["phraseCounts"]): void {
    this.phraseCounts[key] += 1;
  }

  registerExactSentence(sentence: string): void {
    const normalized = sentence.replace(/\s+/g, " ").trim().toLocaleLowerCase("ru");
    this.exactSentenceCounts.set(normalized, (this.exactSentenceCounts.get(normalized) ?? 0) + 1);
  }

  getExactSentenceCount(sentence: string): number {
    const normalized = sentence.replace(/\s+/g, " ").trim().toLocaleLowerCase("ru");
    return this.exactSentenceCounts.get(normalized) ?? 0;
  }
}

export type MacroGuardrailStatuses = {
  proteinStatus: string | null;
  fatStatus: string | null;
  carbsStatus: string | null;
};

export type NutritionDayCommentComposerInput = {
  trainingType: string;
  trainingLabel: string;
  athleteTrainingLabel: string;
  nutritionStatus: string | null;
  findings: string[];
  macro: MacroGuardrailStatuses;
  hasNutritionCompletenessIssue: boolean;
  hasEnergyIssue: boolean;
  roleInfo: NutritionNarrativeDayRoleInfo;
};

function hasLowCarbs(macro: MacroGuardrailStatuses, loadDay: boolean): boolean {
  return loadDay && (macro.carbsStatus === "low" || macro.carbsStatus === "borderline");
}

function buildMacroNuanceSentence(input: {
  macro: MacroGuardrailStatuses;
  loadDay: boolean;
  hasEnergyIssue: boolean;
  state: NutritionNarrativeRepetitionState;
  patternOccurrence: number;
}): string | null {
  const { macro, loadDay, hasEnergyIssue, state, patternOccurrence } = input;
  if (patternOccurrence >= 3) {
    return null;
  }

  if (hasEnergyIssue && macro.proteinStatus === "ok" && loadDay && hasLowCarbs(macro, loadDay)) {
    if (state.canUsePhrase("protein_closed", 3)) {
      state.registerPhrase("protein_closed");
      if (patternOccurrence >= 2) {
        return "Белок закрыт, но топлива всё равно маловато.";
      }
      return "Белок закрыт, но общей энергии и углеводов всё равно маловато.";
    }
    if (patternOccurrence >= 2) {
      return "Топлива под нагрузку всё равно маловато.";
    }
    return "Общей энергии и углеводов всё равно маловато.";
  }

  const segments: string[] = [];
  if (loadDay && macro.carbsStatus === "low" && state.canUsePhrase("carbs_low", 4)) {
    segments.push("углеводов под нагрузку маловато");
    state.registerPhrase("carbs_low");
  } else if (loadDay && macro.carbsStatus === "borderline") {
    segments.push("углеводы на нижней границе");
  }

  if (macro.proteinStatus === "borderline") {
    segments.push("белок близко к нижней границе");
  } else if (macro.proteinStatus === "low") {
    segments.push("белка в этот день маловато");
  }
  if (macro.fatStatus === "low") {
    segments.push("жиры низковаты");
  } else if (macro.fatStatus === "borderline") {
    segments.push("жиры на нижней границе");
  }

  if (segments.length === 0) {
    return null;
  }
  if (segments.length === 1) {
    const part = segments[0]!;
    if (part.startsWith("углевод")) {
      return part.endsWith(".") ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}.`;
    }
    return `${part.charAt(0).toUpperCase()}${part.slice(1)}.`;
  }
  return `${segments[0]!.charAt(0).toUpperCase()}${segments[0]!.slice(1)}; ${segments.slice(1).join(", ")}.`;
}

function buildLowEnergyPrimarySentence(input: {
  roleInfo: NutritionNarrativeDayRoleInfo;
  athleteTrainingLabel: string;
  state: NutritionNarrativeRepetitionState;
  pattern: NarrativePatternId;
  patternOccurrence: number;
}): string {
  const { roleInfo, athleteTrainingLabel, state, patternOccurrence } = input;
  const keyPrefix = roleInfo.isKey ? "ключевая " : "";

  if (roleInfo.role === "key_interval") {
    if (patternOccurrence >= 3) {
      return "Интервальный день снова вышел низким по энергии.";
    }
    if (patternOccurrence >= 2) {
      return `По интервальной работе (${athleteTrainingLabel}) энергии снова маловато.`;
    }
    if (roleInfo.isKey) {
      return "Это ключевая интервальная работа недели. Под такую тренировку общей энергии и углеводов было маловато, поэтому этот день я бы усилил в первую очередь.";
    }
    return `Это ${keyPrefix}интервальная работа. Под такую тренировку общей энергии и углеводов было маловато.`;
  }

  if (roleInfo.role === "key_tempo") {
    if (patternOccurrence >= 2) {
      return `По темповой работе (${athleteTrainingLabel}) топлива снова маловато.`;
    }
    if (roleInfo.isKey) {
      return "Это ключевая темповая работа. Для неё важны не только белок, но и углеводы до и после тренировки; здесь топлива было маловато.";
    }
    return "Это темповая работа. Для неё важны углеводы до и после тренировки; здесь топлива было маловато.";
  }

  if (roleInfo.role === "combined_load") {
    if (patternOccurrence >= 2) {
      return "При двойной нагрузке день снова вышел скромным по энергии.";
    }
    return "Здесь нагрузка получилась двойная: силовая плюс бег или кросс плюс бег. При такой связке день вышел слишком скромным по энергии.";
  }

  if (roleInfo.role === "cross_training") {
    if (patternOccurrence >= 3) {
      return "По кросс-тренировке снова низкая энергия.";
    }
    if (patternOccurrence >= 2 && /падел/i.test(athleteTrainingLabel)) {
      return "По падлу повторяется тот же паттерн: энергии и углеводов маловато для дня с нагрузкой.";
    }
    if (/падел/i.test(athleteTrainingLabel)) {
      return "Падел тоже даёт нагрузку. Здесь низковаты общая энергия и углеводы.";
    }
    return `${athleteTrainingLabel} тоже даёт нагрузку. Здесь низковаты общая энергия и углеводы.`;
  }

  if (roleInfo.role === "strength") {
    if (patternOccurrence >= 2) {
      return "В день силовой энергии снова маловато для восстановления.";
    }
    return "В день силовой важно оставить достаточно энергии для восстановления. Здесь день получился скромным по ккал.";
  }

  if (roleInfo.role === "rest") {
    return "День отдыха получился низким по энергии. Разово не страшно, но такие дни не стоит делать регулярными.";
  }

  if (roleInfo.role === "easy_run") {
    if (patternOccurrence >= 2) {
      return "Для лёгкого бега день снова вышел низким по энергии.";
    }
    return "Для лёгкого бега день получился низким по энергии.";
  }

  if (patternOccurrence >= 3) {
    return "День с нагрузкой снова вышел низким по энергии.";
  }
  if (patternOccurrence >= 2) {
    return "Для дня с нагрузкой энергии снова маловато.";
  }
  if (state.canUsePhrase("too_empty_day", 2)) {
    state.registerPhrase("too_empty_day");
    return "Для дня с нагрузкой энергии получилось маловато. Я бы не делал этот день слишком пустым по питанию и лучше поддержал питание вокруг тренировки.";
  }
  if (state.canUsePhrase("energy_low", 5)) {
    state.registerPhrase("energy_low");
    return "Для дня с нагрузкой энергии получилось маловато. Лучше поддержать питание вокруг тренировки.";
  }
  return "Для дня с нагрузкой энергии получилось маловато.";
}

function resolveLowEnergyPattern(roleInfo: NutritionNarrativeDayRoleInfo): NarrativePatternId {
  switch (roleInfo.role) {
    case "key_interval":
      return "low_energy_key_interval";
    case "key_tempo":
      return "low_energy_key_tempo";
    case "long_endurance":
      return "low_energy_load";
    case "cross_training":
      return "low_energy_cross";
    case "strength":
      return "low_energy_strength";
    case "rest":
      return "rest_low_energy";
    default:
      return "low_energy_load";
  }
}

export function composeNutritionDayComment(
  input: NutritionDayCommentComposerInput,
  state: NutritionNarrativeRepetitionState
): string {
  const { macro, hasEnergyIssue, roleInfo, athleteTrainingLabel, hasNutritionCompletenessIssue } = input;
  const cautiousPrefix = hasNutritionCompletenessIssue
    ? "Данные по питанию за день неполные, поэтому вывод короткий. "
    : "";
  const loadDay = roleInfo.role !== "rest";

  if (input.nutritionStatus === "suspect") {
    return "Данные по питанию за день выглядят неполными или нетипичными, поэтому здесь лучше проверить исходный отчёт вручную.";
  }

  if (input.nutritionStatus === "pre_long_low") {
    state.bumpPattern("pre_long_low");
    return `${cautiousPrefix}Это день перед длинной нагрузкой: для такой подготовки углеводы на нижней границе, накануне длинной работы лучше не просаживать топливо.`;
  }

  if (
    input.nutritionStatus === "long_run_low" ||
    (hasEnergyIssue && (roleInfo.role === "long_run" || roleInfo.role === "long_endurance"))
  ) {
    const occurrence = state.bumpPattern("long_run_low");
    const primary =
      occurrence >= 2
      ? "На длинную работу день снова вышел скромным по энергии."
      : "На длинную работу день получился скромным по энергии: запас топлива и восстановление могли быть лучше.";
    const macroSentence = buildMacroNuanceSentence({
      macro,
      loadDay: true,
      hasEnergyIssue: true,
      state,
      patternOccurrence: occurrence,
    });
    return macroSentence ? `${cautiousPrefix}${primary} ${macroSentence}` : `${cautiousPrefix}${primary}`;
  }

  if (hasEnergyIssue) {
    const pattern = resolveLowEnergyPattern(roleInfo);
    const occurrence = state.bumpPattern(pattern);
    const primary = buildLowEnergyPrimarySentence({
      roleInfo,
      athleteTrainingLabel,
      state,
      pattern,
      patternOccurrence: occurrence,
    });
    const macroSentence = buildMacroNuanceSentence({
      macro,
      loadDay,
      hasEnergyIssue: true,
      state,
      patternOccurrence: occurrence,
    });
    const combined = macroSentence ? `${primary} ${macroSentence}` : primary;
    state.registerExactSentence(combined);
    return `${cautiousPrefix}${combined}`;
  }

  if (macro.fatStatus === "low" || input.nutritionStatus === "low_fat" || input.findings.includes("fat_below_floor")) {
    return `${cautiousPrefix}Жиров в этот день получилось низковато. Не нужно специально держать такие дни слишком сухими по жирам, особенно если они повторяются.`;
  }

  if (input.nutritionStatus === "low_protein" || input.findings.includes("protein_low")) {
    return `${cautiousPrefix}Белок в этот день чуть ниже ориентира. Поддержи базовый белок, но главный фокус всё равно на ровной энергии и углеводах под нагрузку.`;
  }

  if (hasLowCarbs(macro, loadDay) && !hasEnergyIssue) {
    const occurrence = state.bumpPattern("low_carbs_load");
    const primary =
      roleInfo.role === "cross_training"
        ? /падел/i.test(athleteTrainingLabel)
          ? "Падел тоже даёт нагрузку. Углеводов для такого дня низковато."
          : `${athleteTrainingLabel} тоже нагрузка. Углеводов для такого дня низковато.`
        : roleInfo.role === "key_interval" && roleInfo.isKey
          ? "Это ключевая интервальная работа недели. Углеводов под такую нагрузку маловато."
          : roleInfo.role === "key_tempo" && roleInfo.isKey
            ? "Это ключевая темповая работа. Углеводов под такую нагрузку маловато."
            : "Углеводов для такой нагрузки маловато.";
    const macroSentence = buildMacroNuanceSentence({
      macro,
      loadDay,
      hasEnergyIssue: false,
      state,
      patternOccurrence: occurrence,
    });
    return macroSentence ? `${cautiousPrefix}${primary} ${macroSentence}` : `${cautiousPrefix}${primary}`;
  }

  if (roleInfo.role === "rest") {
    if (macro.proteinStatus === "ok" && macro.carbsStatus === "ok" && macro.fatStatus === "ok") {
      state.bumpPattern("macro_ok");
      if (state.canUsePhrase("protein_closed", 3)) {
        state.registerPhrase("protein_closed");
        return `${cautiousPrefix}Для дня отдыха питание выглядит ровно: энергии достаточно, белок закрыт, сильных перекосов по БЖУ не видно.`;
      }
      return `${cautiousPrefix}Для дня отдыха питание выглядит ровно: энергии достаточно, сильных перекосов по БЖУ не видно.`;
    }
    if (input.findings.includes("protein_sufficient")) {
      if (state.canUsePhrase("protein_closed", 3)) {
        state.registerPhrase("protein_closed");
        return `${cautiousPrefix}День отдыха получился спокойным: белок закрыт хорошо, явного конфликта между питанием и нагрузкой нет.`;
      }
      return `${cautiousPrefix}День отдыха получился спокойным: явного конфликта между питанием и нагрузкой нет.`;
    }
    return `${cautiousPrefix}День отдыха. По питанию всё спокойно, здесь ничего специально менять не нужно.`;
  }

  if (roleInfo.role === "key_interval" && roleInfo.isKey) {
    state.bumpPattern("macro_ok");
    return `${cautiousPrefix}Это ключевая интервальная работа недели, и по питанию день получился хорошо поддержан. Углеводов было достаточно для такой нагрузки, сильной просадки по энергии не видно.`;
  }

  if (roleInfo.role === "key_tempo" && roleInfo.isKey) {
    state.bumpPattern("macro_ok");
    return `${cautiousPrefix}Это ключевая темповая работа, и по питанию день выглядит ровно: углеводов достаточно, сильной просадки по энергии не видно.`;
  }

  if (roleInfo.role === "easy_run") {
    if (macro.proteinStatus === "ok" && macro.carbsStatus === "ok" && macro.fatStatus === "ok") {
      state.bumpPattern("macro_ok");
      return `${cautiousPrefix}Под лёгкую работу день выглядит нормально: энергии и углеводов достаточно, здесь ничего специально менять не нужно.`;
    }
    return `${cautiousPrefix}Под лёгкую работу день выглядит нормально: энергии и углеводов достаточно.`;
  }

  if (roleInfo.role === "combined_load") {
    state.bumpPattern("macro_ok");
    return `${cautiousPrefix}Здесь нагрузка двойная (${athleteTrainingLabel}). По питанию день выглядит достаточно ровно: энергии и углеводов хватает для такой связки.`;
  }

  if (roleInfo.role === "long_endurance") {
    state.bumpPattern("macro_ok");
    return `${cautiousPrefix}Под длинную выносливостную нагрузку день выглядит достаточно ровно: сильной просадки по энергии и углеводам не видно.`;
  }

  if (roleInfo.role === "cross_training") {
    state.bumpPattern("macro_ok");
    return `${cautiousPrefix}Под ${athleteTrainingLabel} день выглядит достаточно ровно: сильной просадки по энергии и углеводам не видно.`;
  }

  if (roleInfo.role === "long_run") {
    state.bumpPattern("macro_ok");
    return `${cautiousPrefix}Под длинную работу день выглядит достаточно ровно: сильной просадки по энергии и углеводам не видно.`;
  }

  if (roleInfo.role === "key_interval" || roleInfo.role === "key_tempo") {
    state.bumpPattern("macro_ok");
    return `${cautiousPrefix}Под эту ключевую работу питание выглядит согласованно: сильной просадки по дню не видно.`;
  }

  if (input.findings.includes("protein_sufficient") && macro.fatStatus === "ok" && macro.carbsStatus === "ok") {
    state.bumpPattern("macro_ok");
    return `${cautiousPrefix}Белок в этот день закрыт хорошо, по нагрузке и питанию явного конфликта не видно.`;
  }

  state.bumpPattern("macro_ok");
  return `${cautiousPrefix}День выглядит ровно, здесь ничего специально менять не нужно.`;
}

export type NutritionWeeklySummaryDayFact = {
  date: string;
  trainingType: string;
  trainingLabel: string;
  nutritionStatus: string | null;
  findings: string[];
  macro: MacroGuardrailStatuses;
  hasEnergyIssue: boolean;
  roleInfo: NutritionNarrativeDayRoleInfo;
};

export function buildNutritionWeeklySummary(input: {
  days: NutritionWeeklySummaryDayFact[];
  proteinSufficient?: boolean;
  weeklyProteinAvgGPerKg?: number | null;
}): string {
  let proteinOkDays = 0;
  let proteinLowOrBorderlineDays = 0;
  let fatLowOrBorderlineDays = 0;
  let carbsLowLoadDays = 0;
  let energyLowLoadDays = 0;
  let keyWorkoutLabel: string | null = null;
  let mainLoadLabel: string | null = null;
  let hardestDayLabels: string[] = [];
  let carbRichDayLabels: string[] = [];

  for (const day of input.days) {
    const loadDay = day.roleInfo.role !== "rest";
    if (day.macro.proteinStatus === "ok") {
      proteinOkDays += 1;
    } else if (day.macro.proteinStatus === "low" || day.macro.proteinStatus === "borderline") {
      proteinLowOrBorderlineDays += 1;
    }
    if (day.macro.fatStatus === "low" || day.macro.fatStatus === "borderline") {
      fatLowOrBorderlineDays += 1;
    }
    if (loadDay && (day.macro.carbsStatus === "low" || day.macro.carbsStatus === "borderline")) {
      carbsLowLoadDays += 1;
    }
    if (day.hasEnergyIssue && loadDay) {
      energyLowLoadDays += 1;
    }
    if (day.roleInfo.isKey) {
      keyWorkoutLabel = humanizeNutritionTrainingLabel(day.trainingLabel, day.trainingType);
    }
    if (
      !mainLoadLabel &&
      (day.roleInfo.role === "long_endurance" ||
        day.roleInfo.role === "long_run" ||
        day.roleInfo.role === "key_interval" ||
        day.roleInfo.role === "key_tempo" ||
        day.roleInfo.role === "combined_load")
    ) {
      mainLoadLabel = humanizeNutritionTrainingLabel(day.trainingLabel, day.trainingType);
    }
  }

  const sortedByCarbs = [...input.days]
    .filter((day) => typeof day.macro.carbsStatus === "string")
    .sort((left, right) => {
      const leftScore = left.macro.carbsStatus === "ok" ? 2 : left.macro.carbsStatus === "borderline" ? 1 : 0;
      const rightScore = right.macro.carbsStatus === "ok" ? 2 : right.macro.carbsStatus === "borderline" ? 1 : 0;
      return rightScore - leftScore;
    })
    .slice(0, 2);
  carbRichDayLabels = sortedByCarbs.map((day) => humanizeNutritionTrainingLabel(day.trainingLabel, day.trainingType));
  hardestDayLabels = input.days
    .filter(
      (day) =>
        day.roleInfo.role === "key_interval" ||
        day.roleInfo.role === "key_tempo" ||
        day.roleInfo.role === "long_run" ||
        day.roleInfo.role === "long_endurance" ||
        day.roleInfo.role === "combined_load"
    )
    .map((day) => humanizeNutritionTrainingLabel(day.trainingLabel, day.trainingType));

  const segments: string[] = [];

  if (energyLowLoadDays >= 3 || (energyLowLoadDays >= 2 && carbsLowLoadDays >= 2)) {
    segments.push("Главный паттерн недели: дни с нагрузкой часто получались низкими по энергии и углеводам.");
  } else if (energyLowLoadDays > 0 || carbsLowLoadDays > 0) {
    segments.push("Главный фокус: сделать дни с нагрузкой не такими «пустыми» по энергии и углеводам.");
  } else {
    segments.push("Главный момент недели — держать энергию ровнее вокруг ключевых тренировок.");
  }

  const proteinAvgOk = (input.weeklyProteinAvgGPerKg ?? 0) >= 1.5 || input.proteinSufficient;
  if (proteinAvgOk) {
    segments.push("Белок в среднем держится хорошо, это не главный вопрос недели.");
  } else if (proteinLowOrBorderlineDays >= 2) {
    segments.push("Белок в целом ближе к нижней границе.");
  } else if (proteinOkDays > proteinLowOrBorderlineDays) {
    segments.push("Белок в целом ближе к норме, но он не компенсирует просадки по общей энергии и углеводам.");
  }

  if (fatLowOrBorderlineDays >= 2) {
    segments.push("Жиры тоже несколько раз были на нижней границе.");
  }

  if (carbRichDayLabels.length > 0 && hardestDayLabels.length > 0) {
    const overlap = carbRichDayLabels.some((label) => hardestDayLabels.includes(label));
    if (!overlap) {
      segments.push("Лучшие по углеводам дни пришлись не на самые тяжёлые тренировки.");
    }
  }
  if (carbsLowLoadDays >= 2) {
    segments.push("Самые тяжёлые дни вышли с углеводами на нижней границе.");
  }

  if (keyWorkoutLabel) {
    segments.push(
      `Главный тренировочный день недели — ${keyWorkoutLabel}. Именно вокруг таких работ питание стоит поддерживать лучше всего.`
    );
  } else if (mainLoadLabel) {
    segments.push(
      `Главный тренировочный день недели — ${mainLoadLabel}. Именно вокруг такой нагрузки питание стоит поддерживать лучше всего.`
    );
  }

  return segments.join(" ");
}

function resolveTargetPlanDayRole(day: NutritionNextWeekPlanDay): NutritionNarrativeDayRoleInfo {
  const { role, reason } = resolveNutritionNarrativeWorkoutRole({
    trainingType: day.training_type,
    trainingLabel: day.workout_title ?? day.training_label,
    mode: "target_plan",
    isCompleted: false,
  });
  return { role, isKey: day.flags?.key_workout === true, reason };
}

export function buildNutritionTargetWeekFocusNarrative(
  nextWeekPlan: NutritionNextWeekPlan | null,
  planWeekMode: NutritionPlanTargetWeekMode
): string[] {
  if (!nextWeekPlan || nextWeekPlan.days.length === 0) {
    return [];
  }

  const weekLabel = planWeekMode === "current_week" ? "на эту неделю" : "на следующую неделю";
  const lines: string[] = [
    `Фокус ${weekLabel} — не резко увеличивать всё питание, а лучше поддержать дни нагрузки.`,
  ];

  const keyIntervalDay = nextWeekPlan.days.find((day) => {
    const role = resolveTargetPlanDayRole(day);
    return role.role === "key_interval" && (role.isKey || day.flags?.key_workout);
  });
  const longRunDay = nextWeekPlan.days.find((day) => {
    const role = resolveTargetPlanDayRole(day);
    return (
      role.role === "long_run" &&
      isNutritionLongRunWorkout({
        title: day.workout_title ?? day.training_label,
        mode: "target_plan",
        isCompleted: false,
      })
    );
  });

  const onlyEasyCrossRest = nextWeekPlan.days.every((day) => {
    const role = resolveTargetPlanDayRole(day).role;
    return role === "easy_run" || role === "cross_training" || role === "rest";
  });

  if (keyIntervalDay) {
    const label = humanizeNutritionTrainingLabel(
      keyIntervalDay.workout_title ?? keyIntervalDay.training_label,
      keyIntervalDay.training_type
    );
    lines.push(`Особенно важен день с ${label}: к нему лучше подойти не «пустой» по энергии и углеводам.`);
  } else if (longRunDay) {
    lines.push("Особенно важна длительная: к ней готовимся заранее, но цифры ниже — ориентиры, не обязательство.");
  } else if (onlyEasyCrossRest) {
    lines.push("Фокус — сделать дни с нагрузкой ровнее, без резкого увеличения всех цифр.");
  }

  return lines;
}

export function findTargetWeekKeyIntervalLabel(nextWeekPlan: NutritionNextWeekPlan | null): string | null {
  if (!nextWeekPlan) {
    return null;
  }
  const keyDay =
    nextWeekPlan.days.find((day) => isKeyIntervalTitle(day.workout_title ?? day.training_label)) ??
    nextWeekPlan.days.find((day) => day.flags?.key_workout && day.training_type === "hard");
  if (!keyDay) {
    return null;
  }
  return humanizeNutritionTrainingLabel(keyDay.workout_title ?? keyDay.training_label, keyDay.training_type);
}

export function targetWeekHasLongRun(nextWeekPlan: NutritionNextWeekPlan | null): boolean {
  if (!nextWeekPlan) {
    return false;
  }
  return nextWeekPlan.days.some((day) =>
    isNutritionLongRunWorkout({
      title: day.workout_title ?? day.training_label,
      mode: "target_plan",
      isCompleted: false,
    })
  );
}
