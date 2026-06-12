import {
  buildNutritionInterpretationValidationFacts,
  NUTRITION_INTERPRETATION_SHADOW_VERSION,
  validateNutritionWeeklyInterpretation,
  type NutritionInterpretationValidationIssue,
  type NutritionWeeklyInterpretation,
} from "@/features/nutrition/interpretation-contract";
import { NUTRITION_REVIEW_NARRATIVE_PROMPT_LINES } from "@/features/nutrition/narrative-guardrails";
import type { TrainingPeaksTelegramFormality } from "@/features/trainingpeaks/repository";
import { getTrainingPeaksReplyDraftFormalityInstruction } from "@/features/trainingpeaks/telegram-context";

const OPENAI_API_URL = process.env.OPENAI_API_URL?.trim() || "https://api.openai.com/v1/chat/completions";
const OPENAI_NUTRITION_INTERPRETATION_MODEL =
  process.env.OPENAI_NUTRITION_WEEKLY_REVIEW_MODEL?.trim() || "gpt-4o-mini";
const NUTRITION_INTERPRETATION_PROMPT_VERSION = "nutrition-interpretation-shadow-v1";

export type NutritionInterpretationShadowMetadata = {
  version: typeof NUTRITION_INTERPRETATION_SHADOW_VERSION;
  mode: "ai" | "fallback" | "disabled";
  generated_at: string;
  validation_ok: boolean;
  issues: NutritionInterpretationValidationIssue[];
  interpretation: NutritionWeeklyInterpretation | null;
  prompt_version?: string;
};

function extractJsonOnly(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildFallbackInterpretation(input: {
  factsPayload: Record<string, unknown>;
  formality: TrainingPeaksTelegramFormality;
}): NutritionWeeklyInterpretation {
  const dailyAnalysis = Array.isArray(input.factsPayload.daily_analysis) ? input.factsPayload.daily_analysis : [];
  const oneFocus = asObject(input.factsPayload.one_focus);
  const focusStatement =
    readString(oneFocus.statement_ru) ||
    "Держим ровную энергию вокруг ключевых тренировок без резких шагов.";
  const daily_blocks = dailyAnalysis
    .map((raw) => {
      const day = asObject(raw);
      const date = readString(day.date);
      if (!date) {
        return null;
      }
      const hint = readString(day.hint_for_comment) || readString(day.hintForComment);
      const findings = Array.isArray(day.findings)
        ? day.findings.filter((item): item is string => typeof item === "string")
        : [];
      const comment_ru =
        hint ||
        (findings[0]
          ? `По этому дню сигнал: ${findings[0].replace(/_/g, " ")}.`
          : "Питание выглядит относительно ровно относительно нагрузки дня.");
      return { date, comment_ru };
    })
    .filter((block): block is { date: string; comment_ru: string } => Boolean(block));
  const weekLead =
    input.formality === "vy"
      ? "По неделе в целом питание выглядит рабочим, но есть точки, где нагрузка и питание расходились."
      : "По неделе в целом питание нормальное, но есть моменты, где нагрузка и питание расходились.";
  return {
    daily_blocks,
    week_summary_ru: weekLead,
    one_focus_statement_ru: focusStatement.replace(/^главный\s+фокус(?:\s+недели)?\s*[—:-]\s*/i, "").trim(),
    week_comparison_line_ru: null,
  };
}

function buildInterpretationSystemPrompt(formality: TrainingPeaksTelegramFormality): string {
  const formalityInstruction = getTrainingPeaksReplyDraftFormalityInstruction(formality);
  return [
    "Return strict JSON only.",
    "Interpretation-only contract: do NOT write final athlete message.",
    "Do NOT write greeting or closing.",
    "Do NOT write mini-table or plan targets section.",
    "Do NOT calculate kcal/protein/fat/carbs or g/kg.",
    "Use deterministic facts only.",
    "Use coach_context_ru as interpretation context but do not quote it verbatim.",
    "Use athlete_report_signals carefully; no medical claims.",
    "Russian only. Plain text only.",
    "Hedged causality only: может, могло, вполне могло.",
    "One formality style only.",
    "Output schema:",
    '{"daily_blocks":[{"date":"YYYY-MM-DD","comment_ru":"..."}],"week_summary_ru":"...","one_focus_statement_ru":"...","week_comparison_line_ru":null}',
    "daily_blocks must cover every date in daily_analysis exactly once.",
    "week_comparison_line_ru must be null unless previous_weeks_context exists in facts.",
    "Forbidden in all fields: markdown (** , headings, code fences, ---), greetings, closings, RED-S, LEA, энергодоступность, дефицит, диагноз, гормоны, медицинский, TrainingPeaks.",
    ...NUTRITION_REVIEW_NARRATIVE_PROMPT_LINES,
    `Formality instruction: ${formalityInstruction}`,
    `Prompt version: ${NUTRITION_INTERPRETATION_PROMPT_VERSION}`,
  ].join("\n");
}

export function buildNutritionInterpretationFactsPayload(factsPayload: unknown): Record<string, unknown> {
  const payload = asObject(factsPayload);
  const student = asObject(payload.student);
  return {
    student: {
      name: student.name ?? payload.studentName ?? null,
      formality: student.formality ?? payload.formality ?? "unknown",
      nutrition_goal: student.nutrition_goal ?? payload.nutrition_goal ?? null,
      coach_context_ru: student.coach_context_ru ?? payload.coach_context_ru ?? null,
    },
    athlete_report_signals: payload.athlete_report_signals ?? [],
    previous_weeks_context: payload.previous_weeks_context ?? payload.previousWeeksContext ?? null,
    daily_analysis: payload.daily_analysis ?? [],
    one_focus: payload.one_focus ?? null,
    methodology_signals: payload.methodology_signals ?? null,
    data_quality: payload.data_quality ?? null,
  };
}

export function resolveNutritionInterpretationPreviousWeeksContext(factsPayload: unknown): boolean {
  const payload = asObject(factsPayload);
  const candidate = payload.previous_weeks_context ?? payload.previousWeeksContext;
  if (Array.isArray(candidate)) {
    return candidate.length > 0;
  }
  return Object.keys(asObject(candidate)).length > 0;
}

export async function generateNutritionWeeklyInterpretationShadow(input: {
  factsPayload: unknown;
  formality: "ty" | "vy" | "unknown";
  studentName: string;
}): Promise<{
  mode: "ai" | "fallback" | "disabled";
  interpretation: NutritionWeeklyInterpretation | null;
  issues: NutritionInterpretationValidationIssue[];
  raw?: unknown;
}> {
  const factsPayload = buildNutritionInterpretationFactsPayload(input.factsPayload);
  const hasPreviousWeeksContext = resolveNutritionInterpretationPreviousWeeksContext(factsPayload);
  const validationFacts = buildNutritionInterpretationValidationFacts({
    dailyAnalysis: factsPayload.daily_analysis,
    hasPreviousWeeksContext,
  });

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    const fallback = buildFallbackInterpretation({
      factsPayload,
      formality: input.formality,
    });
    const validated = validateNutritionWeeklyInterpretation(fallback, validationFacts);
    return {
      mode: "disabled",
      interpretation: validated.interpretation ?? null,
      issues: validated.issues,
    };
  }

  const systemPrompt = buildInterpretationSystemPrompt(input.formality);
  try {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_NUTRITION_INTERPRETATION_MODEL,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Facts JSON:\n${JSON.stringify(
              {
                ...factsPayload,
                student: {
                  ...asObject(factsPayload.student),
                  name: input.studentName,
                  formality: input.formality,
                },
              },
              null,
              2
            )}`,
          },
        ],
      }),
    });
    if (!response.ok) {
      const fallback = buildFallbackInterpretation({
        factsPayload,
        formality: input.formality,
      });
      const validated = validateNutritionWeeklyInterpretation(fallback, validationFacts);
      return {
        mode: "fallback",
        interpretation: validated.interpretation ?? null,
        issues: validated.issues,
      };
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      const fallback = buildFallbackInterpretation({
        factsPayload,
        formality: input.formality,
      });
      const validated = validateNutritionWeeklyInterpretation(fallback, validationFacts);
      return {
        mode: "fallback",
        interpretation: validated.interpretation ?? null,
        issues: validated.issues,
      };
    }
    const raw = JSON.parse(extractJsonOnly(content)) as unknown;
    const validated = validateNutritionWeeklyInterpretation(raw, validationFacts);
    return {
      mode: "ai",
      interpretation: validated.interpretation ?? null,
      issues: validated.issues,
      raw,
    };
  } catch {
    const fallback = buildFallbackInterpretation({
      factsPayload,
      formality: input.formality,
    });
    const validated = validateNutritionWeeklyInterpretation(fallback, validationFacts);
    return {
      mode: "fallback",
      interpretation: validated.interpretation ?? null,
      issues: validated.issues,
    };
  }
}

export function buildNutritionInterpretationShadowMetadata(input: {
  mode: "ai" | "fallback" | "disabled";
  interpretation: NutritionWeeklyInterpretation | null;
  issues: NutritionInterpretationValidationIssue[];
}): NutritionInterpretationShadowMetadata {
  return {
    version: NUTRITION_INTERPRETATION_SHADOW_VERSION,
    mode: input.mode,
    generated_at: new Date().toISOString(),
    validation_ok: input.issues.every((issue) => issue.severity !== "error"),
    issues: input.issues,
    interpretation: input.interpretation,
    prompt_version: NUTRITION_INTERPRETATION_PROMPT_VERSION,
  };
}

export { NUTRITION_INTERPRETATION_PROMPT_VERSION };
