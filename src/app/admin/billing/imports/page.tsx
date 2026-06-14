import Link from "next/link";

import FormActionButton from "@/app/admin/FormActionButton";
import { confirmImportedPaymentAction, ignoreImportedPaymentAction } from "@/app/admin/billing/actions";
import {
  formatBillingAmount,
  getBillingImportedPaymentStatusLabel,
  getSingleSearchParam,
} from "@/app/admin/lib";
import { getAdminImportedPaymentsOverview } from "@/features/billing/admin";
import { BILLING_TIME_ZONE, type BillingImportedPaymentReviewStatusFilter } from "@/features/billing/types";

type AdminBillingImportsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const STATUS_FILTERS: Array<{ value: BillingImportedPaymentReviewStatusFilter; label: string }> = [
  { value: "new", label: "Новые" },
  { value: "matched", label: "Засчитано" },
  { value: "ignored", label: "Игнорировано" },
  { value: "all", label: "Все" },
];

function formatBillingDate(isoDate: string | null): string {
  if (!isoDate) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: BILLING_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${isoDate}T12:00:00.000Z`));
}

function formatBillingMonthLabel(billingMonth: string): string {
  return billingMonth.slice(0, 7);
}

function getImportedStatusBadgeClass(status: string): string {
  switch (status) {
    case "matched":
      return "admin-badge-success";
    case "ignored":
      return "admin-badge-muted";
    default:
      return "admin-badge-warning";
  }
}

function buildImportsRedirect(status: BillingImportedPaymentReviewStatusFilter): string {
  if (status === "new") {
    return "/admin/billing/imports";
  }

  const params = new URLSearchParams();
  params.set("status", status);
  return `/admin/billing/imports?${params.toString()}`;
}

function parseStatusFilter(value: string | null): BillingImportedPaymentReviewStatusFilter {
  if (value === "matched" || value === "ignored" || value === "all") {
    return value;
  }

  return "new";
}

export default async function AdminBillingImportsPage({ searchParams }: AdminBillingImportsPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const statusFilter = parseStatusFilter(getSingleSearchParam(resolvedSearchParams.status));
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const overview = await getAdminImportedPaymentsOverview(statusFilter);
  const redirectTo = buildImportsRedirect(statusFilter);

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <Link className="admin-backlink" href="/admin/billing">
            ← К биллингу
          </Link>
          <h2>Импорт оплат</h2>
          <p className="admin-muted">
            Строки из выписки Т-Банка. Ничего не засчитывается автоматически.
          </p>
        </div>
      </div>

      {(notice || error) && (
        <div className={`admin-alert ${error ? "admin-alert-error" : "admin-alert-success"}`}>{error ?? notice}</div>
      )}

      <div className="admin-actions">
        {STATUS_FILTERS.map((filter) => (
          <Link
            key={filter.value}
            className={`admin-button ${statusFilter === filter.value ? "" : "admin-button-secondary"}`}
            href={buildImportsRedirect(filter.value)}
          >
            {filter.label}
          </Link>
        ))}
      </div>

      <div className="admin-summary-grid">
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Новые</span>
          <strong className="admin-summary-value">{overview.counts.new}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Засчитано</span>
          <strong className="admin-summary-value">{overview.counts.matched}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Игнорировано</span>
          <strong className="admin-summary-value">{overview.counts.ignored}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Всего</span>
          <strong className="admin-summary-value">{overview.counts.total}</strong>
        </article>
      </div>

      {overview.rows.length === 0 ? (
        <article className="admin-card">
          <p className="admin-muted">
            Нет строк для просмотра. Для импорта используйте CLI: npm run billing:import-payments.
          </p>
        </article>
      ) : (
        overview.rows.map((row) => {
          const { imported, suggestions, matchedMonthlyPayment } = row;
          const manualCandidates = overview.candidates.filter(
            (candidate) => candidate.currency === imported.currency
          );

          return (
            <article key={imported.id} className="admin-card admin-import-card">
              <div className="admin-import-header">
                <div className="admin-import-title">
                  <strong>{formatBillingDate(imported.paymentDate)}</strong>
                  <span>{formatBillingAmount(imported.amount, imported.currency)}</span>
                </div>
                <span className={`admin-badge ${getImportedStatusBadgeClass(imported.status)}`}>
                  {getBillingImportedPaymentStatusLabel(imported.status)}
                </span>
              </div>

              <dl className="admin-import-meta admin-meta-list">
                <div>
                  <dt>Плательщик</dt>
                  <dd>{imported.payerHint ?? "—"}</dd>
                </div>
                <div>
                  <dt>Описание</dt>
                  <dd>{imported.description ?? "—"}</dd>
                </div>
                <div>
                  <dt>Файл</dt>
                  <dd>{imported.sourceFileName ?? "—"}</dd>
                </div>
              </dl>

              {imported.status === "new" && (
                <>
                  <div className="admin-import-suggestions">
                    <h3 className="admin-eyebrow">Подсказки</h3>
                    {suggestions.length === 0 ? (
                      <p className="admin-muted">Совпадений не найдено.</p>
                    ) : (
                      suggestions.map((suggestion) => (
                        <form
                          key={suggestion.monthlyPayment.id}
                          action={confirmImportedPaymentAction}
                          className="admin-import-suggestion"
                        >
                          <input type="hidden" name="importedPaymentId" value={imported.id} />
                          <input type="hidden" name="monthlyPaymentId" value={suggestion.monthlyPayment.id} />
                          <input type="hidden" name="redirectTo" value={redirectTo} />
                          <div className="admin-import-suggestion-body">
                            <strong>
                              {suggestion.monthlyPayment.client.clientName}
                              {suggestion.knownPayer && (
                                <span className="admin-badge admin-badge-success" style={{ marginLeft: 8 }}>
                                  Знакомый плательщик
                                </span>
                              )}
                            </strong>
                            <span>
                              {formatBillingMonthLabel(suggestion.monthlyPayment.billingMonth)} ·{" "}
                              {formatBillingAmount(
                                suggestion.monthlyPayment.plannedAmount,
                                suggestion.monthlyPayment.currency
                              )}
                            </span>
                            {suggestion.reasons.length > 0 && (
                              <span className="admin-muted">{suggestion.reasons.join("; ")}</span>
                            )}
                          </div>
                          <FormActionButton
                            className="admin-button admin-button-secondary"
                            pendingText="Засчитывание..."
                            confirmMessage="Засчитать импортированный платёж для выбранного клиента и месяца?"
                          >
                            Засчитать
                          </FormActionButton>
                        </form>
                      ))
                    )}
                  </div>

                  <div className="admin-import-manual">
                    <h3 className="admin-eyebrow">Засчитать вручную</h3>
                    {manualCandidates.length === 0 ? (
                      <p className="admin-muted">
                        Для валюты {imported.currency} нет доступных месячных платежей для ручного выбора.
                      </p>
                    ) : (
                      <form action={confirmImportedPaymentAction} className="admin-form-stack">
                        <input type="hidden" name="importedPaymentId" value={imported.id} />
                        <input type="hidden" name="redirectTo" value={redirectTo} />
                        <label className="admin-field">
                          <span>Месячный платёж</span>
                          <select className="admin-input" name="monthlyPaymentId" defaultValue="" required>
                            <option value="" disabled>
                              Выбери месячный платёж
                            </option>
                            {manualCandidates.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.client.clientName} — {formatBillingMonthLabel(candidate.billingMonth)} —{" "}
                                {formatBillingAmount(candidate.plannedAmount, candidate.currency)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="admin-import-manual-actions">
                          <FormActionButton
                            className="admin-button"
                            pendingText="Засчитывание..."
                            confirmMessage="Засчитать импортированный платёж для выбранного клиента и месяца?"
                          >
                            Засчитать вручную
                          </FormActionButton>
                        </div>
                      </form>
                    )}
                  </div>

                  <div className="admin-import-actions">
                    <form action={ignoreImportedPaymentAction}>
                      <input type="hidden" name="importedPaymentId" value={imported.id} />
                      <input type="hidden" name="redirectTo" value={redirectTo} />
                      <FormActionButton
                        className="admin-button admin-button-secondary"
                        pendingText="Игнорирование..."
                        confirmMessage="Игнорировать эту строку импорта?"
                      >
                        Игнорировать
                      </FormActionButton>
                    </form>
                  </div>
                </>
              )}

              {imported.status === "matched" && (
                <div className="admin-import-result">
                  {matchedMonthlyPayment ? (
                    <p className="admin-muted">
                      Засчитано для{" "}
                      <strong>{matchedMonthlyPayment.client.clientName}</strong> ·{" "}
                      {formatBillingMonthLabel(matchedMonthlyPayment.billingMonth)} ·{" "}
                      {formatBillingAmount(matchedMonthlyPayment.plannedAmount, matchedMonthlyPayment.currency)}
                    </p>
                  ) : (
                    <p className="admin-muted">Связанный месячный платёж недоступен.</p>
                  )}
                </div>
              )}

              {imported.status === "ignored" && imported.notes && (
                <div className="admin-import-result">
                  <p className="admin-muted">{imported.notes}</p>
                </div>
              )}
            </article>
          );
        })
      )}
    </section>
  );
}
