"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ADMIN_ACCESS_COOKIE_NAME,
  getAdminAccessCookieOptions,
  getAdminAccessCookieValue,
  isAdminAccessBypassedForLocalDev,
  isAdminAccessConfigured,
  isValidAdminAccessToken,
  normalizeAdminRedirectPath,
} from "@/lib/admin-auth";

function buildLoginRedirect(nextPath: string, key: "notice" | "error", value: string): string {
  const params = new URLSearchParams();
  params.set("next", normalizeAdminRedirectPath(nextPath));
  params.set(key, value);
  return `/admin/login?${params.toString()}`;
}

export async function loginAdminAction(formData: FormData): Promise<void> {
  const token = typeof formData.get("token") === "string" ? String(formData.get("token")) : "";
  const nextPath = normalizeAdminRedirectPath(
    typeof formData.get("next") === "string" ? String(formData.get("next")) : null
  );

  if (!isAdminAccessConfigured()) {
    if (isAdminAccessBypassedForLocalDev()) {
      redirect(nextPath);
    }

    redirect(
      buildLoginRedirect(
        nextPath,
        "error",
        "ADMIN_ACCESS_TOKEN не настроен. Сначала добавь переменную окружения и redeploy."
      )
    );
  }

  if (!isValidAdminAccessToken(token)) {
    redirect(buildLoginRedirect(nextPath, "error", "Неверный токен доступа."));
  }

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_ACCESS_COOKIE_NAME, getAdminAccessCookieValue(), getAdminAccessCookieOptions());

  redirect(nextPath);
}

export async function logoutAdminAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_ACCESS_COOKIE_NAME);
  redirect("/admin/login?notice=Выход%20выполнен.");
}
