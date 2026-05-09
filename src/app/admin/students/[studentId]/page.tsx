import Link from "next/link";
import { notFound } from "next/navigation";

import FormActionButton from "@/app/admin/FormActionButton";
import {
  archiveTrainingPeaksStudentAction,
  restoreTrainingPeaksStudentAction,
} from "@/app/admin/actions";
import {
  formatIsoDate,
  formatWeekRange,
  getRegistryStatusLabel,
  getReviewStatusLabel,
  getSingleSearchParam,
} from "@/app/admin/lib";
import {
  getTrainingPeaksAdminStudentById,
  listTrainingPeaksAdminReportsForStudent,
} from "@/features/trainingpeaks/admin";

type StudentDetailPageProps = {
  params: Promise<{
    studentId: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminStudentDetailPage({
  params,
  searchParams,
}: StudentDetailPageProps) {
  const { studentId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const student = await getTrainingPeaksAdminStudentById(studentId);

  if (!student) {
    notFound();
  }

  const reports = await listTrainingPeaksAdminReportsForStudent(studentId);

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <Link className="admin-backlink" href="/admin/students">
            ← Ко всем ученикам
          </Link>
          <h2>{student.studentName}</h2>
          <p className="admin-muted">{student.studentId}</p>
        </div>
        <div className="admin-actions">
          {student.isActive ? (
            <form action={archiveTrainingPeaksStudentAction}>
              <input type="hidden" name="studentId" value={student.id} />
              <input type="hidden" name="redirectTo" value={`/admin/students/${student.id}`} />
              <FormActionButton
                className="admin-button admin-button-danger"
                confirmMessage="Архивировать ученика? Это выключит weekly reports и Telegram delivery."
                pendingText="Архивация..."
              >
                Архивировать
              </FormActionButton>
            </form>
          ) : (
            <form action={restoreTrainingPeaksStudentAction}>
              <input type="hidden" name="studentId" value={student.id} />
              <input type="hidden" name="redirectTo" value={`/admin/students/${student.id}`} />
              <FormActionButton className="admin-button" pendingText="Восстановление...">
                Восстановить
              </FormActionButton>
            </form>
          )}
        </div>
      </div>

      {(notice || error) && (
        <div className={`admin-alert ${error ? "admin-alert-error" : "admin-alert-success"}`}>
          {error ?? notice}
        </div>
      )}

      <div className="admin-grid admin-grid-meta">
        <article className="admin-card">
          <h3>Состояние</h3>
          <dl className="admin-meta-list">
            <div>
              <dt>Активность</dt>
              <dd>{student.isActive ? "Активен" : "Архив"}</dd>
            </div>
            <div>
              <dt>Архивирован</dt>
              <dd>{formatIsoDate(student.archivedAt)}</dd>
            </div>
            <div>
              <dt>Weekly reports</dt>
              <dd>{student.weeklyReportEnabled ? "Включены" : "Выключены"}</dd>
            </div>
          </dl>
        </article>

        <article className="admin-card">
          <h3>Telegram</h3>
          <dl className="admin-meta-list">
            <div>
              <dt>Chat ID</dt>
              <dd>{student.telegramChatId ?? "—"}</dd>
            </div>
            <div>
              <dt>Username</dt>
              <dd>{student.telegramUsername ? `@${student.telegramUsername}` : "—"}</dd>
            </div>
            <div>
              <dt>Доставка</dt>
              <dd>{student.telegramDeliveryEnabled ? "Включена" : "Выключена"}</dd>
            </div>
          </dl>
        </article>
      </div>

      <article className="admin-card">
        <h3>История отчётов</h3>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Неделя</th>
                <th>Статус</th>
                <th>Доставка</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 ? (
                <tr>
                  <td colSpan={4} className="admin-empty-cell">
                    История отчётов пока пустая.
                  </td>
                </tr>
              ) : (
                reports.map((entry) => (
                  <tr key={entry.report.id}>
                    <td>{formatWeekRange(entry.report.weekFrom, entry.report.weekTo)}</td>
                    <td>
                      <div className="admin-table-primary">
                        <span className="admin-badge admin-badge-outline">
                          {getReviewStatusLabel(entry.report.reviewStatus)}
                        </span>
                        <span className="admin-muted">{getRegistryStatusLabel(entry.report.status)}</span>
                      </div>
                    </td>
                    <td>{entry.report.sentAt ? formatIsoDate(entry.report.sentAt) : entry.report.deliveryError ?? "—"}</td>
                    <td>
                      <Link className="admin-button admin-button-secondary" href={`/admin/reports/${entry.report.id}`}>
                        Открыть отчёт
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
