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
  getNutritionWeeklyAnalysisForWeek,
  getNutritionWeightLogs,
  listNutritionReportsForStudent,
  insertNutritionDailyMacros,
  listNutritionDashboardRows,
  type NutritionDashboardFilters,
  type NutritionContextItemType,
} from "@/features/nutrition/repository";
import { generateNutritionWeeklyAnalysis } from "@/features/nutrition/draft-generator";
import { intakeNutritionReportFiles, type IntakeNutritionReportFilesResult } from "@/features/nutrition/file-intake";

export async function listNutritionAdminDashboardRows(filters: NutritionDashboardFilters = {}) {
  return listNutritionDashboardRows(filters);
}

export async function getNutritionAdminStudentCard(input: {
  studentId: string;
  weekFrom: string;
  weekTo: string;
}) {
  const essentials = await getNutritionStudentEssentials(input.studentId);
  const [profile, contextItems, weightLogs, reports, weeklyAnalysis] = await Promise.all([
    getNutritionStudentProfile(input.studentId),
    getActiveNutritionContextItems(input.studentId),
    getNutritionWeightLogs(input.studentId),
    listNutritionReportsForStudent(input.studentId, {
      weekFrom: input.weekFrom,
      weekTo: input.weekTo,
      limit: 20,
    }),
    getNutritionWeeklyAnalysisForWeek({
      studentId: input.studentId,
      weekFrom: input.weekFrom,
      weekTo: input.weekTo,
    }),
  ]);
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
  coachNotes?: string | null;
}) {
  const { upsertNutritionStudentProfile } = await import("@/features/nutrition/repository");
  return upsertNutritionStudentProfile({
    studentId: input.studentId,
    enabled: input.enabled,
    goal: input.goal ?? null,
    trackingApp: input.trackingApp ?? null,
    currentWeightKg: input.currentWeightKg ?? null,
    toleranceNotes: input.toleranceNotes ?? null,
    coachNotes: input.coachNotes ?? null,
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
  files: File[];
  forceNeedsReview?: boolean;
}) {
  const reportId = randomUUID();
  const intake = await intakeNutritionReportFiles({
    studentId: input.studentId,
    reportId,
    weekFrom: input.weekFrom,
    files: input.files,
  });
  const rows = intake.extraction.extractedRows;
  const quality = calculateNutritionDataQuality(rows);
  const status = input.forceNeedsReview ? "needs_review" : classifyNutritionReportStatus(quality);
  const hasOnlyNotes = rows.length === 0 && Boolean(input.studentNotes?.trim());
  const resolvedStatus = hasOnlyNotes ? "needs_review" : status;

  const report = await createNutritionReport({
    studentId: input.studentId,
    weekFrom: input.weekFrom,
    weekTo: input.weekTo,
    sourceType: intake.sourceType,
    rawText: input.studentNotes ?? null,
    fileRefs: {
      files: intake.fileMetas,
      unsupported_files: intake.extraction.unsupportedFiles,
      extraction_warnings: intake.extraction.extractionWarnings,
    },
    status: resolvedStatus,
    dataQuality: {
      ...quality,
      extracted_days: rows.length,
      unsupported_files_count: intake.extraction.unsupportedFiles.length,
    },
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
    }));
  const macros = await insertNutritionDailyMacros(macrosToSave);

  return {
    report,
    macros,
    intake,
    quality,
    status: resolvedStatus,
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

  const rows = input.manualRowsOverrideText
    ? normalizeManualMacroInput(input.manualRowsOverrideText, input.weekFrom)
    : reportWithMacros.macros.map((row) => ({
        day: row.day,
        weekday: null,
        kcal: row.kcal,
        proteinG: row.proteinG,
        fatG: row.fatG,
        carbsG: row.carbsG,
        confidence: row.confidence ?? 1,
        notes: row.notes,
      }));

  const context = await buildNutritionStudentContext({
    studentId: input.studentId,
    weekFrom: input.weekFrom,
    weekTo: input.weekTo,
    manualRows: rows,
  });
  const generated = await generateNutritionWeeklyAnalysis({ context });
  const status = generated.safety_flags.blocked
    ? "blocked_safety"
    : generated.status === "draft_ready"
      ? "draft_generated"
      : "needs_review";

  const analysis = await createNutritionWeeklyAnalysis({
    studentId: input.studentId,
    reportId: input.reportId,
    weekFrom: input.weekFrom,
    weekTo: input.weekTo,
    status,
    internalSummary: generated.internal_summary,
    tpPastWeekContext: context.tpPastWeek,
    tpNextWeekContext: context.tpNextWeek,
    nutritionSummary: generated.nutrition_summary,
    safetyFlags: generated.safety_flags,
    contextSnapshot: {
      studentName: context.studentName,
      studentSlug: context.studentSlug,
      studentUuid: context.studentUuid,
      communicationProfile: context.resolvedCommunicationProfile,
      communicationProfilePromptLines: context.communicationProfilePromptLines,
      telegramContextNotes: context.telegramContextNotes,
      coachMemoryCount: context.coachMemoryItems.length,
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

  return {
    analysis,
    generated,
    context,
  };
}
