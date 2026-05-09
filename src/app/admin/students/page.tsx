import Link from "next/link";

import FormActionButton from "@/app/admin/FormActionButton";
import {
  archiveTrainingPeaksStudentAction,
  restoreTrainingPeaksStudentAction,
} from "@/app/admin/actions";
import {
  getRegistryStatusLabel,
  getSingleSearchParam,
} from "@/app/admin/lib";
import {
  listTrainingPeaksAdminStudents,
  type TrainingPeaksAdminStudentsView,
} from "@/features/trainingpeaks/admin";

type StudentsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getTelegramBindingText(
  student: Awaited<ReturnType<typeof listTrainingPeaksAdminStudents>>[number]
): string {
  if (!student.telegramChatId) {
    return "Чат не привязан";
  }

  if (!student.telegramDeliveryEnabled) {
    return "Привязан, но доставка выключена";
  }

  return "Привязан и включён";
}

export default async function AdminStudentsPage({ searchParams }: StudentsPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const requestedView = getSingleSearchParam(resolvedSearchParams.view);
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const view: TrainingPeaksAdminStudentsView =
    requestedView === "archived" || requestedView === "all" ? requestedView : "active";
  const students = await listTrainingPeaksAdminStudents(view);

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <h2>Ученики</h2>
          <p className="admin-muted">
            Активные ученики показываются по умолчанию. Архив не участвует в генерации и доставке.
          </p>
        </div>
      </div>

      {(notice || error) && (
        <div className={`admin-alert ${error ? "admin-alert-error" : "admin-alert-success"}`}>
          {error ?? notice}
        </div>
      )}

      <div className="admin-tabs">
        <Link className={view === "active" ? "admin-tab admin-tab-active" : "admin-tab"} href="/admin/students">
          Активные
        </Link>
        <Link
          className={view === "archived" ? "admin-tab admin-tab-active" : "admin-tab"}
          href="/admin/students?view=archived"
        >
          Архив
        </Link>
        <Link className={view === "all" ? "admin-tab admin-tab-active" : "admin-tab"} href="/admin/students?view=all">
          Все
        </Link>
      </div>

      <div className="admin-card admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Ученик</th>
              <th>Статус</th>
              <th>Telegram</th>
              <th>Последний отчёт</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {students.length === 0 ? (
              <tr>
                <td colSpan={5} className="admin-empty-cell">
                  Список пуст.
                </td>
              </tr>
            ) : (
              students.map((student) => (
                <tr key={student.id}>
                  <td>
                    <div className="admin-table-primary">
                      <strong>{student.studentName}</strong>
                      <span className="admin-muted">{student.studentId}</span>
                    </div>
                  </td>
                  <td>
                    <div className="admin-table-primary">
                      <span className={`admin-badge ${student.isActive ? "admin-badge-success" : "admin-badge-warning"}`}>
                        {student.isActive ? "Активен" : "Архив"}
                      </span>
                      <span className="admin-muted">
                        {student.weeklyReportEnabled ? "Недельные отчёты включены" : "Недельные отчёты выключены"}
                      </span>
                    </div>
                  </td>
                  <td>{getTelegramBindingText(student)}</td>
                  <td>
                    {student.latestWeekFrom && student.latestWeekTo ? (
                      <div className="admin-table-primary">
                        <span>{student.latestWeekFrom} — {student.latestWeekTo}</span>
                        <span className="admin-muted">{getRegistryStatusLabel(student.latestReportStatus)}</span>
                      </div>
                    ) : (
                      <span className="admin-muted">Пока нет истории</span>
                    )}
                  </td>
                  <td>
                    <div className="admin-actions">
                      <Link className="admin-button admin-button-secondary" href={`/admin/students/${student.id}`}>
                        Открыть
                      </Link>
                      {student.isActive ? (
                        <form action={archiveTrainingPeaksStudentAction}>
                          <input type="hidden" name="studentId" value={student.id} />
                          <input type="hidden" name="redirectTo" value={`/admin/students${view === "active" ? "" : `?view=${view}`}`} />
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
                          <input type="hidden" name="redirectTo" value={`/admin/students${view === "active" ? "" : `?view=${view}`}`} />
                          <FormActionButton className="admin-button" pendingText="Восстановление...">
                            Восстановить
                          </FormActionButton>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
