"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  confirmImportedPaymentMatch,
  ignoreImportedPayment,
  linkBillingClientToStudent,
  markBillingClientPaid,
  markBillingClientUnpaid,
  resolveBillingMonth,
  unlinkBillingClientFromStudent,
  updateBillingClientById,
} from "@/features/billing/service";
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
  return trimmed ? trimmed : null;
}

function buildBillingRedirect(month: string): string {
  const params = new URLSearchParams();
  params.set("month", month.slice(0, 7));
  return `/admin/billing?${params.toString()}`;
}

function withNotice(pathname: string, key: "notice" | "error", value: string): string {
  const [path, rawQuery = ""] = pathname.split("?");
  const params = new URLSearchParams(rawQuery);
  params.set(key, value);
  return `${path}?${params.toString()}`;
}

function revalidateBillingPaths(clientId?: string, studentId?: string): void {
  revalidatePath("/admin/billing");
  revalidatePath("/admin/billing/matching");
  revalidatePath("/admin/billing/imports");

  if (clientId) {
    revalidatePath(`/admin/billing/clients/${clientId}`);
  }

  if (studentId) {
    revalidatePath(`/admin/students/${studentId}`);
  }
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

function parseOptionalAmount(rawAmount: string | null): number | null {
  if (!rawAmount) {
    return null;
  }

  const amount = Number(rawAmount);
  if (!Number.isFinite(amount)) {
    throw new Error("Invalid form field: amount");
  }

  return amount;
}

const BILLING_ACTION_ACTOR = "admin:/admin/billing";
const BILLING_IMPORTS_ACTION_ACTOR = "admin:/admin/billing/imports";

function buildBillingImportsRedirect(status?: string | null): string {
  const params = new URLSearchParams();
  if (status && status !== "new") {
    params.set("status", status);
  }
  const query = params.toString();
  return query ? `/admin/billing/imports?${query}` : "/admin/billing/imports";
}

export async function markBillingPaidAction(formData: FormData): Promise<void> {
  const clientId = getRequiredFormValue(formData, "clientId");
  const month = resolveBillingMonth(getRequiredFormValue(formData, "month"));
  const redirectTo = getOptionalFormValue(formData, "redirectTo") ?? buildBillingRedirect(month);

  await ensureAdminAccess(redirectTo);

  let notice = "Платёж отмечен как оплаченный.";

  try {
    const result = await markBillingClientPaid({
      billingClientId: clientId,
      month,
      paidAmount: parseOptionalAmount(getOptionalFormValue(formData, "amount")),
      actor: BILLING_ACTION_ACTOR,
    });
    if (result.kind === "already_paid") {
      notice = "Платёж уже отмечен как оплаченный.";
    }
  } catch (error) {
    revalidateBillingPaths(clientId);
    const message = error instanceof Error ? error.message : "Не удалось отметить платёж как оплаченный.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateBillingPaths(clientId);
  redirect(withNotice(redirectTo, "notice", notice));
}

export async function markBillingUnpaidAction(formData: FormData): Promise<void> {
  const clientId = getRequiredFormValue(formData, "clientId");
  const month = resolveBillingMonth(getRequiredFormValue(formData, "month"));
  const redirectTo = getOptionalFormValue(formData, "redirectTo") ?? buildBillingRedirect(month);

  await ensureAdminAccess(redirectTo);

  try {
    await markBillingClientUnpaid({
      billingClientId: clientId,
      month,
      actor: BILLING_ACTION_ACTOR,
    });
  } catch (error) {
    revalidateBillingPaths(clientId);
    const message = error instanceof Error ? error.message : "Не удалось снять оплату.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateBillingPaths(clientId);
  redirect(withNotice(redirectTo, "notice", "Оплата снята. Статус возвращён в ожидание."));
}

function parseIntegerField(value: string, fieldName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid form field: ${fieldName}`);
  }
  return parsed;
}

export async function updateBillingClientAction(formData: FormData): Promise<void> {
  const clientId = getRequiredFormValue(formData, "clientId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  const field = getRequiredFormValue(formData, "field");
  await ensureAdminAccess(redirectTo);

  try {
    switch (field) {
      case "clientName":
        await updateBillingClientById(clientId, {
          clientName: getRequiredFormValue(formData, "value"),
          updatedBy: BILLING_ACTION_ACTOR,
        });
        break;
      case "groupName":
        await updateBillingClientById(clientId, {
          groupName: getOptionalFormValue(formData, "value"),
          updatedBy: BILLING_ACTION_ACTOR,
        });
        break;
      case "monthlyAmount":
        await updateBillingClientById(clientId, {
          monthlyAmount: parseIntegerField(getRequiredFormValue(formData, "value"), "value"),
          updatedBy: BILLING_ACTION_ACTOR,
        });
        break;
      case "plannedPaymentDay":
        await updateBillingClientById(clientId, {
          plannedPaymentDay: parseIntegerField(getRequiredFormValue(formData, "value"), "value"),
          updatedBy: BILLING_ACTION_ACTOR,
        });
        break;
      case "paymentMethod":
        await updateBillingClientById(clientId, {
          paymentMethod: getRequiredFormValue(formData, "value"),
          updatedBy: BILLING_ACTION_ACTOR,
        });
        break;
      default:
        throw new Error(`Unsupported billing field: ${field}`);
    }
  } catch (error) {
    revalidateBillingPaths(clientId);
    const message = error instanceof Error ? error.message : "Не удалось обновить клиента биллинга.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateBillingPaths(clientId);
  redirect(withNotice(redirectTo, "notice", "Данные клиента обновлены."));
}

export async function setBillingClientActiveAction(formData: FormData): Promise<void> {
  const clientId = getRequiredFormValue(formData, "clientId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  const nextState = getRequiredFormValue(formData, "isActive") === "true";
  await ensureAdminAccess(redirectTo);

  try {
    await updateBillingClientById(clientId, {
      isActive: nextState,
      updatedBy: BILLING_ACTION_ACTOR,
    });
  } catch (error) {
    revalidateBillingPaths(clientId);
    const message = error instanceof Error ? error.message : "Не удалось обновить статус клиента.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateBillingPaths(clientId);
  redirect(withNotice(redirectTo, "notice", nextState ? "Клиент активирован." : "Клиент поставлен на паузу."));
}

export async function linkBillingClientToStudentAction(formData: FormData): Promise<void> {
  const clientId = getRequiredFormValue(formData, "clientId");
  const studentId = getRequiredFormValue(formData, "studentId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);

  try {
    await linkBillingClientToStudent(clientId, studentId, BILLING_ACTION_ACTOR);
  } catch (error) {
    revalidateBillingPaths(clientId, studentId);
    const message = error instanceof Error ? error.message : "Не удалось привязать billing-клиента к ученику.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateBillingPaths(clientId, studentId);
  redirect(withNotice(redirectTo, "notice", "Billing-клиент привязан к ученику."));
}

export async function unlinkBillingClientFromStudentAction(formData: FormData): Promise<void> {
  const clientId = getRequiredFormValue(formData, "clientId");
  const redirectTo = getRequiredFormValue(formData, "redirectTo");
  const studentId = getOptionalFormValue(formData, "studentId") ?? undefined;
  await ensureAdminAccess(redirectTo);

  try {
    await unlinkBillingClientFromStudent(clientId, BILLING_ACTION_ACTOR);
  } catch (error) {
    revalidateBillingPaths(clientId, studentId);
    const message = error instanceof Error ? error.message : "Не удалось отвязать billing-клиента от ученика.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateBillingPaths(clientId, studentId);
  redirect(withNotice(redirectTo, "notice", "Billing-клиент отвязан от ученика."));
}

export async function confirmImportedPaymentAction(formData: FormData): Promise<void> {
  const importedPaymentId = getRequiredFormValue(formData, "importedPaymentId");
  const monthlyPaymentId = getRequiredFormValue(formData, "monthlyPaymentId");
  const redirectTo = getOptionalFormValue(formData, "redirectTo") ?? buildBillingImportsRedirect("new");

  await ensureAdminAccess(redirectTo);

  let clientId: string | undefined;
  let notice = "Импортированный платёж засчитан.";

  try {
    const result = await confirmImportedPaymentMatch({
      importedPaymentId,
      monthlyPaymentId,
      actor: BILLING_IMPORTS_ACTION_ACTOR,
    });
    clientId = result.monthlyPayment.client.id;
    if (result.identityLearningWarnings.length > 0) {
      notice = `${notice} Обучение идентификаторов: ${result.identityLearningWarnings.length} предупрежд.`;
    }
  } catch (error) {
    revalidatePath("/admin/billing/imports");
    const message = error instanceof Error ? error.message : "Не удалось засчитать импортированный платёж.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateBillingPaths(clientId);
  redirect(withNotice(redirectTo, "notice", notice));
}

export async function ignoreImportedPaymentAction(formData: FormData): Promise<void> {
  const importedPaymentId = getRequiredFormValue(formData, "importedPaymentId");
  const redirectTo = getOptionalFormValue(formData, "redirectTo") ?? buildBillingImportsRedirect("new");
  const notes = getOptionalFormValue(formData, "notes");

  await ensureAdminAccess(redirectTo);

  try {
    await ignoreImportedPayment({
      importedPaymentId,
      actor: BILLING_IMPORTS_ACTION_ACTOR,
      notes,
    });
  } catch (error) {
    revalidatePath("/admin/billing/imports");
    const message = error instanceof Error ? error.message : "Не удалось игнорировать импортированный платёж.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidatePath("/admin/billing/imports");
  redirect(withNotice(redirectTo, "notice", "Импортированный платёж помечен как игнорированный."));
}
