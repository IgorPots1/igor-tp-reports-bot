import Link from "next/link";

import FormActionButton from "@/app/admin/FormActionButton";
import {
  deleteTrainingPeaksOrphanReportsForWeekAction,
  sendTrainingPeaksReportAction,
} from "@/app/admin/actions";
import {
  formatWeekRange,
  getReviewStatusLabel,
  getSingleSearchParam,
} from "@/app/admin/lib";
import {
  getTrainingPeaksAdminReportStudentState,
  listTrainingPeaksAdminReports,
  type TrainingPeaksAdminReportRecord,
  type TrainingPeaksAdminReportStatusFilter,
  type TrainingPeaksAdminStudentStateFilter,
  type TrainingPeaksAdminTelegramFilter,
} from "@/features/trainingpeaks/admin";

export const dynamic = "force-dynamic";

type ReportsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const REPORT_STATUS_OPTIONS: Array<{
  value: TrainingPeaksAdminReportStatusFilter;
  label: string;
}> = [
  { value: "all", label: "Все" },
  { value: "ready", label: "Готовые" },
  { value: "sent", label: "Отправленные" },
  { value: "failed", label: "Ошибка отправки" },
  { value: "unsent", label: "Не отправленные" },
];

const TELEGRAM_STATUS_OPTIONS: Array<{
  value: TrainingPeaksAdminTelegramFilter;
  label: string;
}> = [
  { value: "all", label: "Все" },
  { value: "linked", label: "Telegram привязан" },
  { value: "unlinked", label: "Telegram не привязан" },
];

const STUDENT_STATE_OPTIONS: Array<{
  value: TrainingPeaksAdminStudentStateFilter;
  label: string;
}> = [
  { value: "active", label: "Активные" },
  { value: "archived", label: "Архивные" },
  { value: "orphan", label: "Нет в реестре" },
  { value: "all", label: "Все" },
];

function getTelegramStatusText(report: TrainingPeaksAdminReportRecord): string {
  if (!report.isTelegramLinked) {
    return "Telegram не привязан";
  }

  if (report.student?.telegramDeliveryEnabled === false) {
    return "Telegram привязан, доставка выключена";
  }

  return "Telegram привязан";
}

function getStudentStateText(report: TrainingPeaksAdminReportRecord): string {
  const state = getTrainingPeaksAdminReportStudentState(report);

  switch (state) {
    case "archived":
      return "Архивный";
    case "orphan":
      return "Нет в реестре";
    default:
      return "Активный";
  }
}

function getDeliveryStatusText(report: TrainingPeaksAdminReportRecord): string {
  if (report.report.sentAt) {
    return "Отправлен";
  }

  if (report.report.deliveryError) {
    return "Ошибка отправки";
  }

  return "Не отправлен";
}

function getWeekLabel(weekValue: string): string {
  const [weekFrom, weekTo] = weekValue.split("..");

  if (!weekFrom || !weekTo) {
    return weekValue;
  }

  return formatWeekRange(weekFrom, weekTo);
}

function parseWeekValue(weekValue: string | null): {
  weekFrom: string;
  weekTo: string;
} | null {
  if (!weekValue) {
    return null;
  }

  const [weekFrom, weekTo] = weekValue.split("..");

  if (!weekFrom || !weekTo) {
    return null;
  }

  return { weekFrom, weekTo };
}

function buildListHref(params: URLSearchParams): string {
  return `/admin/reports${params.size > 0 ? `?${params.toString()}` : ""}`;
}

export default async function AdminReportsPage({ searchParams }: ReportsPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const week = getSingleSearchParam(resolvedSearchParams.week);
  const reportStatus =
    getSingleSearchParam(resolvedSearchParams.reportStatus) ??
    getSingleSearchParam(resolvedSearchParams.status) ??
    "all";
  const telegramStatus = getSingleSearchParam(resolvedSearchParams.telegram) ?? "all";
  const studentState = getSingleSearchParam(resolvedSearchParams.studentState) ?? "active";
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const { reports, availableWeeks, selectedWeek, summary } = await listTrainingPeaksAdminReports({
    week,
    reportStatus,
    telegramStatus,
    studentState,
  });
  const listRedirectParams = new URLSearchParams();

  if (selectedWeek) {
    listRedirectParams.set("week", selectedWeek);
  }

  if (reportStatus !== "all") {
    listRedirectParams.set("reportStatus", reportStatus);
  }

  if (telegramStatus !== "all") {
    listRedirectParams.set("telegram", telegramStatus);
  }

  if (studentState !== "active") {
    listRedirectParams.set("studentState", studentState);
  }

  const redirectTo = buildListHref(listRedirectParams);
  const selectedWeekRange = parseWeekValue(selectedWeek);
  const showOrphanCleanupAction =
    Boolean(selectedWeekRange) && (studentState === "orphan" || studentState === "all");

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

      <form className="admin-card admin-filters admin-filters-compact" method="get">
        <label className="admin-field">
          <span>Неделя</span>
          <select name="week" defaultValue={selectedWeek ?? ""}>
            {availableWeeks.map((weekValue) => (
              <option key={weekValue} value={weekValue}>
                {getWeekLabel(weekValue)}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Статус отчёта</span>
          <select name="reportStatus" defaultValue={reportStatus}>
            {REPORT_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Telegram</span>
          <select name="telegram" defaultValue={telegramStatus}>
            {TELEGRAM_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Состояние ученика</span>
          <select name="studentState" defaultValue={studentState}>
            {STUDENT_STATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="admin-actions admin-filters-actions">
          <button className="admin-button admin-button-secondary" type="submit">
            Применить
          </button>
          <Link className="admin-button admin-button-secondary" href="/admin/reports">
            Сбросить
          </Link>
        </div>
      </form>

      <div className="admin-summary-grid admin-summary-grid-compact">
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Всего отчётов</span>
          <strong className="admin-summary-value">{summary.totalReports}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Готово к отправке</span>
          <strong className="admin-summary-value">{summary.readyToSend}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Отправлено</span>
          <strong className="admin-summary-value">{summary.sent}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Ошибки</span>
          <strong className="admin-summary-value">{summary.errors}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Без Telegram</span>
          <strong className="admin-summary-value">{summary.withoutTelegram}</strong>
        </article>
      </div>

      {showOrphanCleanupAction && selectedWeekRange && (
        <article className="admin-card">
          <div className="admin-section-header">
            <div>
              <h3>Cleanup orphan-отчётов</h3>
              <p className="admin-muted">
                Удаляет только orphan-отчёты за выбранную неделю, если `student_id` отсутствует в
                `trainingpeaks_students`. Отчёты активных и архивных учеников не затрагиваются.
              </p>
            </div>
          </div>
          <form className="admin-actions" action={deleteTrainingPeaksOrphanReportsForWeekAction}>
            <input type="hidden" name="weekFrom" value={selectedWeekRange.weekFrom} />
            <input type="hidden" name="weekTo" value={selectedWeekRange.weekTo} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <FormActionButton
              className="admin-button admin-button-secondary"
              pendingText="Удаление..."
              confirmMessage={[
                "Удалить orphan-отчёты за эту неделю?",
                "",
                "Будут удалены только записи, у которых student_id отсутствует в trainingpeaks_students.",
                "Отчёты активных и архивных учеников останутся без изменений.",
              ].join("\n")}
            >
              Удалить orphan-отчёты за эту неделю
            </FormActionButton>
          </form>
        </article>
      )}

      <div className="admin-report-list">
        {reports.length === 0 ? (
          <article className="admin-card">
            <div className="admin-empty-cell">Отчёты не найдены.</div>
          </article>
        ) : (
          reports.map((entry) => {
            const reportDetailParams = new URLSearchParams(listRedirectParams);
            const reportHref = `/admin/reports/${entry.report.id}${reportDetailParams.size > 0 ? `?${reportDetailParams.toString()}` : ""}`;

            return (
              <article key={entry.report.id} className="admin-card admin-report-card admin-report-card-compact">
                <div className="admin-report-card-top">
                  <div className="admin-report-card-identity">
                    <h3 className="admin-report-card-title">{entry.report.studentName}</h3>
                    <p className="admin-muted admin-report-card-subtitle">
                      {formatWeekRange(entry.report.weekFrom, entry.report.weekTo)}
                    </p>
                  </div>
                  <div className="admin-actions admin-report-card-actions">
                    <Link className="admin-button admin-button-secondary" href={reportHref}>
                      Открыть
                    </Link>
                    {entry.canSend ? (
                      <form action={sendTrainingPeaksReportAction}>
                        <input type="hidden" name="reportId" value={entry.report.id} />
                        <input type="hidden" name="redirectTo" value={redirectTo} />
                        <FormActionButton className="admin-button" pendingText="Отправка...">
                          Отправить
                        </FormActionButton>
                      </form>
                    ) : null}
                  </div>
                </div>

                <dl className="admin-report-meta admin-report-meta-compact">
                  <div className="admin-report-meta-chip">
                    <dt>Неделя</dt>
                    <dd>{formatWeekRange(entry.report.weekFrom, entry.report.weekTo)}</dd>
                  </div>
                  <div className="admin-report-meta-chip">
                    <dt>Статус отчёта</dt>
                    <dd>{getReviewStatusLabel(entry.report.reviewStatus)}</dd>
                  </div>
                  <div className="admin-report-meta-chip">
                    <dt>Доставка</dt>
                    <dd>{getDeliveryStatusText(entry)}</dd>
                  </div>
                  <div className="admin-report-meta-chip">
                    <dt>Telegram</dt>
                    <dd>{getTelegramStatusText(entry)}</dd>
                  </div>
                  <div className="admin-report-meta-chip">
                    <dt>Состояние ученика</dt>
                    <dd>{getStudentStateText(entry)}</dd>
                  </div>
                </dl>

                <div className="admin-badge-row admin-report-card-flags">
                  <span className="admin-badge admin-badge-outline">
                    {getReviewStatusLabel(entry.report.reviewStatus)}
                  </span>
                  {entry.report.sentAt && <span className="admin-badge admin-badge-success">Отправлен</span>}
                  {entry.report.deliveryError && !entry.report.sentAt && (
                    <span className="admin-badge admin-badge-danger">Ошибка доставки</span>
                  )}
                  {!entry.student && <span className="admin-badge admin-badge-muted">Нет в реестре</span>}
                  {entry.student?.weeklyReportEnabled === false && (
                    <span className="admin-badge admin-badge-warning">Отчёты выключены</span>
                  )}
                  {entry.report.editedReportMarkdown?.trim() && (
                    <span className="admin-badge admin-badge-accent">Есть правка</span>
                  )}
                </div>

                {!entry.canSend && (
                  <div className="admin-report-card-footer">
                    <span className="admin-muted">{entry.sendBlockedReason ?? "Отправка недоступна"}</span>
                  </div>
                )}

                {entry.report.deliveryError && !entry.report.sentAt && (
                  <p className="admin-muted admin-report-card-error">{entry.report.deliveryError}</p>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
