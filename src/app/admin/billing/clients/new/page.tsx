import Link from "next/link";

import FormActionButton from "@/app/admin/FormActionButton";
import { createBillingClientAction } from "@/app/admin/billing/actions";
import { getBillingPaymentMethodLabel, getSingleSearchParam } from "@/app/admin/lib";
import { listBillingAvailableStudentsForManualLink } from "@/features/billing/admin";
import { BILLING_CURRENCY_VALUES, BILLING_PAYMENT_METHOD_VALUES } from "@/features/billing/types";

type NewBillingClientPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const CURRENCY_LABELS: Record<string, string> = {
  RUB: "₽ RUB",
  EUR: "€ EUR",
  OTHER: "Другая",
};

export default async function NewBillingClientPage({ searchParams }: NewBillingClientPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const availableStudents = await listBillingAvailableStudentsForManualLink();

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <Link className="admin-backlink" href="/admin/billing">
            ← К биллингу
          </Link>
          <h2>Добавить клиента биллинга</h2>
          <p className="admin-muted">
            Создаёт нового плательщика. Строка оплаты текущего месяца будет создана автоматически.
            Привязка к ученику и Telegram — опционально, можно сделать позже на карточке клиента/ученика.
          </p>
        </div>
      </div>

      {(notice || error) && (
        <div className={`admin-alert ${error ? "admin-alert-error" : "admin-alert-success"}`}>{error ?? notice}</div>
      )}

      <article className="admin-card">
        <form className="admin-form-stack" action={createBillingClientAction}>
          <input type="hidden" name="redirectTo" value="/admin/billing/clients/new" />

          <label className="admin-field">
            <span>Имя клиента *</span>
            <input className="admin-input" name="clientName" type="text" placeholder="Иван Петров" required />
          </label>

          <label className="admin-field">
            <span>Группа</span>
            <input className="admin-input" name="groupName" type="text" placeholder="Основная" />
            <span className="admin-muted">Необязательно. Тег для фильтра/различения тёзок.</span>
          </label>

          <label className="admin-field">
            <span>Сумма в месяц *</span>
            <input className="admin-input" name="monthlyAmount" type="number" min={1} step={1} placeholder="5000" required />
          </label>

          <label className="admin-field">
            <span>Валюта *</span>
            <select className="admin-input" name="currency" defaultValue="RUB" required>
              {BILLING_CURRENCY_VALUES.map((currency) => (
                <option key={currency} value={currency}>
                  {CURRENCY_LABELS[currency] ?? currency}
                </option>
              ))}
            </select>
          </label>

          <label className="admin-field">
            <span>День оплаты</span>
            <input className="admin-input" name="plannedPaymentDay" type="number" min={1} max={31} step={1} placeholder="5" />
            <span className="admin-muted">1–31. Можно оставить пустым, если день неизвестен.</span>
          </label>

          <label className="admin-field">
            <span>Метод оплаты *</span>
            <select className="admin-input" name="paymentMethod" defaultValue="tbank_link_a" required>
              {BILLING_PAYMENT_METHOD_VALUES.map((method) => (
                <option key={method} value={method}>
                  {getBillingPaymentMethodLabel(method)}
                </option>
              ))}
            </select>
          </label>

          <label className="admin-field">
            <span>Привязать к ученику</span>
            <select className="admin-input" name="studentId" defaultValue="">
              <option value="">Без привязки (можно позже)</option>
              {availableStudents.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.studentName} ({student.studentId})
                </option>
              ))}
            </select>
            <span className="admin-muted">Список — активные ученики без billing-связи.</span>
          </label>

          <label className="admin-field">
            <span>Заметки</span>
            <textarea className="admin-textarea admin-textarea-compact" name="notes" rows={4} />
          </label>

          <div className="admin-actions">
            <FormActionButton className="admin-button" pendingText="Создание...">
              Создать клиента
            </FormActionButton>
            <Link className="admin-button admin-button-secondary" href="/admin/billing">
              Отмена
            </Link>
          </div>
        </form>
      </article>
    </section>
  );
}
