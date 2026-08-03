import Link from "next/link";

import FormActionButton from "@/app/admin/FormActionButton";
import { linkBillingClientToStudentAction } from "@/app/admin/billing/actions";
import { formatBillingAmount, getBillingPaymentMethodLabel, getSingleSearchParam } from "@/app/admin/lib";
import {
  listBillingAvailableStudentsForManualLink,
  listUnlinkedBillingClientsWithSuggestions,
} from "@/features/billing/admin";

export const dynamic = "force-dynamic";

type BillingMatchingPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

// Компактная подпись уверенности вместо длинного перечня причин сопоставления.
function getSuggestionMatchLabel(score: number): string {
  if (score >= 100) {
    return "точное совпадение имени";
  }
  if (score >= 80) {
    return "сильное совпадение";
  }
  if (score >= 45) {
    return "совпадение по фамилии";
  }
  return "слабое совпадение";
}

export default async function BillingMatchingPage({ searchParams }: BillingMatchingPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const [records, availableStudents] = await Promise.all([
    listUnlinkedBillingClientsWithSuggestions(),
    listBillingAvailableStudentsForManualLink(),
  ]);
  const hasAvailableStudents = availableStudents.length > 0;

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <Link className="admin-backlink" href="/admin/billing">
            ← К биллингу
          </Link>
          <h2>Связка billing-клиентов</h2>
          <p className="admin-muted">
            Предложения строятся только как подсказки по имени. Автопривязки нет: coach подтверждает каждую связь
            вручную.
          </p>
        </div>
      </div>

      {(notice || error) && (
        <div className={`admin-alert ${error ? "admin-alert-error" : "admin-alert-success"}`}>{error ?? notice}</div>
      )}

      {!hasAvailableStudents && records.length > 0 && (
        <div className="admin-alert admin-alert-warning">
          Сейчас нет доступных активных учеников без billing-связи. Ниже остаются непривязанные клиенты, но ручная
          привязка временно недоступна, пока не освободится ученик.
        </div>
      )}

      <article className="admin-card">
        <h3>Непривязанные клиенты</h3>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Клиент</th>
                <th>Подсказки</th>
                <th>Ручная привязка</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td className="admin-empty-cell" colSpan={3}>
                    Все активные billing-клиенты уже связаны с учениками.
                  </td>
                </tr>
              ) : (
                records.map((record) => {
                  const redirectTo = "/admin/billing/matching";

                  return (
                    <tr key={record.client.id}>
                      <td>
                        <div className="admin-table-primary">
                          <Link href={`/admin/billing/clients/${record.client.id}`}>
                            <strong>{record.client.clientName}</strong>
                          </Link>
                          <span className="admin-muted">
                            {record.client.groupName ?? "Без группы"} ·{" "}
                            {formatBillingAmount(record.client.monthlyAmount, record.client.currency)}
                          </span>
                          <span className="admin-muted">
                            {record.client.plannedPaymentDay != null
                              ? `${record.client.plannedPaymentDay} число`
                              : "Плановый день не задан"}{" "}
                            · {getBillingPaymentMethodLabel(record.client.paymentMethod)}
                          </span>
                        </div>
                      </td>
                      <td>
                        {record.suggestions.length === 0 ? (
                          <span className="admin-muted">Похожих учеников не найдено.</span>
                        ) : (
                          <div className="admin-import-suggestions">
                            {record.suggestions.map((suggestion) => (
                              <form
                                key={suggestion.student.id}
                                action={linkBillingClientToStudentAction}
                                className="admin-import-suggestion"
                              >
                                <input type="hidden" name="clientId" value={record.client.id} />
                                <input type="hidden" name="studentId" value={suggestion.student.id} />
                                <input type="hidden" name="redirectTo" value={redirectTo} />
                                <div className="admin-import-suggestion-body">
                                  <strong>
                                    {suggestion.student.studentName}{" "}
                                    <span className="admin-muted">({suggestion.student.studentId})</span>
                                  </strong>
                                  <span className="admin-muted">{getSuggestionMatchLabel(suggestion.score)}</span>
                                </div>
                                <FormActionButton
                                  className="admin-button admin-button-secondary"
                                  pendingText="Привязка..."
                                  confirmMessage="Привязать billing-клиента к выбранному ученику?"
                                >
                                  Подтвердить
                                </FormActionButton>
                              </form>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        {hasAvailableStudents ? (
                          <form className="admin-form-stack" action={linkBillingClientToStudentAction}>
                            <input type="hidden" name="clientId" value={record.client.id} />
                            <input type="hidden" name="redirectTo" value={redirectTo} />
                            <label className="admin-field">
                              <span>Выбрать ученика вручную</span>
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
                              Привязать вручную
                            </FormActionButton>
                          </form>
                        ) : (
                          <span className="admin-muted">Нет доступных учеников для ручной привязки.</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="admin-muted">Пропустить клиента можно просто без действия. Никаких изменений без submit не происходит.</p>
      </article>
    </section>
  );
}
