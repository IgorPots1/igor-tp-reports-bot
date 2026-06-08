"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  addNutritionContextNoteActionData,
  addNutritionWeightActionData,
  generateNutritionWeeklyReview,
  previewNutritionFileUpload,
  parseNutritionManualMacros,
  saveNutritionFileReport,
  saveNutritionManualMacros,
  saveNutritionProfileActionData,
} from "@/features/nutrition/admin";
import { formatNutritionStatus } from "@/features/nutrition/admin-labels";
import type { NutritionContextItemType } from "@/features/nutrition/repository";
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
      coachNotes: getOptionalFormValue(formData, "coachNotes"),
    });
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = error instanceof Error ? error.message : "Не удалось сохранить профиль питания.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateNutritionPaths(studentId);
  redirect(withNotice(redirectTo, "notice", "Профиль питания сохранён."));
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
      coachNotes: existing?.coachNotes ?? null,
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
    revalidateNutritionPaths(studentId);
    const [pathOnly] = redirectTo.split("?");
    const params = new URLSearchParams();
    params.set("weekFrom", weekFrom);
    params.set("weekTo", weekTo);
    params.set("macroText", rawText);
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
      withNotice(
        redirectTo,
        "notice",
        `Отчёт сохранён (${formatNutritionStatus(result.report.status, "report")}), строк макросов: ${result.macros.length}.`
      )
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

export async function previewNutritionFileUploadAction(formData: FormData): Promise<void> {
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
    const preview = await previewNutritionFileUpload({
      studentId,
      weekFrom,
      weekTo,
      studentNotes,
      files,
    });
    revalidateNutritionPaths(studentId);
    redirect(
      withNotice(
        redirectTo,
        "notice",
        `Файлы обработаны: ${preview.fileMetas.length}. Дней найдено: ${preview.quality.parsedDays}, статус: ${formatNutritionStatus(preview.status, "report")}.`
      )
    );
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = error instanceof Error ? error.message : "Не удалось распознать файлы отчёта.";
    redirect(withNotice(redirectTo, "error", message));
  }
}

export async function saveNutritionFileReportAction(formData: FormData): Promise<void> {
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
    const forceNeedsReview = parseBoolean(getOptionalFormValue(formData, "forceNeedsReview"), false);
    const result = await saveNutritionFileReport({
      studentId,
      weekFrom,
      weekTo,
      studentNotes,
      files,
      forceNeedsReview,
    });
    revalidateNutritionPaths(studentId);
    redirect(
      withNotice(
        redirectTo,
        "notice",
        `Отчёт сохранён (${formatNutritionStatus(result.status, "report")}), файлов: ${result.intake.fileMetas.length}, макросов: ${result.macros.length}.`
      )
    );
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = error instanceof Error ? error.message : "Не удалось сохранить отчёт из файлов.";
    redirect(withNotice(redirectTo, "error", message));
  }
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
    revalidateNutritionPaths(studentId);
    const message = result.generated.safety_flags.blocked
      ? "Блок безопасности: черновик скрыт, нужна ручная проверка."
      : "Недельный обзор сгенерирован.";
    redirect(withNotice(redirectTo, "notice", message));
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = error instanceof Error ? error.message : "Не удалось сгенерировать недельный обзор.";
    redirect(withNotice(redirectTo, "error", message));
  }
}
