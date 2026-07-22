import Link from "next/link";

import FormActionButton from "@/app/admin/FormActionButton";
import { formatIsoDate } from "@/app/admin/lib";
import {
  archiveTrainingPeaksStudentAction,
  restoreTrainingPeaksStudentAction,
} from "@/app/admin/actions";
import {
  getRegistryStatusLabel,
  getSingleSearchParam,
} from "@/app/admin/lib";
import {
  getTrainingPeaksAdminStudentGroupTopicListText,
  listTrainingPeaksAdminStudents,
  type TrainingPeaksAdminStudentsView,
} from "@/features/trainingpeaks/admin";
import {
  buildTrainingPeaksContactDisplay,
} from "@/features/trainingpeaks/contact-display";

type StudentsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getWeeklyReportsText(
  student: Awaited<ReturnType<typeof listTrainingPeaksAdminStudents>>[number]
): string {
  return student.weeklyReportEnabled ? "Недельные отчёты включены" : "Недельные отчёты выключены";
}

function getTelegramBindingText(
  student: Awaited<ReturnType<typeof listTrainingPeaksAdminStudents>>[number]
): string {
  if (!student.telegramChatId) {
    return "Telegram не привязан";
  }

  if (!student.telegramDeliveryEnabled) {
    return "Telegram привязан, доставка выключена";
  }

  return "Telegram привязан, доставка включена";
}

function formatLastContact(
  student: Awaited<ReturnType<typeof listTrainingPeaksAdminStudents>>[number]
): string {
  const contactDisplay = buildTrainingPeaksContactDisplay({
    lastCoachTouchAt: student.contactStatus?.lastCoachTouchAt ?? null,
  });
  return formatIsoDate(contactDisplay.lastContactAt) ?? "нет истории";
}

function getDaysWithoutContactDisplay(
  student: Awaited<ReturnType<typeof listTrainingPeaksAdminStudents>>[number]
): { text: string; className: string } {
  const contactDisplay = buildTrainingPeaksContactDisplay({
    lastCoachTouchAt: student.contactStatus?.lastCoachTouchAt ?? null,
  });
  if (contactDisplay.daysWithoutContact === null) {
    return {
      text: "—",
      className: "admin-muted",
    };
  }

  if (contactDisplay.hasNoContactAlert) {
    return {
      text: `${contactDisplay.daysWithoutContact}д`,
      className: "admin-badge admin-badge-warning",
    };
  }

  return {
    text: `${contactDisplay.daysWithoutContact}д`,
    className: "admin-muted",
  };
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
            Активные ученики показываются по умолчанию. Архив не участвует в генерации и доставке, а выключенные
            недельные отчёты дополнительно блокируют будущую генерацию и доставку.
          </p>
        </div>
        <div className="admin-actions">
          <Link className="admin-button admin-button-secondary" href="/admin/students/weekly-reports">
            Недельные отчёты
          </Link>
          <Link className="admin-button admin-button-secondary" href="/admin/students/sync">
            Синхронизировать из TrainingPeaks
          </Link>
          <Link className="admin-button" href="/admin/students/new">
            Добавить ученика
          </Link>
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
              <th>Последний контакт</th>
              <th>Дней без контакта</th>
              <th>Последний отчёт</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {students.length === 0 ? (
              <tr>
                <td colSpan={8} className="admin-empty-cell">
                  Список пуст.
                </td>
              </tr>
            ) : (
              students.map((student) => {
                const daysWithoutContact = getDaysWithoutContactDisplay(student);
                return (
                  <tr key={student.id}>
                  <td>
                    <div className="admin-table-primary">
                      <strong>{student.studentName}</strong>
                      <span className="admin-muted">{student.studentId}</span>
                    </div>
                  </td>
                  <td>
                    <div className="admin-table-primary">
                      <div className="admin-badge-row">
                        <span
                          className={`admin-badge ${student.isActive ? "admin-badge-success" : "admin-badge-warning"}`}
                        >
                          {student.isActive ? "Активен" : "Архив"}
                        </span>
                        <span
                          className={`admin-badge ${
                            student.weeklyReportEnabled ? "admin-badge-accent" : "admin-badge-warning"
                          }`}
                        >
                          {student.weeklyReportEnabled ? "Отчёты вкл" : "Отчёты выкл"}
                        </span>
                      </div>
                      <span className="admin-muted">
                        {getWeeklyReportsText(student)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="admin-table-primary">
                      <span
                        className={`admin-badge ${
                          student.telegramChatId
                            ? student.telegramDeliveryEnabled
                              ? "admin-badge-success"
                              : "admin-badge-warning"
                            : "admin-badge-muted"
                        }`}
                      >
                        {student.telegramChatId ? "Привязан" : "Не привязан"}
                      </span>
                      <span className="admin-muted">{getTelegramBindingText(student)}</span>
                      <span className="admin-muted">{getTrainingPeaksAdminStudentGroupTopicListText(student)}</span>
                    </div>
                  </td>
                  <td>
                    <span className="admin-muted">{formatLastContact(student)}</span>
                  </td>
                  <td>
                    <span className={daysWithoutContact.className}>{daysWithoutContact.text}</span>
                  </td>
                  <td>
                    {student.latestWeekFrom && student.latestWeekTo ? (
                      <div className="admin-table-primary">
                        <span>
                          {student.latestWeekFrom} — {student.latestWeekTo}
                        </span>
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
                            confirmMessage="Архивировать ученика? Это выключит недельные отчёты и доставку в Telegram."
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
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
