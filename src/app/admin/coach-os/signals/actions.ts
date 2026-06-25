"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ADMIN_ACCESS_COOKIE_NAME,
  hasValidAdminAccessCookie,
  isAdminAccessBypassedForLocalDev,
  normalizeAdminRedirectPath,
} from "@/lib/admin-auth";
import {
  closeHealthSignalByAdminUi,
  isAdminCloseableHealthSignalType,
  type AdminHealthSignalCloseReason,
} from "@/features/trainingpeaks/repository";

const SIGNALS_ADMIN_PATH = "/admin/coach-os/signals";

async function ensureAdminAccess(): Promise<void> {
  if (isAdminAccessBypassedForLocalDev()) {
    return;
  }
  const cookieStore = await cookies();
  if (hasValidAdminAccessCookie(cookieStore.get(ADMIN_ACCESS_COOKIE_NAME)?.value)) {
    return;
  }
  redirect(`/admin/login?next=${encodeURIComponent(normalizeAdminRedirectPath(SIGNALS_ADMIN_PATH))}`);
}

function withNotice(key: "notice" | "error", value: string): string {
  const params = new URLSearchParams();
  params.set(key, value);
  return `${SIGNALS_ADMIN_PATH}?${params.toString()}`;
}

function normalizeCloseReason(value: string | null): AdminHealthSignalCloseReason | null {
  if (value === "recovered" || value === "false_positive" || value === "obsolete") {
    return value;
  }
  return null;
}

export async function closeHealthSignalAction(formData: FormData): Promise<void> {
  await ensureAdminAccess();

  const signalId = formData.get("signalId");
  const studentId = formData.get("studentId");
  const closeReasonRaw = formData.get("closeReason");

  if (typeof signalId !== "string" || !signalId.trim()) {
    redirect(withNotice("error", "Не передан ID сигнала"));
  }
  if (typeof studentId !== "string" || !studentId.trim()) {
    redirect(withNotice("error", "Не передан ID ученика"));
  }
  const closeReason = normalizeCloseReason(typeof closeReasonRaw === "string" ? closeReasonRaw.trim() : null);
  if (!closeReason) {
    redirect(withNotice("error", "Не выбрана причина закрытия"));
  }

  let result: Awaited<ReturnType<typeof closeHealthSignalByAdminUi>>;
  try {
    result = await closeHealthSignalByAdminUi({ signalId, studentId, closeReason });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Неизвестная ошибка";
    redirect(withNotice("error", `Ошибка при закрытии: ${msg}`));
  }

  if (!result.updated) {
    const reasonLabels: Record<string, string> = {
      not_found: "Сигнал не найден",
      not_active: "Сигнал уже неактивен",
      not_health_signal: "Тип сигнала не является здоровьем",
      concurrent_update: "Параллельное изменение, попробуй ещё раз",
    };
    redirect(withNotice("error", reasonLabels[result.reason] ?? `Не закрыт: ${result.reason}`));
  }

  revalidatePath(SIGNALS_ADMIN_PATH);
  redirect(withNotice("notice", "Сигнал закрыт"));
}

export async function validateHealthSignalTypeAction(signalType: string): Promise<boolean> {
  return isAdminCloseableHealthSignalType(signalType);
}
