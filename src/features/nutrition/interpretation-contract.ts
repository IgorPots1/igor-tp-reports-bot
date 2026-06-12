import { NUTRITION_ATHLETE_FORBIDDEN_MEDICAL_TERMS } from "@/features/nutrition/narrative-guardrails";

export const NUTRITION_INTERPRETATION_SHADOW_VERSION = "nutrition_interpretation_v1";

export type NutritionWeeklyInterpretationDailyBlock = {
  date: string;
  comment_ru: string;
};

export type NutritionWeeklyInterpretation = {
  daily_blocks: NutritionWeeklyInterpretationDailyBlock[];
  week_summary_ru: string;
  one_focus_statement_ru: string;
  week_comparison_line_ru?: string | null;
};

export type NutritionInterpretationValidationIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

export type NutritionInterpretationValidationFacts = {
  dailyDates: string[];
  hasPreviousWeeksContext: boolean;
  dayMacroValuesByDate: Record<
    string,
    {
      kcal: number | null;
      proteinG: number | null;
      fatG: number | null;
      carbsG: number | null;
    }
  >;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const FORBIDDEN_STRUCTURE_GREETING = [/привет/i, /здравствуйте/i];
const FORBIDDEN_STRUCTURE_CLOSING = [/на следующем разборе/i];
const FORBIDDEN_STRUCTURE_MINI_TABLE = [/📋/, /мини-таблиц/i];
const FORBIDDEN_STRUCTURE_PLAN_NUMBERS = [
  /цифры ниже/i,
  /ориентиры, не обязательство/i,
  /\d+\s*[бБ](?:\b|$)/i,
  /\d+\s*[жЖ](?:\b|$)/i,
  /\d+\s*[уУ](?:\b|$)/i,
  /\d{3,5}\s*ккал.*\d+\s*[бБжЖуУ]/i,
];

const FORBIDDEN_INTERPRETATION_TERMS = [
  ...NUTRITION_ATHLETE_FORBIDDEN_MEDICAL_TERMS,
  "TrainingPeaks",
  "trainingpeaks",
] as const;

const MARKDOWN_PATTERNS = [/\*\*/, /^#{1,6}\s/m, /```/, /^---$/m];

const MACRO_LIKE_PATTERNS = [
  /\d{3,5}\s*ккал/i,
  /\d{2,4}\s*г\s*(?:белк|жир|углевод)/i,
  /~\d+\s*ккал/i,
  /\d+\s*б\b/i,
  /\d+\s*ж\b/i,
  /\d+\s*у\b/i,
  /\d+[,.]?\d*\s*г\/кг/i,
];

const MAX_DAILY_COMMENT_CHARS = 300;
const MAX_WEEK_SUMMARY_CHARS = 600;
const MAX_FOCUS_CHARS = 300;

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
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

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isNullOrEmpty(value: unknown): boolean {
  if (value == null) {
    return true;
  }
  return typeof value === "string" && value.trim().length === 0;
}

function extractDayMacroValues(day: Record<string, unknown>): {
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
} {
  const actual = asObject(day.actual);
  const canonical = asObject(day.canonical_daily_analysis ?? day.canonicalDailyAnalysis);
  const canonicalActual = asObject(canonical.actual);
  return {
    kcal:
      toFiniteNumber(day.kcal) ??
      toFiniteNumber(day.actual_kcal) ??
      toFiniteNumber(actual.kcal) ??
      toFiniteNumber(canonicalActual.kcal),
    proteinG:
      toFiniteNumber(day.proteinG) ??
      toFiniteNumber(day.protein_g) ??
      toFiniteNumber(actual.proteinG) ??
      toFiniteNumber(canonicalActual.proteinG),
    fatG:
      toFiniteNumber(day.fatG) ??
      toFiniteNumber(day.fat_g) ??
      toFiniteNumber(actual.fatG) ??
      toFiniteNumber(canonicalActual.fatG),
    carbsG:
      toFiniteNumber(day.carbsG) ??
      toFiniteNumber(day.carbs_g) ??
      toFiniteNumber(actual.carbsG) ??
      toFiniteNumber(canonicalActual.carbsG),
  };
}

export function buildNutritionInterpretationValidationFacts(input: {
  dailyAnalysis: unknown;
  hasPreviousWeeksContext: boolean;
}): NutritionInterpretationValidationFacts {
  const dailyDates: string[] = [];
  const dayMacroValuesByDate: NutritionInterpretationValidationFacts["dayMacroValuesByDate"] = {};
  const rows = Array.isArray(input.dailyAnalysis) ? input.dailyAnalysis : [];
  for (const raw of rows) {
    const day = asObject(raw);
    const date = typeof day.date === "string" ? day.date : null;
    if (!date || !ISO_DATE_RE.test(date)) {
      continue;
    }
    dailyDates.push(date);
    dayMacroValuesByDate[date] = extractDayMacroValues(day);
  }
  return {
    dailyDates: [...new Set(dailyDates)].sort(),
    hasPreviousWeeksContext: input.hasPreviousWeeksContext,
    dayMacroValuesByDate,
  };
}

export function countForbiddenInterpretationTerms(text: string): Record<string, number> {
  const lower = text.toLowerCase();
  const counts: Record<string, number> = {};
  for (const term of FORBIDDEN_INTERPRETATION_TERMS) {
    const needle = term.toLowerCase();
    let count = 0;
    let position = 0;
    while (position < lower.length) {
      const index = lower.indexOf(needle, position);
      if (index < 0) {
        break;
      }
      count += 1;
      position = index + Math.max(needle.length, 1);
    }
    if (count > 0) {
      counts[term] = count;
    }
  }
  return counts;
}

function collectAllowedMacroNumbers(
  facts: NutritionInterpretationValidationFacts,
  date?: string
): number[] {
  const values: number[] = [];
  const dates = date ? [date] : facts.dailyDates;
  for (const dayDate of dates) {
    const macros = facts.dayMacroValuesByDate[dayDate];
    if (!macros) {
      continue;
    }
    for (const value of [macros.kcal, macros.proteinG, macros.fatG, macros.carbsG]) {
      if (value != null && Number.isFinite(value)) {
        values.push(Math.round(value));
        values.push(value);
      }
    }
  }
  return [...new Set(values)];
}

function numberAppearsInAllowedSet(candidate: number, allowed: number[]): boolean {
  const rounded = Math.round(candidate);
  return allowed.some((value) => Math.abs(value - candidate) <= 1 || Math.abs(Math.round(value) - rounded) <= 1);
}

export function countMacroNumberWarnings(
  text: string,
  allowedValues: number[]
): number {
  let warnings = 0;
  const numberMatches = text.match(/\d{2,5}/g) ?? [];
  for (const raw of numberMatches) {
    const candidate = Number(raw);
    if (!Number.isFinite(candidate)) {
      continue;
    }
    const looksMacro =
      MACRO_LIKE_PATTERNS.some((pattern) => pattern.test(text)) ||
      /ккал|белк|жир|углевод|г\/кг/i.test(text);
    if (!looksMacro) {
      continue;
    }
    if (!numberAppearsInAllowedSet(candidate, allowedValues)) {
      warnings += 1;
    }
  }
  return warnings;
}

function pushIssue(
  issues: NutritionInterpretationValidationIssue[],
  issue: NutritionInterpretationValidationIssue
): void {
  issues.push(issue);
}

function validateTextStructure(
  text: string,
  fieldLabel: string,
  issues: NutritionInterpretationValidationIssue[]
): void {
  for (const pattern of MARKDOWN_PATTERNS) {
    if (pattern.test(text)) {
      pushIssue(issues, {
        severity: "error",
        code: "forbidden_markdown",
        message: `${fieldLabel} must not contain markdown (${pattern}).`,
      });
    }
  }
  for (const pattern of FORBIDDEN_STRUCTURE_GREETING) {
    if (pattern.test(text)) {
      pushIssue(issues, {
        severity: "error",
        code: "forbidden_greeting",
        message: `${fieldLabel} must not contain greeting phrases.`,
      });
    }
  }
  for (const pattern of FORBIDDEN_STRUCTURE_CLOSING) {
    if (pattern.test(text)) {
      pushIssue(issues, {
        severity: "error",
        code: "forbidden_closing",
        message: `${fieldLabel} must not contain closing phrases.`,
      });
    }
  }
  for (const pattern of FORBIDDEN_STRUCTURE_MINI_TABLE) {
    if (pattern.test(text)) {
      pushIssue(issues, {
        severity: "error",
        code: "forbidden_mini_table",
        message: `${fieldLabel} must not contain mini-table structure.`,
      });
    }
  }
  for (const pattern of FORBIDDEN_STRUCTURE_PLAN_NUMBERS) {
    if (pattern.test(text)) {
      pushIssue(issues, {
        severity: "error",
        code: "forbidden_plan_numbers",
        message: `${fieldLabel} must not contain plan target numbers section.`,
      });
    }
  }
  const forbiddenCounts = countForbiddenInterpretationTerms(text);
  for (const [term, count] of Object.entries(forbiddenCounts)) {
    pushIssue(issues, {
      severity: "error",
      code: "forbidden_term",
      message: `${fieldLabel} contains forbidden term "${term}" (${count}).`,
    });
  }
  if (/[A-Za-z]{4,}/.test(text)) {
    pushIssue(issues, {
      severity: "warning",
      code: "non_russian_latin",
      message: `${fieldLabel} contains Latin words; interpretation should stay Russian/plain text.`,
    });
  }
}

function validateMacroNumbersInText(
  text: string,
  fieldLabel: string,
  allowedValues: number[],
  issues: NutritionInterpretationValidationIssue[]
): void {
  const warnings = countMacroNumberWarnings(text, allowedValues);
  if (warnings > 0) {
    pushIssue(issues, {
      severity: "warning",
      code: "macro_number_not_in_facts",
      message: `${fieldLabel} may introduce macro numbers not present in deterministic day facts (${warnings}).`,
    });
  }
  if (MACRO_LIKE_PATTERNS.some((pattern) => pattern.test(text)) && allowedValues.length === 0) {
    pushIssue(issues, {
      severity: "warning",
      code: "macro_like_without_facts",
      message: `${fieldLabel} contains macro-like numbers but day facts have no comparable values.`,
    });
  }
}

function normalizeInterpretationShape(input: unknown): NutritionWeeklyInterpretation | null {
  const root = asObject(input);
  const dailyBlocksRaw = root.daily_blocks;
  if (!Array.isArray(dailyBlocksRaw)) {
    return null;
  }
  const daily_blocks: NutritionWeeklyInterpretationDailyBlock[] = [];
  for (const raw of dailyBlocksRaw) {
    const block = asObject(raw);
    const date = normalizeText(block.date);
    const comment_ru = normalizeText(block.comment_ru);
    if (!date || !comment_ru) {
      return null;
    }
    daily_blocks.push({ date, comment_ru });
  }
  const week_summary_ru = normalizeText(root.week_summary_ru);
  const one_focus_statement_ru = normalizeText(root.one_focus_statement_ru);
  if (!week_summary_ru || !one_focus_statement_ru) {
    return null;
  }
  const weekComparisonRaw = root.week_comparison_line_ru;
  const week_comparison_line_ru =
    weekComparisonRaw == null ? null : normalizeText(weekComparisonRaw) || null;
  return {
    daily_blocks,
    week_summary_ru,
    one_focus_statement_ru,
    week_comparison_line_ru,
  };
}

export function validateNutritionWeeklyInterpretation(
  input: unknown,
  facts: NutritionInterpretationValidationFacts
): {
  ok: boolean;
  issues: NutritionInterpretationValidationIssue[];
  interpretation?: NutritionWeeklyInterpretation;
} {
  const issues: NutritionInterpretationValidationIssue[] = [];
  const interpretation = normalizeInterpretationShape(input);
  if (!interpretation) {
    pushIssue(issues, {
      severity: "error",
      code: "invalid_shape",
      message: "Interpretation JSON shape is invalid.",
    });
    return { ok: false, issues };
  }

  const canonicalDates = [...facts.dailyDates].sort();
  const blockDates = interpretation.daily_blocks.map((block) => block.date).sort();
  if (blockDates.length !== canonicalDates.length) {
    pushIssue(issues, {
      severity: "error",
      code: "daily_blocks_count_mismatch",
      message: `daily_blocks length ${blockDates.length} does not match canonical dates ${canonicalDates.length}.`,
    });
  }
  for (const date of canonicalDates) {
    if (!blockDates.includes(date)) {
      pushIssue(issues, {
        severity: "error",
        code: "missing_daily_block",
        message: `Missing daily block for canonical date ${date}.`,
      });
    }
  }
  for (const date of blockDates) {
    if (!ISO_DATE_RE.test(date)) {
      pushIssue(issues, {
        severity: "error",
        code: "invalid_date",
        message: `Invalid date format: ${date}.`,
      });
    }
    if (!canonicalDates.includes(date)) {
      pushIssue(issues, {
        severity: "error",
        code: "extra_daily_date",
        message: `Extra daily block date not in canonical facts: ${date}.`,
      });
    }
  }

  for (const block of interpretation.daily_blocks) {
    if (!block.comment_ru) {
      pushIssue(issues, {
        severity: "error",
        code: "empty_daily_comment",
        message: `Empty comment_ru for ${block.date}.`,
      });
    }
    if (block.comment_ru.length > MAX_DAILY_COMMENT_CHARS) {
      pushIssue(issues, {
        severity: "error",
        code: "daily_comment_too_long",
        message: `comment_ru for ${block.date} exceeds ${MAX_DAILY_COMMENT_CHARS} chars.`,
      });
    }
    validateTextStructure(block.comment_ru, `daily_blocks[${block.date}]`, issues);
    validateMacroNumbersInText(
      block.comment_ru,
      `daily_blocks[${block.date}]`,
      collectAllowedMacroNumbers(facts, block.date),
      issues
    );
  }

  if (interpretation.week_summary_ru.length > MAX_WEEK_SUMMARY_CHARS) {
    pushIssue(issues, {
      severity: "error",
      code: "week_summary_too_long",
      message: `week_summary_ru exceeds ${MAX_WEEK_SUMMARY_CHARS} chars.`,
    });
  }
  if (interpretation.one_focus_statement_ru.length > MAX_FOCUS_CHARS) {
    pushIssue(issues, {
      severity: "error",
      code: "focus_too_long",
      message: `one_focus_statement_ru exceeds ${MAX_FOCUS_CHARS} chars.`,
    });
  }

  validateTextStructure(interpretation.week_summary_ru, "week_summary_ru", issues);
  validateTextStructure(interpretation.one_focus_statement_ru, "one_focus_statement_ru", issues);
  validateMacroNumbersInText(
    interpretation.week_summary_ru,
    "week_summary_ru",
    collectAllowedMacroNumbers(facts),
    issues
  );
  validateMacroNumbersInText(
    interpretation.one_focus_statement_ru,
    "one_focus_statement_ru",
    collectAllowedMacroNumbers(facts),
    issues
  );

  if (!facts.hasPreviousWeeksContext && !isNullOrEmpty(interpretation.week_comparison_line_ru)) {
    pushIssue(issues, {
      severity: "error",
      code: "phantom_week_comparison",
      message: "week_comparison_line_ru is only allowed when previous weeks context exists.",
    });
  }
  if (!isNullOrEmpty(interpretation.week_comparison_line_ru)) {
    validateTextStructure(interpretation.week_comparison_line_ru ?? "", "week_comparison_line_ru", issues);
    validateMacroNumbersInText(
      interpretation.week_comparison_line_ru ?? "",
      "week_comparison_line_ru",
      collectAllowedMacroNumbers(facts),
      issues
    );
  }

  const hasErrors = issues.some((issue) => issue.severity === "error");
  return {
    ok: !hasErrors,
    issues,
    interpretation,
  };
}
