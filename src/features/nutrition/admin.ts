import { randomUUID } from "node:crypto";

import {
  buildNutritionStudentContext,
  classifyNutritionReportStatus,
  calculateNutritionDataQuality,
  normalizeManualMacroInput,
  summarizeNutritionRows,
} from "@/features/nutrition/context";
import {
  addNutritionContextItem,
  addNutritionWeightLog,
  createNutritionReport,
  createNutritionWeeklyAnalysis,
  getActiveNutritionContextItems,
  getNutritionReportWithMacros,
  getNutritionStudentEssentials,
  getNutritionStudentProfile,
  getNutritionWeeklyAnalysisById,
  getNutritionWeeklyAnalysisForWeek,
  getNutritionWeightLogs,
  listNutritionReportsForStudent,
  listNutritionWeeklyAnalysesForStudentWeek,
  insertNutritionDailyMacros,
  listNutritionDashboardRows,
  type NutritionDashboardFilters,
  type NutritionContextItemType,
} from "@/features/nutrition/repository";
import {
  collectNutritionAthleteReportSignalTexts,
  detectNutritionAthleteReportSignalsFromTexts,
} from "@/features/nutrition/athlete-signals";
import { generateNutritionWeeklyAnalysis } from "@/features/nutrition/draft-generator";
import { intakeNutritionReportFiles, type IntakeNutritionReportFilesResult } from "@/features/nutrition/file-intake";
import {
  buildNutritionReportDateQualityMetadata,
  compareNutritionReportDateRanges,
  formatNutritionReportDateMismatchNotice,
  resolveNutritionEffectiveReportWeek,
} from "@/features/nutrition/report-date-coverage";
import { generateAndSaveNutritionWeeklyPlan } from "@/features/nutrition/weekly-plan-generator";

export { generateAndSaveNutritionWeeklyPlan };

export async function listNutritionAdminDashboardRows(filters: NutritionDashboardFilters = {}) {
  return listNutritionDashboardRows(filters);
}

export async function getNutritionAdminStudentCard(input: {
  studentId: string;
  weekFrom: string;
  weekTo: string;
  reviewId?: string | null;
}) {
  const essentials = await getNutritionStudentEssentials(input.studentId);
  const [profile, contextItems, weightLogs, reports, weeklyAnalyses] = await Promise.all([
    getNutritionStudentProfile(input.studentId),
    getActiveNutritionContextItems(input.studentId),
    getNutritionWeightLogs(input.studentId),
    listNutritionReportsForStudent(input.studentId, {
      weekFrom: input.weekFrom,
      weekTo: input.weekTo,
      limit: 20,
    }),
    listNutritionWeeklyAnalysesForStudentWeek(input.studentId, input.weekFrom, input.weekTo),
  ]);

  let weeklyAnalysis: Awaited<ReturnType<typeof getNutritionWeeklyAnalysisForWeek>> = null;
  if (input.reviewId) {
    const byId = await getNutritionWeeklyAnalysisById(input.reviewId);
    if (byId && byId.studentId === input.studentId) {
      weeklyAnalysis = byId;
    }
  }
  if (!weeklyAnalysis) {
    weeklyAnalysis =
      weeklyAnalyses[0] ??
      (await getNutritionWeeklyAnalysisForWeek({
        studentId: input.studentId,
        weekFrom: input.weekFrom,
        weekTo: input.weekTo,
      }));
  }

  const context = await buildNutritionStudentContext({
    studentId: input.studentId,
    weekFrom: input.weekFrom,
    weekTo: input.weekTo,
    manualRows: [],
  });
  return {
    student: essentials.student,
    profile,
    contextItems,
    weightLogs,
    reports,
    weeklyAnalyses,
    weeklyAnalysis,
    context,
  };
}

export async function saveNutritionProfileActionData(input: {
  studentId: string;
  enabled: boolean;
  goal?: string | null;
  trackingApp?: string | null;
  currentWeightKg?: number | null;
  toleranceNotes?: string | null;
  ownRegime?: boolean;
  nutritionGoalType?: import("@/features/nutrition/repository").NutritionGoalType;
  targetWeightKg?: number | null;
  sex?: import("@/features/nutrition/repository").NutritionSex | null;
  heightCm?: number | null;
  ageYears?: number | null;
}) {
  const { upsertNutritionStudentProfile } = await import("@/features/nutrition/repository");
  return upsertNutritionStudentProfile({
    studentId: input.studentId,
    enabled: input.enabled,
    goal: input.goal ?? null,
    trackingApp: input.trackingApp ?? null,
    currentWeightKg: input.currentWeightKg ?? null,
    toleranceNotes: input.toleranceNotes ?? null,
    ownRegime: input.ownRegime,
    nutritionGoalType: input.nutritionGoalType,
    // Only meaningful for goal=lose; cleared otherwise.
    targetWeightKg: input.nutritionGoalType === "lose" ? input.targetWeightKg ?? null : null,
    sex: input.sex,
    heightCm: input.heightCm,
    ageYears: input.ageYears,
  });
}

export async function saveNutritionCoachContextActionData(input: {
  studentId: string;
  coachContextRu: string | null;
}) {
  const { saveNutritionCoachContextRu } = await import("@/features/nutrition/repository");
  return saveNutritionCoachContextRu({
    studentId: input.studentId,
    coachContextRu: input.coachContextRu,
  });
}

export async function addNutritionWeightActionData(input: {
  studentId: string;
  weightKg: number;
  source?: string;
  rawText?: string | null;
}) {
  return addNutritionWeightLog({
    studentId: input.studentId,
    weightKg: input.weightKg,
    source: input.source ?? "manual",
    rawText: input.rawText ?? null,
    confirmedByCoach: true,
  });
}

export async function addNutritionContextNoteActionData(input: {
  studentId: string;
  itemType: NutritionContextItemType;
  text: string;
  source?: string;
  priority?: number;
}) {
  return addNutritionContextItem({
    studentId: input.studentId,
    itemType: input.itemType,
    text: input.text,
    source: input.source ?? "coach_manual",
    priority: input.priority ?? 0,
    isActive: true,
  });
}

export async function parseNutritionManualMacros(input: {
  studentId: string;
  weekFrom: string;
  weekTo: string;
  rawText: string;
}) {
  const rows = normalizeManualMacroInput(input.rawText, input.weekFrom);
  const context = await buildNutritionStudentContext({
    studentId: input.studentId,
    weekFrom: input.weekFrom,
    weekTo: input.weekTo,
    manualRows: rows,
  });
  return {
    rows,
    quality: context.dataQuality,
    status: context.reportStatus,
    summaryRows: summarizeNutritionRows(rows),
  };
}

export async function saveNutritionManualMacros(input: {
  studentId: string;
  weekFrom: string;
  weekTo: string;
  sourceType?: string;
  rawText: string;
}) {
  const parsed = await parseNutritionManualMacros({
    studentId: input.studentId,
    weekFrom: input.weekFrom,
    weekTo: input.weekTo,
    rawText: input.rawText,
  });

  const report = await createNutritionReport({
    studentId: input.studentId,
    weekFrom: input.weekFrom,
    weekTo: input.weekTo,
    sourceType: input.sourceType ?? "manual_text",
    rawText: input.rawText,
    status: parsed.status,
    dataQuality: parsed.quality,
  });

  const macrosToSave = parsed.rows
    .filter((row) => !row.day.startsWith("unresolved:"))
    .map((row) => ({
      reportId: report.id,
      studentId: input.studentId,
      day: row.day,
      kcal: row.kcal,
      proteinG: row.proteinG,
      fatG: row.fatG,
      carbsG: row.carbsG,
      confidence: row.confidence,
      source: "manual_text",
      notes: row.notes,
      items: row.items,
    }));

  const savedMacros = await insertNutritionDailyMacros(macrosToSave);
  return { report, macros: savedMacros, parsed };
}

export async function previewNutritionFileUpload(input: {
  studentId: string;
  weekFrom: string;
  weekTo: string;
  studentNotes?: string | null;
  files: File[];
}): Promise<IntakeNutritionReportFilesResult & {
  quality: ReturnType<typeof calculateNutritionDataQuality>;
  status: ReturnType<typeof classifyNutritionReportStatus>;
}> {
  const previewReportId = randomUUID();
  const intake = await intakeNutritionReportFiles({
    studentId: input.studentId,
    reportId: previewReportId,
    weekFrom: input.weekFrom,
    weekTo: input.weekTo,
    files: input.files,
    persistFiles: false,
  });
  const rows = intake.extraction.extractedRows;
  const quality = calculateNutritionDataQuality(rows);
  const status = classifyNutritionReportStatus(quality);
  return {
    ...intake,
    quality,
    status,
  };
}

export async function saveNutritionFileReport(input: {
  studentId: string;
  weekFrom: string;
  weekTo: string;
  studentNotes?: string | null;
  coachNotesRu?: string | null;
  rememberCoachNote?: boolean;
  files: File[];
  forceNeedsReview?: boolean;
}) {
  const reportId = randomUUID();
  const intake = await intakeNutritionReportFiles({
    studentId: input.studentId,
    reportId,
    weekFrom: input.weekFrom,
    weekTo: input.weekTo,
    files: input.files,
  });
  const rows = intake.extraction.extractedRows;
  const parsedCoverage = intake.extraction.dateCoverage;
  const effectiveWeek = resolveNutritionEffectiveReportWeek({
    uiWeekFrom: input.weekFrom,
    uiWeekTo: input.weekTo,
    parsedWeekFrom: parsedCoverage.parsedWeekFrom,
    parsedWeekTo: parsedCoverage.parsedWeekTo,
  });
  const dateComparison = compareNutritionReportDateRanges({
    uiWeekFrom: input.weekFrom,
    uiWeekTo: input.weekTo,
    parsedWeekFrom: parsedCoverage.parsedWeekFrom,
    parsedWeekTo: parsedCoverage.parsedWeekTo,
  });
  const quality = calculateNutritionDataQuality(rows);
  const status = input.forceNeedsReview ? "needs_review" : classifyNutritionReportStatus(quality);
  const hasOnlyNotes = rows.length === 0 && Boolean(input.studentNotes?.trim());
  const resolvedStatus = hasOnlyNotes ? "needs_review" : status;
  const dateMismatchNotice = formatNutritionReportDateMismatchNotice({
    uiWeekFrom: input.weekFrom,
    uiWeekTo: input.weekTo,
    effectiveWeekFrom: effectiveWeek.effectiveWeekFrom,
    effectiveWeekTo: effectiveWeek.effectiveWeekTo,
    dateRangeSource: effectiveWeek.dateRangeSource,
    mismatch: dateComparison.mismatch,
  });

  const report = await createNutritionReport({
    studentId: input.studentId,
    weekFrom: effectiveWeek.effectiveWeekFrom,
    weekTo: effectiveWeek.effectiveWeekTo,
    sourceType: intake.sourceType,
    rawText: input.studentNotes ?? null,
    coachNotesRu: input.coachNotesRu ?? null,
    fileRefs: {
      files: intake.fileMetas,
      unsupported_files: intake.extraction.unsupportedFiles,
      extraction_warnings: intake.extraction.extractionWarnings,
      parsed_week_from: parsedCoverage.parsedWeekFrom,
      parsed_week_to: parsedCoverage.parsedWeekTo,
      ui_week_from: input.weekFrom,
      ui_week_to: input.weekTo,
    },
    status: resolvedStatus,
    dataQuality: buildNutritionReportDateQualityMetadata({
      uiWeekFrom: input.weekFrom,
      uiWeekTo: input.weekTo,
      parsedCoverage,
      existing: {
        ...quality,
        extracted_days: rows.length,
        unsupported_files_count: intake.extraction.unsupportedFiles.length,
      },
    }),
  });

  const macrosToSave = rows
    .filter((row) => !row.day.startsWith("unresolved:"))
    .map((row) => ({
      reportId: report.id,
      studentId: input.studentId,
      day: row.day,
      kcal: row.kcal,
      proteinG: row.proteinG,
      fatG: row.fatG,
      carbsG: row.carbsG,
      confidence: row.confidence,
      source: intake.sourceType === "manual_text" ? "manual_text" : "file_upload",
      notes: row.notes,
      items: row.items,
    }));
  const macros = await insertNutritionDailyMacros(macrosToSave);

  // Task 8: "remember about the student" → persist the coach note so it is pulled
  // into every future review (not just this week's report).
  if (input.rememberCoachNote && input.coachNotesRu?.trim()) {
    const { appendNutritionPersistentNote } = await import("@/features/nutrition/repository");
    await appendNutritionPersistentNote({ studentId: input.studentId, note: input.coachNotesRu });
  }

  return {
    report,
    macros,
    intake,
    quality,
    status: resolvedStatus,
    effectiveWeekFrom: effectiveWeek.effectiveWeekFrom,
    effectiveWeekTo: effectiveWeek.effectiveWeekTo,
    dateMismatchNotice,
    dateComparison,
  };
}

export async function generateNutritionWeeklyReview(input: {
  studentId: string;
  weekFrom: string;
  weekTo: string;
  reportId: string;
  manualRowsOverrideText?: string | null;
}) {
  const reportWithMacros = await getNutritionReportWithMacros(input.reportId);
  if (!reportWithMacros) {
    throw new Error(`Nutrition report not found: ${input.reportId}`);
  }

  const effectiveWeekFrom = reportWithMacros.report.weekFrom;
  const effectiveWeekTo = reportWithMacros.report.weekTo;

  const rows = input.manualRowsOverrideText
    ? normalizeManualMacroInput(input.manualRowsOverrideText, effectiveWeekFrom)
    : reportWithMacros.macros.map((row) => ({
        day: row.day,
        weekday: null,
        kcal: row.kcal,
        proteinG: row.proteinG,
        fatG: row.fatG,
        carbsG: row.carbsG,
        confidence: row.confidence ?? 1,
        notes: row.notes,
        ...(row.items.length > 0 ? { items: row.items } : {}),
      }));

  const essentials = await getNutritionStudentEssentials(input.studentId);
  const signalSourceTexts = collectNutritionAthleteReportSignalTexts({
    reportComment: reportWithMacros.report.rawText,
    manualMacroNotes: rows.map((row) => row.notes),
    nutritionContextNotes: essentials.contextItems.map((item) => item.text),
    profileToleranceNotes: essentials.profile?.toleranceNotes ?? null,
  });
  const athleteReportSignals = detectNutritionAthleteReportSignalsFromTexts(signalSourceTexts);

  const context = await buildNutritionStudentContext({
    studentId: input.studentId,
    weekFrom: effectiveWeekFrom,
    weekTo: effectiveWeekTo,
    manualRows: rows,
    athleteReportSignals,
    coachReportNoteRu: reportWithMacros.report.coachNotesRu,
    athleteCommentRu: reportWithMacros.report.rawText,
  });
  const generated = await generateNutritionWeeklyAnalysis({ context });
  const status = generated.safety_flags.blocked
    ? "blocked_safety"
    : generated.generation_mode === "awaiting_generation"
      ? "awaiting_generation"
      : generated.status === "draft_ready"
        ? "draft_generated"
        : "needs_review";

  // Task 7: propose repeating patterns to the coach (draft->approve). Compare this
  // week's findings with recent prior weeks. NOT on a safety-blocked week.
  let patternCandidates: import("@/features/nutrition/pattern-detection").NutritionPatternCandidate[] = [];
  let loadCarbsTrend: string | null = null;
  try {
    const { listRecentNutritionWeeklyAnalysesForStudent } = await import("@/features/nutrition/repository");
    const { detectNutritionRepeatingPatterns, buildNutritionLoadCarbsTrend } = await import(
      "@/features/nutrition/pattern-detection"
    );
    const priorAnalyses = await listRecentNutritionWeeklyAnalysesForStudent(input.studentId, {
      limit: 4,
      excludeWeekFrom: effectiveWeekFrom,
    });
    const toWeekDaily = (weekFrom: string, daily: unknown) => ({
      weekFrom,
      days: Array.isArray(daily) ? (daily as Array<Record<string, unknown>>) : [],
    });
    const current = toWeekDaily(effectiveWeekFrom, generated.daily_analysis);
    const prior = priorAnalyses.map((a) =>
      toWeekDaily(a.weekFrom, (a.nutritionSummary as Record<string, unknown>)?.daily_analysis)
    );
    loadCarbsTrend = buildNutritionLoadCarbsTrend({ current, prior });
    if (!generated.safety_flags.blocked) {
      patternCandidates = detectNutritionRepeatingPatterns({
        current,
        prior,
        alreadyApprovedTexts: (context.studentMemory.approved_patterns ?? []).map((p) => p.text),
      });
    }
  } catch (error) {
    console.error("[nutrition-review] pattern detection failed (non-blocking)", error);
  }

  const analysis = await createNutritionWeeklyAnalysis({
    studentId: input.studentId,
    reportId: input.reportId,
    weekFrom: effectiveWeekFrom,
    weekTo: effectiveWeekTo,
    status,
    internalSummary: generated.internal_summary,
    tpPastWeekContext: context.tpPastWeek,
    tpNextWeekContext: context.tpNextWeek,
    nutritionSummary: {
      ...generated.nutrition_summary,
      data_quality_summary: generated.data_quality_summary,
      daily_analysis: generated.daily_analysis,
      training_nutrition_links: generated.training_nutrition_links,
      one_focus: generated.one_focus,
      methodology_signals: generated.methodology_signals,
      bodyweight_kg: context.currentWeightKg,
      carb_progression_strategy: generated.one_focus.progression_strategy,
      coach_summary_text: generated.coach_summary_text,
      day_by_day_analysis_text: generated.day_by_day_analysis_text,
      athlete_report_signals: generated.athlete_report_signals,
      generation_mode: generated.generation_mode,
      prompt_version: generated.prompt_version,
      do_not_send_reasons: generated.do_not_send_reasons,
      pattern_candidates: patternCandidates,
    },
    safetyFlags: generated.safety_flags,
    contextSnapshot: {
      studentName: context.studentName,
      studentSlug: context.studentSlug,
      studentUuid: context.studentUuid,
      communicationProfile: context.resolvedCommunicationProfile,
      communicationProfilePromptLines: context.communicationProfilePromptLines,
      telegramContextNotes: context.telegramContextNotes,
      coachMemoryCount: context.coachMemoryItems.length,
      coachContextRu: context.coachContextRu,
      athleteReportSignals: context.athleteReportSignals,
      nutritionContextItemCount: context.nutritionContextItems.length,
      weightLogCount: context.weightLogs.length,
      manualMacroRows: context.manualMacroRows,
      dataQuality: context.dataQuality,
    },
    promptHash: generated.prompt_hash,
    contextHash: generated.context_hash,
    aiModel: generated.ai_model,
    athleteMessageDraft: generated.athlete_message_draft,
    coachEdits: null,
  });

  // Task 7: roll the review-memory signals forward (last focus + carbs trend) so
  // the next review sees the shift. Approved patterns are added only on coach
  // approval (separate action) — never auto-stored here.
  if (!generated.safety_flags.blocked) {
    try {
      const { updateNutritionMemoryAfterReview } = await import("@/features/nutrition/repository");
      await updateNutritionMemoryAfterReview({
        studentId: input.studentId,
        lastFocus: generated.one_focus?.statement_ru ?? null,
        keyTrends: loadCarbsTrend ? [loadCarbsTrend] : context.studentMemory.key_trends,
      });
    } catch (error) {
      console.error("[nutrition-review] memory roll-forward failed (non-blocking)", error);
    }
  }

  return {
    analysis,
    generated,
    context,
    effectiveWeekFrom,
    effectiveWeekTo,
  };
}
