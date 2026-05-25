import type { ReactNode } from "react";
import Link from "next/link";

import { logoutAdminAction } from "@/app/admin/login/actions";

type AdminShellProps = {
  children: ReactNode;
  hasAdminSession: boolean;
  showAdminNav: boolean;
  showDevBypassWarning: boolean;
};

export default function AdminShell({
  children,
  hasAdminSession,
  showAdminNav,
  showDevBypassWarning,
}: AdminShellProps) {
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
              <Link href="/admin/telegram-links">Telegram-привязки</Link>
              <Link href="/admin/billing">Биллинг</Link>
              <Link href="/admin/students/weekly-reports">Недельные отчёты</Link>
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
      {showDevBypassWarning && (
        <div className="admin-alert admin-alert-warning">
          <code>ADMIN_ACCESS_TOKEN</code> не задан. <code>/admin</code> открыт только для локального dev-режима.
          Перед production обязательно задай переменную окружения.
        </div>
      )}
      {children}
    </main>
  );
}
