import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { buildDerivedNutritionCombinedMessage } from "../src/features/nutrition/combined-message";
import {
  buildNutritionInterpretationValidationFacts,
  validateNutritionWeeklyInterpretation,
  type NutritionInterpretationValidationIssue,
  type NutritionWeeklyInterpretation,
} from "../src/features/nutrition/interpretation-contract";
import {
  analyzeProductionText,
  analyzeShadowInterpretation,
  buildCanonicalFactsReadiness,
  buildReviewerPack,
  compareNutritionOutputs,
  NUTRITION_AUDIT_VERDICTS,
  slugify,
  type NutritionAuditVerdict,
} from "../src/features/nutrition/interpretation-audit";
import {
  buildNutritionInterpretationFactsPayload,
  generateNutritionWeeklyInterpretationShadow,
  resolveNutritionInterpretationPreviousWeeksContext,
} from "../src/features/nutrition/interpretation-generator";
import {
  getLatestNutritionWeeklyPlanForStudentWeek,
  getNutritionStudentDefaultWeek,
  getNutritionWeeklyAnalysisForWeek,
  type NutritionWeeklyAnalysis,
  type NutritionWeeklyPlan,
} from "../src/features/nutrition/repository";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

// Read-only default. DB writes are NEVER performed by this audit. If a future
// variant needs to persist audit fixtures, it must require these explicit flags.
const NUTRITION_AUDIT_APPLY_CONFIRM = "GENERATE NUTRITION AUDIT FIXTURES";
const AUDIT_REPORT_ROOT = join("reports", "nutrition-interpretation-shadow-audit");

type AuditMode = "saved-review" | "file-fixture" | "auto-discover";

type CliOptions = {
  students: string[];
  weekFrom?: string;
  weekTo?: string;
  mode?: AuditMode;
  fixtureGlob?: string;
  autoDiscover: boolean;
  limit: number;
  studentName?: string;
  regenShadow: boolean;
  apply: boolean;
  confirm?: string;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { students: [], autoDiscover: false, limit: 5, regenShadow: false, apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--students" && next) {
      options.students = next
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
      index += 1;
    } else if (arg === "--week-from" && next) {
      options.weekFrom = next;
      index += 1;
    } else if (arg === "--week-to" && next) {
      options.weekTo = next;
      index += 1;
    } else if (arg === "--mode" && next) {
      if (next === "saved-review" || next === "file-fixture" || next === "auto-discover") {
        options.mode = next;
      }
      index += 1;
    } else if (arg === "--fixture-glob" && next) {
      options.fixtureGlob = next;
      index += 1;
    } else if (arg === "--auto-discover") {
      options.autoDiscover = true;
    } else if (arg === "--limit" && next) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.limit = parsed;
      }
      index += 1;
    } else if (arg === "--student-name" && next) {
      options.studentName = next;
      index += 1;
    } else if (arg === "--regen-shadow") {
      options.regenShadow = true;
    } else if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--confirm" && next) {
      options.confirm = next;
      index += 1;
    }
  }
  return options;
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isoDate(value: string | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function addIsoDays(date: string, days: number): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return date;
  }
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function timestampDir(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

type StudentRow = { id: string; student_id: string; student_name: string };

type CaseRecord = {
  caseId: string;
  studentName: string;
  source: "saved-review" | "file-fixture";
  weekFrom: string;
  weekTo: string;
  reportId?: string | null;
  reviewId?: string | null;
  planId?: string | null;
  factsReadiness: ReturnType<typeof buildCanonicalFactsReadiness>;
  production: ReturnType<typeof analyzeProductionText> & { status: string };
  shadow: ReturnType<typeof analyzeShadowInterpretation>;
  comparison: ReturnType<typeof compareNutritionOutputs>;
};

type SkippedCase = { name: string; reason: string };

function resolveCoachContext(review: NutritionWeeklyAnalysis): string | null {
  const summary = toObject(review.nutritionSummary);
  if (typeof summary.coach_context_ru === "string" && summary.coach_context_ru.trim()) {
    return summary.coach_context_ru;
  }
  const snapshot = toObject(review.contextSnapshot);
  if (typeof snapshot.coach_context_ru === "string" && snapshot.coach_context_ru.trim()) {
    return snapshot.coach_context_ru;
  }
  return null;
}

function hasPreviousWeeksContextFromReview(review: NutritionWeeklyAnalysis): boolean {
  const summary = toObject(review.nutritionSummary);
  const internal = toObject(review.internalSummary);
  const snapshot = toObject(review.contextSnapshot);
  const candidates = [
    summary.previous_weeks_context,
    summary.previousWeeksContext,
    internal.previous_weeks_context,
    snapshot.previous_weeks_context,
  ];
  return candidates.some((candidate) => {
    if (Array.isArray(candidate)) {
      return candidate.length > 0;
    }
    return Object.keys(toObject(candidate)).length > 0;
  });
}

async function buildSavedReviewCase(input: {
  student: StudentRow;
  weekFrom: string;
  weekTo: string;
  regenShadow: boolean;
}): Promise<{ record: CaseRecord; productionText: string | null; interpretation: NutritionWeeklyInterpretation | null; athleteContext: string[]; factsSummary: string[] } | null> {
  const { student, weekFrom, weekTo } = input;
  const review = await getNutritionWeeklyAnalysisForWeek({ studentId: student.id, weekFrom, weekTo });
  if (!review) {
    return null;
  }
  const summary = toObject(review.nutritionSummary);
  const daily = Array.isArray(summary.daily_analysis) ? summary.daily_analysis : [];
  const coachContext = resolveCoachContext(review);
  const athleteSignals = Array.isArray(summary.athlete_report_signals) ? summary.athlete_report_signals : [];
  const previousWeeksContext = hasPreviousWeeksContextFromReview(review);

  const factsPayload = buildNutritionInterpretationFactsPayload({
    student: { name: student.student_name, formality: "unknown", coach_context_ru: coachContext },
    athlete_report_signals: athleteSignals,
    previous_weeks_context: previousWeeksContext ? summary.previous_weeks_context ?? [{ week_from: weekFrom }] : null,
    daily_analysis: daily,
    one_focus: summary.one_focus ?? null,
    methodology_signals: summary.methodology_signals ?? null,
    data_quality: summary.data_quality_summary ?? null,
  });
  const validationFacts = buildNutritionInterpretationValidationFacts({
    dailyAnalysis: factsPayload.daily_analysis,
    hasPreviousWeeksContext: resolveNutritionInterpretationPreviousWeeksContext(factsPayload),
  });

  // Prefer stored shadow; dry-run generate only when missing or explicitly requested.
  const storedShadow = toObject(summary.interpretation_shadow);
  let shadowMode = typeof storedShadow.mode === "string" ? storedShadow.mode : "n/a";
  let interpretation = (storedShadow.interpretation as NutritionWeeklyInterpretation | null) ?? null;
  if (input.regenShadow || !storedShadow.version) {
    const generated = await generateNutritionWeeklyInterpretationShadow({
      factsPayload,
      formality: "unknown",
      studentName: student.student_name,
    });
    shadowMode = generated.mode;
    interpretation = generated.interpretation;
  }
  const validated = validateNutritionWeeklyInterpretation(interpretation, validationFacts);
  const issues: NutritionInterpretationValidationIssue[] = validated.issues;
  interpretation = validated.interpretation ?? interpretation;

  // Current derived composer output (production copy-ready block).
  const planWeekFrom = addIsoDays(weekTo, 1);
  const planWeekTo = addIsoDays(weekTo, 7);
  let plan: NutritionWeeklyPlan | null = null;
  try {
    plan = await getLatestNutritionWeeklyPlanForStudentWeek({ studentId: student.id, planWeekFrom, planWeekTo });
  } catch {
    plan = null;
  }
  const combined = buildDerivedNutritionCombinedMessage({
    review,
    plan,
    formality: "ty",
    studentName: student.student_name,
  });
  const productionText = combined.athleteMessageDraft;

  const readiness = buildCanonicalFactsReadiness({
    dailyAnalysis: daily,
    coachContextPresent: Boolean(coachContext && coachContext.trim()),
    athleteSignalsCount: athleteSignals.length,
    previousWeeksContextPresent: previousWeeksContext,
  });
  const production = analyzeProductionText({ text: productionText, warnings: combined.warnings });
  const shadow = analyzeShadowInterpretation({ mode: shadowMode, interpretation, issues, facts: validationFacts });
  const comparison = compareNutritionOutputs({ production, shadow, interpretation, readiness });

  const athleteContext: string[] = [];
  if (coachContext) {
    athleteContext.push("coach_context_ru present (not quoted verbatim)");
  }
  athleteContext.push(`athlete_report_signals: ${athleteSignals.length}`);
  athleteContext.push(`previous_weeks_context: ${previousWeeksContext ? "yes" : "no"}`);

  const factsSummary: string[] = [
    `canonical days: ${readiness.dailyCount}`,
    `key workout days: ${readiness.keyWorkoutDates.join(", ") || "none"}`,
    `long run days: ${readiness.longRunDates.join(", ") || "none"}`,
    `long endurance days: ${readiness.longEnduranceDays.join(", ") || "none"}`,
    `missing nutrition training days: ${readiness.missingNutritionTrainingDays.join(", ") || "none"}`,
    `adjacent missing nutrition days: ${readiness.adjacentTrainingWithoutNutritionDays.join(", ") || "none"}`,
    `main load day: ${readiness.mainLoadDay ?? "none"}`,
    `carb placement insight: ${readiness.carbPlacementInsight ?? "none"}`,
    `macro guardrails present: ${readiness.macroGuardrails ? "yes" : "no"}`,
    `energy availability screening present: ${readiness.energyAvailability ? "yes" : "no"}`,
  ];

  const record: CaseRecord = {
    caseId: slugify(`${student.student_name}-${weekFrom}`),
    studentName: student.student_name,
    source: "saved-review",
    weekFrom,
    weekTo,
    reportId: review.reportId,
    reviewId: review.id,
    planId: plan?.id ?? null,
    factsReadiness: readiness,
    production: { ...production, status: combined.status },
    shadow,
    comparison,
  };

  return { record, productionText, interpretation, athleteContext, factsSummary };
}

async function resolveNamedStudents(
  supabase: SupabaseClient,
  names: string[],
  skipped: SkippedCase[]
): Promise<StudentRow[]> {
  const resolved: StudentRow[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const { data, error } = await supabase
      .from("trainingpeaks_students")
      .select("id,student_id,student_name")
      .ilike("student_name", `%${name}%`)
      .limit(5);
    if (error) {
      skipped.push({ name, reason: `lookup error: ${error.message}` });
      continue;
    }
    const rows = (data as StudentRow[]) ?? [];
    if (rows.length === 0) {
      skipped.push({ name, reason: "student not found" });
      continue;
    }
    if (rows.length > 1) {
      // Prefer an exact case-insensitive match if present; otherwise note ambiguity but take first.
      const exact = rows.find((row) => row.student_name.toLowerCase() === name.toLowerCase());
      const picked = exact ?? rows[0];
      if (!exact) {
        skipped.push({
          name,
          reason: `ambiguous (${rows.map((row) => row.student_name).join(", ")}); used ${picked.student_name}`,
        });
      }
      if (!seen.has(picked.id)) {
        seen.add(picked.id);
        resolved.push(picked);
      }
      continue;
    }
    if (!seen.has(rows[0].id)) {
      seen.add(rows[0].id);
      resolved.push(rows[0]);
    }
  }
  return resolved;
}

async function autoDiscoverStudents(
  supabase: SupabaseClient,
  excludeIds: Set<string>,
  limit: number
): Promise<StudentRow[]> {
  const { data: analyses, error } = await supabase
    .from("nutrition_weekly_analyses")
    .select("student_id")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error || !analyses) {
    return [];
  }
  const orderedIds: string[] = [];
  const seen = new Set<string>(excludeIds);
  for (const row of analyses as Array<{ student_id: string }>) {
    if (!row.student_id || seen.has(row.student_id)) {
      continue;
    }
    seen.add(row.student_id);
    orderedIds.push(row.student_id);
    if (orderedIds.length >= limit) {
      break;
    }
  }
  if (orderedIds.length === 0) {
    return [];
  }
  const { data: students } = await supabase
    .from("trainingpeaks_students")
    .select("id,student_id,student_name")
    .in("id", orderedIds);
  const byId = new Map((students as StudentRow[] | null ?? []).map((row) => [row.id, row]));
  return orderedIds.map((id) => byId.get(id)).filter((row): row is StudentRow => Boolean(row));
}

function renderCaseMarkdown(input: {
  record: CaseRecord;
  productionText: string | null;
  interpretation: NutritionWeeklyInterpretation | null;
}): string {
  const { record, productionText, interpretation } = input;
  const productionExcerpt = productionText
    ? productionText.split("\n").slice(0, 12).join("\n")
    : "(no production copy-ready text — status: " + record.production.status + ")";
  const dailyComments = (interpretation?.daily_blocks ?? [])
    .map((block) => `- ${block.date}: ${block.comment_ru}`)
    .join("\n");
  return [
    `# Case: ${record.studentName}`,
    "",
    `- source: ${record.source}`,
    `- week: ${record.weekFrom}..${record.weekTo}`,
    `- reviewId: ${record.reviewId ?? "n/a"} · planId: ${record.planId ?? "n/a"}`,
    "",
    "## Facts readiness",
    `- canonical days: ${record.factsReadiness.dailyCount}`,
    `- key workout days: ${record.factsReadiness.keyWorkoutDates.join(", ") || "none"}`,
    `- long run days: ${record.factsReadiness.longRunDates.join(", ") || "none"}`,
    `- long endurance days: ${record.factsReadiness.longEnduranceDays.join(", ") || "none"}`,
    `- missing nutrition training days: ${record.factsReadiness.missingNutritionTrainingDays.join(", ") || "none"}`,
    `- adjacent missing nutrition days: ${record.factsReadiness.adjacentTrainingWithoutNutritionDays.join(", ") || "none"}`,
    `- main load day: ${record.factsReadiness.mainLoadDay ?? "none"}`,
    `- carb placement insight: ${record.factsReadiness.carbPlacementInsight ?? "none"}`,
    `- coach context present: ${record.factsReadiness.coachContextPresent}`,
    `- athlete signals: ${record.factsReadiness.athleteSignalsCount}`,
    `- previous weeks context: ${record.factsReadiness.previousWeeksContextPresent}`,
    "",
    "## Current derived composer (excerpt)",
    "",
    "```",
    productionExcerpt,
    "```",
    `- charCount: ${record.production.charCount} · repeatedPhrases: ${record.production.repeatedPhraseCounts}`,
    `- key workout mentions: ${record.production.keyWorkoutMentions} · long run mentions: ${record.production.longRunMentions}`,
    `- practical target wording present: ${record.production.practicalTargetWordingPresent}`,
    `- forbidden terms: ${JSON.stringify(record.production.forbiddenTermCounts)}`,
    `- warnings: ${record.production.warnings.length === 0 ? "none" : record.production.warnings.join(" | ")}`,
    "",
    "## Shadow interpretation",
    `- mode: ${record.shadow.mode} · validationOk: ${record.shadow.validationOk}`,
    `- daily blocks: ${record.shadow.dailyBlockCount} · macro number warnings: ${record.shadow.macroNumberWarnings}`,
    `- comment length (min/avg/max): ${record.shadow.commentLengthStats.min}/${record.shadow.commentLengthStats.avg}/${record.shadow.commentLengthStats.max}`,
    `- forbidden terms: ${JSON.stringify(record.shadow.forbiddenTermCounts)}`,
    "",
    "Daily comments:",
    dailyComments || "- (none)",
    "",
    `week_summary_ru: ${interpretation?.week_summary_ru ?? "n/a"}`,
    `one_focus_statement_ru: ${interpretation?.one_focus_statement_ru ?? "n/a"}`,
    `week_comparison_line_ru: ${interpretation?.week_comparison_line_ru ?? "null"}`,
    "",
    "## Automated verdict",
    `- verdict: ${record.comparison.verdict}`,
    `- shadow better signals: ${record.comparison.shadowBetterSignals.join(", ") || "none"}`,
    `- shadow risk signals: ${record.comparison.shadowRiskSignals.join(", ") || "none"}`,
    "",
    "## Reviewer questions",
    "1. Safer output (A derived vs B shadow)?",
    "2. More coach-like?",
    "3. Less repetitive?",
    "4. Hallucinated comparison/medical claims?",
    "5. Shadow good enough for production switch?",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.apply && options.confirm !== NUTRITION_AUDIT_APPLY_CONFIRM) {
    throw new Error(
      `--apply requires --confirm "${NUTRITION_AUDIT_APPLY_CONFIRM}". This audit is read-only by default and never writes to the DB.`
    );
  }

  const mode: AuditMode = options.mode ?? (options.fixtureGlob ? "file-fixture" : "saved-review");
  loadScriptEnv();

  const outDir = join(AUDIT_REPORT_ROOT, timestampDir());
  const casesDir = join(outDir, "cases");
  const reviewerPacksDir = join(outDir, "reviewer-packs");
  mkdirSync(casesDir, { recursive: true });
  mkdirSync(reviewerPacksDir, { recursive: true });

  const records: CaseRecord[] = [];
  const skipped: SkippedCase[] = [];

  if (mode === "file-fixture") {
    // File-fixture mode requires local fixtures; if none configured, we record a
    // skip and continue (the harness must not hard-fail on missing inputs).
    skipped.push({
      name: options.fixtureGlob ?? "(no glob)",
      reason: "file-fixture mode: no committed nutrition fixtures available; use saved-review/auto-discover against DB",
    });
  } else {
    const env = resolveSupabaseEnv();
    if (!env) {
      console.log("SKIP: missing Supabase env; cannot run saved-review/auto-discover audit.");
    } else {
      const supabase = createClient(env.supabaseUrl, env.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const namedStudents = options.students.length > 0
        ? await resolveNamedStudents(supabase, options.students, skipped)
        : [];
      const excludeIds = new Set(namedStudents.map((row) => row.id));
      const discovered = options.autoDiscover
        ? await autoDiscoverStudents(supabase, excludeIds, Math.max(0, options.limit - namedStudents.length))
        : [];
      const allStudents = [...namedStudents, ...discovered];

      for (const student of allStudents) {
        let weekFrom = isoDate(options.weekFrom);
        let weekTo = isoDate(options.weekTo);
        if (!weekFrom || !weekTo) {
          const defaultWeek = await getNutritionStudentDefaultWeek(student.id);
          if (!defaultWeek) {
            skipped.push({ name: student.student_name, reason: "no nutrition week found" });
            continue;
          }
          weekFrom = defaultWeek.weekFrom;
          weekTo = defaultWeek.weekTo;
        }
        try {
          const built = await buildSavedReviewCase({ student, weekFrom, weekTo, regenShadow: options.regenShadow });
          if (!built) {
            skipped.push({ name: student.student_name, reason: `no review for week ${weekFrom}..${weekTo}` });
            continue;
          }
          records.push(built.record);
          writeFileSync(join(casesDir, `${built.record.caseId}.json`), JSON.stringify(built.record, null, 2));
          writeFileSync(
            join(casesDir, `${built.record.caseId}.md`),
            renderCaseMarkdown({ record: built.record, productionText: built.productionText, interpretation: built.interpretation })
          );
          writeFileSync(
            join(reviewerPacksDir, `${built.record.caseId}.md`),
            buildReviewerPack({
              studentName: built.record.studentName,
              weekFrom,
              weekTo,
              athleteContextLines: built.athleteContext,
              factsSummaryLines: built.factsSummary,
              productionText: built.productionText,
              interpretation: built.interpretation,
            })
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          skipped.push({ name: student.student_name, reason: `case error: ${message}` });
        }
      }
    }
  }

  // Summary aggregation.
  const verdictCounts: Record<NutritionAuditVerdict, number> = {
    shadow_candidate: 0,
    derived_better: 0,
    needs_prompt_tuning: 0,
    blocked: 0,
  };
  for (const record of records) {
    verdictCounts[record.comparison.verdict] += 1;
  }

  const summaryJson = {
    generatedAt: new Date().toISOString(),
    mode,
    readOnly: true,
    productionRenderSwitched: false,
    options: {
      students: options.students,
      weekFrom: options.weekFrom ?? null,
      weekTo: options.weekTo ?? null,
      autoDiscover: options.autoDiscover,
      limit: options.limit,
      regenShadow: options.regenShadow,
    },
    caseCount: records.length,
    verdictCounts,
    cases: records.map((record) => ({
      caseId: record.caseId,
      studentName: record.studentName,
      source: record.source,
      week: `${record.weekFrom}..${record.weekTo}`,
      validationOk: record.shadow.validationOk,
      verdict: record.comparison.verdict,
      riskSignals: record.comparison.shadowRiskSignals,
    })),
    skipped,
    pyrite: {
      required: false,
      reviewerPacksDir,
      exampleCommand: "pyrite run --input <reviewer-pack.md>  # optional; only if pyrite is installed",
    },
  };
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summaryJson, null, 2));

  const verdictRecommendation =
    verdictCounts.blocked > 0
      ? "blocked cases present — do NOT proceed to 4C; fix safety/structure first."
      : verdictCounts.needs_prompt_tuning > 0
        ? "shadow needs prompt tuning before 4C switch."
        : records.length > 0 && verdictCounts.shadow_candidate >= verdictCounts.derived_better
          ? "shadow looks like a candidate; 4C can proceed behind a feature flag / staged switch."
          : "current derived composer still preferable; keep production as-is.";

  const summaryMd = [
    "# Nutrition interpretation shadow audit",
    "",
    `- generated: ${summaryJson.generatedAt}`,
    `- mode: ${mode} · read-only: yes · production render switched: no`,
    `- cases: ${records.length} · skipped: ${skipped.length}`,
    "",
    "## Verdict counts",
    `- shadow_candidate: ${verdictCounts.shadow_candidate}`,
    `- derived_better: ${verdictCounts.derived_better}`,
    `- needs_prompt_tuning: ${verdictCounts.needs_prompt_tuning}`,
    `- blocked: ${verdictCounts.blocked}`,
    "",
    `Recommendation: ${verdictRecommendation}`,
    "",
    "## Cases",
    "",
    "| Case | Source | Validation | Verdict | Risk signals |",
    "| --- | --- | --- | --- | --- |",
    ...records.map(
      (record) =>
        `| ${record.studentName} | ${record.source} | ${record.shadow.validationOk ? "ok" : "FAIL"} | ${record.comparison.verdict} | ${record.comparison.shadowRiskSignals.join(", ") || "none"} |`
    ),
    "",
    "## Skipped",
    ...(skipped.length > 0 ? skipped.map((entry) => `- ${entry.name}: ${entry.reason}`) : ["- none"]),
    "",
    "## Reviewer packs",
    `- dir: ${reviewerPacksDir}`,
    "- optional: `pyrite run --input <reviewer-pack.md>` (not required)",
    "",
  ].join("\n");
  writeFileSync(join(outDir, "summary.md"), summaryMd);

  console.log(`Nutrition interpretation shadow audit (read-only, mode=${mode})`);
  console.log(`Cases: ${records.length} · skipped: ${skipped.length}`);
  console.log(`Verdicts: ${JSON.stringify(verdictCounts)}`);
  console.log(`Recommendation: ${verdictRecommendation}`);
  console.log(`Output: ${outDir}`);
  if (skipped.length > 0) {
    console.log("Skipped:");
    for (const entry of skipped) {
      console.log(`- ${entry.name}: ${entry.reason}`);
    }
  }
  // Verdict categories are constrained for downstream tooling.
  void NUTRITION_AUDIT_VERDICTS;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`audit-nutrition-interpretation-shadow failed: ${message}`);
  process.exitCode = 1;
});
