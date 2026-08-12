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
  APPLICATION_STATUSES,
  updateApplication,
  type ApplicationStatus,
} from "@/features/intensive/repository";

async function ensureAdminAccess(redirectTarget: string): Promise<void> {
  if (isAdminAccessBypassedForLocalDev()) return;
  const cookieStore = await cookies();
  if (hasValidAdminAccessCookie(cookieStore.get(ADMIN_ACCESS_COOKIE_NAME)?.value)) return;
  redirect(`/admin/login?next=${encodeURIComponent(normalizeAdminRedirectPath(redirectTarget))}`);
}

function withNotice(pathname: string, key: "notice" | "error", value: string): string {
  const [path, rawQuery = ""] = pathname.split("?");
  const params = new URLSearchParams(rawQuery);
  params.set(key, value);
  return `${path}?${params.toString()}`;
}

function req(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing form field: ${key}`);
  }
  return value;
}

/**
 * Меняет статус заявки. Именно статус двигает счётчик мест на публичных
 * страницах: new и confirmed место занимают, cancelled возвращает.
 */
export async function updateIntensiveApplicationStatusAction(formData: FormData) {
  const id = req(formData, "id");
  const rawStatus = req(formData, "status");
  const redirectTo = normalizeAdminRedirectPath(
    typeof formData.get("redirectTo") === "string"
      ? (formData.get("redirectTo") as string)
      : `/admin/intensive/${id}`
  );

  await ensureAdminAccess(redirectTo);

  if (!(APPLICATION_STATUSES as readonly string[]).includes(rawStatus)) {
    redirect(withNotice(redirectTo, "error", "Неизвестный статус"));
  }

  await updateApplication(id, { status: rawStatus as ApplicationStatus });

  revalidatePath("/admin/intensive");
  revalidatePath(`/admin/intensive/${id}`);
  // Счётчик мест на публичных страницах обязан поехать сразу же.
  revalidatePath("/intensive");
  revalidatePath("/start");

  redirect(withNotice(redirectTo, "notice", "Статус обновлён"));
}

export async function updateIntensiveApplicationNoteAction(formData: FormData) {
  const id = req(formData, "id");
  const rawNote = formData.get("admin_note");
  const note = typeof rawNote === "string" ? rawNote.trim().slice(0, 4000) : "";
  const redirectTo = normalizeAdminRedirectPath(
    typeof formData.get("redirectTo") === "string"
      ? (formData.get("redirectTo") as string)
      : `/admin/intensive/${id}`
  );

  await ensureAdminAccess(redirectTo);

  await updateApplication(id, { adminNote: note || null });

  revalidatePath("/admin/intensive");
  revalidatePath(`/admin/intensive/${id}`);

  redirect(withNotice(redirectTo, "notice", "Заметка сохранена"));
}
