"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  bindTrainingPeaksAdminStudentTelegramByBusinessChat,
  bindTrainingPeaksAdminStudentTelegramByUsername,
  createTrainingPeaksAdminStudentTelegramLinkCode,
  sendTrainingPeaksAdminStudentTelegramTestMessage,
  createTrainingPeaksStudent,
  deleteTrainingPeaksAdminOrphanReport,
  deleteTrainingPeaksOrphanReportsForWeek,
  saveTrainingPeaksAdminReportEdit,
  setTrainingPeaksStudentWeeklyReportsEnabled,
  sendTrainingPeaksWeeklyReportToStudent,
  unlinkTrainingPeaksStudentTelegram,
} from "@/features/trainingpeaks/admin";
import {
  disableTrainingPeaksStudentByInternalId,
  enableTrainingPeaksStudentByInternalId,
} from "@/features/trainingpeaks/service";
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

function withNotice(pathname: string, key: "notice" | "error", value: string): string {
  const [path, rawQuery = ""] = pathname.split("?");
  const params = new URLSearchParams(rawQuery);
  params.set(key, value);
  return `${path}?${params.toString()}`;
}

function withParams(pathname: string, values: Record<string, string>): string {
  const [path, rawQuery = ""] = pathname.split("?");
  const params = new URLSearchParams(rawQuery);

  for (const [key, value] of Object.entries(values)) {
    params.set(key, value);
  }

  return `${path}?${params.toString()}`;
}

function getTrainingPeaksStudentDetailPath(studentId: string): string {
  return `/admin/students/${studentId}`;
}

async function ensureAdminAccess(redirectTarget?: string): Promise<void> {
  if (isAdminAccessBypassedForLocalDev()) {
    return;
  }

  const cookieStore = await cookies();

  if (hasValidAdminAccessCookie(cookieStore.get(ADMIN_ACCESS_COOKIE_NAME)?.value)) {
    return;
  }

  redirect(`/admin/login?next=${encodeURIComponent(normalizeAdminRedirectPath(redirectTarget ?? "/admin/reports"))}`);
}

function revalidateTrainingPeaksAdminPaths(reportId?: string, studentId?: string): void {
  revalidatePath("/admin/reports");
  revalidatePath("/admin/students");

  if (reportId) {
    revalidatePath(`/admin/reports/${reportId}`);
  }

  if (studentId) {
    revalidatePath(`/admin/students/${studentId}`);
  }
}

export async function saveTrainingPeaksReportEditAction(formData: FormData): Promise<void> {
  const reportId = getRequiredFormValue(formData, "reportId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const reportMarkdown = getRequiredFormValue(formData, "reportMarkdown");
  const result = await saveTrainingPeaksAdminReportEdit(reportId, reportMarkdown);

  revalidateTrainingPeaksAdminPaths(reportId);

  if (!result.ok) {
    redirect(withNotice(redirectTo, "error", result.message));
  }

  redirect(withNotice(redirectTo, "notice", "Изменения сохранены."));
}

export async function sendTrainingPeaksReportAction(formData: FormData): Promise<void> {
  const reportId = getRequiredFormValue(formData, "reportId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const result = await sendTrainingPeaksWeeklyReportToStudent(reportId);

  revalidateTrainingPeaksAdminPaths(reportId);

  if (!result.ok) {
    redirect(withNotice(redirectTo, "error", result.message));
  }

  redirect(
    withNotice(
      redirectTo,
      "notice",
      result.deliveredChunks > 1
        ? `Отчёт отправлен. Доставлено ${result.deliveredChunks} сообщения.`
        : "Отчёт отправлен."
    )
  );
}

export async function deleteTrainingPeaksOrphanReportsForWeekAction(formData: FormData): Promise<void> {
  const weekFrom = getRequiredFormValue(formData, "weekFrom");
  const weekTo = getRequiredFormValue(formData, "weekTo");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const result = await deleteTrainingPeaksOrphanReportsForWeek(weekFrom, weekTo);

  revalidateTrainingPeaksAdminPaths();

  if (!result.ok) {
    redirect(withNotice(redirectTo, "error", result.message));
  }

  redirect(
    withNotice(
      redirectTo,
      "notice",
      result.deletedCount > 0
        ? `Удалено orphan-отчётов: ${result.deletedCount}.`
        : "За выбранную неделю orphan-отчёты не найдены."
    )
  );
}

export async function deleteTrainingPeaksOrphanReportAction(formData: FormData): Promise<void> {
  const reportId = getRequiredFormValue(formData, "reportId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const result = await deleteTrainingPeaksAdminOrphanReport(reportId);

  revalidateTrainingPeaksAdminPaths(reportId);

  if (!result.ok) {
    redirect(withNotice(redirectTo, "error", result.message));
  }

  redirect(withNotice(redirectTo, "notice", "Orphan-отчёт удалён."));
}

export async function archiveTrainingPeaksStudentAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const student = await disableTrainingPeaksStudentByInternalId(studentId);

  revalidateTrainingPeaksAdminPaths(undefined, studentId);

  if (!student) {
    redirect(withNotice(redirectTo, "error", "Ученик не найден."));
  }

  redirect(withNotice(redirectTo, "notice", `Ученик архивирован: ${student.studentName}.`));
}

export async function restoreTrainingPeaksStudentAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const student = await enableTrainingPeaksStudentByInternalId(studentId);

  revalidateTrainingPeaksAdminPaths(undefined, studentId);

  if (!student) {
    redirect(withNotice(redirectTo, "error", "Ученик не найден."));
  }

  redirect(
    withNotice(
      redirectTo,
      "notice",
      `Ученик восстановлен: ${student.studentName}. Проверь доставку в Telegram перед следующей отправкой.`
    )
  );
}

export async function createTrainingPeaksStudentAction(formData: FormData): Promise<void> {
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const studentId = typeof formData.get("student_id") === "string" ? String(formData.get("student_id")) : "";
  const studentName = typeof formData.get("student_name") === "string" ? String(formData.get("student_name")) : "";
  const trainingPeaksAthleteUrl =
    typeof formData.get("trainingpeaks_athlete_url") === "string"
      ? String(formData.get("trainingpeaks_athlete_url"))
      : "";
  const dataQualityStatus =
    typeof formData.get("data_quality_status") === "string"
      ? String(formData.get("data_quality_status"))
      : "";
  const result = await createTrainingPeaksStudent({
    studentId,
    studentName,
    trainingPeaksAthleteUrl,
    notes: typeof formData.get("notes") === "string" ? String(formData.get("notes")) : null,
    dataQualityStatus,
  });

  revalidateTrainingPeaksAdminPaths();

  if (!result.ok) {
    redirect(
      withParams(withNotice(redirectTo, "error", result.message), {
        student_id: studentId,
        student_name: studentName,
        trainingpeaks_athlete_url: trainingPeaksAthleteUrl,
        data_quality_status: dataQualityStatus,
      })
    );
  }

  redirect(
    withNotice(
      `/admin/students/${result.student.id}`,
      "notice",
      `Ученик создан: ${result.student.studentName}.`
    )
  );
}

export async function setTrainingPeaksStudentWeeklyReportsEnabledAction(
  formData: FormData
): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const enabled = getRequiredFormValue(formData, "enabled") === "true";
  const result = await setTrainingPeaksStudentWeeklyReportsEnabled(studentId, enabled);

  revalidateTrainingPeaksAdminPaths(undefined, studentId);

  if (!result.ok) {
    redirect(withNotice(redirectTo, "error", result.message));
  }

  redirect(
    withNotice(
      redirectTo,
      "notice",
      enabled
        ? `Недельные отчёты включены: ${result.student.studentName}.`
        : `Недельные отчёты отключены: ${result.student.studentName}.`
    )
  );
}

export async function bindTrainingPeaksStudentTelegramFromBusinessChatAction(
  formData: FormData
): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const businessChatId = getRequiredFormValue(formData, "businessChatId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const result = await bindTrainingPeaksAdminStudentTelegramByBusinessChat(studentId, businessChatId);

  revalidateTrainingPeaksAdminPaths(undefined, studentId);

  if (!result.ok) {
    redirect(withNotice(redirectTo, "error", result.message));
  }

  redirect(
    withNotice(
      getTrainingPeaksStudentDetailPath(studentId),
      "notice",
      `Telegram привязан: ${result.studentName}.`
    )
  );
}

export async function searchTrainingPeaksStudentTelegramByUsernameAction(
  formData: FormData
): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  const rawUsername = getRequiredFormValue(formData, "telegramUsername");
  await ensureAdminAccess(redirectTo);
  const result = await bindTrainingPeaksAdminStudentTelegramByUsername(studentId, rawUsername);

  revalidateTrainingPeaksAdminPaths(undefined, studentId);

  if (result.ok) {
    redirect(
      withNotice(
        getTrainingPeaksStudentDetailPath(studentId),
        "notice",
        `Telegram привязан: ${result.studentName}.`
      )
    );
  }

  if (!result.normalizedUsername) {
    redirect(withNotice(redirectTo, "error", result.message));
  }

  redirect(
    withParams(getTrainingPeaksStudentDetailPath(studentId), {
      telegramView: "username",
      telegramUsername: result.normalizedUsername,
    })
  );
}

export async function createTrainingPeaksStudentTelegramLinkCodeAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const result = await createTrainingPeaksAdminStudentTelegramLinkCode(studentId);

  revalidateTrainingPeaksAdminPaths(undefined, studentId);

  if (!result) {
    redirect(withNotice(redirectTo, "error", "Ученик не найден."));
  }

  redirect(
    withParams(withNotice(getTrainingPeaksStudentDetailPath(studentId), "notice", "Код привязки создан."), {
      telegramView: "code",
      telegramLinkCode: result.linkCode.code,
      telegramLinkCodeExpiresAt: result.linkCode.expiresAt,
    })
  );
}

export async function sendTrainingPeaksStudentTelegramTestAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const result = await sendTrainingPeaksAdminStudentTelegramTestMessage(studentId);

  revalidateTrainingPeaksAdminPaths(undefined, studentId);

  if (!result.ok) {
    redirect(withNotice(redirectTo, "error", result.message));
  }

  redirect(
    withNotice(
      getTrainingPeaksStudentDetailPath(studentId),
      "notice",
      `Тестовое сообщение отправлено: ${result.studentName}.`
    )
  );
}

export async function unlinkTrainingPeaksStudentTelegramAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const result = await unlinkTrainingPeaksStudentTelegram(studentId);

  revalidateTrainingPeaksAdminPaths(undefined, studentId);

  if (!result.ok) {
    redirect(withNotice(redirectTo, "error", result.message));
  }

  redirect(withNotice(redirectTo, "notice", `Telegram-привязка удалена: ${result.student.studentName}.`));
}
