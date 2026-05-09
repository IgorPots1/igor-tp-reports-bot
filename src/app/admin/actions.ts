"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createTrainingPeaksStudent,
  saveTrainingPeaksAdminReportEdit,
  setTrainingPeaksStudentWeeklyReportsEnabled,
  sendTrainingPeaksWeeklyReportToStudent,
  unlinkTrainingPeaksStudentTelegram,
} from "@/features/trainingpeaks/admin";
import {
  disableTrainingPeaksStudentByInternalId,
  enableTrainingPeaksStudentByInternalId,
} from "@/features/trainingpeaks/service";

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

export async function archiveTrainingPeaksStudentAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
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
  const result = await createTrainingPeaksStudent({
    studentId: typeof formData.get("student_id") === "string" ? String(formData.get("student_id")) : "",
    studentName: typeof formData.get("student_name") === "string" ? String(formData.get("student_name")) : "",
    trainingPeaksAthleteUrl:
      typeof formData.get("trainingpeaks_athlete_url") === "string"
        ? String(formData.get("trainingpeaks_athlete_url"))
        : "",
    notes: typeof formData.get("notes") === "string" ? String(formData.get("notes")) : null,
    dataQualityStatus:
      typeof formData.get("data_quality_status") === "string"
        ? String(formData.get("data_quality_status"))
        : null,
  });

  revalidateTrainingPeaksAdminPaths();

  if (!result.ok) {
    redirect(withNotice(redirectTo, "error", result.message));
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

export async function unlinkTrainingPeaksStudentTelegramAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  const result = await unlinkTrainingPeaksStudentTelegram(studentId);

  revalidateTrainingPeaksAdminPaths(undefined, studentId);

  if (!result.ok) {
    redirect(withNotice(redirectTo, "error", result.message));
  }

  redirect(withNotice(redirectTo, "notice", `Telegram-привязка удалена: ${result.student.studentName}.`));
}
