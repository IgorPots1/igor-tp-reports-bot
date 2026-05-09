"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  saveTrainingPeaksAdminReportEdit,
  sendTrainingPeaksWeeklyReportToStudent,
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

  redirect(withNotice(redirectTo, "notice", `Ученик восстановлен: ${student.studentName}.`));
}
