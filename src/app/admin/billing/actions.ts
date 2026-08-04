"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  confirmImportedPaymentMatch,
  createBillingClient,
  createBillingClientFromImportedPaymentAndStudent,
  deleteBillingPayerIdentity,
  ignoreImportedPayment,
  linkBillingClientToStudent,
  markBillingClientPaid,
  markBillingClientUnpaid,
  recordManualPaymentForClientMonth,
  resolveBillingMonth,
  setBillingClientActive,
  undoImportedPaymentMatch,
  unlinkBillingClientFromStudent,
  updateBillingClientById,
} from "@/features/billing/service";
import {
  BILLING_CURRENCY_VALUES,
  type BillingCurrency,
  type BillingPaymentSlot,
} from "@/features/billing/types";
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
      case "currency": {
        const newCurrency = getRequiredFormValue(formData, "value");
        if (!(BILLING_CURRENCY_VALUES as readonly string[]).includes(newCurrency)) {
          throw new Error(`Недопустимая валюта: ${newCurrency}.`);
        }
        await updateBillingClientById(clientId, {
          currency: newCurrency as BillingCurrency,
          updatedBy: BILLING_ACTION_ACTOR,
        });
        break;
      }
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

  let pausedMonths = 0;

  try {
    const result = await setBillingClientActive({
      clientId,
      isActive: nextState,
      actor: BILLING_ACTION_ACTOR,
    });
    pausedMonths = result.pausedMonths;
  } catch (error) {
    revalidateBillingPaths(clientId);
    const message = error instanceof Error ? error.message : "Не удалось обновить статус клиента.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateBillingPaths(clientId);
  const notice = nextState
    ? "Клиент активирован."
    : pausedMonths > 0
      ? `Клиент на паузе. Неоплаченных месяцев приостановлено: ${pausedMonths}.`
      : "Клиент поставлен на паузу.";
  redirect(withNotice(redirectTo, "notice", notice));
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
  // Слот необязателен на стороне формы: у обычного клиента его не показывают, а форма
  // «Засчитать вручную» охватывает разных клиентов и не может знать заранее, нужен ли
  // он. Решает сервер — по фактической строке месяца.
  const slotRaw = getOptionalFormValue(formData, "slot");
  const slot: BillingPaymentSlot | undefined =
    slotRaw === "base" || slotRaw === "nutrition" ? slotRaw : undefined;
  const redirectTo = getOptionalFormValue(formData, "redirectTo") ?? buildBillingImportsRedirect("new");

  await ensureAdminAccess(redirectTo);

  let clientId: string | undefined;
  let notice = "Импортированный платёж засчитан.";

  try {
    const result = await confirmImportedPaymentMatch({
      importedPaymentId,
      monthlyPaymentId,
      actor: BILLING_IMPORTS_ACTION_ACTOR,
      slot,
    });
    clientId = result.monthlyPayment.client.id;
    if (result.identityLearningWarnings.length > 0) {
      notice = `${notice} ⚠️ Не все идентификаторы плательщика обучены (${result.identityLearningWarnings.length}): возможен конфликт с другим клиентом. Проверь «Изученные идентификаторы» на карточке клиента.`;
    }
  } catch (error) {
    revalidatePath("/admin/billing/imports");
    const message = error instanceof Error ? error.message : "Не удалось засчитать импортированный платёж.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateBillingPaths(clientId);
  redirect(withNotice(redirectTo, "notice", notice));
}

export async function createBillingClientAction(formData: FormData): Promise<void> {
  const redirectTo = getOptionalFormValue(formData, "redirectTo") ?? "/admin/billing/clients/new";
  await ensureAdminAccess(redirectTo);

  const clientName = getRequiredFormValue(formData, "clientName");
  const monthlyAmountRaw = getRequiredFormValue(formData, "monthlyAmount");
  const currency = getRequiredFormValue(formData, "currency");
  const paymentMethod = getRequiredFormValue(formData, "paymentMethod");
  const groupName = getOptionalFormValue(formData, "groupName");
  const plannedPaymentDayRaw = getOptionalFormValue(formData, "plannedPaymentDay");
  const studentId = getOptionalFormValue(formData, "studentId");
  const notes = getOptionalFormValue(formData, "notes");

  let createdClientId: string | undefined;

  try {
    const monthlyAmount = Number(monthlyAmountRaw);
    if (!Number.isInteger(monthlyAmount)) {
      throw new Error("Сумма должна быть целым числом.");
    }

    const plannedPaymentDay = plannedPaymentDayRaw == null ? null : Number(plannedPaymentDayRaw);
    if (plannedPaymentDay !== null && !Number.isInteger(plannedPaymentDay)) {
      throw new Error("День оплаты должен быть числом.");
    }

    const created = await createBillingClient({
      clientName,
      groupName,
      monthlyAmount,
      currency: currency as BillingCurrency,
      plannedPaymentDay,
      paymentMethod,
      studentId,
      notes,
      actor: BILLING_ACTION_ACTOR,
    });
    createdClientId = created.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось создать клиента биллинга.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateBillingPaths(createdClientId);
  redirect(
    withNotice(
      createdClientId ? `/admin/billing/clients/${createdClientId}` : redirectTo,
      "notice",
      "Клиент биллинга создан."
    )
  );
}

export async function deleteBillingPayerIdentityAction(formData: FormData): Promise<void> {
  const identityId = getRequiredFormValue(formData, "identityId");
  const clientId = getRequiredFormValue(formData, "clientId");
  const redirectTo = getOptionalFormValue(formData, "redirectTo") ?? `/admin/billing/clients/${clientId}`;

  await ensureAdminAccess(redirectTo);

  try {
    await deleteBillingPayerIdentity({ identityId });
  } catch (error) {
    revalidateBillingPaths(clientId);
    const message = error instanceof Error ? error.message : "Не удалось удалить идентификатор плательщика.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateBillingPaths(clientId);
  redirect(withNotice(redirectTo, "notice", "Идентификатор плательщика удалён."));
}

export async function undoImportedPaymentMatchAction(formData: FormData): Promise<void> {
  const importedPaymentId = getRequiredFormValue(formData, "importedPaymentId");
  const redirectTo = getOptionalFormValue(formData, "redirectTo") ?? buildBillingImportsRedirect("matched");

  await ensureAdminAccess(redirectTo);

  let notice = "Зачёт отменён: платёж снова доступен для привязки.";

  try {
    const result = await undoImportedPaymentMatch({
      importedPaymentId,
      actor: BILLING_IMPORTS_ACTION_ACTOR,
    });
    if (result.removedIdentityCount > 0) {
      notice = `${notice} Удалена выученная связь плательщика (${result.removedIdentityCount}).`;
    }
  } catch (error) {
    revalidatePath("/admin/billing/imports");
    const message = error instanceof Error ? error.message : "Не удалось отменить зачёт.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateBillingPaths();
  redirect(withNotice(redirectTo, "notice", notice));
}

export async function createBillingClientFromPaymentAction(formData: FormData): Promise<void> {
  const importedPaymentId = getRequiredFormValue(formData, "importedPaymentId");
  const studentId = getRequiredFormValue(formData, "studentId");
  const clientName = getRequiredFormValue(formData, "clientName");
  const redirectTo = getOptionalFormValue(formData, "redirectTo") ?? buildBillingImportsRedirect("new");

  await ensureAdminAccess(redirectTo);

  let clientId: string | undefined;

  try {
    const result = await createBillingClientFromImportedPaymentAndStudent({
      importedPaymentId,
      studentId,
      clientName,
      actor: BILLING_IMPORTS_ACTION_ACTOR,
    });
    clientId = result.createdClientId;
  } catch (error) {
    revalidatePath("/admin/billing/imports");
    const message = error instanceof Error ? error.message : "Не удалось завести клиента из платежа.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateBillingPaths(clientId);
  redirect(withNotice(redirectTo, "notice", "Клиент заведён и платёж засчитан."));
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

export async function recordManualPaymentsAction(formData: FormData): Promise<void> {
  const clientId = getRequiredFormValue(formData, "clientId");
  const redirectTo =
    getOptionalFormValue(formData, "redirectTo") ?? `/admin/billing/clients/${clientId}`;

  await ensureAdminAccess(redirectTo);

  const currencyRaw = getRequiredFormValue(formData, "currency");
  if (!(BILLING_CURRENCY_VALUES as readonly string[]).includes(currencyRaw)) {
    revalidateBillingPaths(clientId);
    redirect(withNotice(redirectTo, "error", `Недопустимая валюта: ${currencyRaw}.`));
  }
  const currency = currencyRaw as BillingCurrency;

  const actualDate = getRequiredFormValue(formData, "actualDate");
  const months = formData.getAll("month").filter((v): v is string => typeof v === "string" && v.trim() !== "");
  const amounts = formData.getAll("amount").filter((v): v is string => typeof v === "string" && v.trim() !== "");

  if (months.length === 0) {
    revalidateBillingPaths(clientId);
    redirect(withNotice(redirectTo, "error", "Укажи хотя бы один месяц."));
  }

  if (months.length !== amounts.length) {
    revalidateBillingPaths(clientId);
    redirect(withNotice(redirectTo, "error", "Количество месяцев и сумм не совпадает."));
  }

  const notices: string[] = [];

  try {
    for (let i = 0; i < months.length; i++) {
      const month = months[i];
      const paidAmount = Number(amounts[i]);
      if (!Number.isInteger(paidAmount) || paidAmount <= 0) {
        throw new Error(`Сумма для месяца ${month} должна быть положительным целым числом.`);
      }
      const result = await recordManualPaymentForClientMonth({
        billingClientId: clientId,
        month,
        paidAmount,
        actualPaymentDate: actualDate,
        currency,
        actor: BILLING_ACTION_ACTOR,
      });
      const label = month.slice(0, 7);
      notices.push(result.kind === "already_paid" ? `${label}: уже был оплачен.` : `${label}: записано.`);
    }
  } catch (error) {
    revalidateBillingPaths(clientId);
    const message = error instanceof Error ? error.message : "Не удалось записать оплату.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidateBillingPaths(clientId);
  redirect(withNotice(redirectTo, "notice", notices.join(" ")));
}
