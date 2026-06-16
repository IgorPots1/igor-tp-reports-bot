"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  addNutritionContextNoteActionData,
  addNutritionWeightActionData,
  generateAndSaveNutritionWeeklyPlan,
  generateNutritionWeeklyReview,
  previewNutritionFileUpload,
  parseNutritionManualMacros,
  saveNutritionFileReport,
  saveNutritionManualMacros,
  saveNutritionCoachContextActionData,
  saveNutritionProfileActionData,
} from "@/features/nutrition/admin";
import {
  buildNutritionStudentCardHref,
  formatNutritionPlanTargetWeekNotice,
  formatNutritionStatus,
} from "@/features/nutrition/admin-labels";
import { getNutritionPlanTargetWeekToday } from "@/features/nutrition/plan-week-policy";
import {
  NUTRITION_FILE_PREVIEW_COOKIE,
  serializeNutritionFileUploadPreview,
} from "@/features/nutrition/file-preview-cookie";
import type { NutritionFileUploadPreviewSnapshot } from "@/features/nutrition/file-preview-cookie";
import type { NutritionFileUploadPreviewActionState } from "@/app/admin/coach-os/nutrition/upload-action-state";
import type { NutritionContextItemType } from "@/features/nutrition/repository";
import { normalizeNutritionGoalType, normalizeNutritionSex } from "@/features/nutrition/repository";
import {
  ADMIN_ACCESS_COOKIE_NAME,
  hasValidAdminAccessCookie,
  isAdminAccessBypassedForLocalDev,
  normalizeAdminRedirectPath,
} from "@/lib/admin-auth";

function getRequiredFormValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing form field: ${key}`);
  }
  return value;
}

function getOptionalFormValue(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function withNotice(pathname: string, key: "notice" | "error", value: string): string {
  const [path, rawQuery = ""] = pathname.split("?");
  const params = new URLSearchParams(rawQuery);
  params.set(key, value);
  return `${path}?${params.toString()}`;
}

async function ensureAdminAccess(redirectTarget: string): Promise<void> {
  if (isAdminAccessBypassedForLocalDev()) {
    return;
  }

  const cookieStore = await cookies();
  if (hasValidAdminAccessCookie(cookieStore.get(ADMIN_ACCESS_COOKIE_NAME)?.value)) {
    return;
  }
  redirect(`/admin/login?next=${encodeURIComponent(normalizeAdminRedirectPath(redirectTarget))}`);
}

function getPreviewCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/admin/coach-os/nutrition",
    maxAge: 60 * 10,
  };
}

function revalidateNutritionPaths(studentId?: string): void {
  revalidatePath("/admin/coach-os/nutrition");
  if (studentId) {
    revalidatePath(`/admin/coach-os/nutrition/${studentId}`);
    revalidatePath(`/admin/students/${studentId}`);
  }
}

function parseBoolean(value: string | null, fallback = false): boolean {
  if (value === null) {
    return fallback;
  }
  return value === "true" || value === "1" || value === "on";
}

function parseOptionalNumber(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Invalid numeric field");
  }
  return parsed;
}

function toNutritionUploadUserError(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (!message) {
      return fallback;
    }
    if (/next_redirect|redirect/i.test(message)) {
      return fallback;
    }
    return message;
  }
  return fallback;
}

function buildPreviewSnapshot(input: {
  studentId: string;
  weekFrom: string;
  weekTo: string;
  preview: Awaited<ReturnType<typeof previewNutritionFileUpload>>;
}): NutritionFileUploadPreviewSnapshot {
  return {
    studentId: input.studentId,
    weekFrom: input.weekFrom,
    weekTo: input.weekTo,
    status: input.preview.status,
    quality: input.preview.quality,
    rows: input.preview.extraction.extractedRows.map((row) => ({
      day: row.day,
      kcal: row.kcal,
      proteinG: row.proteinG,
      fatG: row.fatG,
      carbsG: row.carbsG,
      confidence: row.confidence,
      notes: row.notes,
    })),
    extractionWarnings: input.preview.extraction.extractionWarnings,
    unsupportedFiles: input.preview.extraction.unsupportedFiles,
    files: input.preview.fileMetas.map((file) => ({
      originalFileName: file.originalFileName,
      fileKind: file.fileKind,
      extractionMethod: file.extractionMethod ?? null,
      extractionErrorCode: file.extractionErrorCode ?? null,
      extractionPageCount: file.extractionPageCount ?? null,
      extractionTextLength: file.extractionTextLength ?? null,
      extractionNormalizedTextLength: file.extractionNormalizedTextLength ?? null,
      extractionDiagnostics: file.extractionDiagnostics ?? null,
      extractionWarnings: file.extractionWarnings ?? [],
    })),
  };
}

export async function saveNutritionCoachContextAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);

  try {
    await saveNutritionCoachContextActionData({
      studentId,
      coachContextRu: getOptionalFormValue(formData, "coachContextRu"),
    });
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = error instanceof Error ? error.message : "Не удалось сохранить контекст для разбора.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateNutritionPaths(studentId);
  redirect(withNotice(redirectTo, "notice", "Контекст для разбора питания сохранён."));
}

export async function saveNutritionProfileAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);

  try {
    await saveNutritionProfileActionData({
      studentId,
      enabled: parseBoolean(getOptionalFormValue(formData, "enabled"), false),
      goal: getOptionalFormValue(formData, "goal"),
      trackingApp: getOptionalFormValue(formData, "trackingApp"),
      currentWeightKg: parseOptionalNumber(getOptionalFormValue(formData, "currentWeightKg")),
      toleranceNotes: getOptionalFormValue(formData, "toleranceNotes"),
      nutritionGoalType: normalizeNutritionGoalType(getOptionalFormValue(formData, "nutritionGoalType")),
      targetWeightKg: parseOptionalNumber(getOptionalFormValue(formData, "targetWeightKg")),
      sex: normalizeNutritionSex(getOptionalFormValue(formData, "sex")),
      heightCm: parseOptionalNumber(getOptionalFormValue(formData, "heightCm")),
      ageYears: parseOptionalNumber(getOptionalFormValue(formData, "ageYears")),
    });
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = error instanceof Error ? error.message : "Не удалось сохранить профиль питания.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateNutritionPaths(studentId);
  redirect(withNotice(redirectTo, "notice", "Профиль питания сохранён."));
}

export async function archiveNutritionReportAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  const reportId = getRequiredFormValue(formData, "reportId");
  const archived = getRequiredFormValue(formData, "archived") === "true";
  await ensureAdminAccess(redirectTo);

  try {
    const { setNutritionReportArchived } = await import("@/features/nutrition/repository");
    await setNutritionReportArchived(reportId, archived);
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = error instanceof Error ? error.message : "Не удалось обновить отчёт.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateNutritionPaths(studentId);
  redirect(withNotice(redirectTo, "notice", archived ? "Отчёт архивирован." : "Отчёт возвращён из архива."));
}

export async function archiveNutritionAnalysisAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  const analysisId = getRequiredFormValue(formData, "analysisId");
  const archived = getRequiredFormValue(formData, "archived") === "true";
  await ensureAdminAccess(redirectTo);

  try {
    const { setNutritionWeeklyAnalysisArchived } = await import("@/features/nutrition/repository");
    await setNutritionWeeklyAnalysisArchived(analysisId, archived);
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = error instanceof Error ? error.message : "Не удалось обновить разбор.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateNutritionPaths(studentId);
  redirect(withNotice(redirectTo, "notice", archived ? "Разбор архивирован." : "Разбор возвращён из архива."));
}

export async function setNutritionEnabledAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);

  const enabled = parseBoolean(getRequiredFormValue(formData, "enabled"), false);

  try {
    const { getNutritionStudentProfile } = await import("@/features/nutrition/repository");
    const existing = await getNutritionStudentProfile(studentId);
    await saveNutritionProfileActionData({
      studentId,
      enabled,
      goal: existing?.goal ?? null,
      trackingApp: existing?.trackingApp ?? null,
      currentWeightKg: existing?.currentWeightKg ?? null,
      toleranceNotes: existing?.toleranceNotes ?? null,
    });
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = error instanceof Error ? error.message : "Не удалось изменить статус питания.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateNutritionPaths(studentId);
  redirect(withNotice(redirectTo, "notice", enabled ? "Ученик включён в тест питания." : "Ученик выключен из теста питания."));
}

export async function addNutritionWeightAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);

  try {
    const weight = parseOptionalNumber(getRequiredFormValue(formData, "weightKg"));
    if (weight === null) {
      throw new Error("Укажите вес.");
    }
    await addNutritionWeightActionData({
      studentId,
      weightKg: weight,
      source: getOptionalFormValue(formData, "source") ?? "manual",
      rawText: getOptionalFormValue(formData, "rawText"),
    });
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = error instanceof Error ? error.message : "Не удалось сохранить запись веса.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateNutritionPaths(studentId);
  redirect(withNotice(redirectTo, "notice", "Запись веса добавлена."));
}

export async function addNutritionContextNoteAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);

  try {
    await addNutritionContextNoteActionData({
      studentId,
      itemType: getRequiredFormValue(formData, "itemType") as NutritionContextItemType,
      text: getRequiredFormValue(formData, "text"),
      source: getOptionalFormValue(formData, "source") ?? "coach_manual",
      priority: parseOptionalNumber(getOptionalFormValue(formData, "priority")) ?? 0,
    });
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = error instanceof Error ? error.message : "Не удалось добавить заметку.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateNutritionPaths(studentId);
  redirect(withNotice(redirectTo, "notice", "Заметка добавлена."));
}

export async function parseNutritionManualMacrosAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const weekFrom = getRequiredFormValue(formData, "weekFrom");
  const weekTo = getRequiredFormValue(formData, "weekTo");
  const rawText = getRequiredFormValue(formData, "rawText");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);

  try {
    const parsed = await parseNutritionManualMacros({
      studentId,
      weekFrom,
      weekTo,
      rawText,
    });
    const reportId = getOptionalFormValue(formData, "reportId");
    revalidateNutritionPaths(studentId);
    const [pathOnly] = redirectTo.split("?");
    const params = new URLSearchParams();
    params.set("weekFrom", weekFrom);
    params.set("weekTo", weekTo);
    params.set("macroText", rawText);
    if (reportId) {
      params.set("reportId", reportId);
    }
    params.set(
      "notice",
      `Разбор: ${parsed.rows.length} дн., статус ${formatNutritionStatus(parsed.status, "report")}.`
    );
    redirect(`${pathOnly}?${params.toString()}`);
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = error instanceof Error ? error.message : "Не удалось разобрать макросы.";
    redirect(withNotice(redirectTo, "error", message));
  }
}

export async function saveNutritionManualMacrosAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const weekFrom = getRequiredFormValue(formData, "weekFrom");
  const weekTo = getRequiredFormValue(formData, "weekTo");
  const rawText = getRequiredFormValue(formData, "rawText");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);

  try {
    const result = await saveNutritionManualMacros({
      studentId,
      weekFrom,
      weekTo,
      sourceType: "manual_text",
      rawText,
    });
    revalidateNutritionPaths(studentId);
    redirect(
      buildNutritionStudentCardHref({
        studentId,
        weekFrom,
        weekTo,
        reportId: result.report.id,
        notice: `Отчёт сохранён (${formatNutritionStatus(result.report.status, "report")}), строк макросов: ${result.macros.length}.`,
      })
    );
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = error instanceof Error ? error.message : "Не удалось сохранить разбор макросов.";
    redirect(withNotice(redirectTo, "error", message));
  }
}

function getFormFiles(formData: FormData, key: string): File[] {
  const values = formData.getAll(key);
  return values.filter((value): value is File => value instanceof File && value.size > 0);
}

export async function previewNutritionFileUploadAction(
  _prevState: NutritionFileUploadPreviewActionState,
  formData: FormData
): Promise<NutritionFileUploadPreviewActionState> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const weekFrom = getRequiredFormValue(formData, "weekFrom");
  const weekTo = getRequiredFormValue(formData, "weekTo");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  const studentNotes = getOptionalFormValue(formData, "studentNotes");
  await ensureAdminAccess(redirectTo);

  try {
    const files = getFormFiles(formData, "reportFiles");
    if (files.length === 0) {
      throw new Error("Выберите хотя бы один файл.");
    }
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    console.info("[nutrition.upload.preview] start", {
      studentId,
      fileCount: files.length,
      totalBytes,
      mimeTypes: files.map((file) => file.type || "application/octet-stream"),
    });
    const preview = await previewNutritionFileUpload({
      studentId,
      weekFrom,
      weekTo,
      studentNotes,
      files,
    });
    const snapshot = buildPreviewSnapshot({
      studentId,
      weekFrom,
      weekTo,
      preview,
    });
    const cookieStore = await cookies();
    cookieStore.set(
      NUTRITION_FILE_PREVIEW_COOKIE,
      serializeNutritionFileUploadPreview(snapshot),
      getPreviewCookieOptions()
    );
    console.info("[nutrition.upload.preview] success", {
      studentId,
      fileCount: preview.fileMetas.length,
      parsedRows: preview.extraction.extractedRows.length,
      warningsCount: preview.extraction.extractionWarnings.length,
      unsupportedFiles: preview.extraction.unsupportedFiles.length,
    });
    return {
      ok: true,
      notice: `Файлы обработаны: ${preview.fileMetas.length}. Дней найдено: ${preview.quality.parsedDays}, статус: ${formatNutritionStatus(preview.status, "report")}.`,
      error: null,
      preview: snapshot,
      refreshKey: `${Date.now()}`,
    };
  } catch (error) {
    const message = toNutritionUploadUserError(error, "Файл загружен, но отчёт не удалось распознать.");
    console.warn("[nutrition.upload.preview] failed", {
      studentId,
      message,
    });
    return {
      ok: false,
      notice: null,
      error: message,
      preview: null,
      refreshKey: null,
    };
  }
}

export async function saveNutritionFileReportAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const weekFrom = getRequiredFormValue(formData, "weekFrom");
  const weekTo = getRequiredFormValue(formData, "weekTo");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  const studentNotes = getOptionalFormValue(formData, "studentNotes");
  await ensureAdminAccess(redirectTo);

  let result: Awaited<ReturnType<typeof saveNutritionFileReport>>;
  try {
    const files = getFormFiles(formData, "reportFiles");
    if (files.length === 0) {
      throw new Error("Выберите хотя бы один файл.");
    }
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    console.info("[nutrition.upload.save] start", {
      studentId,
      fileCount: files.length,
      totalBytes,
      mimeTypes: files.map((file) => file.type || "application/octet-stream"),
    });
    const forceNeedsReview = parseBoolean(getOptionalFormValue(formData, "forceNeedsReview"), false);
    const coachNotesRu = getOptionalFormValue(formData, "coachNotesRu");
    const rememberCoachNote = parseBoolean(getOptionalFormValue(formData, "rememberCoachNote"), false);
    result = await saveNutritionFileReport({
      studentId,
      weekFrom,
      weekTo,
      studentNotes,
      coachNotesRu,
      rememberCoachNote,
      files,
      forceNeedsReview,
    });
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = toNutritionUploadUserError(error, "Не удалось сохранить отчёт из файлов.");
    console.warn("[nutrition.upload.save] failed", {
      studentId,
      message,
    });
    redirect(withNotice(redirectTo, "error", message));
  }

  const cookieStore = await cookies();
  cookieStore.delete(NUTRITION_FILE_PREVIEW_COOKIE);
  revalidateNutritionPaths(studentId);
  console.info("[nutrition.upload.save] success", {
    studentId,
    reportId: result.report.id,
    fileCount: result.intake.fileMetas.length,
    parsedRows: result.intake.extraction.extractedRows.length,
    warningsCount: result.intake.extraction.extractionWarnings.length,
    macrosSaved: result.macros.length,
  });
  redirect(
    buildNutritionStudentCardHref({
      studentId,
      weekFrom: result.effectiveWeekFrom,
      weekTo: result.effectiveWeekTo,
      reportId: result.report.id,
      notice: [
        `Отчёт сохранён (${formatNutritionStatus(result.status, "report")}), файлов: ${result.intake.fileMetas.length}, макросов: ${result.macros.length}.`,
        result.dateMismatchNotice,
      ]
        .filter(Boolean)
        .join(" "),
    })
  );
}

export async function generateNutritionWeeklyPlanAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const weekFrom = getRequiredFormValue(formData, "weekFrom");
  const weekTo = getRequiredFormValue(formData, "weekTo");
  const sourceAnalysisId = getRequiredFormValue(formData, "sourceAnalysisId");
  const sourceReportId = getOptionalFormValue(formData, "sourceReportId");
  const reportId = getOptionalFormValue(formData, "reportId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  const requestedModeRaw = getOptionalFormValue(formData, "requestedMode");
  const requestedMode = requestedModeRaw === "ai" || requestedModeRaw === "fallback" ? requestedModeRaw : undefined;
  await ensureAdminAccess(redirectTo);

  try {
    const plan = await generateAndSaveNutritionWeeklyPlan({
      studentId,
      sourceAnalysisId,
      sourceReportId: sourceReportId ?? undefined,
      requestedMode,
    });
    revalidateNutritionPaths(studentId);
    const targetWeek = getNutritionPlanTargetWeekToday();
    const message =
      plan.status === "blocked_safety"
        ? "Блок безопасности: фокус недели сохранён без черновика для ученика."
        : formatNutritionPlanTargetWeekNotice(targetWeek.mode);
    redirect(
      buildNutritionStudentCardHref({
        studentId,
        weekFrom,
        weekTo,
        reportId,
        reviewId: sourceAnalysisId,
        planId: plan.id,
        notice: message,
      })
    );
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = error instanceof Error ? error.message : "Не удалось сгенерировать фокус питания на неделю.";
    redirect(withNotice(redirectTo, "error", message));
  }
}

/**
 * Sequential batch generation (master order Task 1). Generates weekly reviews
 * for the selected students ONE AT A TIME — never in parallel. Each call already
 * spaces its OpenAI requests through the in-process generation queue, so a real
 * "пачка подряд" run does not burst the model into a 429. Reuses the exact same
 * per-student path as the single-review button; adds no new mutation.
 *
 * Each selected entry is `studentId|reportId|weekFrom|weekTo`, mirroring the
 * hidden inputs the single-review form already trusts.
 */
export async function generateNutritionWeeklyReviewBatchAction(formData: FormData): Promise<void> {
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);

  const entries = formData
    .getAll("batchStudent")
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (entries.length === 0) {
    redirect(withNotice(redirectTo, "error", "Не выбрано ни одного ученика для пачки."));
  }

  let ok = 0;
  let blocked = 0;
  let rateLimited = 0;
  let failed = 0;
  const touchedStudentIds: string[] = [];

  for (const entry of entries) {
    const [studentId, reportId, weekFrom, weekTo] = entry.split("|");
    if (!studentId || !reportId || !weekFrom || !weekTo) {
      failed += 1;
      continue;
    }
    try {
      const result = await generateNutritionWeeklyReview({ studentId, weekFrom, weekTo, reportId });
      touchedStudentIds.push(studentId);
      const notes = result.generated.internal_summary?.notes ?? [];
      if (notes.some((note) => note.includes("ai_rate_limited") || note.includes("ai_insufficient_quota"))) {
        rateLimited += 1;
      }
      if (result.generated.safety_flags.blocked) {
        blocked += 1;
      } else {
        ok += 1;
      }
    } catch {
      failed += 1;
    }
  }

  revalidatePath("/admin/coach-os/nutrition");
  for (const studentId of touchedStudentIds) {
    revalidateNutritionPaths(studentId);
  }

  const parts = [`готово ${ok}`];
  if (blocked) {
    parts.push(`блок безопасности ${blocked}`);
  }
  if (rateLimited) {
    parts.push(`лимит OpenAI ${rateLimited}`);
  }
  if (failed) {
    parts.push(`ошибок ${failed}`);
  }
  redirect(
    withNotice(redirectTo, rateLimited || failed ? "error" : "notice", `Пачка разборов: ${parts.join(", ")}.`)
  );
}

export async function generateNutritionWeeklyReviewAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const weekFrom = getRequiredFormValue(formData, "weekFrom");
  const weekTo = getRequiredFormValue(formData, "weekTo");
  const reportId = getRequiredFormValue(formData, "reportId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);

  try {
    const result = await generateNutritionWeeklyReview({
      studentId,
      weekFrom,
      weekTo,
      reportId,
      manualRowsOverrideText: getOptionalFormValue(formData, "manualRowsOverrideText"),
    });
    // Task 6: one button. The review (Claude) already wrote the next-week plan
    // prose in the same call; build the plan record from it now (numbers from
    // formulas, no OpenAI). Skip when the review was held (awaiting_generation)
    // or safety-blocked — those must be regenerated/reviewed, not turned into a
    // "ready" plan.
    let planId: string | null = null;
    const reviewStatus = result.analysis.status;
    if (reviewStatus === "draft_generated" || reviewStatus === "needs_review") {
      try {
        const plan = await generateAndSaveNutritionWeeklyPlan({
          studentId,
          sourceAnalysisId: result.analysis.id,
          sourceReportId: result.analysis.reportId ?? reportId,
          claudePlanProse: result.generated.next_week_plan_text,
          claudePlanAiModel: result.generated.ai_model,
          preferSavedTpContext: true,
        });
        planId = plan.id;
      } catch (planError) {
        // A plan failure must not lose the saved review; surface it on the page.
        console.error("[nutrition-review-action] plan generation after review failed", planError);
      }
    }
    revalidateNutritionPaths(studentId);
    const message = result.generated.safety_flags.blocked
      ? "Блок безопасности: черновик скрыт, нужна ручная проверка."
      : reviewStatus === "awaiting_generation"
        ? "Разбор не сгенерирован живой моделью — поставлен в очередь. Перегенерируй."
        : planId
          ? "Разбор и план на неделю сгенерированы."
          : "Недельный обзор сгенерирован.";
    redirect(
      buildNutritionStudentCardHref({
        studentId,
        weekFrom: result.effectiveWeekFrom,
        weekTo: result.effectiveWeekTo,
        reportId,
        reviewId: result.analysis.id,
        planId,
        notice: message,
      })
    );
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = error instanceof Error ? error.message : "Не удалось сгенерировать недельный обзор.";
    redirect(withNotice(redirectTo, "error", message));
  }
}

/**
 * Task 7: coach approves a proposed repeating pattern → it enters student memory
 * (draft->approve). The candidate is then removed from the analysis so the
 * proposal stops showing. Unconfirmed patterns are never stored.
 */
export async function approveNutritionPatternAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const analysisId = getRequiredFormValue(formData, "analysisId");
  const code = getRequiredFormValue(formData, "code");
  const text = getRequiredFormValue(formData, "patternText");
  const sinceWeek = getOptionalFormValue(formData, "sinceWeek");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  try {
    const { addNutritionApprovedPattern, removeNutritionAnalysisPatternCandidate } = await import(
      "@/features/nutrition/repository"
    );
    await addNutritionApprovedPattern({ studentId, text, sinceWeek: sinceWeek ?? null });
    await removeNutritionAnalysisPatternCandidate({ analysisId, code });
    revalidateNutritionPaths(studentId);
    redirect(withNotice(redirectTo, "notice", "Паттерн добавлен в память ученика."));
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = error instanceof Error ? error.message : "Не удалось сохранить паттерн.";
    redirect(withNotice(redirectTo, "error", message));
  }
}

/** Task 7: coach rejects a proposed pattern — removed from the analysis, NOT stored to memory. */
export async function dismissNutritionPatternAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const analysisId = getRequiredFormValue(formData, "analysisId");
  const code = getRequiredFormValue(formData, "code");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  try {
    const { removeNutritionAnalysisPatternCandidate } = await import("@/features/nutrition/repository");
    await removeNutritionAnalysisPatternCandidate({ analysisId, code });
    revalidateNutritionPaths(studentId);
    redirect(withNotice(redirectTo, "notice", "Паттерн отклонён (в память не добавлен)."));
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = error instanceof Error ? error.message : "Не удалось отклонить паттерн.";
    redirect(withNotice(redirectTo, "error", message));
  }
}
