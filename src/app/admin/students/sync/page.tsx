import Link from "next/link";

import SyncRosterPanel from "@/app/admin/students/sync/SyncRosterPanel";

export default function AdminStudentsSyncPage() {
  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <Link className="admin-backlink" href="/admin/students">
            ← Ко всем ученикам
          </Link>
          <h2>Синхронизация из TrainingPeaks</h2>
          <p className="admin-muted">
            Тянет тренерский ростер из TrainingPeaks живым запросом и показывает, кого ещё нет в реестре. Вставляются
            только новые ученики — существующие и архивные не трогаются, TrainingPeaks не меняется.
          </p>
        </div>
      </div>

      <div className="admin-alert admin-alert-success">
        Работает только локально: сессия TrainingPeaks берётся из снапшота на твоём Маке. Открой эту страницу из
        локальной админки (<code>npm run dev</code>). Если сессия устарела — обнови её командой{" "}
        <code>tp-refresh-session-snapshot</code>. Новым ученикам недельные отчёты выключены по умолчанию.
      </div>

      <SyncRosterPanel />
    </section>
  );
}
