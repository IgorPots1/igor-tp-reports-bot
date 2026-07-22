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
  computeTrainingPeaksRosterImportPlan,
  applyTrainingPeaksRosterImportSelection,
  type ApplyTrainingPeaksRosterImportResult,
  deleteTrainingPeaksAdminOrphanReport,
  deleteTrainingPeaksOrphanReportsForWeek,
  parseTrainingPeaksAdminTelegramContextNotes,
  parseTrainingPeaksAdminTelegramFormality,
  saveTrainingPeaksAdminReportEdit,
  setTrainingPeaksStudentWeeklyReportsEnabled,
  sendTrainingPeaksWeeklyReportToStudent,
  unlinkTrainingPeaksStudentTelegram,
  updateTrainingPeaksAdminStudentTelegramContext,
} from "@/features/trainingpeaks/admin";
import {
  disableTrainingPeaksStudentByInternalId,
  enableTrainingPeaksStudentByInternalId,
  requestTrainingPeaksWeeklyRunForStudentByInternalId,
} from "@/features/trainingpeaks/service";
import type { WouldInsertRow } from "@/features/trainingpeaks/athlete-roster-import";
import { TpApiAuthError, TpApiHttpError, TpApiSchemaError } from "@/features/trainingpeaks/tp-api-client";
import { TpSessionSnapshotMissingError } from "@/features/trainingpeaks/tp-session-snapshot";
import { createBillingClient } from "@/features/billing/service";
import type { BillingCurrency } from "@/features/billing/types";
import {
  ADMIN_ACCESS_COOKIE_NAME,
  hasValidAdminAccessCookie,
  isAdminAccessBypassedForLocalDev,
  normalizeAdminRedirectPath,
} from "@/lib/admin-auth";
import type { TrainingPeaksRosterSyncPreviewResult } from "@/app/admin/students/sync/types";

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
  revalidatePath("/admin/telegram-links");

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

  // Опциональный биллинг: если в форме указана сумма — заводим клиента сразу,
  // привязанного к новому ученику. Если биллинг не удался — ученик уже создан,
  // не теряем его, сообщаем об этом в уведомлении.
  const billingAmountRaw =
    typeof formData.get("billing_monthly_amount") === "string"
      ? String(formData.get("billing_monthly_amount")).trim()
      : "";
  let successNotice = `Ученик создан: ${result.student.studentName}.`;

  if (billingAmountRaw) {
    try {
      const monthlyAmount = Number(billingAmountRaw);
      if (!Number.isInteger(monthlyAmount)) {
        throw new Error("сумма должна быть целым числом");
      }

      const billingDayRaw =
        typeof formData.get("billing_payment_day") === "string"
          ? String(formData.get("billing_payment_day")).trim()
          : "";
      const plannedPaymentDay = billingDayRaw ? Number(billingDayRaw) : null;
      if (plannedPaymentDay !== null && !Number.isInteger(plannedPaymentDay)) {
        throw new Error("день оплаты должен быть числом");
      }

      const currency =
        typeof formData.get("billing_currency") === "string"
          ? String(formData.get("billing_currency"))
          : "RUB";
      const paymentMethod =
        typeof formData.get("billing_payment_method") === "string"
          ? String(formData.get("billing_payment_method"))
          : "tbank_link_a";

      await createBillingClient({
        clientName: result.student.studentName,
        monthlyAmount,
        currency: currency as BillingCurrency,
        plannedPaymentDay,
        paymentMethod,
        studentId: result.student.id,
        actor: "admin:/admin/students/new",
      });
      successNotice = `Ученик и биллинг созданы: ${result.student.studentName}.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "не удалось завести биллинг";
      successNotice = `Ученик создан: ${result.student.studentName}. Биллинг не заведён: ${message}`;
    }
  }

  redirect(withNotice(`/admin/students/${result.student.id}`, "notice", successNotice));
}

const ROSTER_SYNC_REDIRECT_TARGET = "/admin/students/sync";
const MAX_ROSTER_SYNC_SELECTION = 500;

function classifyRosterSyncPreviewError(error: unknown): Extract<TrainingPeaksRosterSyncPreviewResult, { ok: false }> {
  if (error instanceof TpSessionSnapshotMissingError) {
    return {
      ok: false,
      kind: "snapshot_missing",
      message:
        "Сессия TrainingPeaks не найдена. Синхронизация работает только локально: запусти админку на своём Маке (npm run dev) и обнови сессию командой tp-refresh-session-snapshot.",
    };
  }
  if (
    error instanceof TpApiAuthError ||
    (error instanceof TpApiHttpError && (error.status === 401 || error.status === 403))
  ) {
    return {
      ok: false,
      kind: "auth_stale",
      message:
        "Сессия TrainingPeaks устарела. Обнови её локально командой tp-refresh-session-snapshot и повтори синхронизацию.",
    };
  }
  if (error instanceof TpApiHttpError) {
    return {
      ok: false,
      kind: "tp_http",
      message: `TrainingPeaks вернул ошибку HTTP ${error.status}. Попробуй позже.`,
    };
  }
  if (error instanceof TpApiSchemaError) {
    return {
      ok: false,
      kind: "tp_schema",
      message: "TrainingPeaks вернул неожиданный формат ответа. Проверь список учеников вручную и сообщи разработчику.",
    };
  }
  console.error("TrainingPeaks roster sync preview failed", {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  });
  return {
    ok: false,
    kind: "unknown",
    message: "Не удалось загрузить ростер из TrainingPeaks. Попробуй ещё раз.",
  };
}

export async function previewTrainingPeaksRosterSyncAction(): Promise<TrainingPeaksRosterSyncPreviewResult> {
  await ensureAdminAccess(ROSTER_SYNC_REDIRECT_TARGET);

  try {
    const plan = await computeTrainingPeaksRosterImportPlan();
    return { ok: true, plan };
  } catch (error) {
    return classifyRosterSyncPreviewError(error);
  }
}

function sanitizeRosterSyncSelection(selected: unknown): WouldInsertRow[] {
  if (!Array.isArray(selected)) {
    throw new Error("Некорректный список выбранных учеников.");
  }
  if (selected.length > MAX_ROSTER_SYNC_SELECTION) {
    throw new Error(`Слишком много учеников за один раз (>${MAX_ROSTER_SYNC_SELECTION}).`);
  }

  const rows: WouldInsertRow[] = [];
  for (const raw of selected) {
    if (typeof raw !== "object" || raw === null) continue;
    const record = raw as Record<string, unknown>;
    const studentId = typeof record.student_id === "string" ? record.student_id.trim() : "";
    const studentName = typeof record.student_name === "string" ? record.student_name.trim() : "";
    const athleteUrl =
      typeof record.trainingpeaks_athlete_url === "string" ? record.trainingpeaks_athlete_url.trim() : "";
    if (!studentId || !studentName || !athleteUrl) continue;

    const athleteId =
      typeof record.athlete_id === "number" && Number.isInteger(record.athlete_id) ? record.athlete_id : 0;
    const baseSlug = typeof record.base_slug === "string" && record.base_slug ? record.base_slug : studentId;
    const slugSuffix = typeof record.slug_suffix === "number" ? record.slug_suffix : null;

    rows.push({
      student_id: studentId,
      student_name: studentName,
      trainingpeaks_athlete_url: athleteUrl,
      athlete_id: athleteId,
      base_slug: baseSlug,
      slug_suffix: slugSuffix,
    });
  }

  return rows;
}

export async function applyTrainingPeaksRosterSyncAction(
  selected: WouldInsertRow[]
): Promise<ApplyTrainingPeaksRosterImportResult> {
  await ensureAdminAccess(ROSTER_SYNC_REDIRECT_TARGET);

  const rows = sanitizeRosterSyncSelection(selected);
  const result = await applyTrainingPeaksRosterImportSelection(rows);
  revalidateTrainingPeaksAdminPaths();
  return result;
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
    withNotice(redirectTo, "notice", `Telegram привязан: ${result.studentName}.`)
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
    withNotice(redirectTo, "notice", `Тестовое сообщение отправлено: ${result.studentName}.`)
  );
}

export async function createTrainingPeaksStudentWeeklyReportJobAction(
  formData: FormData
): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const weekFrom = getRequiredFormValue(formData, "weekFrom");
  const weekTo = getRequiredFormValue(formData, "weekTo");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);

  const result = await requestTrainingPeaksWeeklyRunForStudentByInternalId({
    studentInternalId: studentId,
    weekFrom,
    weekTo,
    requestedByChatId: "admin",
    requestedByUserId: "admin",
  });

  revalidateTrainingPeaksAdminPaths(undefined, studentId);

  if (!result.ok) {
    redirect(withNotice(redirectTo, "error", result.message));
  }

  redirect(
    withNotice(
      redirectTo,
      "notice",
      `Задача на генерацию отчёта поставлена в очередь: ${result.student.studentName}, ${weekFrom} — ${weekTo}. Отчёт не будет отправлен ученику автоматически.`
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

export async function updateTrainingPeaksStudentTelegramContextAction(formData: FormData): Promise<void> {
  const studentId = getRequiredFormValue(formData, "studentId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);

  const result = await updateTrainingPeaksAdminStudentTelegramContext(studentId, {
    telegramFormality: parseTrainingPeaksAdminTelegramFormality(formData.get("telegramFormality")),
    telegramContextNotes: parseTrainingPeaksAdminTelegramContextNotes(formData.get("telegramContextNotes")),
  });

  revalidateTrainingPeaksAdminPaths(undefined, studentId);

  if (!result.ok) {
    redirect(withNotice(redirectTo, "error", result.message));
  }

  redirect(withNotice(redirectTo, "notice", `Telegram-контекст сохранён: ${result.studentName}.`));
}
