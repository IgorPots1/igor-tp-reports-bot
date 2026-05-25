import Link from "next/link";
import { notFound } from "next/navigation";

import FormActionButton from "@/app/admin/FormActionButton";
import {
  linkBillingClientToStudentAction,
  markBillingPaidAction,
  markBillingUnpaidAction,
  setBillingClientActiveAction,
  unlinkBillingClientFromStudentAction,
  updateBillingClientAction,
} from "@/app/admin/billing/actions";
import {
  formatBillingAmount,
  formatIsoDate,
  getBillingPaymentMethodLabel,
  getBillingPaymentStatusLabel,
  getSingleSearchParam,
} from "@/app/admin/lib";
import { getBillingClientDetail, listBillingAvailableStudentsForManualLink } from "@/features/billing/admin";
import { BILLING_TIME_ZONE, type BillingMonthStatusRow } from "@/features/billing/types";
import { getTrainingPeaksAdminStudentById } from "@/features/trainingpeaks/admin";

type BillingClientDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function formatBillingMonthLabel(billingMonth: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: BILLING_TIME_ZONE,
    month: "long",
    year: "numeric",
  }).format(new Date(`${billingMonth}T12:00:00.000Z`));
}

function formatBillingDate(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: BILLING_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function getRowStatus(row: BillingMonthStatusRow): string {
  if (row.status === "pending" && row.daysOverdue != null && row.daysOverdue > 0) {
    return "overdue";
  }

  return row.status;
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

export default async function BillingClientDetailPage({
  params,
  searchParams,
}: BillingClientDetailPageProps) {
  const { id } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const detail = await getBillingClientDetail(id);

  if (!detail) {
    notFound();
  }

  const redirectTo = `/admin/billing/clients/${detail.client.id}`;
  const [availableStudents, linkedStudent] = await Promise.all([
    detail.client.studentId ? Promise.resolve([]) : listBillingAvailableStudentsForManualLink(),
    detail.client.studentId ? getTrainingPeaksAdminStudentById(detail.client.studentId) : Promise.resolve(null),
  ]);
  const currentMonthStatus = detail.currentMonthStatus;
  const currentMonthEffectiveStatus = currentMonthStatus ? getRowStatus(currentMonthStatus) : null;

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <Link className="admin-backlink" href="/admin/billing">
            ← К биллингу
          </Link>
          <h2>{detail.client.clientName}</h2>
          <p className="admin-muted">Карточка billing-клиента и ручное управление связью с учеником.</p>
        </div>
        <div className="admin-badge-row">
          <span className={`admin-badge ${detail.client.isActive ? "admin-badge-success" : "admin-badge-warning"}`}>
            {detail.client.isActive ? "Активен" : "Пауза"}
          </span>
          <span className={`admin-badge ${detail.client.studentId ? "admin-badge-success" : "admin-badge-warning"}`}>
            {detail.client.studentId ? "Связан с учеником" : "Не связан"}
          </span>
        </div>
      </div>

      {(notice || error) && (
        <div className={`admin-alert ${error ? "admin-alert-error" : "admin-alert-success"}`}>{error ?? notice}</div>
      )}

      <div className="admin-grid admin-grid-student-detail">
        <article className="admin-card admin-card-compact">
          <h3>Клиент</h3>
          <dl className="admin-meta-list admin-meta-list-compact">
            <div>
              <dt>Имя</dt>
              <dd>{detail.client.clientName}</dd>
            </div>
            <div>
              <dt>Группа</dt>
              <dd>{detail.client.groupName ?? "—"}</dd>
            </div>
            <div>
              <dt>Сумма в месяц</dt>
              <dd>{formatBillingAmount(detail.client.monthlyAmount, detail.client.currency)}</dd>
            </div>
            <div>
              <dt>Валюта</dt>
              <dd>{detail.client.currency}</dd>
            </div>
            <div>
              <dt>Плановый день оплаты</dt>
              <dd>{detail.client.plannedPaymentDay}</dd>
            </div>
            <div>
              <dt>Метод оплаты</dt>
              <dd>{getBillingPaymentMethodLabel(detail.client.paymentMethod)}</dd>
            </div>
            <div>
              <dt>Связь с учеником</dt>
              <dd>
                {linkedStudent ? (
                  <div className="admin-table-primary">
                    <Link href={`/admin/students/${linkedStudent.id}`}>{linkedStudent.studentName}</Link>
                    <span className="admin-muted">{linkedStudent.studentId}</span>
                  </div>
                ) : detail.client.studentId ? (
                  detail.client.studentId
                ) : (
                  "Не привязан"
                )}
              </dd>
            </div>
          </dl>
          <div className="admin-card-actions admin-card-actions-compact">
            <form action={setBillingClientActiveAction}>
              <input type="hidden" name="clientId" value={detail.client.id} />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <input type="hidden" name="isActive" value={detail.client.isActive ? "false" : "true"} />
              <FormActionButton
                className={`admin-button ${detail.client.isActive ? "admin-button-secondary" : ""}`}
                pendingText="Сохранение..."
                confirmMessage={
                  detail.client.isActive
                    ? "Поставить клиента на паузу? Это остановит генерацию будущих monthly rows."
                    : undefined
                }
              >
                {detail.client.isActive ? "Пауза клиента" : "Активировать клиента"}
              </FormActionButton>
            </form>
          </div>
        </article>

        <article className="admin-card admin-card-compact">
          <h3>Текущий месяц</h3>
          <p className="admin-muted">{formatBillingMonthLabel(detail.currentMonth)}</p>
          {currentMonthStatus ? (
            <>
              <dl className="admin-meta-list admin-meta-list-compact">
                <div>
                  <dt>Статус</dt>
                  <dd>
                    <span className={`admin-badge ${getStatusBadgeClass(currentMonthEffectiveStatus ?? "pending")}`}>
                      {getBillingPaymentStatusLabel(currentMonthEffectiveStatus)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Плановая дата</dt>
                  <dd>{formatBillingDate(currentMonthStatus.plannedPaymentDate)}</dd>
                </div>
                <div>
                  <dt>Фактическая дата</dt>
                  <dd>{formatBillingDate(currentMonthStatus.actualPaymentDate)}</dd>
                </div>
                <div>
                  <dt>Сумма</dt>
                  <dd>{formatBillingAmount(currentMonthStatus.plannedAmount, currentMonthStatus.currency)}</dd>
                </div>
              </dl>
              <div className="admin-card-actions admin-card-actions-compact">
                {currentMonthEffectiveStatus === "paid" ? (
                  <form action={markBillingUnpaidAction}>
                    <input type="hidden" name="clientId" value={detail.client.id} />
                    <input type="hidden" name="month" value={detail.currentMonth.slice(0, 7)} />
                    <input type="hidden" name="redirectTo" value={redirectTo} />
                    <FormActionButton
                      className="admin-button admin-button-secondary"
                      pendingText="Снятие..."
                      confirmMessage="Снять оплату и вернуть статус в ожидание?"
                    >
                      Снять оплату
                    </FormActionButton>
                  </form>
                ) : (
                  <form action={markBillingPaidAction}>
                    <input type="hidden" name="clientId" value={detail.client.id} />
                    <input type="hidden" name="month" value={detail.currentMonth.slice(0, 7)} />
                    <input type="hidden" name="redirectTo" value={redirectTo} />
                    <input type="hidden" name="amount" value={String(currentMonthStatus.plannedAmount)} />
                    <FormActionButton className="admin-button" pendingText="Сохранение...">
                      Отметить как оплачено
                    </FormActionButton>
                  </form>
                )}
              </div>
            </>
          ) : (
            <p className="admin-muted">
              Для текущего месяца строка пока не создана. Будет использоваться актуальная сумма и плановый день при
              следующей генерации месяца.
            </p>
          )}
        </article>

        <article className="admin-card admin-card-compact">
          <h3>Редактировать клиента</h3>
          <div className="admin-section">
            <form className="admin-form-inline" action={updateBillingClientAction}>
              <input type="hidden" name="clientId" value={detail.client.id} />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <input type="hidden" name="field" value="clientName" />
              <label className="admin-field">
                <span>Имя</span>
                <input className="admin-input" name="value" type="text" defaultValue={detail.client.clientName} required />
              </label>
              <FormActionButton className="admin-button" pendingText="Сохранение...">
                Сохранить имя
              </FormActionButton>
            </form>

            <form className="admin-form-inline" action={updateBillingClientAction}>
              <input type="hidden" name="clientId" value={detail.client.id} />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <input type="hidden" name="field" value="groupName" />
              <label className="admin-field">
                <span>Группа</span>
                <input className="admin-input" name="value" type="text" defaultValue={detail.client.groupName ?? ""} />
              </label>
              <FormActionButton className="admin-button" pendingText="Сохранение...">
                Сохранить группу
              </FormActionButton>
            </form>

            <form className="admin-form-inline" action={updateBillingClientAction}>
              <input type="hidden" name="clientId" value={detail.client.id} />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <input type="hidden" name="field" value="monthlyAmount" />
              <label className="admin-field">
                <span>Сумма</span>
                <input
                  className="admin-input"
                  name="value"
                  type="number"
                  min="1"
                  step="1"
                  defaultValue={String(detail.client.monthlyAmount)}
                  required
                />
              </label>
              <FormActionButton className="admin-button" pendingText="Сохранение...">
                Сохранить сумму
              </FormActionButton>
            </form>

            <form className="admin-form-inline" action={updateBillingClientAction}>
              <input type="hidden" name="clientId" value={detail.client.id} />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <input type="hidden" name="field" value="plannedPaymentDay" />
              <label className="admin-field">
                <span>Плановый день оплаты</span>
                <input
                  className="admin-input"
                  name="value"
                  type="number"
                  min="1"
                  max="28"
                  step="1"
                  defaultValue={String(detail.client.plannedPaymentDay)}
                  required
                />
              </label>
              <FormActionButton className="admin-button" pendingText="Сохранение...">
                Сохранить день
              </FormActionButton>
            </form>

            <form className="admin-form-inline" action={updateBillingClientAction}>
              <input type="hidden" name="clientId" value={detail.client.id} />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <input type="hidden" name="field" value="paymentMethod" />
              <label className="admin-field">
                <span>Метод оплаты</span>
                <select className="admin-input" name="value" defaultValue={detail.client.paymentMethod}>
                  <option value="tbank_link_a">T-Банк A</option>
                  <option value="tbank_link_b">T-Банк B</option>
                  <option value="tbank_link_c">T-Банк C</option>
                  <option value="manual_eur">EUR вручную</option>
                  <option value="manual_other">Вручную / другое</option>
                  {!["tbank_link_a", "tbank_link_b", "tbank_link_c", "manual_eur", "manual_other"].includes(
                    detail.client.paymentMethod
                  ) && <option value={detail.client.paymentMethod}>{detail.client.paymentMethod}</option>}
                </select>
              </label>
              <FormActionButton className="admin-button" pendingText="Сохранение...">
                Сохранить метод
              </FormActionButton>
            </form>
          </div>
          <p className="admin-muted">
            Изменения суммы и дня оплаты применяются только к будущим monthly rows. Уже созданные исторические строки не
            переписываются автоматически.
          </p>
        </article>

        <article className="admin-card admin-card-compact">
          <h3>Привязка к ученику</h3>
          <p className="admin-muted">
            Billing остаётся отдельной сущностью. Привязка делается только вручную и не создаётся автоматически по имени.
          </p>
          {detail.client.studentId ? (
            <>
              <dl className="admin-meta-list admin-meta-list-compact">
                <div>
                  <dt>Текущий ученик</dt>
                  <dd>
                    {linkedStudent ? (
                      <div className="admin-table-primary">
                        <Link href={`/admin/students/${linkedStudent.id}`}>{linkedStudent.studentName}</Link>
                        <span className="admin-muted">{linkedStudent.studentId}</span>
                      </div>
                    ) : (
                      detail.client.studentId
                    )}
                  </dd>
                </div>
              </dl>
              <p className="admin-muted">Чтобы привязать другого ученика, сначала отвяжи текущего.</p>
              <form action={unlinkBillingClientFromStudentAction}>
                <input type="hidden" name="clientId" value={detail.client.id} />
                <input type="hidden" name="studentId" value={detail.client.studentId} />
                <input type="hidden" name="redirectTo" value={redirectTo} />
                <FormActionButton
                  className="admin-button"
                  pendingText="Отвязка..."
                  confirmMessage="Отвязать billing-клиента от ученика?"
                >
                  Отвязать
                </FormActionButton>
              </form>
            </>
          ) : availableStudents.length === 0 ? (
            <>
              <p className="admin-muted">
                Сейчас нет доступных активных учеников без billing-связи. Сначала отвяжи ученика от другого
                billing-клиента или проверь matching-очередь.
              </p>
              <p className="admin-muted">
                Для массовой ручной проверки открой <Link href="/admin/billing/matching">matching-очередь</Link>.
              </p>
            </>
          ) : (
            <>
              <form className="admin-form-stack" action={linkBillingClientToStudentAction}>
                <input type="hidden" name="clientId" value={detail.client.id} />
                <input type="hidden" name="redirectTo" value={redirectTo} />
                <label className="admin-field">
                  <span>Активный ученик TrainingPeaks</span>
                  <select className="admin-input" name="studentId" defaultValue="" required>
                    <option value="" disabled>
                      Выбери ученика
                    </option>
                    {availableStudents.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.studentName} ({student.studentId})
                      </option>
                    ))}
                  </select>
                </label>
                <FormActionButton
                  className="admin-button"
                  pendingText="Привязка..."
                  confirmMessage="Привязать billing-клиента к выбранному ученику?"
                >
                  Привязать к ученику
                </FormActionButton>
              </form>
              <p className="admin-muted">
                Для массовой ручной проверки открой <Link href="/admin/billing/matching">matching-очередь</Link>.
              </p>
            </>
          )}
        </article>
      </div>

      <article className="admin-card">
        <div className="admin-section-header">
          <div>
            <h3>История оплат</h3>
            <p className="admin-muted">Исторические месяцы показываются по уже созданным monthly rows.</p>
          </div>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Месяц</th>
                <th>Плановая дата</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th>Фактическая дата</th>
              </tr>
            </thead>
            <tbody>
              {detail.paymentHistory.length === 0 ? (
                <tr>
                  <td className="admin-empty-cell" colSpan={5}>
                    История оплат пока пустая.
                  </td>
                </tr>
              ) : (
                detail.paymentHistory.map((row) => {
                  const effectiveStatus = getRowStatus(row);

                  return (
                    <tr key={`${row.clientId}:${row.plannedPaymentDate}`}>
                      <td>{formatBillingMonthLabel(row.plannedPaymentDate.slice(0, 7))}</td>
                      <td>{formatBillingDate(row.plannedPaymentDate)}</td>
                      <td>{formatBillingAmount(row.plannedAmount, row.currency)}</td>
                      <td>
                        <div className="admin-table-primary">
                          <span className={`admin-badge ${getStatusBadgeClass(effectiveStatus)}`}>
                            {getBillingPaymentStatusLabel(effectiveStatus)}
                          </span>
                          {row.paidAmount != null && row.paidAmount !== row.plannedAmount && (
                            <span className="admin-muted">
                              Факт: {formatBillingAmount(row.paidAmount, row.currency)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>{formatBillingDate(row.actualPaymentDate)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="admin-muted">Обновление карточки клиента не меняет уже созданные historical rows задним числом.</p>
      </article>

      {linkedStudent && (
        <p className="admin-muted">
          Профиль ученика: <Link href={`/admin/students/${linkedStudent.id}`}>{linkedStudent.studentName}</Link>. Даты в
          карточке оплаты форматируются по billing timezone, а системные timestamps ниже в админке остаются в UTC через{" "}
          `formatIsoDate`: {formatIsoDate(detail.client.updatedAt)}.
        </p>
      )}
    </section>
  );
}
