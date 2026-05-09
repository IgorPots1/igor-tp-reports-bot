import Link from "next/link";

import FormActionButton from "@/app/admin/FormActionButton";
import { sendTrainingPeaksReportAction } from "@/app/admin/actions";
import {
  formatWeekRange,
  getReviewStatusLabel,
  getSingleSearchParam,
} from "@/app/admin/lib";
import { listTrainingPeaksAdminReports } from "@/features/trainingpeaks/admin";

type ReportsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getTelegramStatusText(report: Awaited<ReturnType<typeof listTrainingPeaksAdminReports>>["reports"][number]): string {
  if (!report.student) {
    return "Нет в реестре";
  }

  if (!report.student.telegramChatId) {
    return "Telegram не привязан";
  }

  if (!report.student.telegramDeliveryEnabled) {
    return "Доставка отключена";
  }

  return "Привязано и включено";
}

export default async function AdminReportsPage({ searchParams }: ReportsPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const week = getSingleSearchParam(resolvedSearchParams.week);
  const reviewStatus = getSingleSearchParam(resolvedSearchParams.status);
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const listRedirectParams = new URLSearchParams();

  if (week) {
    listRedirectParams.set("week", week);
  }

  if (reviewStatus) {
    listRedirectParams.set("status", reviewStatus);
  }

  const redirectTo = `/admin/reports${listRedirectParams.size > 0 ? `?${listRedirectParams.toString()}` : ""}`;
  const { reports, availableWeeks } = await listTrainingPeaksAdminReports({
    week,
    reviewStatus,
  });

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <h2>Недельные отчёты</h2>
          <p className="admin-muted">
            Основной рабочий стол тренера: проверка, ручная правка и отправка в Telegram Business.
          </p>
        </div>
      </div>

      {(notice || error) && (
        <div className={`admin-alert ${error ? "admin-alert-error" : "admin-alert-success"}`}>
          {error ?? notice}
        </div>
      )}

      <form className="admin-card admin-filters" method="get">
        <label className="admin-field">
          <span>Неделя</span>
          <select name="week" defaultValue={week ?? ""}>
            <option value="">Все недели</option>
            {availableWeeks.map((weekValue) => (
              <option key={weekValue} value={weekValue}>
                {weekValue}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Статус</span>
          <select name="status" defaultValue={reviewStatus ?? ""}>
            <option value="">Все статусы</option>
            <option value="draft">Черновик</option>
            <option value="approved">Готов к отправке</option>
            <option value="failed">Ошибка доставки</option>
            <option value="skipped">Пропущен</option>
            <option value="sent">Отправлен</option>
          </select>
        </label>
        <button className="admin-button admin-button-secondary" type="submit">
          Применить
        </button>
      </form>

      <div className="admin-card admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Ученик</th>
              <th>Неделя</th>
              <th>Статус отчёта</th>
              <th>Telegram</th>
              <th>Доставка</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {reports.length === 0 ? (
              <tr>
                <td colSpan={6} className="admin-empty-cell">
                  Отчёты не найдены.
                </td>
              </tr>
            ) : (
              reports.map((entry) => (
                <tr key={entry.report.id}>
                  <td>
                    <div className="admin-table-primary">
                      <strong>{entry.report.studentName}</strong>
                      <div className="admin-badge-row">
                        {!entry.student && <span className="admin-badge admin-badge-muted">Нет в реестре</span>}
                        {entry.student && !entry.student.isActive && (
                          <span className="admin-badge admin-badge-warning">Архив</span>
                        )}
                        {entry.student?.weeklyReportEnabled === false && (
                          <span className="admin-badge admin-badge-warning">Недельные отчёты выключены</span>
                        )}
                        {entry.report.editedReportMarkdown?.trim() && (
                          <span className="admin-badge admin-badge-accent">Есть правка</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>{formatWeekRange(entry.report.weekFrom, entry.report.weekTo)}</td>
                  <td>
                    <div className="admin-table-primary">
                      <span className="admin-badge admin-badge-outline">
                        {getReviewStatusLabel(entry.report.reviewStatus)}
                      </span>
                      <span className="admin-muted">
                        {entry.finalReportMarkdown ? "Готов к отправке" : "Нет текста отчёта"}
                      </span>
                    </div>
                  </td>
                  <td>{getTelegramStatusText(entry)}</td>
                  <td>
                    {entry.report.sentAt ? (
                      <div className="admin-table-primary">
                        <span className="admin-badge admin-badge-success">Доставлен</span>
                        <span className="admin-muted">{entry.report.sentAt.slice(0, 10)}</span>
                      </div>
                    ) : entry.report.deliveryError ? (
                      <div className="admin-table-primary">
                        <span className="admin-badge admin-badge-danger">Ошибка</span>
                        <span className="admin-muted">{entry.report.deliveryError}</span>
                      </div>
                    ) : (
                      <span className="admin-muted">Не отправлялся</span>
                    )}
                  </td>
                  <td>
                    <div className="admin-actions">
                      <Link className="admin-button admin-button-secondary" href={`/admin/reports/${entry.report.id}`}>
                        Открыть
                      </Link>
                      {entry.canSend ? (
                        <form action={sendTrainingPeaksReportAction}>
                          <input type="hidden" name="reportId" value={entry.report.id} />
                          <input type="hidden" name="redirectTo" value={redirectTo} />
                          <FormActionButton
                            className="admin-button"
                            pendingText="Отправка..."
                          >
                            Отправить
                          </FormActionButton>
                        </form>
                      ) : (
                        <span className="admin-muted">{entry.sendBlockedReason ?? "Недоступно"}</span>
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
