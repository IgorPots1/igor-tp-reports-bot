import { createHash, timingSafeEqual } from "node:crypto";

export const ADMIN_ACCESS_COOKIE_NAME = "tp_admin_access";
export const ADMIN_ACCESS_QUERY_PARAM = "admin_token";

function getAdminAccessToken(): string {
  return process.env.ADMIN_ACCESS_TOKEN?.trim() ?? "";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAdminAccessConfigured(): boolean {
  return Boolean(getAdminAccessToken());
}

export function isAdminAccessBypassedForLocalDev(): boolean {
  return process.env.NODE_ENV !== "production" && !isAdminAccessConfigured();
}

export function isValidAdminAccessToken(candidate: string): boolean {
  const expectedToken = getAdminAccessToken();

  if (!expectedToken) {
    return false;
  }

  return safeEqual(sha256(candidate.trim()), sha256(expectedToken));
}

export function getAdminAccessCookieValue(): string {
  return sha256(getAdminAccessToken());
}

export function hasValidAdminAccessCookie(cookieValue: string | undefined): boolean {
  const expectedToken = getAdminAccessToken();

  if (!expectedToken || !cookieValue) {
    return false;
  }

  return safeEqual(cookieValue, sha256(expectedToken));
}

export function getAdminAccessCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

export function normalizeAdminRedirectPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) {
    return "/admin/reports";
  }

  if (!value.startsWith("/admin")) {
    return "/admin/reports";
  }

  return value;
}
