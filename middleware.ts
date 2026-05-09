import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  ADMIN_ACCESS_COOKIE_NAME,
  ADMIN_ACCESS_QUERY_PARAM,
  getAdminAccessCookieOptions,
  getAdminAccessCookieValue,
  hasValidAdminAccessCookie,
  isAdminAccessBypassedForLocalDev,
  isAdminAccessConfigured,
  isValidAdminAccessToken,
  normalizeAdminRedirectPath,
} from "@/lib/admin-auth";

function buildLoginUrl(request: NextRequest, nextPath: string, error?: string): URL {
  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("next", normalizeAdminRedirectPath(nextPath));

  if (error) {
    loginUrl.searchParams.set("error", error);
  }

  return loginUrl;
}

export function middleware(request: NextRequest) {
  const { nextUrl } = request;
  const pathname = nextUrl.pathname;
  const isLoginPage = pathname === "/admin/login";
  const cookieValue = request.cookies.get(ADMIN_ACCESS_COOKIE_NAME)?.value;
  const hasAccessCookie = hasValidAdminAccessCookie(cookieValue);
  const nextPath = `${pathname}${nextUrl.search}`;
  const sanitizedSearchParams = new URLSearchParams(nextUrl.searchParams);
  sanitizedSearchParams.delete(ADMIN_ACCESS_QUERY_PARAM);
  const sanitizedNextPath = `${pathname}${sanitizedSearchParams.toString() ? `?${sanitizedSearchParams.toString()}` : ""}`;

  if (hasAccessCookie) {
    if (isLoginPage) {
      return NextResponse.redirect(new URL(normalizeAdminRedirectPath(nextUrl.searchParams.get("next")), request.url));
    }

    return NextResponse.next();
  }

  if (isAdminAccessBypassedForLocalDev()) {
    return NextResponse.next();
  }

  if (!isAdminAccessConfigured()) {
    if (isLoginPage) {
      return NextResponse.next();
    }

    return NextResponse.redirect(
      buildLoginUrl(request, nextPath, "ADMIN_ACCESS_TOKEN не настроен. Закрой публичный доступ и добавь переменную окружения.")
    );
  }

  const queryToken = nextUrl.searchParams.get(ADMIN_ACCESS_QUERY_PARAM);

  if (queryToken) {
    if (isValidAdminAccessToken(queryToken)) {
      const redirectUrl = new URL(request.url);
      redirectUrl.searchParams.delete(ADMIN_ACCESS_QUERY_PARAM);

      const response = NextResponse.redirect(redirectUrl);
      response.cookies.set(ADMIN_ACCESS_COOKIE_NAME, getAdminAccessCookieValue(), getAdminAccessCookieOptions());
      return response;
    }

    return NextResponse.redirect(buildLoginUrl(request, sanitizedNextPath, "Неверный admin token."));
  }

  if (isLoginPage) {
    return NextResponse.next();
  }

  return NextResponse.redirect(buildLoginUrl(request, nextPath));
}

export const config = {
  matcher: ["/admin/:path*"],
};
