import Link from "next/link";

import { listTrainingPeaksAdminWeeklyReportRoster } from "@/features/trainingpeaks/admin";

export const dynamic = "force-dynamic";

export default async function AdminWeeklyReportsRosterPage() {
  const { inGeneration, activeReportsDisabled, archived } =
    await listTrainingPeaksAdminWeeklyReportRoster();

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <h2>Ученики для недельных отчётов</h2>
          <p className="admin-muted">
            Когорта для batch-задач <code>scope=all_enabled</code>: активные ученики с включёнными недельными
            отчётами.
          </p>
        </div>
        <Link className="admin-button admin-button-secondary" href="/admin/students">
          К списку учеников
        </Link>
      </div>

      <RosterSection
        title="В генерации"
        description={`is_active=true и weekly_report_enabled=true — ${inGeneration.length} ученик(ов)`}
        students={inGeneration}
        emptyText="Нет учеников в когорте генерации."
      />

      <RosterSection
        title="Активные, отчёты выключены"
        description={`is_active=true и weekly_report_enabled=false — ${activeReportsDisabled.length} ученик(ов)`}
        students={activeReportsDisabled}
        emptyText="Все активные ученики включены в недельные отчёты."
      />

      <RosterSection
        title="Архив"
        description={`Неактивные / архивные — ${archived.length} ученик(ов)`}
        students={archived}
        emptyText="Архив пуст."
      />
    </section>
  );
}

function RosterSection({
  title,
  description,
  students,
  emptyText,
}: {
  title: string;
  description: string;
  students: { id: string; studentId: string; studentName: string }[];
  emptyText: string;
}) {
  return (
    <div className="admin-card" style={{ marginTop: "1.25rem" }}>
      <div className="admin-section-header" style={{ marginBottom: "0.75rem" }}>
        <div>
          <h3>{title}</h3>
          <p className="admin-muted">{description}</p>
        </div>
      </div>
      {students.length === 0 ? (
        <p className="admin-muted">{emptyText}</p>
      ) : (
        <div className="admin-report-list">
          {students.map((student) => (
            <div key={student.id} className="admin-card admin-card-compact">
              <Link href={`/admin/students/${student.id}`}>
                <strong>{student.studentName}</strong>
              </Link>
              <span className="admin-muted"> — {student.studentId}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
