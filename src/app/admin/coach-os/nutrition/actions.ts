"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  addNutritionContextNoteActionData,
  addNutritionWeightActionData,
  generateNutritionWeeklyReview,
  parseNutritionManualMacros,
  saveNutritionManualMacros,
  saveNutritionProfileActionData,
} from "@/features/nutrition/admin";
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
    const message = error instanceof Error ? error.message : "Failed to save nutrition profile.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateNutritionPaths(studentId);
  redirect(withNotice(redirectTo, "notice", "Nutrition profile saved."));
}

export async function addNutritionWeightAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);

  try {
    const weight = parseOptionalNumber(getRequiredFormValue(formData, "weightKg"));
    if (weight === null) {
      throw new Error("Weight is required.");
    }
    await addNutritionWeightActionData({
      studentId,
      weightKg: weight,
      source: getOptionalFormValue(formData, "source") ?? "manual",
      rawText: getOptionalFormValue(formData, "rawText"),
    });
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = error instanceof Error ? error.message : "Failed to save weight log.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateNutritionPaths(studentId);
  redirect(withNotice(redirectTo, "notice", "Weight log added."));
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
    const message = error instanceof Error ? error.message : "Failed to add nutrition context note.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateNutritionPaths(studentId);
  redirect(withNotice(redirectTo, "notice", "Nutrition context note added."));
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
    params.set("notice", `Manual parser: ${parsed.rows.length} rows, status ${parsed.status}.`);
    redirect(`${pathOnly}?${params.toString()}`);
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = error instanceof Error ? error.message : "Failed to parse manual macros.";
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
        `Report saved (${result.report.status}), macro rows stored: ${result.macros.length}.`
      )
    );
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = error instanceof Error ? error.message : "Failed to save parsed macros.";
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
      ? "Safety block triggered: draft suppressed, manual review required."
      : "Nutrition weekly review draft generated.";
    redirect(withNotice(redirectTo, "notice", message));
  } catch (error) {
    revalidateNutritionPaths(studentId);
    const message = error instanceof Error ? error.message : "Failed to generate nutrition weekly review.";
    redirect(withNotice(redirectTo, "error", message));
  }
}
