"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  markBillingClientPaid,
  markBillingClientUnpaid,
  resolveBillingMonth,
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

export async function markBillingPaidAction(formData: FormData): Promise<void> {
  const clientId = getRequiredFormValue(formData, "clientId");
  const month = resolveBillingMonth(getRequiredFormValue(formData, "month"));
  const redirectTo = buildBillingRedirect(month);

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
    revalidatePath("/admin/billing");
    const message = error instanceof Error ? error.message : "Не удалось отметить платёж как оплаченный.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidatePath("/admin/billing");
  redirect(withNotice(redirectTo, "notice", notice));
}

export async function markBillingUnpaidAction(formData: FormData): Promise<void> {
  const clientId = getRequiredFormValue(formData, "clientId");
  const month = resolveBillingMonth(getRequiredFormValue(formData, "month"));
  const redirectTo = buildBillingRedirect(month);

  await ensureAdminAccess(redirectTo);

  try {
    await markBillingClientUnpaid({
      billingClientId: clientId,
      month,
      actor: BILLING_ACTION_ACTOR,
    });
  } catch (error) {
    revalidatePath("/admin/billing");
    const message = error instanceof Error ? error.message : "Не удалось снять оплату.";
    redirect(withNotice(redirectTo, "error", message));
  }

  revalidatePath("/admin/billing");
  redirect(withNotice(redirectTo, "notice", "Оплата снята. Статус возвращён в ожидание."));
}
