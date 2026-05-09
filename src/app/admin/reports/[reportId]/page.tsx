import Link from "next/link";
import { notFound } from "next/navigation";

import FormActionButton from "@/app/admin/FormActionButton";
import {
  saveTrainingPeaksReportEditAction,
  sendTrainingPeaksReportAction,
} from "@/app/admin/actions";
import {
  formatIsoDate,
  formatWeekRange,
  getReviewStatusLabel,
  getSingleSearchParam,
} from "@/app/admin/lib";
import { getTrainingPeaksAdminReportById } from "@/features/trainingpeaks/admin";

type ReportDetailPageProps = {
  params: Promise<{
    reportId: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminReportDetailPage({
  params,
  searchParams,
}: ReportDetailPageProps) {
  const { reportId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const entry = await getTrainingPeaksAdminReportById(reportId);

  if (!entry) {
    notFound();
  }

  const currentMarkdown = entry.finalReportMarkdown ?? "";
  const isSent = entry.report.reviewStatus === "sent";

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <Link className="admin-backlink" href="/admin/reports">
            ← Ко всем отчётам
          </Link>
          <h2>{entry.report.studentName}</h2>
          <p className="admin-muted">{formatWeekRange(entry.report.weekFrom, entry.report.weekTo)}</p>
        </div>
        <div className="admin-badge-row">
          <span className="admin-badge admin-badge-outline">
            {getReviewStatusLabel(entry.report.reviewStatus)}
          </span>
          {entry.student && !entry.student.isActive && (
            <span className="admin-badge admin-badge-warning">Ученик в архиве</span>
          )}
          {entry.student?.weeklyReportEnabled === false && (
            <span className="admin-badge admin-badge-warning">Недельные отчёты выключены</span>
          )}
          {entry.report.editedReportMarkdown?.trim() && (
            <span className="admin-badge admin-badge-accent">Используется ручная правка</span>
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
              <dt>Статус проверки</dt>
              <dd>{getReviewStatusLabel(entry.report.reviewStatus)}</dd>
            </div>
            <div>
              <dt>Отправлен</dt>
              <dd>{formatIsoDate(entry.report.sentAt)}</dd>
            </div>
            <div>
              <dt>Последняя ошибка</dt>
              <dd>{entry.report.deliveryError ?? "—"}</dd>
            </div>
          </dl>
        </article>

        <article className="admin-card">
          <h3>Ученик</h3>
          <dl className="admin-meta-list">
            <div>
              <dt>Реестр</dt>
              <dd>{entry.student ? "Есть запись" : "Запись не найдена"}</dd>
            </div>
            <div>
              <dt>Telegram</dt>
              <dd>
                {entry.student?.telegramChatId
                  ? entry.student.telegramDeliveryEnabled
                    ? "Привязан и включён"
                    : "Привязан, но доставка выключена"
                  : "Чат не привязан"}
              </dd>
            </div>
            <div>
              <dt>Активность</dt>
              <dd>
                {entry.student
                  ? entry.student.isActive
                    ? "Активен"
                    : "Архив / выключен"
                  : "Нет записи"}
              </dd>
            </div>
            <div>
              <dt>Недельные отчёты</dt>
              <dd>
                {entry.student
                  ? entry.student.weeklyReportEnabled
                    ? "Включены"
                    : "Выключены"
                  : "Нет записи"}
              </dd>
            </div>
          </dl>
        </article>
      </div>

      <article className="admin-card">
        <div className="admin-section-header">
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
          <pre className="admin-markdown-preview">{currentMarkdown}</pre>
        ) : (
          <div className="admin-form-stack">
            <form className="admin-form-stack" action={saveTrainingPeaksReportEditAction}>
              <input type="hidden" name="reportId" value={entry.report.id} />
              <input type="hidden" name="redirectTo" value={`/admin/reports/${entry.report.id}`} />
              <textarea
                className="admin-textarea"
                name="reportMarkdown"
                defaultValue={currentMarkdown}
                rows={28}
              />
              <div className="admin-actions">
                <FormActionButton className="admin-button" pendingText="Сохранение...">
                  Сохранить правки
                </FormActionButton>
              </div>
            </form>
            <div className="admin-actions">
              {entry.canSend && (
                <form action={sendTrainingPeaksReportAction}>
                  <input type="hidden" name="reportId" value={entry.report.id} />
                  <input type="hidden" name="redirectTo" value={`/admin/reports/${entry.report.id}`} />
                  <FormActionButton className="admin-button admin-button-secondary" pendingText="Отправка...">
                    Отправить ученику
                  </FormActionButton>
                </form>
              )}
              {!entry.canSend && entry.sendBlockedReason && (
                <span className="admin-muted">{entry.sendBlockedReason}</span>
              )}
            </div>
          </div>
        )}
      </article>

      {entry.report.editedReportMarkdown?.trim() && entry.report.reportMarkdown?.trim() && (
        <article className="admin-card">
          <h3>Исходный сгенерированный markdown</h3>
          <pre className="admin-markdown-preview">{entry.report.reportMarkdown}</pre>
        </article>
      )}
    </section>
  );
}
