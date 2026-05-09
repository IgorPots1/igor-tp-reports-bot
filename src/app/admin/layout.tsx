import type { ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";

import { logoutAdminAction } from "@/app/admin/login/actions";
import {
  ADMIN_ACCESS_COOKIE_NAME,
  hasValidAdminAccessCookie,
  isAdminAccessBypassedForLocalDev,
} from "@/lib/admin-auth";

type AdminLayoutProps = {
  children: ReactNode;
};

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const cookieStore = await cookies();
  const hasAdminSession = hasValidAdminAccessCookie(cookieStore.get(ADMIN_ACCESS_COOKIE_NAME)?.value);
  const showAdminNav = hasAdminSession || isAdminAccessBypassedForLocalDev();

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div>
          <p className="admin-eyebrow">TrainingPeaks Reports Bot</p>
          <h1>Web Admin</h1>
        </div>
        {showAdminNav && (
          <div className="admin-actions">
            <nav className="admin-nav">
              <Link href="/admin/reports">Отчёты</Link>
              <Link href="/admin/students">Ученики</Link>
            </nav>
            {hasAdminSession && (
              <form action={logoutAdminAction}>
                <button className="admin-button admin-button-secondary" type="submit">
                  Выйти
                </button>
              </form>
            )}
          </div>
        )}
      </header>
      {isAdminAccessBypassedForLocalDev() && (
        <div className="admin-alert admin-alert-warning">
          <code>ADMIN_ACCESS_TOKEN</code> не задан. <code>/admin</code> открыт только для локального dev-режима.
          Перед production обязательно задай переменную окружения.
        </div>
      )}
      {children}
    </main>
  );
}
