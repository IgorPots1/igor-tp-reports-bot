import type { NutritionPlanTargetWeekMode } from "@/features/nutrition/plan-week-policy";
import type {
  NutritionFatFeedbackPolicy,
  NutritionFoodItem,
  NutritionMealSection,
} from "@/features/nutrition/context";
import { shouldShowHighFatAthleteFeedback } from "@/features/nutrition/context";
import { isNutritionLongEnduranceWorkout, isNutritionLongRunWorkout, isEasyLightNutritionTitle, hasNutritionTempoWorkEvidence } from "@/features/nutrition/long-run";
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

export const EVENING_SECTIONS = ["dinner", "snack"] as const;

function normalizeFoodName(name: string): string {
  return name
    .replace(/[.…]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pick the most notable foods by a given macro, optionally restricted to meal
 * sections. Pure helper: returns cleaned, deduped display names only. Empty or
 * missing items yield []. Daily totals are never derived from this.
 */
// Shared selection core: pick the most notable food items by a macro (share
// threshold + dedupe by normalized name + limit). Returns the items themselves
// (with grams) so callers that need either the name OR the gram value build on
// ONE selection algorithm — no duplicated logic that could drift (урок #3).
function selectNotableFoodItems(
  items: NutritionFoodItem[] | undefined,
  macro: "fatG" | "carbsG" | "kcal",
  opts?: {
    sections?: ReadonlyArray<NutritionMealSection>;
    limit?: number;
    minShare?: number;
  }
): NutritionFoodItem[] {
  if (!items || items.length === 0) {
    return [];
  }
  const limit = opts?.limit ?? 3;
  const minShare = opts?.minShare ?? 0.12;
  const sectionFilter = opts?.sections ? new Set(opts.sections) : null;

  const scoped = items.filter((item) => {
    if (sectionFilter && (item.section === null || !sectionFilter.has(item.section))) {
      return false;
    }
    const value = item[macro];
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  });
  if (scoped.length === 0) {
    return [];
  }
  const totalKnown = scoped.reduce((sum, item) => sum + (item[macro] ?? 0), 0);
  const threshold = totalKnown > 0 ? totalKnown * minShare : 0;

  const sorted = [...scoped].sort((a, b) => (b[macro] ?? 0) - (a[macro] ?? 0));
  const picked: NutritionFoodItem[] = [];
  const seen = new Set<string>();
  for (const item of sorted) {
    if ((item[macro] ?? 0) < threshold) {
      continue;
    }
    const name = normalizeFoodName(item.name);
    if (name.length < 2) {
      continue;
    }
    const key = name.toLocaleLowerCase("ru");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    picked.push(item);
    if (picked.length >= limit) {
      break;
    }
  }
  return picked;
}

export function pickNotableFoods(
  items: NutritionFoodItem[] | undefined,
  macro: "fatG" | "carbsG" | "kcal",
  opts?: {
    sections?: ReadonlyArray<NutritionMealSection>;
    limit?: number;
    minShare?: number;
  }
): string[] {
  return selectNotableFoodItems(items, macro, opts).map((item) => normalizeFoodName(item.name));
}

// Same selection as pickNotableFoods("carbsG"), but keeps the per-item carb grams
// (from the PDF) so the caller can attach a deterministic fast/slow carb class.
export function pickNotableCarbItemsWithGrams(
  items: NutritionFoodItem[] | undefined,
  opts?: { limit?: number; minShare?: number }
): Array<{ name: string; carbsG: number }> {
  return selectNotableFoodItems(items, "carbsG", opts).map((item) => ({
    name: normalizeFoodName(item.name),
    carbsG: typeof item.carbsG === "number" ? item.carbsG : 0,
  }));
}

/**
 * Athlete-facing notable-food mention, strictly gated by policy.
 *
 * Returns null unless `fatFeedbackPolicy === "normal"`. Even then it only fires on
 * a load/key/long day that is low on carbs with notable evening fat sources, and
 * stays neutral and factual (no morality, no "вечером" without dinner/snack
 * section evidence). For coach_only / suppress_athlete / soften it always returns
 * null, so high-fat product names never reach primary athlete text by default.
 */
export function buildAthleteFacingNotableFoodMention(input: {
  fatFeedbackPolicy: NutritionFatFeedbackPolicy;
  items: NutritionFoodItem[] | undefined;
  loadDay: boolean;
  lowCarbs: boolean;
  highEveningFat: boolean;
}): string | null {
  if (input.fatFeedbackPolicy !== "normal") {
    return null;
  }
  if (!input.loadDay || !input.lowCarbs || !input.highEveningFat) {
    return null;
  }
  const foods = pickNotableFoods(input.items, "fatG", { sections: EVENING_SECTIONS, limit: 3 });
  if (foods.length === 0) {
    return null;
  }
  return `Часть энергии в ужин/перекус пришлась на ${foods.join(", ")}; при такой нагрузке лучше смещать больше топлива в углеводы.`;
}

const INTERVAL_REPEAT_PATTERN = /\b\d+\s*[xх]\s*\d+([,.]\d+)?\s*(мин|min|сек|sec|м|m|км|km)?/i;
const INTERVAL_DISTANCE_PATTERN = /\b\d+\s*[xх]\s*\d{2,4}\s*(м|m)?/i;
const INTERVAL_KEYWORD_PATTERN = /(интервал|interval|vo2|повтор|repeats?)/i;

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
  return hasNutritionTempoWorkEvidence(title);
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

function extractDurationMinutesFromHMM(label: string): number | null {
  const match = label.match(/\b(\d+):(\d{2})\b/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
}

function resolveEffectiveDurationMinutes(label: string, durationMinutes?: number | null): number | null {
  if (durationMinutes !== null && durationMinutes !== undefined && Number.isFinite(durationMinutes)) {
    return durationMinutes;
  }
  return extractDurationMinutesFromLabel(label) ?? extractDurationMinutesFromHMM(label);
}

const PRE_LONG_ENERGY_FLOOR_FINDINGS = new Set([
  "below_load_energy_floor",
  "below_rest_energy_floor",
  "below_cross_training_floor",
  "below_strength_floor",
  "ea_red_screen",
  "ea_amber_screen",
  "low_energy_long_run_day",
  "low_energy_with_cross_training",
  "low_energy_with_strength",
]);

export function resolvePreLongActualEnergyIssue(input: {
  nutritionStatus: string | null;
  findings: string[];
  hasEnergyIssue: boolean;
}): boolean {
  if (input.nutritionStatus !== "pre_long_low") {
    return input.hasEnergyIssue;
  }
  return input.findings.some((finding) => PRE_LONG_ENERGY_FLOOR_FINDINGS.has(finding));
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
  const durationMinutes = resolveEffectiveDurationMinutes(label, input.durationMinutes);

  if (trainingType === "rest" || /день отдыха|день без тренировки/i.test(label)) {
    return { role: "rest", reason: "rest_day" };
  }

  if (isCombinedLoadLabel(label)) {
    return { role: "combined_load", reason: "combined_load_label" };
  }

  if (isEasyLightNutritionTitle(label)) {
    return { role: "easy_run", reason: "easy_light_title" };
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

  if (trainingType === "long_endurance") {
    return { role: "long_endurance", reason: "long_endurance_type" };
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

  if (isStrengthType(trainingType, label)) {
    return { role: "strength", reason: "strength_type" };
  }

  if (isCrossTrainingType(trainingType, label)) {
    return { role: "cross_training", reason: "cross_training_type" };
  }

  if (trainingType === "intervals") {
    return { role: "key_interval", reason: "canonical_interval_type" };
  }

  if (trainingType === "tempo") {
    return { role: "key_tempo", reason: "canonical_tempo_type" };
  }

  if (trainingType === "easy" || trainingType === "unknown") {
    return { role: "easy_run", reason: "easy_type" };
  }

  if (trainingType === "race") {
    return { role: "key_tempo", reason: "race_day" };
  }

  if (trainingType === "hard") {
    return { role: "key_tempo", reason: "canonical_hard_type" };
  }

  return { role: "unknown", reason: "unknown_type" };
}

function extractDurationHMM(label: string): string | null {
  const match = label.match(/(\d+):(\d{2})/);
  if (!match) {
    return null;
  }
  return `${match[1]}:${match[2]}`;
}

function resolveSportShortRu(title: string): string | null {
  if (/cycling|bike/i.test(title)) {
    return "вело";
  }
  if (/padel/i.test(title)) {
    return "падел";
  }
  if (/strength/i.test(title)) {
    return "силовая";
  }
  if (/run|бег|пробеж/i.test(title)) {
    return "бег";
  }
  return null;
}

// Task 10d: TrainingPeaks sends English activity names; in a Russian review they
// must read in Russian (e.g. "Pilates" → "пилатес"). Ordered EN→RU map (multi-word
// entries first). Anything not listed is left untouched (never break the label) and
// logged once via transcribeTrainingPeaksActivityRu so the dictionary can grow.
const TRAININGPEAKS_ACTIVITY_RU_MAP: Array<[RegExp, string]> = [
  [/\bPadel\s*Racket\b/gi, "падел"],
  [/\bPadel\b/gi, "падел"],
  [/\bStand\s*Up\s*Paddleboarding\b/gi, "сап"],
  [/\bPaddleboard(?:ing)?\b/gi, "сап"],
  [/\bSUP\b/gi, "сап"],
  [/\bM(?:ountain|tn)\s*Bike\b/gi, "вело"],
  [/\bCycling\b/gi, "вело"],
  [/\bBike\b/gi, "вело"],
  [/\bRunning\b/gi, "бег"],
  [/\bRun\b/gi, "бег"],
  [/\bStrength\b/gi, "силовая"],
  [/\bGym\b/gi, "зал"],
  [/\bSwimming\b/gi, "плавание"],
  [/\bSwim\b/gi, "плавание"],
  [/\bPilates\b/gi, "пилатес"],
  [/\bYoga\b/gi, "йога"],
  [/\bStretching\b/gi, "растяжка"],
  [/\bRowing\b/gi, "гребля"],
  [/\bRow\b/gi, "гребля"],
  [/\bWalking\b/gi, "ходьба"],
  [/\bWalk\b/gi, "ходьба"],
  [/\bHiking\b/gi, "хайк"],
  [/\bHike\b/gi, "хайк"],
  [/\bTennis\b/gi, "теннис"],
  [/\bXC[-\s]?Ski(?:ing)?\b/gi, "лыжи"],
  [/\bSkiing\b/gi, "лыжи"],
  [/\bSki\b/gi, "лыжи"],
  [/\bElliptical\b/gi, "эллипс"],
  [/\bTreadmill\b/gi, "дорожка"],
  [/\bBrick\b/gi, "брик"],
  [/\bCross[-\s]?Train(?:ing)?\b/gi, "кросс-тренировка"],
  [/\bTrainingPeaks\b/gi, "план тренировок"],
];

function applyActivityTranscription(label: string): string {
  let out = label;
  for (const [pattern, ru] of TRAININGPEAKS_ACTIVITY_RU_MAP) {
    out = out.replace(pattern, ru);
  }
  return out;
}

/** Transcribe + log any leftover Latin activity token (so the map can be extended). */
function transcribeTrainingPeaksActivityRu(label: string): string {
  const out = applyActivityTranscription(label);
  const residual = out.match(/[A-Za-z]{3,}/g);
  if (residual && residual.length > 0) {
    console.warn(
      `[nutrition.activity-transcription] untranslated activity token(s) ${JSON.stringify([
        ...new Set(residual.map((token) => token.toLowerCase())),
      ])} in label "${label}" — add to TRAININGPEAKS_ACTIVITY_RU_MAP`
    );
  }
  return out;
}

// Back-compat name used in the label branches below.
function replaceEnglishSportTokens(label: string): string {
  return applyActivityTranscription(label);
}

function isRunLikeLabel(label: string): boolean {
  return /бег|run|пробеж|лонг/i.test(label);
}

export function humanizeNutritionTrainingLabel(trainingLabel: string, trainingType: string): string {
  // Final pass: whatever label branch produced, transcribe any English activity
  // names to Russian (and log unknown tokens). Covers all return paths at once.
  return transcribeTrainingPeaksActivityRu(humanizeNutritionTrainingLabelInner(trainingLabel, trainingType));
}

function humanizeNutritionTrainingLabelInner(trainingLabel: string, trainingType: string): string {
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
  if (
    /бег в легком темпе/i.test(raw) &&
    trainingType !== "long_run" &&
    trainingType !== "long_endurance" &&
    !/длительн|длинн|long\s*run|лонг/i.test(raw)
  ) {
    // Easy-pace run only when it is genuinely an easy day. A long run held at
    // easy pace ("длинный бег в легком темпе") must fall through to the
    // длительная label so the 🟥 mini-table square and the text agree.
    return "лёгкий бег";
  }
  if (isCombinedLoadLabel(raw)) {
    return replaceEnglishSportTokens(raw);
  }
  if (isKeyIntervalTitle(raw) || isKeyTempoTitle(raw)) {
    return replaceEnglishSportTokens(raw);
  }

  const longEndurancePattern = /^длинная выносливостная нагрузка(?:\s+(\d+:\d{2}))?(?::\s*(.+))?$/i;
  const longEnduranceMatch = raw.match(longEndurancePattern);
  if (longEnduranceMatch || trainingType === "long_endurance") {
    const duration = longEnduranceMatch?.[1] ?? extractDurationHMM(raw);
    const titleTail = longEnduranceMatch?.[2]?.trim() ?? raw.split(":").slice(-1)[0]?.trim() ?? "";
    const sport = resolveSportShortRu(titleTail) ?? resolveSportShortRu(raw);
    if (sport === "вело" && duration) {
      return `вело ${duration}`;
    }
    if (sport && duration) {
      return `${sport} ${duration}`;
    }
    if (duration) {
      return `длинная нагрузка ${duration}`;
    }
    if (sport) {
      return sport;
    }
  }

  if (trainingType === "long_run" || /длительн|long\s*run|лонг/i.test(raw)) {
    const stripped = raw
      .replace(/^длительная:\s*/i, "")
      .replace(/^длительная\s+/i, "")
      .replace(/^длинная выносливостная нагрузка\s*/i, "")
      .trim();
    const duration = extractDurationHMM(stripped) ?? extractDurationHMM(raw);
    const distanceMatch = stripped.match(/(\d+(?:[,.]\d+)?)\s*(?:км|km)\b/i) ?? raw.match(/(\d+(?:[,.]\d+)?)\s*(?:км|km)\b/i);
    const runLike = isRunLikeLabel(stripped) || isRunLikeLabel(raw) || trainingType === "long_run";
    if (distanceMatch && runLike) {
      return `длительный бег ${distanceMatch[1].replace(".", ",")} км`;
    }
    if (distanceMatch) {
      return `длительная ${distanceMatch[1].replace(".", ",")} км`;
    }
    if (duration && runLike) {
      return `бег ${duration}`;
    }
    if (runLike) {
      const cleaned = stripped.replace(/long\s*run/gi, "бег").trim();
      if (/^бег$/i.test(cleaned)) {
        return "длительный бег";
      }
      if (cleaned && !/^длительн/i.test(cleaned)) {
        if (!distanceMatch && !duration && /бег по пульсу|easy run|long run/i.test(cleaned)) {
          return "длительная";
        }
        return cleaned.toLocaleLowerCase("ru").startsWith("бег") ? cleaned : `длительный ${cleaned}`;
      }
      return "длительный бег";
    }
    if (/длитель|long\s*run|лонг/i.test(raw)) {
      return raw.replace(/long\s*run/gi, "длительная");
    }
    return "длительная";
  }

  if (/^cycling$/i.test(raw) || /^bike$/i.test(raw) || /вело/i.test(raw)) {
    return "вело";
  }
  return replaceEnglishSportTokens(raw);
}

export function formatNutritionWorkoutLabelForAthlete(input: {
  trainingLabel: string;
  trainingType: string;
}): string {
  return humanizeNutritionTrainingLabel(input.trainingLabel, input.trainingType);
}

export function formatNutritionWorkoutLabelForCoach(input: {
  trainingLabel: string;
  trainingType: string;
}): string {
  const label = humanizeNutritionTrainingLabel(input.trainingLabel, input.trainingType);
  return label
    .replace(/^длительная:\s*/i, "")
    .replace(/^длительная\s+/i, "")
    .trim() || label;
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

export function mapCarbLoadBasisToNarrativeRole(loadBasis: string): NutritionNarrativeWorkoutRole | null {
  switch (loadBasis) {
    case "rest":
      return "rest";
    case "easy":
      return "easy_run";
    case "hard":
      return "key_tempo";
    case "long_run":
      return "long_run";
    case "long_endurance":
      return "long_endurance";
    case "pre_long":
      return "easy_run";
    case "cross_training":
      return "cross_training";
    case "strength":
      return "strength";
    default:
      return null;
  }
}

export function reconcileNarrativeRoleWithCarbLoadBasis(
  roleInfo: NutritionNarrativeDayRoleInfo,
  loadBasis: string | null | undefined
): NutritionNarrativeDayRoleInfo {
  if (!loadBasis || loadBasis === "unknown") {
    return roleInfo;
  }
  const basisRole = mapCarbLoadBasisToNarrativeRole(loadBasis);
  if (!basisRole) {
    return roleInfo;
  }

  const softRoles = new Set<NutritionNarrativeWorkoutRole>(["easy_run", "unknown", "rest"]);
  const hardBases = new Set(["hard", "long_run", "long_endurance", "pre_long"]);

  if (softRoles.has(roleInfo.role) && hardBases.has(loadBasis)) {
    return { ...roleInfo, role: basisRole, reason: `${roleInfo.reason}+carb_load_basis_${loadBasis}` };
  }
  if (roleInfo.role !== "rest" && loadBasis === "rest") {
    return { ...roleInfo, role: "rest", reason: `${roleInfo.reason}+carb_load_basis_rest` };
  }
  if (
    loadBasis === "easy" &&
    (roleInfo.role === "key_tempo" || roleInfo.role === "key_interval" || roleInfo.role === "long_run")
  ) {
    return { ...roleInfo, role: "easy_run", reason: `${roleInfo.reason}+carb_load_basis_easy` };
  }
  return roleInfo;
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
    energy_scarce: 0,
    modest_energy_day: 0,
    lower_boundary: 0,
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
  fatPercentStatus?: string | null;
  fatG?: number | null;
  fatPercentEnergy?: number | null;
  carbsStatus: string | null;
  carbsG?: number | null;
  carbsGPerKg?: number | null;
};

function isHighFatMacro(macro: MacroGuardrailStatuses): boolean {
  return macro.fatStatus === "high" || macro.fatPercentStatus === "high";
}

function isLowOrBorderlineFatMacro(macro: MacroGuardrailStatuses): boolean {
  return macro.fatStatus === "low" || macro.fatStatus === "borderline";
}

function shouldMentionFatInAthleteText(input: {
  macro: MacroGuardrailStatuses;
  fatFeedbackPolicy: NutritionFatFeedbackPolicy;
}): boolean {
  if (isLowOrBorderlineFatMacro(input.macro)) {
    return true;
  }
  if (isHighFatMacro(input.macro)) {
    return shouldShowHighFatAthleteFeedback(input.fatFeedbackPolicy);
  }
  return false;
}

function buildHighFatAthleteSentence(loadDay: boolean, lowCarbs: boolean): string | null {
  if (!loadDay || !lowCarbs) {
    return null;
  }
  return "Жиры высоковаты, при этом углеводов под нагрузку не хватает — лучше сместить часть энергии в углеводы вокруг тяжёлых дней.";
}

function isLongEnduranceTrainingType(trainingType: string): boolean {
  return trainingType === "long_endurance" || trainingType === "long_run";
}

function isRunLikeAfterLongDay(role: NutritionNarrativeWorkoutRole): boolean {
  return (
    role === "combined_load" ||
    role === "key_interval" ||
    role === "key_tempo" ||
    role === "easy_run" ||
    role === "long_run"
  );
}

function buildLongAfterEndurancePrefix(input: {
  previousDayTrainingType: string | null | undefined;
  previousDayTrainingLabel: string | null | undefined;
  roleInfo: NutritionNarrativeDayRoleInfo;
}): string | null {
  if (!input.previousDayTrainingType || !isLongEnduranceTrainingType(input.previousDayTrainingType)) {
    return null;
  }
  if (!isRunLikeAfterLongDay(input.roleInfo.role)) {
    return null;
  }
  const prevLabel = (input.previousDayTrainingLabel ?? "").toLocaleLowerCase("ru");
  const prevIsBike = /вело|cycling|bike/.test(prevLabel) || input.previousDayTrainingType === "long_endurance";
  if (prevIsBike) {
    return "День после длинного вело + ещё беговая работа. ";
  }
  return "День после длинной нагрузки + ещё беговая работа. ";
}

function countMeaningfulSentences(text: string): number {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 12).length;
}

const DETAIL_FLOOR_ROLES = new Set<NutritionNarrativeWorkoutRole>([
  "key_interval",
  "key_tempo",
  "long_run",
  "long_endurance",
  "combined_load",
]);

function ensureDetailFloorSentence(input: {
  text: string;
  roleInfo: NutritionNarrativeDayRoleInfo;
  athleteTrainingLabel: string;
}): string {
  if (!DETAIL_FLOOR_ROLES.has(input.roleInfo.role)) {
    return input.text;
  }
  if (countMeaningfulSentences(input.text) >= 2) {
    return input.text;
  }
  const supplement =
    input.roleInfo.role === "long_endurance" || input.roleInfo.role === "long_run"
      ? `Под ${input.athleteTrainingLabel} важно держать энергию и углеводы ровнее, без резких просадок в такие дни.`
      : `Под ${input.athleteTrainingLabel} имеет смысл заранее поддержать энергию и углеводы, чтобы нагрузка не осталась «на пустом».`;
  return `${input.text} ${supplement}`;
}

export type NutritionDayCommentComposerInput = {
  trainingType: string;
  trainingLabel: string;
  athleteTrainingLabel: string;
  nutritionStatus: string | null;
  findings: string[];
  macro: MacroGuardrailStatuses;
  hasNutritionCompletenessIssue: boolean;
  missingNutritionData?: boolean;
  hasEnergyIssue: boolean;
  roleInfo: NutritionNarrativeDayRoleInfo;
  fatFeedbackPolicy?: NutritionFatFeedbackPolicy;
  previousDayTrainingType?: string | null;
  previousDayTrainingLabel?: string | null;
  /**
   * Task 10d (Bug 1): goal-aware deterministic fallback. For goal=lose/gain, a
   * rest/easy day whose actual energy is above the deficit line must NOT read as
   * "спокойно". maintain leaves these undefined → behaviour byte-identical.
   */
  goalType?: "lose" | "maintain" | "gain";
  goalDayTargetKcal?: number | null;
  actualKcal?: number | null;
  actualFatG?: number | null;
};

export type NutritionDayNarrativeParts = {
  energyLine?: string;
  carbLine?: string;
  proteinLine?: string;
  fatLine?: string;
  practicalLine?: string;
  coachOnlySuppressed?: string[];
};

function hasLowCarbs(macro: MacroGuardrailStatuses, loadDay: boolean): boolean {
  return loadDay && (macro.carbsStatus === "low" || macro.carbsStatus === "borderline");
}

function isKeyLoadRole(role: NutritionNarrativeWorkoutRole): boolean {
  return role === "key_interval" || role === "key_tempo" || role === "combined_load" || role === "long_run" || role === "long_endurance";
}

function capitalizeRu(value: string): string {
  if (!value) {
    return value;
  }
  return `${value.slice(0, 1).toLocaleUpperCase("ru")}${value.slice(1)}`;
}

function rolePrefixSentence(roleInfo: NutritionNarrativeDayRoleInfo, athleteTrainingLabel: string): string | null {
  switch (roleInfo.role) {
    case "key_interval":
      return roleInfo.isKey
        ? "Это ключевая интервальная работа недели."
        : `Это интервальная работа (${athleteTrainingLabel}).`;
    case "key_tempo":
      return roleInfo.isKey ? "Это ключевая темповая работа недели." : `Это темповая работа (${athleteTrainingLabel}).`;
    case "combined_load":
      return `Здесь нагрузка двойная (${athleteTrainingLabel}).`;
    case "long_endurance":
      if (roleInfo.isKey) {
        return `Это главная длинная нагрузка недели — ${athleteTrainingLabel}.`;
      }
      if (/^вело\b/i.test(athleteTrainingLabel)) {
        const duration = athleteTrainingLabel.replace(/^вело\s*/i, "").trim();
        return duration
          ? `Это длинная велотренировка ${duration}, главный нагрузочный день недели.`
          : `Это длинная велотренировка, главный нагрузочный день недели.`;
      }
      return `Это день длинной выносливостной нагрузки (${athleteTrainingLabel}).`;
    case "long_run":
      return `Это длительная беговая работа (${athleteTrainingLabel}).`;
    case "easy_run":
      return `Под ${athleteTrainingLabel} день выглядит рабочим.`;
    case "rest":
      return "Это день отдыха.";
    default:
      return null;
  }
}

export function buildNutritionDayNarrativeParts(input: {
  macro: MacroGuardrailStatuses;
  roleInfo: NutritionNarrativeDayRoleInfo;
  nutritionStatus: string | null;
  hasEnergyIssue: boolean;
  loadDay: boolean;
  fatFeedbackPolicy: NutritionFatFeedbackPolicy;
  athleteTrainingLabel: string;
  previousDayTrainingType?: string | null;
  findings?: string[];
}): NutritionDayNarrativeParts {
  const {
    macro,
    roleInfo,
    nutritionStatus,
    hasEnergyIssue: rawHasEnergyIssue,
    loadDay,
    fatFeedbackPolicy,
    athleteTrainingLabel,
    previousDayTrainingType,
    findings = [],
  } = input;
  const isPreLong = nutritionStatus === "pre_long_low";
  const hasEnergyIssue = isPreLong
    ? resolvePreLongActualEnergyIssue({ nutritionStatus, findings, hasEnergyIssue: rawHasEnergyIssue })
    : rawHasEnergyIssue;
  const parts: NutritionDayNarrativeParts = {};
  const suppressed: string[] = [];
  const rolePrefix = rolePrefixSentence(roleInfo, athleteTrainingLabel);

  if (rolePrefix && !isPreLong) {
    parts.energyLine = rolePrefix;
  }

  if (isPreLong) {
    if (hasEnergyIssue) {
      parts.energyLine =
        "День перед длинной нагрузкой получился скромным и по энергии, и по углеводам.";
    } else if (macro.carbsStatus === "ok") {
      parts.energyLine = "Подготовка к длинной нагрузке по углеводам выглядит спокойнее.";
    } else {
      parts.energyLine = "Калорийность высокая, день точно не был «пустым» по энергии.";
    }
  }

  if (hasEnergyIssue && !isPreLong) {
    if (roleInfo.role === "rest") {
      const onlyEaAmber =
        findings.includes("ea_amber_screen") &&
        !findings.includes("ea_red_screen") &&
        !findings.includes("below_load_energy_floor") &&
        nutritionStatus !== "below_energy_floor";
      if (onlyEaAmber) {
        parts.energyLine = `${rolePrefix ?? "Это день отдыха."} По общей энергии день выглядит скорее сдержанно, но не критично.`;
      } else {
        parts.energyLine = `${rolePrefix ?? "Это день отдыха."} Для дня отдыха это нижняя граница по энергии. Разово нормально, но такие дни не стоит делать регулярными.`;
      }
    } else if (roleInfo.role === "cross_training") {
      parts.energyLine = `${capitalizeRu(athleteTrainingLabel)} тоже считается нагрузкой, и энергии под этот день маловато.`;
    } else if (roleInfo.role === "strength") {
      parts.energyLine = "В силовой день энергии маловато для уверенного восстановления.";
    } else if (roleInfo.role === "easy_run") {
      parts.energyLine = "Для лёгкой тренировки день получился низким по энергии.";
    } else if (isKeyLoadRole(roleInfo.role)) {
      parts.energyLine = `${rolePrefix ?? ""} День получился скромным по энергии под такую нагрузку.`.trim();
    } else {
      parts.energyLine = `${rolePrefix ?? ""} Энергии под нагрузку маловато.`.trim();
    }
  } else if (roleInfo.role === "rest" && !isPreLong) {
    parts.energyLine = `${rolePrefix ?? "Это день отдыха."} По энергии день не был пустым.`;
  }

  if (loadDay) {
    if (macro.carbsStatus === "low") {
      if (isPreLong) {
        parts.carbLine =
          "Но для подготовки к длинной работе углеводы здесь скорее нижняя граница, накануне такой нагрузки лучше смещать больше топлива в углеводы.";
      } else {
        parts.carbLine = "Углеводов для такой нагрузки маловато.";
      }
    } else if (macro.carbsStatus === "borderline") {
      if (isPreLong) {
        parts.carbLine =
          "Но как день перед длинной работой углеводы здесь скорее нижняя граница: накануне лучше чуть выше, чтобы не заходить в работу на пустом топливе.";
      } else {
        parts.carbLine = "Углеводы на нижней границе для такой работы.";
      }
    } else if (macro.carbsStatus === "ok" && isKeyLoadRole(roleInfo.role)) {
      parts.carbLine = "По углеводам день выглядит рабочим для этой нагрузки.";
    }
  }

  if (macro.proteinStatus === "low") {
    parts.proteinLine = "Белка маловато, восстановление лучше поддержать полноценным приёмом пищи.";
  } else if (macro.proteinStatus === "borderline") {
    parts.proteinLine = "Белок близко к нижней границе, восстановление лучше поддержать чуть увереннее.";
  } else if (macro.proteinStatus === "ok" && isPreLong && !hasEnergyIssue) {
    parts.proteinLine = "Белка много, по восстановлению здесь есть запас.";
  } else if (macro.proteinStatus === "ok" && (isKeyLoadRole(roleInfo.role) || isPreLong)) {
    parts.proteinLine = "По белку день спокойный, базовое восстановление закрыто.";
  }

  if (isLowOrBorderlineFatMacro(macro)) {
    parts.fatLine = macro.fatStatus === "low" ? "Жиры низковаты." : "Жиры на нижней границе.";
  } else if (isHighFatMacro(macro)) {
    if (shouldShowHighFatAthleteFeedback(fatFeedbackPolicy)) {
      if (loadDay && (macro.carbsStatus === "low" || macro.carbsStatus === "borderline")) {
        parts.fatLine = "Жиры высоковаты, а углеводов под нагрузку не хватает — лучше сместить часть энергии в углеводы.";
      }
    } else {
      suppressed.push("high_fat_hidden_by_policy");
    }
  }

  if (isPreLong) {
    parts.practicalLine = "Практически: к длинной работе лучше подходить с более уверенными углеводами.";
  } else if (roleInfo.role === "long_endurance" || roleInfo.role === "long_run") {
    if (previousDayTrainingType === "long_endurance" && roleInfo.role === "long_run") {
      parts.practicalLine = "Практически: это бег на фоне предыдущей длинной работы, поэтому углеводы и восстановление лучше держать ровнее.";
    } else {
      parts.practicalLine = "Практически: вокруг таких длинных работ важно не просаживать углеводы и восстановление.";
    }
  } else if (isKeyLoadRole(roleInfo.role)) {
    parts.practicalLine = "Практически: к таким работам лучше подходить не пустой по энергии и углеводам.";
  } else if (roleInfo.role === "easy_run") {
    parts.practicalLine = "Практически: не делать беговой день слишком пустым по энергии.";
  }

  parts.coachOnlySuppressed = suppressed;
  return parts;
}

function composeNarrativeFromParts(input: {
  parts: NutritionDayNarrativeParts;
  roleInfo: NutritionNarrativeDayRoleInfo;
  state: NutritionNarrativeRepetitionState;
}): string | null {
  const { parts, roleInfo, state } = input;
  const ordered = [parts.energyLine, parts.carbLine, parts.proteinLine, parts.fatLine, parts.practicalLine]
    .map((line) => line?.trim())
    .filter((line): line is string => Boolean(line));
  if (ordered.length === 0) {
    return null;
  }
  const detailBudget = roleInfo.role === "key_interval" || roleInfo.role === "key_tempo" || roleInfo.role === "combined_load" ? 3 : 4;
  const sliced = ordered.slice(0, detailBudget);
  let normalized = sliced
    .map((line) => {
      const withDot = /[.!?…]$/.test(line) ? line : `${line}.`;
      if (/близко к нижней границе/i.test(withDot)) {
        if (state.canUsePhrase("lower_boundary", 4)) {
          state.registerPhrase("lower_boundary");
          return withDot;
        }
        return withDot.replace(/близко к нижней границе/gi, "чуть ниже желаемого уровня");
      }
      if (/Белок закрыт/i.test(withDot) && !state.canUsePhrase("protein_closed", 3)) {
        return withDot.replace(/Белок закрыт/gi, "По белку день спокойный");
      }
      if (/Белок закрыт/i.test(withDot)) {
        state.registerPhrase("protein_closed");
      }
      if (/углеводов под нагрузку маловато/i.test(withDot)) {
        if (!state.canUsePhrase("carbs_low", 2)) {
          return withDot.replace(/углеводов под нагрузку маловато/gi, "углеводов для такой нагрузки немного");
        }
        state.registerPhrase("carbs_low");
      }
      return withDot;
    })
    .join(" ");
  if (state.getExactSentenceCount(normalized) > 0) {
    normalized = normalized
      .replace(/Энергии под нагрузку маловато\./g, "День получился скромным по топливу.")
      .replace(/Углеводов для такой нагрузки маловато\./g, "Углеводов было немного для такой работы.");
  }
  return normalized;
}

function buildMacroNuanceSentence(input: {
  macro: MacroGuardrailStatuses;
  loadDay: boolean;
  hasEnergyIssue: boolean;
  state: NutritionNarrativeRepetitionState;
  patternOccurrence: number;
  fatFeedbackPolicy: NutritionFatFeedbackPolicy;
}): string | null {
  const { macro, loadDay, hasEnergyIssue, state, patternOccurrence, fatFeedbackPolicy } = input;
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

  const highFatSentence =
    shouldShowHighFatAthleteFeedback(fatFeedbackPolicy) && isHighFatMacro(macro) && loadDay && hasLowCarbs(macro, loadDay)
      ? buildHighFatAthleteSentence(loadDay, true)
      : null;
  if (highFatSentence) {
    return highFatSentence;
  }

  const segments: string[] = [];
  if (loadDay && macro.carbsStatus === "low" && state.canUsePhrase("carbs_low", 3)) {
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
  if (shouldMentionFatInAthleteText({ macro, fatFeedbackPolicy })) {
    if (macro.fatStatus === "low") {
      segments.push("жиры низковаты");
    } else if (macro.fatStatus === "borderline") {
      segments.push("жиры на нижней границе");
    }
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
      if (state.canUsePhrase("modest_energy_day", 2)) {
        state.registerPhrase("modest_energy_day");
        return "При двойной нагрузке день снова вышел скромным по энергии.";
      }
      return "При двойной нагрузке день снова вышел низким по энергии.";
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
    if (state.canUsePhrase("energy_scarce", 2)) {
      state.registerPhrase("energy_scarce");
      return "Для дня с нагрузкой энергии снова маловато.";
    }
    return "Для дня с нагрузкой энергии снова низковато.";
  }
  if (state.canUsePhrase("too_empty_day", 2)) {
    state.registerPhrase("too_empty_day");
    return "Для дня с нагрузкой энергии получилось маловато. Я бы не делал этот день слишком пустым по питанию и лучше поддержал питание вокруг тренировки.";
  }
  if (state.canUsePhrase("energy_low", 5)) {
    state.registerPhrase("energy_low");
    if (state.canUsePhrase("energy_scarce", 2)) {
      state.registerPhrase("energy_scarce");
      return "Для дня с нагрузкой энергии получилось маловато. Лучше поддержать питание вокруг тренировки.";
    }
    return "Для дня с нагрузкой энергии получилось низковато. Лучше поддержать питание вокруг тренировки.";
  }
  if (state.canUsePhrase("energy_scarce", 2)) {
    state.registerPhrase("energy_scarce");
    return "Для дня с нагрузкой энергии получилось маловато.";
  }
  return "Для дня с нагрузкой энергии получилось низковато.";
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
  const {
    macro,
    hasEnergyIssue,
    roleInfo,
    athleteTrainingLabel,
    hasNutritionCompletenessIssue,
    fatFeedbackPolicy = "coach_only",
    previousDayTrainingType,
    previousDayTrainingLabel,
  } = input;
  const cautiousPrefix = hasNutritionCompletenessIssue
    ? "Данные по питанию за день неполные, поэтому вывод короткий. "
    : "";
  const longAfterPrefix =
    buildLongAfterEndurancePrefix({
      previousDayTrainingType,
      previousDayTrainingLabel,
      roleInfo,
    }) ?? "";
  const loadDay = roleInfo.role !== "rest";

  if (input.missingNutritionData) {
    const base = "Питание за этот день не зафиксировано. По макросам вывод не делаю.";
    if (roleInfo.role === "rest") {
      return `${cautiousPrefix}${longAfterPrefix}${base}`;
    }
    return `${cautiousPrefix}${longAfterPrefix}${base} Но сама тренировка тоже считается нагрузкой.`;
  }

  if (input.nutritionStatus === "suspect") {
    return "Данные по питанию за день выглядят неполными или нетипичными, поэтому здесь лучше проверить исходный отчёт вручную.";
  }

  // Task 10d (Bug 1): goal-aware deterministic fallback so a losing athlete's REST
  // day above the deficit line never reads as "спокойно" — even when the model's
  // goal-aware prose is unavailable. maintain/gain or no target → fall through to
  // the existing logic (behaviour byte-identical for them).
  if (
    input.goalType === "lose" &&
    roleInfo.role === "rest" &&
    typeof input.goalDayTargetKcal === "number" &&
    typeof input.actualKcal === "number" &&
    input.actualKcal > input.goalDayTargetKcal + 150
  ) {
    const orientKcal = Math.round(input.goalDayTargetKcal / 50) * 50;
    const fatG = typeof input.actualFatG === "number" ? input.actualFatG : input.macro.fatG ?? null;
    const fatPct = typeof fatG === "number" && input.actualKcal > 0 ? (fatG * 9) / input.actualKcal : null;
    const fatSentence =
      typeof fatG === "number" && fatPct !== null && fatPct > 0.35
        ? ` Жиров ${Math.round(fatG / 5) * 5} г для дня без нагрузки многовато — в основном из них и набегают лишние калории.`
        : "";
    return `${longAfterPrefix}Для дня без нагрузки при твоей цели это многовато — ориентир в такие дни около ${orientKcal} ккал.${fatSentence} В дни отдыха попробуй сделать тарелку легче: больше овощей и белка, поменьше жирного.`;
  }

  if (input.nutritionStatus === "pre_long_low") {
    state.bumpPattern("pre_long_low");
    const parts = buildNutritionDayNarrativeParts({
      macro,
      roleInfo: { ...roleInfo, role: "rest" },
      nutritionStatus: input.nutritionStatus,
      hasEnergyIssue,
      loadDay: true,
      fatFeedbackPolicy,
      athleteTrainingLabel,
      previousDayTrainingType,
      findings: input.findings,
    });
    const composed = composeNarrativeFromParts({ parts, roleInfo, state });
    if (composed) {
      return `${cautiousPrefix}${longAfterPrefix}${composed}`;
    }
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
      fatFeedbackPolicy,
    });
    const baseBody = macroSentence ? `${primary} ${macroSentence}` : primary;
    const parts = buildNutritionDayNarrativeParts({
      macro,
      roleInfo,
      nutritionStatus: input.nutritionStatus,
      hasEnergyIssue: true,
      loadDay: true,
      fatFeedbackPolicy,
      athleteTrainingLabel,
      previousDayTrainingType,
    });
    const composed = composeNarrativeFromParts({ parts, roleInfo, state });
    const body = composed ?? baseBody;
    return `${cautiousPrefix}${longAfterPrefix}${ensureDetailFloorSentence({ text: body, roleInfo, athleteTrainingLabel })}`;
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
      fatFeedbackPolicy,
    });
    const combinedBase = macroSentence ? `${primary} ${macroSentence}` : primary;
    const parts = buildNutritionDayNarrativeParts({
      macro,
      roleInfo,
      nutritionStatus: input.nutritionStatus,
      hasEnergyIssue: true,
      loadDay,
      fatFeedbackPolicy,
      athleteTrainingLabel,
      previousDayTrainingType,
    });
    const composed = composeNarrativeFromParts({ parts, roleInfo, state });
    const combined = composed ?? combinedBase;
    state.registerExactSentence(combined);
    return `${cautiousPrefix}${longAfterPrefix}${ensureDetailFloorSentence({ text: combined, roleInfo, athleteTrainingLabel })}`;
  }

  if (
    shouldMentionFatInAthleteText({ macro, fatFeedbackPolicy }) &&
    (macro.fatStatus === "low" || input.nutritionStatus === "low_fat" || input.findings.includes("fat_below_floor"))
  ) {
    return `${cautiousPrefix}${longAfterPrefix}Жиров в этот день получилось низковато. Не нужно специально держать такие дни слишком сухими по жирам, особенно если они повторяются.`;
  }

  if (
    shouldShowHighFatAthleteFeedback(fatFeedbackPolicy) &&
    isHighFatMacro(macro) &&
    loadDay &&
    hasLowCarbs(macro, loadDay)
  ) {
    const highFatSentence = buildHighFatAthleteSentence(loadDay, true);
    if (highFatSentence) {
      return `${cautiousPrefix}${longAfterPrefix}${highFatSentence}`;
    }
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
      fatFeedbackPolicy,
    });
    const baseBody = macroSentence ? `${primary} ${macroSentence}` : primary;
    const parts = buildNutritionDayNarrativeParts({
      macro,
      roleInfo,
      nutritionStatus: input.nutritionStatus,
      hasEnergyIssue: false,
      loadDay,
      fatFeedbackPolicy,
      athleteTrainingLabel,
      previousDayTrainingType,
    });
    const composed = composeNarrativeFromParts({ parts, roleInfo, state });
    const body = composed ?? baseBody;
    return `${cautiousPrefix}${longAfterPrefix}${ensureDetailFloorSentence({ text: body, roleInfo, athleteTrainingLabel })}`;
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
    const parts = buildNutritionDayNarrativeParts({
      macro,
      roleInfo,
      nutritionStatus: input.nutritionStatus,
      hasEnergyIssue: false,
      loadDay: true,
      fatFeedbackPolicy,
      athleteTrainingLabel,
      previousDayTrainingType,
    });
    const composed = composeNarrativeFromParts({ parts, roleInfo, state });
    if (composed) {
      return `${cautiousPrefix}${longAfterPrefix}${ensureDetailFloorSentence({
        text: composed,
        roleInfo,
        athleteTrainingLabel,
      })}`;
    }
    return `${cautiousPrefix}${longAfterPrefix}${ensureDetailFloorSentence({
      text: "Это ключевая интервальная работа недели, и по питанию день получился хорошо поддержан. Углеводов было достаточно для такой нагрузки, сильной просадки по энергии не видно.",
      roleInfo,
      athleteTrainingLabel,
    })}`;
  }

  if (roleInfo.role === "key_tempo" && roleInfo.isKey) {
    state.bumpPattern("macro_ok");
    const parts = buildNutritionDayNarrativeParts({
      macro,
      roleInfo,
      nutritionStatus: input.nutritionStatus,
      hasEnergyIssue: false,
      loadDay: true,
      fatFeedbackPolicy,
      athleteTrainingLabel,
      previousDayTrainingType,
    });
    const composed = composeNarrativeFromParts({ parts, roleInfo, state });
    if (composed) {
      return `${cautiousPrefix}${longAfterPrefix}${ensureDetailFloorSentence({
        text: composed,
        roleInfo,
        athleteTrainingLabel,
      })}`;
    }
    return `${cautiousPrefix}${longAfterPrefix}${ensureDetailFloorSentence({
      text: "Это ключевая темповая работа, и по питанию день выглядит ровно: углеводов достаточно, сильной просадки по энергии не видно.",
      roleInfo,
      athleteTrainingLabel,
    })}`;
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
    const parts = buildNutritionDayNarrativeParts({
      macro,
      roleInfo,
      nutritionStatus: input.nutritionStatus,
      hasEnergyIssue: false,
      loadDay: true,
      fatFeedbackPolicy,
      athleteTrainingLabel,
      previousDayTrainingType,
    });
    const composed = composeNarrativeFromParts({ parts, roleInfo, state });
    if (composed) {
      return `${cautiousPrefix}${longAfterPrefix}${ensureDetailFloorSentence({
        text: composed,
        roleInfo,
        athleteTrainingLabel,
      })}`;
    }
    return `${cautiousPrefix}${longAfterPrefix}${ensureDetailFloorSentence({
      text: `Здесь нагрузка двойная (${athleteTrainingLabel}). По питанию день выглядит достаточно ровно: энергии и углеводов хватает для такой связки.`,
      roleInfo,
      athleteTrainingLabel,
    })}`;
  }

  if (roleInfo.role === "long_endurance") {
    state.bumpPattern("macro_ok");
    const parts = buildNutritionDayNarrativeParts({
      macro,
      roleInfo,
      nutritionStatus: input.nutritionStatus,
      hasEnergyIssue: false,
      loadDay: true,
      fatFeedbackPolicy,
      athleteTrainingLabel,
      previousDayTrainingType,
    });
    const composed = composeNarrativeFromParts({ parts, roleInfo, state });
    if (composed) {
      return `${cautiousPrefix}${longAfterPrefix}${ensureDetailFloorSentence({
        text: composed,
        roleInfo,
        athleteTrainingLabel,
      })}`;
    }
    return `${cautiousPrefix}${longAfterPrefix}${ensureDetailFloorSentence({
      text: "Под длинную выносливостную нагрузку день выглядит достаточно ровно: сильной просадки по энергии и углеводам не видно.",
      roleInfo,
      athleteTrainingLabel,
    })}`;
  }

  if (roleInfo.role === "cross_training") {
    state.bumpPattern("macro_ok");
    return `${cautiousPrefix}Под ${athleteTrainingLabel} день выглядит достаточно ровно: сильной просадки по энергии и углеводам не видно.`;
  }

  if (roleInfo.role === "long_run") {
    state.bumpPattern("macro_ok");
    const parts = buildNutritionDayNarrativeParts({
      macro,
      roleInfo,
      nutritionStatus: input.nutritionStatus,
      hasEnergyIssue: false,
      loadDay: true,
      fatFeedbackPolicy,
      athleteTrainingLabel,
      previousDayTrainingType,
    });
    const composed = composeNarrativeFromParts({ parts, roleInfo, state });
    if (composed) {
      return `${cautiousPrefix}${longAfterPrefix}${ensureDetailFloorSentence({
        text: composed,
        roleInfo,
        athleteTrainingLabel,
      })}`;
    }
    return `${cautiousPrefix}${longAfterPrefix}${ensureDetailFloorSentence({
      text: "Под длинную работу день выглядит достаточно ровно: сильной просадки по энергии и углеводам не видно.",
      roleInfo,
      athleteTrainingLabel,
    })}`;
  }

  if (roleInfo.role === "key_interval" || roleInfo.role === "key_tempo") {
    state.bumpPattern("macro_ok");
    return `${cautiousPrefix}${longAfterPrefix}${ensureDetailFloorSentence({
      text: "Под эту ключевую работу питание выглядит согласованно: сильной просадки по дню не видно.",
      roleInfo,
      athleteTrainingLabel,
    })}`;
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
  items?: NutritionFoodItem[];
};

export function buildNutritionWeeklySummary(input: {
  days: NutritionWeeklySummaryDayFact[];
  proteinSufficient?: boolean;
  weeklyProteinAvgGPerKg?: number | null;
  fatFeedbackPolicy?: NutritionFatFeedbackPolicy;
}): string {
  const fatFeedbackPolicy = input.fatFeedbackPolicy ?? "coach_only";
  let proteinOkDays = 0;
  let proteinLowOrBorderlineDays = 0;
  let fatLowOrBorderlineDays = 0;
  let fatHighDays = 0;
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
    if (day.macro.fatStatus === "high" || day.macro.fatPercentStatus === "high") {
      fatHighDays += 1;
    }
    if (loadDay && (day.macro.carbsStatus === "low" || day.macro.carbsStatus === "borderline")) {
      carbsLowLoadDays += 1;
    }
    if (day.hasEnergyIssue && loadDay) {
      energyLowLoadDays += 1;
    }
    if (day.roleInfo.isKey) {
      keyWorkoutLabel = formatNutritionWorkoutLabelForAthlete(day);
    }
    if (
      !mainLoadLabel &&
      (day.roleInfo.role === "long_endurance" ||
        day.roleInfo.role === "long_run" ||
        day.roleInfo.role === "key_interval" ||
        day.roleInfo.role === "key_tempo" ||
        day.roleInfo.role === "combined_load")
    ) {
      mainLoadLabel = formatNutritionWorkoutLabelForAthlete(day);
    }
  }

  const hardestDays = input.days.filter(
    (day) =>
      day.roleInfo.role === "key_interval" ||
      day.roleInfo.role === "key_tempo" ||
      day.roleInfo.role === "long_run" ||
      day.roleInfo.role === "long_endurance" ||
      day.roleInfo.role === "combined_load"
  );
  hardestDayLabels = hardestDays.map((day) => formatNutritionWorkoutLabelForAthlete(day));
  const macroDaysWithCarbs = input.days.filter(
    (day) => day.macro.carbsG != null || day.macro.carbsGPerKg != null || typeof day.macro.carbsStatus === "string"
  );
  const sortedByCarbs = [...macroDaysWithCarbs].sort((left, right) => {
    const leftGrams = left.macro.carbsG ?? (left.macro.carbsGPerKg != null ? left.macro.carbsGPerKg * 100 : null);
    const rightGrams = right.macro.carbsG ?? (right.macro.carbsGPerKg != null ? right.macro.carbsGPerKg * 100 : null);
    if (leftGrams != null && rightGrams != null && leftGrams !== rightGrams) {
      return rightGrams - leftGrams;
    }
    const leftScore = left.macro.carbsStatus === "ok" ? 2 : left.macro.carbsStatus === "borderline" ? 1 : 0;
    const rightScore = right.macro.carbsStatus === "ok" ? 2 : right.macro.carbsStatus === "borderline" ? 1 : 0;
    return rightScore - leftScore;
  });
  carbRichDayLabels = sortedByCarbs.slice(0, 2).map((day) => formatNutritionWorkoutLabelForAthlete(day));

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

  if (
    shouldShowHighFatAthleteFeedback(fatFeedbackPolicy) &&
    fatHighDays >= 1 &&
    carbsLowLoadDays >= 1
  ) {
    segments.push(
      "В несколько дней с нагрузкой жиры были высоковаты, а углеводов не хватало — имеет смысл сместить часть энергии в углеводы вокруг тяжёлых дней."
    );
  }

  if (macroDaysWithCarbs.length >= 5 && hardestDays.length >= 2 && carbRichDayLabels.length > 0) {
    const topCarbDates = new Set(sortedByCarbs.slice(0, 2).map((day) => day.date));
    const hardestDates = new Set(hardestDays.map((day) => day.date));
    const overlapCount = [...topCarbDates].filter((date) => hardestDates.has(date)).length;
    const hardestCarbValues = hardestDays
      .map((day) => day.macro.carbsG ?? (day.macro.carbsGPerKg != null ? day.macro.carbsGPerKg * 60 : null))
      .filter((value): value is number => value != null);
    const topCarbValues = sortedByCarbs
      .slice(0, 2)
      .map((day) => day.macro.carbsG ?? (day.macro.carbsGPerKg != null ? day.macro.carbsGPerKg * 60 : null))
      .filter((value): value is number => value != null);
    const meaningfulDiff =
      hardestCarbValues.length > 0 &&
      topCarbValues.length > 0 &&
      Math.min(...topCarbValues) - Math.max(...hardestCarbValues) >= 15;
    const labelOverlap = carbRichDayLabels.some((label) => hardestDayLabels.includes(label));
    if ((overlapCount < 1 || !labelOverlap) && meaningfulDiff) {
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
  planWeekMode: NutritionPlanTargetWeekMode,
  input?: {
    todayLocalDate?: string;
    miniTableMode?: "athlete_remaining_only" | "full_week";
  }
): string[] {
  if (!nextWeekPlan || nextWeekPlan.days.length === 0) {
    return [];
  }

  const weekLabel = planWeekMode === "current_week" ? "на эту неделю" : "на следующую неделю";
  const today = input?.todayLocalDate;
  const remainingOnly = planWeekMode === "current_week" && (input?.miniTableMode ?? "athlete_remaining_only") === "athlete_remaining_only";
  const daysForFocus =
    remainingOnly && today
      ? nextWeekPlan.days.filter((day) => day.date >= today)
      : nextWeekPlan.days;
  const focusDays = daysForFocus.length > 0 ? daysForFocus : nextWeekPlan.days;
  const lines: string[] = [
    `Фокус ${weekLabel} — не резко увеличивать всё питание, а лучше поддержать дни нагрузки.`,
  ];

  const keyIntervalDay = focusDays.find((day) => {
    const role = resolveTargetPlanDayRole(day);
    return role.role === "key_interval" && (role.isKey || day.flags?.key_workout);
  });
  const longRunDay = focusDays.find((day) => {
    const role = resolveTargetPlanDayRole(day);
    return (
      (role.role === "long_run" || role.role === "long_endurance") &&
      (day.training_type === "long_endurance" ||
        isNutritionLongRunWorkout({
          title: day.workout_title ?? day.training_label,
          mode: "target_plan",
          isCompleted: false,
        }))
    );
  });

  const onlyEasyCrossRest = focusDays.every((day) => {
    const role = resolveTargetPlanDayRole(day).role;
    return role === "easy_run" || role === "cross_training" || role === "rest";
  });

  const meaningfulRemainingLoad = focusDays.some((day) => {
    const role = resolveTargetPlanDayRole(day).role;
    return role === "key_interval" || role === "key_tempo" || role === "long_run" || role === "long_endurance" || role === "combined_load";
  });

  if (keyIntervalDay) {
    const label = humanizeNutritionTrainingLabel(
      keyIntervalDay.workout_title ?? keyIntervalDay.training_label,
      keyIntervalDay.training_type
    );
    lines.push(`Особенно важен день с ${label}: к нему лучше подойти не «пустой» по энергии и углеводам.`);
  } else if (longRunDay) {
    lines.push("На оставшиеся дни фокус простой: не уходить в слишком «пустой» день по энергии и углеводам, особенно вокруг оставшейся длительной нагрузки.");
  } else if (remainingOnly && !meaningfulRemainingLoad) {
    lines.push("На оставшиеся дни задача спокойная: удержать ровное питание и не пытаться резко добирать всё за один день.");
  } else if (onlyEasyCrossRest) {
    lines.push("Фокус — сделать дни с нагрузкой ровнее, без резкого увеличения всех цифр.");
  }

  return lines;
}

function resolveTargetWeekFocusDays(
  nextWeekPlan: NutritionNextWeekPlan,
  planWeekMode: NutritionPlanTargetWeekMode,
  input?: {
    todayLocalDate?: string;
    miniTableMode?: "athlete_remaining_only" | "full_week";
  }
): NutritionNextWeekPlanDay[] {
  const today = input?.todayLocalDate;
  const remainingOnly =
    planWeekMode === "current_week" && (input?.miniTableMode ?? "athlete_remaining_only") === "athlete_remaining_only";
  const daysForFocus =
    remainingOnly && today ? nextWeekPlan.days.filter((day) => day.date >= today) : nextWeekPlan.days;
  return daysForFocus.length > 0 ? daysForFocus : nextWeekPlan.days;
}

function hasFutureKeyWorkoutInFocusDays(focusDays: NutritionNextWeekPlanDay[]): boolean {
  return focusDays.some((day) => {
    const role = resolveTargetPlanDayRole(day).role;
    return (
      role === "key_interval" ||
      role === "key_tempo" ||
      role === "long_run" ||
      role === "long_endurance" ||
      role === "combined_load" ||
      day.flags?.key_workout === true
    );
  });
}

export function buildNutritionTargetWeekMainStepLine(
  nextWeekPlan: NutritionNextWeekPlan | null,
  planWeekMode: NutritionPlanTargetWeekMode,
  input?: {
    todayLocalDate?: string;
    miniTableMode?: "athlete_remaining_only" | "full_week";
  }
): string {
  if (!nextWeekPlan || nextWeekPlan.days.length === 0) {
    return "Главный шаг на этой неделе - поднять энергию и углеводы в дни нагрузки, особенно перед ключевой тренировкой.";
  }
  const remainingOnly =
    planWeekMode === "current_week" && (input?.miniTableMode ?? "athlete_remaining_only") === "athlete_remaining_only";
  const focusDays = resolveTargetWeekFocusDays(nextWeekPlan, planWeekMode, input);
  const futureKeyWorkout = hasFutureKeyWorkoutInFocusDays(focusDays);
  if (remainingOnly && !futureKeyWorkout) {
    return "На оставшиеся дни фокус простой: не пытаться резко добрать всё питание, а ровно поддержать энергию и углеводы в беговой день и спокойно закрыть восстановление.";
  }
  if (futureKeyWorkout) {
    return "Главный шаг на этой неделе - поднять энергию и углеводы в дни нагрузки, особенно перед ключевой тренировкой.";
  }
  return "Главный шаг на этой неделе - поднять энергию и углеводы в дни нагрузки.";
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
