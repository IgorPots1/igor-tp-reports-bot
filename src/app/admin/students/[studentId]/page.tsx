import Link from "next/link";
import { notFound } from "next/navigation";

import FormActionButton from "@/app/admin/FormActionButton";
import {
  archiveTrainingPeaksStudentAction,
  restoreTrainingPeaksStudentAction,
  setTrainingPeaksStudentWeeklyReportsEnabledAction,
  unlinkTrainingPeaksStudentTelegramAction,
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

function getTelegramBindingText(student: Awaited<ReturnType<typeof getTrainingPeaksAdminStudentById>>): string {
  if (!student?.telegramChatId) {
    return "Не привязан";
  }

  if (!student.telegramDeliveryEnabled) {
    return "Привязан, но доставка выключена";
  }

  return "Привязан и включён";
}

export default async function AdminStudentDetailPage({
  params,
  searchParams,
}: StudentDetailPageProps) {
  const { studentId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const showSyncReminder = notice?.startsWith("Ученик создан:") ?? false;
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
          <div className="admin-badge-row">
            <span className={`admin-badge ${student.isActive ? "admin-badge-success" : "admin-badge-warning"}`}>
              {student.isActive ? "Активен" : "Архив"}
            </span>
            <span
              className={`admin-badge ${student.weeklyReportEnabled ? "admin-badge-accent" : "admin-badge-warning"}`}
            >
              {student.weeklyReportEnabled ? "Недельные отчёты включены" : "Недельные отчёты выключены"}
            </span>
            <span
              className={`admin-badge ${
                student.telegramChatId
                  ? student.telegramDeliveryEnabled
                    ? "admin-badge-success"
                    : "admin-badge-warning"
                  : "admin-badge-muted"
              }`}
            >
              {student.telegramChatId ? "Telegram привязан" : "Telegram не привязан"}
            </span>
          </div>
        </div>
        <div className="admin-actions">
          {student.weeklyReportEnabled ? (
            <form action={setTrainingPeaksStudentWeeklyReportsEnabledAction}>
              <input type="hidden" name="studentId" value={student.id} />
              <input type="hidden" name="enabled" value="false" />
              <input type="hidden" name="redirectTo" value={`/admin/students/${student.id}`} />
              <FormActionButton
                className="admin-button admin-button-secondary"
                confirmMessage="Отключить недельные отчёты? Будущая генерация и доставка для ученика будут заблокированы."
                pendingText="Сохранение..."
              >
                Отключить отчёты
              </FormActionButton>
            </form>
          ) : (
            <form action={setTrainingPeaksStudentWeeklyReportsEnabledAction}>
              <input type="hidden" name="studentId" value={student.id} />
              <input type="hidden" name="enabled" value="true" />
              <input type="hidden" name="redirectTo" value={`/admin/students/${student.id}`} />
              <FormActionButton
                className="admin-button"
                disabled={!student.isActive}
                pendingText="Сохранение..."
              >
                Включить отчёты
              </FormActionButton>
            </form>
          )}
          {student.telegramChatId && (
            <form action={unlinkTrainingPeaksStudentTelegramAction}>
              <input type="hidden" name="studentId" value={student.id} />
              <input type="hidden" name="redirectTo" value={`/admin/students/${student.id}`} />
              <FormActionButton
                className="admin-button admin-button-secondary"
                confirmMessage="Telegram-привязка будет удалена. Отчёты не смогут отправляться ученику, пока Telegram не будет привязан заново."
                pendingText="Отвязка..."
              >
                Отвязать Telegram
              </FormActionButton>
            </form>
          )}
          {student.isActive ? (
            <form action={archiveTrainingPeaksStudentAction}>
              <input type="hidden" name="studentId" value={student.id} />
              <input type="hidden" name="redirectTo" value={`/admin/students/${student.id}`} />
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

      {showSyncReminder && (
        <div className="admin-alert admin-alert-success">
          После добавления запусти локально <code>tp-sync-students</code>, чтобы Mac-runner обновил{" "}
          <code>students.json</code>.
        </div>
      )}

      {!student.isActive && (
        <div className="admin-alert admin-alert-success">
          После восстановления недельные отчёты включатся автоматически, но доставку в Telegram нужно проверить отдельно.
        </div>
      )}

      {student.isActive && !student.weeklyReportEnabled && (
        <div className="admin-alert admin-alert-error">
          Недельные отчёты выключены. Будущая генерация, sync и доставка для этого ученика будут заблокированы.
        </div>
      )}

      {student.telegramChatId && !student.telegramDeliveryEnabled && (
        <div className="admin-alert admin-alert-error">
          Telegram привязан, но доставка выключена. После восстановления или перепривязки проверь состояние доставки отдельно.
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
              <dt>Недельные отчёты</dt>
              <dd>{student.weeklyReportEnabled ? "Включены" : "Выключены"}</dd>
            </div>
            <div>
              <dt>Обновлён</dt>
              <dd>{formatIsoDate(student.updatedAt)}</dd>
            </div>
          </dl>
        </article>

        <article className="admin-card">
          <h3>TrainingPeaks</h3>
          <dl className="admin-meta-list">
            <div>
              <dt>Ссылка на athlete</dt>
              <dd>
                <a href={student.trainingPeaksAthleteUrl} target="_blank" rel="noreferrer">
                  {student.trainingPeaksAthleteUrl}
                </a>
              </dd>
            </div>
            <div>
              <dt>Качество данных</dt>
              <dd>{student.dataQualityStatus ?? "—"}</dd>
            </div>
            <div>
              <dt>Заметки</dt>
              <dd>{student.notes ?? "—"}</dd>
            </div>
          </dl>
        </article>

        <article className="admin-card">
          <h3>Telegram</h3>
          <dl className="admin-meta-list">
            <div>
              <dt>Статус</dt>
              <dd>{getTelegramBindingText(student)}</dd>
            </div>
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
