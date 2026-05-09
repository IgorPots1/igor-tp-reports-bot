import type { ReactNode } from "react";
import Link from "next/link";

type AdminLayoutProps = {
  children: ReactNode;
};

export default function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div>
          <p className="admin-eyebrow">TrainingPeaks Reports Bot</p>
          <h1>Web Admin</h1>
        </div>
        <nav className="admin-nav">
          <Link href="/admin/reports">Отчёты</Link>
          <Link href="/admin/students">Ученики</Link>
        </nav>
      </header>
      {children}
    </main>
  );
}
