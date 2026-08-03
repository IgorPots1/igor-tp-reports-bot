import Link from "next/link";

import FormActionButton from "@/app/admin/FormActionButton";
import { markBillingPaidAction, markBillingUnpaidAction } from "@/app/admin/billing/actions";
import {
  formatBillingAmount,
  getBillingPaymentMethodLabel,
  getBillingPaymentStatusLabel,
  getSingleSearchParam,
} from "@/app/admin/lib";
import { getAdminBillingMonthOverview, getEffectiveBillingRowStatus } from "@/features/billing/admin";
import { BILLING_TIME_ZONE, type BillingMonthStatusFilter } from "@/features/billing/types";

export const dynamic = "force-dynamic";

type AdminBillingPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const STATUS_FILTERS: Array<{ value: BillingMonthStatusFilter; label: string }> = [
  { value: "all", label: "Все" },
  { value: "unpaid", label: "Не оплачено" },
  { value: "overdue", label: "Просрочено" },
  { value: "paid", label: "Оплачено" },
];

function parseStatusFilter(value: string | null): BillingMonthStatusFilter {
  if (value === "all" || value === "overdue" || value === "paid" || value === "unpaid") {
    return value;
  }

  return "unpaid";
}

function buildBillingPageHref(month: string | undefined, status: BillingMonthStatusFilter): string {
  const params = new URLSearchParams();

  if (month) {
    params.set("month", month.slice(0, 7));
  }

  if (status !== "unpaid") {
    params.set("status", status);
  }

  const query = params.toString();
  return query ? `/admin/billing?${query}` : "/admin/billing";
}

function formatBillingMonthLabel(billingMonth: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: BILLING_TIME_ZONE,
    month: "long",
    year: "numeric",
  }).format(new Date(`${billingMonth}T12:00:00.000Z`));
}

function formatBillingDate(isoDate: string | null): string {
  if (!isoDate) {
    return "Дата не указана";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: BILLING_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${isoDate}T12:00:00.000Z`));
}

function shiftBillingMonth(month: string, delta: number): string {
  const date = new Date(`${month}T12:00:00.000Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1, 12, 0, 0))
    .toISOString()
    .slice(0, 10);
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case "paid":
      return "admin-badge-success";
    case "overdue":
      return "admin-badge-danger";
    case "manual_review":
      return "admin-badge-warning";
    case "paused":
      return "admin-badge-muted";
    case "refunded":
      return "admin-badge-outline";
    default:
      return "admin-badge-accent";
  }
}

function getStudentLinkBadgeClass(isLinked: boolean): string {
  return isLinked ? "admin-badge-success" : "admin-badge-warning";
}

export default async function AdminBillingPage({ searchParams }: AdminBillingPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const month = getSingleSearchParam(resolvedSearchParams.month) ?? undefined;
  const statusFilter = parseStatusFilter(getSingleSearchParam(resolvedSearchParams.status));
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const overview = await getAdminBillingMonthOverview(month, statusFilter);
  const previousMonth = shiftBillingMonth(overview.billingMonth, -1).slice(0, 7);
  const nextMonth = shiftBillingMonth(overview.billingMonth, 1).slice(0, 7);
  const viewMonth = month?.slice(0, 7);

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <h2>Биллинг</h2>
          <p className="admin-muted">
            Coach-only обзор по платежам: кто уже оплачен, кто ожидается и у каких клиентов ещё нет связи с учеником.
          </p>
        </div>
        <div className="admin-actions">
          <Link className="admin-button" href="/admin/billing/clients/new">
            Добавить клиента
          </Link>
          <Link className="admin-button admin-button-secondary" href="/admin/billing/imports">
            Импорт оплат
          </Link>
          <Link className="admin-button admin-button-secondary" href="/admin/billing/matching">
            Связка клиентов
          </Link>
        </div>
      </div>

      <article className="admin-card">
        <div className="admin-section-header">
          <div>
            <h3>{formatBillingMonthLabel(overview.billingMonth)}</h3>
            <p className="admin-muted">Месяц биллинга в часовом поясе Europe/Belgrade.</p>
          </div>
          <div className="admin-actions">
            <Link
              className="admin-button admin-button-secondary"
              href={buildBillingPageHref(previousMonth, statusFilter)}
            >
              Предыдущий
            </Link>
            <Link className="admin-button admin-button-secondary" href={buildBillingPageHref(undefined, statusFilter)}>
              Текущий
            </Link>
            <Link
              className="admin-button admin-button-secondary"
              href={buildBillingPageHref(nextMonth, statusFilter)}
            >
              Следующий
            </Link>
          </div>
        </div>
      </article>

      {(notice || error) && (
        <div className={`admin-alert ${error ? "admin-alert-error" : "admin-alert-success"}`}>
          {error ?? notice}
        </div>
      )}

      <div className="admin-summary-grid">
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Всего</span>
          <strong className="admin-summary-value">{overview.total}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Оплачено</span>
          <strong className="admin-summary-value">{overview.paid}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Ожидаем</span>
          <strong className="admin-summary-value">{overview.pending}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Просрочено</span>
          <strong className="admin-summary-value">{overview.overdue}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">На проверке</span>
          <strong className="admin-summary-value">{overview.manualReview}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Не связаны с учениками</span>
          <strong className="admin-summary-value">{overview.unlinkedCount}</strong>
        </article>
      </div>

      <div className="admin-actions">
        {STATUS_FILTERS.map((filter) => (
          <Link
            key={filter.value}
            className={`admin-button ${statusFilter === filter.value ? "" : "admin-button-secondary"}`}
            href={buildBillingPageHref(viewMonth, filter.value)}
          >
            {filter.label} ({overview.filterCounts[filter.value]})
          </Link>
        ))}
      </div>

      <div className="admin-card admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Клиент</th>
              <th>Группа</th>
              <th>Сумма</th>
              <th>Плановая дата</th>
              <th>Статус</th>
              <th>Метод оплаты</th>
              <th>Связь с учеником</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {overview.rows.length === 0 ? (
              <tr>
                <td className="admin-empty-cell" colSpan={8}>
                  {statusFilter === "all"
                    ? "Для выбранного месяца пока нет строк биллинга."
                    : "Нет клиентов для выбранного фильтра."}
                </td>
              </tr>
            ) : (
              overview.rows.map((row) => {
                const effectiveStatus = getEffectiveBillingRowStatus(row);
                const isLinked = Boolean(row.studentId);

                return (
                  <tr key={row.clientId}>
                    <td>
                      <div className="admin-table-primary">
                        <Link href={`/admin/billing/clients/${row.clientId}`}>
                          <strong>{row.clientName}</strong>
                        </Link>
                      </div>
                    </td>
                    <td>
                      <span className="admin-muted">{row.groupName ?? "—"}</span>
                    </td>
                    <td>{formatBillingAmount(row.plannedAmount, row.currency)}</td>
                    <td>{formatBillingDate(row.plannedPaymentDate)}</td>
                    <td>
                      <div className="admin-table-primary">
                        <span className={`admin-badge ${getStatusBadgeClass(effectiveStatus)}`}>
                          {getBillingPaymentStatusLabel(effectiveStatus)}
                        </span>
                        {row.actualPaymentDate && (
                          <span className="admin-muted">Факт: {formatBillingDate(row.actualPaymentDate)}</span>
                        )}
                      </div>
                    </td>
                    <td>{getBillingPaymentMethodLabel(row.paymentMethod)}</td>
                    <td>
                      <div className="admin-table-primary">
                        <span className={`admin-badge ${getStudentLinkBadgeClass(isLinked)}`}>
                          {isLinked ? "Связан" : "Не связан"}
                        </span>
                        <span className="admin-muted">
                          {isLinked ? "Привязан к ученику" : "Нужна ручная привязка к ученику"}
                        </span>
                      </div>
                    </td>
                    <td>
                      {effectiveStatus === "paid" ? (
                        <form action={markBillingUnpaidAction} className="admin-actions admin-inline-actions">
                          <input type="hidden" name="clientId" value={row.clientId} />
                          <input type="hidden" name="month" value={overview.billingMonth.slice(0, 7)} />
                          <FormActionButton
                            className="admin-button admin-button-secondary"
                            confirmMessage="Снять оплату и вернуть статус в ожидание?"
                            pendingText="Снятие..."
                          >
                            Снять оплату
                          </FormActionButton>
                        </form>
                      ) : effectiveStatus === "pending" ||
                        effectiveStatus === "overdue" ||
                        effectiveStatus === "manual_review" ? (
                        <form action={markBillingPaidAction} className="admin-actions admin-inline-actions">
                          <input type="hidden" name="clientId" value={row.clientId} />
                          <input type="hidden" name="month" value={overview.billingMonth.slice(0, 7)} />
                          {row.plannedAmount != null && (
                            <input type="hidden" name="amount" value={String(row.plannedAmount)} />
                          )}
                          <FormActionButton className="admin-button admin-button-secondary" pendingText="Сохранение...">
                            Оплачено
                          </FormActionButton>
                        </form>
                      ) : (
                        <span className="admin-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {overview.paused > 0 && (
        <p className="admin-muted">В статусе «Пауза»: {overview.paused}. Они не вынесены в summary-карточки, но учтены в общем количестве.</p>
      )}
    </section>
  );
}
