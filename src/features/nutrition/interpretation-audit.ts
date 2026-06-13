import { createHash } from "node:crypto";

import {
  countForbiddenInterpretationTerms,
  countMacroNumberWarnings,
  type NutritionInterpretationValidationFacts,
  type NutritionInterpretationValidationIssue,
  type NutritionWeeklyInterpretation,
} from "@/features/nutrition/interpretation-contract";
import { NUTRITION_PRACTICAL_TARGET_REQUIRED_WORDING } from "@/features/nutrition/narrative-guardrails";

/**
 * Deterministic audit helpers for comparing the current derived nutrition
 * composer output against the shadow interpretation contract output.
 *
 * This module is intentionally side-effect free (no DB, no network, no fs)
 * so it can be unit-tested by check-nutrition-interpretation-shadow-audit.
 */

export const NUTRITION_AUDIT_VERDICTS = [
  "shadow_candidate",
  "derived_better",
  "needs_prompt_tuning",
  "blocked",
] as const;

export type NutritionAuditVerdict = (typeof NUTRITION_AUDIT_VERDICTS)[number];

const GREETING_PATTERNS = [/привет/i, /здравствуй/i, /добрый день/i, /добрый вечер/i];
const CLOSING_PATTERNS = [/на следующем разборе/i, /до встречи/i, /хорошей недели/i];
const MINI_TABLE_PATTERNS = [/📋/, /🟦/, /🟩/, /🟧/, /🟥/, /мини-таблиц/i];
const PLAN_TARGET_SECTION_PATTERNS = [
  /ккал\s*·\s*Б\s*·\s*Ж\s*·\s*У/i,
  /цифры ниже\s*[—-]\s*ориентиры/i,
];
const NEEDS_REVIEW_LEAK_PATTERNS = [
  /needs[_\s-]?review/i,
  /перегенерир/i,
  /перепроверь/i,
  /перепроверить/i,
  /не показываю/i,
  /не сформирован/i,
];

const KEY_WORKOUT_TEXT_PATTERNS = [
  /интервал/i,
  /темп/i,
  /порог/i,
  /длительн/i,
  /длинн/i,
  /long\s*run/i,
  /ключев/i,
];
const LONG_RUN_TEXT_PATTERNS = [/длительн/i, /длинн(?:ый|ая|ого|ую)?\s+бег/i, /long\s*run/i];
const LONG_ENDURANCE_TEXT_PATTERNS = [/вело/i, /\bbike\b/i, /cycling/i, /длинн(?:ая|ый)\s+нагруз/i, /5[:.]\d{2}/];
const SHADOW_LIGHT_DAY_PATTERNS = [/л[её]гк(?:ий|ая)\s+день/i, /день\s+отдыха/i, /свободн(?:ый|ая)\s+день/i];
const MANUAL_REVIEW_PHRASES = [/нужен\s+ручной\s+разбор/i, /данных?\s+недостаточно/i, /не\s+могу\s+точно/i];

const GENERIC_COMMENT_PATTERNS = [
  /питание выглядит относительно ровно/i,
  /питание нормальное/i,
  /выглядит ровно относительно нагрузки/i,
  /держим текущий ритм/i,
];

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function shortHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

export function countRepeatedSentences(text: string): number {
  const counts = new Map<string, number>();
  for (const sentence of splitSentences(text)) {
    const key = sentence.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
    if (key.length < 12) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let repeated = 0;
  for (const value of counts.values()) {
    if (value > 1) {
      repeated += value - 1;
    }
  }
  return repeated;
}

function countMatches(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      count += 1;
    }
  }
  return count;
}

function anyMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export type CanonicalDayFact = {
  date: string;
  trainingLabel: string | null;
  isKeyWorkout: boolean;
  isLongRun: boolean;
  isLongEndurance: boolean;
  role: string;
};

export type CanonicalFactsReadiness = {
  dailyCount: number;
  dayFacts: CanonicalDayFact[];
  keyWorkoutDates: string[];
  longRunDates: string[];
  longEnduranceDays: string[];
  missingNutritionTrainingDays: string[];
  adjacentTrainingWithoutNutritionDays: string[];
  mainLoadDay: string | null;
  carbPlacementInsight: string | null;
  macroGuardrails: boolean;
  energyAvailability: boolean;
  coachContextPresent: boolean;
  athleteSignalsCount: number;
  previousWeeksContextPresent: boolean;
};

function dayIsKeyWorkout(day: Record<string, unknown>): boolean {
  const flags = asObject(day.flags);
  if (flags.hard === true || flags.longRun === true || flags.longEndurance === true) {
    return true;
  }
  if (day.isHardSession === true || day.isLongRun === true) {
    return true;
  }
  return day.workoutIntensity === "high";
}

function dayIsLongRun(day: Record<string, unknown>): boolean {
  const flags = asObject(day.flags);
  return flags.longRun === true || day.isLongRun === true;
}

function dayIsLongEndurance(day: Record<string, unknown>): boolean {
  const flags = asObject(day.flags);
  const trainingType = typeof day.training_type === "string" ? day.training_type : typeof day.trainingType === "string" ? day.trainingType : "";
  return flags.longEndurance === true || trainingType === "long_endurance";
}

function dayHasMacroGuardrails(day: Record<string, unknown>): boolean {
  const canonical = asObject(day.canonical_daily_analysis ?? day.canonicalDailyAnalysis);
  const guard = day.macro_guardrails ?? day.macroGuardrails ?? canonical.macroGuardrails;
  return Boolean(guard && typeof guard === "object");
}

function dayHasEnergyAvailability(day: Record<string, unknown>): boolean {
  const canonical = asObject(day.canonical_daily_analysis ?? day.canonicalDailyAnalysis);
  const ea = day.energy_availability ?? day.energyAvailability ?? canonical.energyAvailability;
  return Boolean(ea && typeof ea === "object");
}

/**
 * Extract canonical daily facts from a stored review summary or a synthetic
 * facts payload. Accepts the raw daily_analysis array.
 */
export function extractCanonicalDayFacts(dailyAnalysis: unknown): CanonicalDayFact[] {
  const rows = Array.isArray(dailyAnalysis) ? dailyAnalysis : [];
  const facts: CanonicalDayFact[] = [];
  for (const raw of rows) {
    const day = asObject(raw);
    const date = typeof day.date === "string" ? day.date : null;
    if (!date) {
      continue;
    }
    const trainingLabel =
      (typeof day.training_label === "string" && day.training_label) ||
      (typeof day.trainingLabel === "string" && day.trainingLabel) ||
      (typeof day.workoutTitle === "string" && day.workoutTitle) ||
      null;
    facts.push({
      date,
      trainingLabel: trainingLabel || null,
      isKeyWorkout: dayIsKeyWorkout(day),
      isLongRun: dayIsLongRun(day),
      isLongEndurance: dayIsLongEndurance(day),
      role:
        (typeof day.training_type === "string" && day.training_type) ||
        (typeof day.trainingType === "string" && day.trainingType) ||
        "unknown",
    });
  }
  return facts;
}

export function buildCanonicalFactsReadiness(input: {
  dailyAnalysis: unknown;
  coachContextPresent: boolean;
  athleteSignalsCount: number;
  previousWeeksContextPresent: boolean;
}): CanonicalFactsReadiness {
  const rows = Array.isArray(input.dailyAnalysis) ? input.dailyAnalysis : [];
  const dayFacts = extractCanonicalDayFacts(input.dailyAnalysis);
  const missingNutritionTrainingDays = rows
    .map((raw) => asObject(raw))
    .filter((day) => {
      const sourceQuality = asObject(day.source_quality ?? day.sourceQuality);
      const hasNutritionData = sourceQuality.hasNutritionData;
      return hasNutritionData === false && dayIsKeyWorkout(day);
    })
    .map((day) => (typeof day.date === "string" ? day.date : ""))
    .filter(Boolean);
  const longEnduranceDays = dayFacts.filter((day) => day.isLongEndurance).map((day) => day.date);
  const mainLoadDay =
    dayFacts.find((day) => day.isLongEndurance)?.date ??
    dayFacts.find((day) => day.isLongRun)?.date ??
    dayFacts.find((day) => day.isKeyWorkout)?.date ??
    null;
  const carbPlacementInsight =
    dayFacts.length >= 5 && dayFacts.some((day) => day.isKeyWorkout)
      ? "needs_alignment_check"
      : null;
  let macroGuardrails = false;
  let energyAvailability = false;
  for (const raw of rows) {
    const day = asObject(raw);
    if (dayHasMacroGuardrails(day)) {
      macroGuardrails = true;
    }
    if (dayHasEnergyAvailability(day)) {
      energyAvailability = true;
    }
  }
  return {
    dailyCount: dayFacts.length,
    dayFacts,
    keyWorkoutDates: dayFacts.filter((day) => day.isKeyWorkout).map((day) => day.date),
    longRunDates: dayFacts.filter((day) => day.isLongRun).map((day) => day.date),
    longEnduranceDays,
    missingNutritionTrainingDays,
    adjacentTrainingWithoutNutritionDays: [],
    mainLoadDay,
    carbPlacementInsight,
    macroGuardrails,
    energyAvailability,
    coachContextPresent: input.coachContextPresent,
    athleteSignalsCount: input.athleteSignalsCount,
    previousWeeksContextPresent: input.previousWeeksContextPresent,
  };
}

export type ProductionTextMetrics = {
  textHash: string;
  charCount: number;
  warnings: string[];
  forbiddenTermCounts: Record<string, number>;
  repeatedPhraseCounts: number;
  keyWorkoutMentions: number;
  longRunMentions: number;
  practicalTargetWordingPresent: boolean;
};

export function analyzeProductionText(input: {
  text: string | null;
  warnings: string[];
}): ProductionTextMetrics {
  const text = input.text ?? "";
  return {
    textHash: text ? shortHash(text) : "",
    charCount: text.length,
    warnings: input.warnings,
    forbiddenTermCounts: countForbiddenInterpretationTerms(text),
    repeatedPhraseCounts: countRepeatedSentences(text),
    keyWorkoutMentions: countMatches(text, KEY_WORKOUT_TEXT_PATTERNS),
    longRunMentions: countMatches(text, LONG_RUN_TEXT_PATTERNS),
    practicalTargetWordingPresent: NUTRITION_PRACTICAL_TARGET_REQUIRED_WORDING.some((wording) =>
      text.includes(wording)
    ),
  };
}

export type ShadowMetrics = {
  mode: string;
  validationOk: boolean;
  issueCounts: { error: number; warning: number };
  dailyBlockCount: number;
  weekComparisonAllowed: boolean;
  weekComparisonPresent: boolean;
  macroNumberWarnings: number;
  forbiddenTermCounts: Record<string, number>;
  commentLengthStats: { min: number; max: number; avg: number };
};

function collectAllowedMacroValues(facts: NutritionInterpretationValidationFacts): number[] {
  const values: number[] = [];
  for (const date of facts.dailyDates) {
    const macros = facts.dayMacroValuesByDate[date];
    if (!macros) {
      continue;
    }
    for (const value of [macros.kcal, macros.proteinG, macros.fatG, macros.carbsG]) {
      if (value != null && Number.isFinite(value)) {
        values.push(value);
      }
    }
  }
  return values;
}

export function shadowInterpretationText(
  interpretation: NutritionWeeklyInterpretation | null
): string {
  if (!interpretation) {
    return "";
  }
  const parts: string[] = [];
  for (const block of interpretation.daily_blocks) {
    parts.push(block.comment_ru);
  }
  parts.push(interpretation.week_summary_ru);
  parts.push(interpretation.one_focus_statement_ru);
  if (interpretation.week_comparison_line_ru) {
    parts.push(interpretation.week_comparison_line_ru);
  }
  return parts.join("\n");
}

export function analyzeShadowInterpretation(input: {
  mode: string;
  interpretation: NutritionWeeklyInterpretation | null;
  issues: NutritionInterpretationValidationIssue[];
  facts: NutritionInterpretationValidationFacts;
}): ShadowMetrics {
  const interpretation = input.interpretation;
  const text = shadowInterpretationText(interpretation);
  const commentLengths = (interpretation?.daily_blocks ?? []).map((block) => block.comment_ru.length);
  const min = commentLengths.length > 0 ? Math.min(...commentLengths) : 0;
  const max = commentLengths.length > 0 ? Math.max(...commentLengths) : 0;
  const avg =
    commentLengths.length > 0
      ? Math.round(commentLengths.reduce((sum, value) => sum + value, 0) / commentLengths.length)
      : 0;
  return {
    mode: input.mode,
    validationOk: input.issues.every((issue) => issue.severity !== "error"),
    issueCounts: {
      error: input.issues.filter((issue) => issue.severity === "error").length,
      warning: input.issues.filter((issue) => issue.severity === "warning").length,
    },
    dailyBlockCount: interpretation?.daily_blocks.length ?? 0,
    weekComparisonAllowed: input.facts.hasPreviousWeeksContext,
    weekComparisonPresent: Boolean(interpretation?.week_comparison_line_ru),
    macroNumberWarnings: countMacroNumberWarnings(text, collectAllowedMacroValues(input.facts)),
    forbiddenTermCounts: countForbiddenInterpretationTerms(text),
    commentLengthStats: { min, max, avg },
  };
}

export type ComparisonResult = {
  dailyCoverageMatch: boolean;
  shadowHasGreeting: boolean;
  shadowHasMiniTable: boolean;
  shadowHasClosing: boolean;
  shadowHasPlanTargetSection: boolean;
  shadowMentionsKeyWorkout: boolean;
  shadowMentionsLongEndurance: boolean;
  shadowRepeatsNeedsReview: boolean;
  shadowHasPhantomComparison: boolean;
  shadowGenericCommentCount: number;
  shadowBetterSignals: string[];
  shadowRiskSignals: string[];
  verdict: NutritionAuditVerdict;
};

function shadowMentionsKeyWorkout(
  interpretation: NutritionWeeklyInterpretation | null,
  keyWorkoutDates: string[]
): boolean {
  if (!interpretation || keyWorkoutDates.length === 0) {
    return true; // no key workout to mention => trivially satisfied
  }
  const blocksByDate = new Map(interpretation.daily_blocks.map((block) => [block.date, block.comment_ru]));
  for (const date of keyWorkoutDates) {
    const comment = blocksByDate.get(date);
    if (comment && anyMatch(comment, KEY_WORKOUT_TEXT_PATTERNS)) {
      return true;
    }
  }
  // Fallback: any mention anywhere in the interpretation text.
  return anyMatch(shadowInterpretationText(interpretation), KEY_WORKOUT_TEXT_PATTERNS);
}

function shadowMentionsLongEndurance(
  interpretation: NutritionWeeklyInterpretation | null,
  longEnduranceDays: string[]
): boolean {
  if (!interpretation || longEnduranceDays.length === 0) {
    return true;
  }
  const blocksByDate = new Map(interpretation.daily_blocks.map((block) => [block.date, block.comment_ru]));
  for (const date of longEnduranceDays) {
    const comment = blocksByDate.get(date);
    if (comment && anyMatch(comment, LONG_ENDURANCE_TEXT_PATTERNS)) {
      return true;
    }
  }
  return anyMatch(shadowInterpretationText(interpretation), LONG_ENDURANCE_TEXT_PATTERNS);
}

function hasShadowDayRoleMismatch(input: {
  interpretation: NutritionWeeklyInterpretation | null;
  dayFacts: CanonicalDayFact[];
}): boolean {
  if (!input.interpretation) {
    return false;
  }
  const blocksByDate = new Map(input.interpretation.daily_blocks.map((block) => [block.date, block.comment_ru]));
  return input.dayFacts.some((fact) => {
    if (!fact.isKeyWorkout && !fact.isLongEndurance) {
      return false;
    }
    const comment = blocksByDate.get(fact.date);
    if (!comment) {
      return false;
    }
    return anyMatch(comment, SHADOW_LIGHT_DAY_PATTERNS);
  });
}

function hasUnnecessaryManualReview(input: {
  interpretation: NutritionWeeklyInterpretation | null;
  readiness: CanonicalFactsReadiness;
}): boolean {
  if (!input.interpretation) {
    return false;
  }
  const sufficientFacts =
    input.readiness.dailyCount >= 5 &&
    input.readiness.macroGuardrails &&
    input.readiness.energyAvailability;
  if (!sufficientFacts) {
    return false;
  }
  const text = `${input.interpretation.one_focus_statement_ru}\n${input.interpretation.week_summary_ru}`;
  return anyMatch(text, MANUAL_REVIEW_PHRASES);
}

function countGenericComments(interpretation: NutritionWeeklyInterpretation | null): number {
  if (!interpretation) {
    return 0;
  }
  let count = 0;
  for (const block of interpretation.daily_blocks) {
    if (anyMatch(block.comment_ru, GENERIC_COMMENT_PATTERNS) || block.comment_ru.length < 24) {
      count += 1;
    }
  }
  return count;
}

export function compareNutritionOutputs(input: {
  production: ProductionTextMetrics;
  shadow: ShadowMetrics;
  interpretation: NutritionWeeklyInterpretation | null;
  readiness: CanonicalFactsReadiness;
}): ComparisonResult {
  const { production, shadow, interpretation, readiness } = input;
  const shadowText = shadowInterpretationText(interpretation);
  const dailyCoverageMatch =
    interpretation != null && interpretation.daily_blocks.length === readiness.dailyCount;

  const shadowHasGreeting = anyMatch(shadowText, GREETING_PATTERNS);
  const shadowHasClosing = anyMatch(shadowText, CLOSING_PATTERNS);
  const shadowHasMiniTable = anyMatch(shadowText, MINI_TABLE_PATTERNS);
  const shadowHasPlanTargetSection = anyMatch(shadowText, PLAN_TARGET_SECTION_PATTERNS);
  const mentionsKeyWorkout = shadowMentionsKeyWorkout(interpretation, readiness.keyWorkoutDates);
  const mentionsLongEndurance = shadowMentionsLongEndurance(interpretation, readiness.longEnduranceDays);
  const repeatsNeedsReview = anyMatch(shadowText, NEEDS_REVIEW_LEAK_PATTERNS);
  const phantomComparison = !readiness.previousWeeksContextPresent && shadow.weekComparisonPresent;
  const genericCommentCount = countGenericComments(interpretation);
  const roleMismatch = hasShadowDayRoleMismatch({
    interpretation,
    dayFacts: readiness.dayFacts,
  });
  const unnecessaryManualReview = hasUnnecessaryManualReview({ interpretation, readiness });
  const shadowForbiddenCount = Object.keys(shadow.forbiddenTermCounts).length;

  const shadowRepetition = countRepeatedSentences(shadowText);
  const lessRepetitive = shadowRepetition <= production.repeatedPhraseCounts;

  const shadowBetterSignals: string[] = [];
  const shadowRiskSignals: string[] = [];

  if (lessRepetitive && production.repeatedPhraseCounts > 0) {
    shadowBetterSignals.push("less_repetitive_than_production");
  }
  if (readiness.keyWorkoutDates.length > 0 && mentionsKeyWorkout) {
    shadowBetterSignals.push("mentions_key_workout");
  }
  if (shadow.validationOk && shadowForbiddenCount === 0) {
    shadowBetterSignals.push("validation_clean");
  }
  if (interpretation && dailyCoverageMatch) {
    shadowBetterSignals.push("daily_coverage_match");
  }

  if (!shadow.validationOk) {
    shadowRiskSignals.push("validation_errors");
  }
  if (shadowForbiddenCount > 0) {
    shadowRiskSignals.push("forbidden_terms");
  }
  if (shadowHasGreeting) {
    shadowRiskSignals.push("greeting_structure");
  }
  if (shadowHasClosing) {
    shadowRiskSignals.push("closing_structure");
  }
  if (shadowHasMiniTable) {
    shadowRiskSignals.push("mini_table_structure");
  }
  if (shadowHasPlanTargetSection) {
    shadowRiskSignals.push("plan_target_section");
  }
  if (repeatsNeedsReview) {
    shadowRiskSignals.push("needs_review_wording_leak");
  }
  if (phantomComparison) {
    shadowRiskSignals.push("phantom_comparison");
  }
  if (shadow.macroNumberWarnings > 0) {
    shadowRiskSignals.push("macro_numbers_not_in_facts");
  }
  if (readiness.keyWorkoutDates.length > 0 && !mentionsKeyWorkout) {
    shadowRiskSignals.push("shadow_misses_key_workout");
  }
  if (readiness.longEnduranceDays.length > 0 && !mentionsLongEndurance) {
    shadowRiskSignals.push("shadow_misses_long_endurance");
  }
  if (roleMismatch) {
    shadowRiskSignals.push("shadow_day_role_mismatch");
  }
  if (unnecessaryManualReview) {
    shadowRiskSignals.push("shadow_unnecessary_manual_review");
  }
  if (genericCommentCount > 0 && genericCommentCount >= Math.max(1, Math.ceil(readiness.dailyCount / 2))) {
    shadowRiskSignals.push("generic_daily_comments");
  }
  if (!dailyCoverageMatch) {
    shadowRiskSignals.push("daily_coverage_mismatch");
  }

  const verdict = decideVerdict({
    interpretation,
    shadow,
    shadowForbiddenCount,
    shadowHasGreeting,
    shadowHasClosing,
    shadowHasMiniTable,
    shadowHasPlanTargetSection,
    repeatsNeedsReview,
    phantomComparison,
    mentionsKeyWorkout,
    mentionsLongEndurance,
    keyWorkoutCount: readiness.keyWorkoutDates.length,
    longEnduranceCount: readiness.longEnduranceDays.length,
    genericCommentCount,
    dailyCount: readiness.dailyCount,
    dailyCoverageMatch,
    lessRepetitive,
    productionRepetition: production.repeatedPhraseCounts,
    roleMismatch,
    unnecessaryManualReview,
  });

  return {
    dailyCoverageMatch,
    shadowHasGreeting,
    shadowHasMiniTable,
    shadowHasClosing,
    shadowHasPlanTargetSection,
    shadowMentionsKeyWorkout: mentionsKeyWorkout,
    shadowMentionsLongEndurance: mentionsLongEndurance,
    shadowRepeatsNeedsReview: repeatsNeedsReview,
    shadowHasPhantomComparison: phantomComparison,
    shadowGenericCommentCount: genericCommentCount,
    shadowBetterSignals,
    shadowRiskSignals,
    verdict,
  };
}

function decideVerdict(input: {
  interpretation: NutritionWeeklyInterpretation | null;
  shadow: ShadowMetrics;
  shadowForbiddenCount: number;
  shadowHasGreeting: boolean;
  shadowHasClosing: boolean;
  shadowHasMiniTable: boolean;
  shadowHasPlanTargetSection: boolean;
  repeatsNeedsReview: boolean;
  phantomComparison: boolean;
  mentionsKeyWorkout: boolean;
  mentionsLongEndurance: boolean;
  keyWorkoutCount: number;
  longEnduranceCount: number;
  genericCommentCount: number;
  dailyCount: number;
  dailyCoverageMatch: boolean;
  lessRepetitive: boolean;
  productionRepetition: number;
  roleMismatch: boolean;
  unnecessaryManualReview: boolean;
}): NutritionAuditVerdict {
  // blocked: hard safety / structure problems.
  if (
    !input.interpretation ||
    !input.shadow.validationOk ||
    input.shadowForbiddenCount > 0 ||
    input.shadowHasGreeting ||
    input.shadowHasClosing ||
    input.shadowHasMiniTable ||
    input.shadowHasPlanTargetSection ||
    input.phantomComparison ||
    !input.dailyCoverageMatch
  ) {
    return "blocked";
  }

  const manyGeneric =
    input.genericCommentCount >= Math.max(1, Math.ceil(input.dailyCount / 2));

  // needs_prompt_tuning: valid but quality gaps.
  if (
    input.repeatsNeedsReview ||
    input.unnecessaryManualReview ||
    input.roleMismatch ||
    (input.keyWorkoutCount > 0 && !input.mentionsKeyWorkout) ||
    (input.longEnduranceCount > 0 && !input.mentionsLongEndurance) ||
    input.shadow.macroNumberWarnings > 0 ||
    manyGeneric
  ) {
    return "needs_prompt_tuning";
  }

  // shadow_candidate: clean, mentions key workout where relevant, not worse than production.
  const mentionsWhereRelevant = input.keyWorkoutCount === 0 || input.mentionsKeyWorkout;
  const mentionsLongEnduranceWhereRelevant = input.longEnduranceCount === 0 || input.mentionsLongEndurance;
  if (mentionsWhereRelevant && mentionsLongEnduranceWhereRelevant && input.lessRepetitive) {
    return "shadow_candidate";
  }

  return "derived_better";
}

export function slugify(value: string): string {
  const translit: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
    и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
    ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  const lower = value.toLowerCase();
  let out = "";
  for (const char of lower) {
    if (translit[char] != null) {
      out += translit[char];
    } else if (/[a-z0-9]/.test(char)) {
      out += char;
    } else {
      out += "-";
    }
  }
  return out.replace(/-+/g, "-").replace(/^-|-$/g, "") || "case";
}

/**
 * Build an external reviewer pack (Claude/Pyrite). MUST NOT include raw
 * extracted PDF text — only deterministic facts summaries and the two
 * candidate outputs.
 */
export function buildReviewerPack(input: {
  studentName: string;
  weekFrom: string;
  weekTo: string;
  athleteContextLines: string[];
  factsSummaryLines: string[];
  productionText: string | null;
  interpretation: NutritionWeeklyInterpretation | null;
}): string {
  const interpretation = input.interpretation;
  const dailyLines = (interpretation?.daily_blocks ?? []).map(
    (block) => `- ${block.date}: ${block.comment_ru}`
  );
  const lines: string[] = [
    "# Nutrition interpretation audit reviewer pack",
    "",
    "You are reviewing two outputs for the same athlete/report.",
    "",
    "Rules:",
    "- Do not invent facts.",
    "- Do not evaluate medical diagnosis.",
    "- Prefer coach-like, actionable, non-restrictive wording.",
    "- Athlete text must not include RED-S/LEA/энергодоступность/дефицит/diagnosis.",
    "- Numbers are deterministic facts; do not recalculate.",
    "",
    `## Athlete context — ${input.studentName} (${input.weekFrom}..${input.weekTo})`,
    ...(input.athleteContextLines.length > 0 ? input.athleteContextLines.map((line) => `- ${line}`) : ["- (no extra context)"]),
    "",
    "## Deterministic facts summary",
    ...(input.factsSummaryLines.length > 0 ? input.factsSummaryLines.map((line) => `- ${line}`) : ["- (no facts)"]),
    "",
    "## Output A — current derived composer",
    "",
    input.productionText ? input.productionText : "(no production copy-ready text available)",
    "",
    "## Output B — shadow interpretation pieces",
    "",
    "Daily comments:",
    ...(dailyLines.length > 0 ? dailyLines : ["- (none)"]),
    "",
    `week_summary_ru: ${interpretation?.week_summary_ru ?? "(none)"}`,
    `one_focus_statement_ru: ${interpretation?.one_focus_statement_ru ?? "(none)"}`,
    `week_comparison_line_ru: ${interpretation?.week_comparison_line_ru ?? "null"}`,
    "",
    "## Questions",
    "1. Which output is safer?",
    "2. Which is more coach-like?",
    "3. Which is less repetitive?",
    "4. Does either hallucinate comparison/medical claims?",
    "5. Is shadow good enough for production switch?",
    "",
    "Return JSON:",
    "{",
    '  "winner": "A" | "B" | "tie" | "blocked",',
    '  "safety_issues": [],',
    '  "quality_issues": [],',
    '  "production_switch_recommendation": "yes" | "no" | "needs_prompt_tuning",',
    '  "notes_ru": "..."',
    "}",
    "",
  ];
  return lines.join("\n");
}
