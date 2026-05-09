import Link from "next/link";
import { notFound } from "next/navigation";

import FormActionButton from "@/app/admin/FormActionButton";
import {
  deleteTrainingPeaksOrphanReportAction,
  saveTrainingPeaksReportEditAction,
  sendTrainingPeaksReportAction,
} from "@/app/admin/actions";
import {
  formatIsoDate,
  formatWeekRange,
  getReviewStatusLabel,
  getSingleSearchParam,
} from "@/app/admin/lib";
import {
  getTrainingPeaksAdminReportById,
  getTrainingPeaksAdminReportStudentState,
} from "@/features/trainingpeaks/admin";

type ReportDetailPageProps = {
  params: Promise<{
    reportId: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type ReportDetailEntry = NonNullable<Awaited<ReturnType<typeof getTrainingPeaksAdminReportById>>>;

function getDeliveryStatusText(entry: ReportDetailEntry): string {
  if (entry.report.sentAt) {
    return "Отправлен";
  }

  if (entry.report.deliveryError) {
    return "Ошибка отправки";
  }

  return "Не отправлен";
}

function getTelegramStatusText(entry: ReportDetailEntry): string {
  if (!entry.student?.telegramChatId) {
    return "Не привязан";
  }

  return entry.student.telegramDeliveryEnabled ? "Привязан и включён" : "Привязан, но выключен";
}

function getStudentStateText(entry: ReportDetailEntry): string {
  const state = getTrainingPeaksAdminReportStudentState(entry);

  switch (state) {
    case "archived":
      return "Архив";
    case "orphan":
      return "Нет в реестре";
    default:
      return "Активен";
  }
}

function getEditorRows(markdown: string): number {
  const estimatedRows = markdown.split(/\r?\n/).reduce((total, line) => {
    return total + Math.max(1, Math.ceil(line.length / 90));
  }, 0);

  return Math.max(28, Math.min(estimatedRows + 4, 80));
}

export default async function AdminReportDetailPage({
  params,
  searchParams,
}: ReportDetailPageProps) {
  const { reportId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const week = getSingleSearchParam(resolvedSearchParams.week);
  const reportStatus =
    getSingleSearchParam(resolvedSearchParams.reportStatus) ??
    getSingleSearchParam(resolvedSearchParams.status);
  const telegramStatus = getSingleSearchParam(resolvedSearchParams.telegram);
  const studentState = getSingleSearchParam(resolvedSearchParams.studentState);
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const entry = await getTrainingPeaksAdminReportById(reportId);

  if (!entry) {
    notFound();
  }

  const currentMarkdown = entry.finalReportMarkdown ?? "";
  const isSent = entry.report.reviewStatus === "sent";
  const listParams = new URLSearchParams();

  if (week) {
    listParams.set("week", week);
  }

  if (reportStatus) {
    listParams.set("reportStatus", reportStatus);
  }

  if (telegramStatus) {
    listParams.set("telegram", telegramStatus);
  }

  if (studentState) {
    listParams.set("studentState", studentState);
  }

  const listHref = `/admin/reports${listParams.size > 0 ? `?${listParams.toString()}` : ""}`;
  const detailRedirectTo = `/admin/reports/${entry.report.id}${listParams.size > 0 ? `?${listParams.toString()}` : ""}`;
  const saveFormId = `trainingpeaks-report-edit-${entry.report.id}`;
  const editorRows = currentMarkdown ? getEditorRows(currentMarkdown) : 28;

  return (
    <section className="admin-section admin-report-detail-page">
      <div className="admin-report-detail-header">
        <div className="admin-section-header">
          <div>
            <Link className="admin-backlink" href={listHref}>
              ← Ко всем отчётам
            </Link>
            <h2>{entry.report.studentName}</h2>
            <p className="admin-muted">{formatWeekRange(entry.report.weekFrom, entry.report.weekTo)}</p>
          </div>
          <div className="admin-badge-row">
            <span className="admin-badge admin-badge-outline">
              {getReviewStatusLabel(entry.report.reviewStatus)}
            </span>
            {!entry.student && <span className="admin-badge admin-badge-muted">Нет в реестре</span>}
            {entry.student && !entry.student.isActive && (
              <span className="admin-badge admin-badge-warning">Ученик в архиве</span>
            )}
            {entry.student?.weeklyReportEnabled === false && (
              <span className="admin-badge admin-badge-warning">Недельные отчёты выключены</span>
            )}
            {entry.report.editedReportMarkdown?.trim() && (
              <span className="admin-badge admin-badge-accent">Есть ручная правка</span>
            )}
          </div>
        </div>

        <div className="admin-actions admin-report-toolbar">
          <Link className="admin-button admin-button-secondary" href={listHref}>
            Назад
          </Link>
          {!isSent && currentMarkdown && (
            <FormActionButton className="admin-button" form={saveFormId} pendingText="Сохранение...">
              Сохранить
            </FormActionButton>
          )}
          {entry.canSend ? (
            <form action={sendTrainingPeaksReportAction}>
              <input type="hidden" name="reportId" value={entry.report.id} />
              <input type="hidden" name="redirectTo" value={detailRedirectTo} />
              <FormActionButton className="admin-button admin-button-secondary" pendingText="Отправка...">
                Отправить
              </FormActionButton>
            </form>
          ) : (
            <span className="admin-muted">{entry.sendBlockedReason ?? "Отправка недоступна"}</span>
          )}
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
          <div className="admin-report-meta-chip">
            <dt>Отправлен</dt>
            <dd>{formatIsoDate(entry.report.sentAt)}</dd>
          </div>
        </dl>
      </div>

      {(notice || error) && (
        <div className={`admin-alert ${error ? "admin-alert-error" : "admin-alert-success"}`}>
          {error ?? notice}
        </div>
      )}

      {!entry.student && (
        <article className="admin-card admin-card-compact">
          <div className="admin-form-stack">
            <div className="admin-alert admin-alert-error">Ученик не найден в реестре</div>
            <div className="admin-actions">
              <form action={deleteTrainingPeaksOrphanReportAction}>
                <input type="hidden" name="reportId" value={entry.report.id} />
                <input type="hidden" name="redirectTo" value={listHref} />
                <FormActionButton
                  className="admin-button admin-button-secondary"
                  pendingText="Удаление..."
                  confirmMessage={[
                    "Удалить этот orphan-отчёт?",
                    "",
                    "Удаление будет выполнено только если student_id по-прежнему отсутствует в trainingpeaks_students.",
                  ].join("\n")}
                >
                  Удалить orphan-отчёт
                </FormActionButton>
              </form>
            </div>
          </div>
        </article>
      )}

      <section className="admin-report-document">
        <div className="admin-section-header admin-report-document-header">
          <div>
            <h3>Текст отчёта</h3>
            <p className="admin-muted">
              Отправка использует сохранённую ручную правку, если она есть; иначе оригинальный сгенерированный текст.
            </p>
          </div>
        </div>

        {!currentMarkdown ? (
          <div className="admin-alert admin-alert-error">
            В этом отчёте пока нет markdown-текста для редактирования и отправки.
          </div>
        ) : isSent ? (
          <pre className="admin-markdown-preview admin-markdown-preview-editor">{currentMarkdown}</pre>
        ) : (
          <form
            id={saveFormId}
            className="admin-form-stack admin-report-document-form"
            action={saveTrainingPeaksReportEditAction}
          >
            <input type="hidden" name="reportId" value={entry.report.id} />
            <input type="hidden" name="redirectTo" value={detailRedirectTo} />
            <textarea
              className="admin-textarea admin-textarea-editor"
              name="reportMarkdown"
              defaultValue={currentMarkdown}
              rows={editorRows}
            />
          </form>
        )}

        <div className="admin-card-actions admin-card-actions-compact admin-report-document-actions">
          {!isSent && currentMarkdown && (
            <>
              <FormActionButton className="admin-button" form={saveFormId} pendingText="Сохранение...">
                Сохранить
              </FormActionButton>
              {entry.canSend ? (
                <form action={sendTrainingPeaksReportAction}>
                  <input type="hidden" name="reportId" value={entry.report.id} />
                  <input type="hidden" name="redirectTo" value={detailRedirectTo} />
                  <FormActionButton
                    className="admin-button admin-button-secondary"
                    pendingText="Отправка..."
                  >
                    Отправить
                  </FormActionButton>
                </form>
              ) : (
                <span className="admin-muted">{entry.sendBlockedReason ?? "Отправка недоступна"}</span>
              )}
            </>
          )}
          <Link className="admin-button admin-button-secondary" href={listHref}>
            Назад
          </Link>
        </div>
      </section>

      {entry.report.deliveryError && !entry.report.sentAt && (
        <div className="admin-alert admin-alert-error">{entry.report.deliveryError}</div>
      )}

      {entry.report.editedReportMarkdown?.trim() && entry.report.reportMarkdown?.trim() && (
        <article className="admin-card admin-card-compact">
          <h3>Исходный markdown</h3>
          <pre className="admin-markdown-preview">{entry.report.reportMarkdown}</pre>
        </article>
      )}
    </section>
  );
}
