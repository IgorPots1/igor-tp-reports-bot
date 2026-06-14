import Link from "next/link";

import FormActionButton from "@/app/admin/FormActionButton";
import { createTrainingPeaksStudentAction } from "@/app/admin/actions";
import { getBillingPaymentMethodLabel, getSingleSearchParam } from "@/app/admin/lib";
import StudentIdentityFields from "@/app/admin/students/new/StudentIdentityFields";
import { BILLING_CURRENCY_VALUES, BILLING_PAYMENT_METHOD_VALUES } from "@/features/billing/types";

const BILLING_CURRENCY_LABELS: Record<string, string> = {
  RUB: "₽ RUB",
  EUR: "€ EUR",
  OTHER: "Другая",
};

type NewStudentPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminNewStudentPage({ searchParams }: NewStudentPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const initialStudentId = getSingleSearchParam(resolvedSearchParams.student_id) ?? "";
  const initialStudentName = getSingleSearchParam(resolvedSearchParams.student_name) ?? "";
  const initialTrainingPeaksAthleteUrl =
    getSingleSearchParam(resolvedSearchParams.trainingpeaks_athlete_url) ?? "";
  const initialDataQualityStatus = getSingleSearchParam(resolvedSearchParams.data_quality_status) ?? "";

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <Link className="admin-backlink" href="/admin/students">
            ← Ко всем ученикам
          </Link>
          <h2>Добавить ученика</h2>
          <p className="admin-muted">
            Добавление в Web Admin обновляет только Supabase-реестр. Локальный <code>students.json</code>{" "}
            веб-приложение не меняет.
          </p>
        </div>
      </div>

      {(notice || error) && (
        <div className={`admin-alert ${error ? "admin-alert-error" : "admin-alert-success"}`}>
          {error ?? notice}
        </div>
      )}

      <div className="admin-alert admin-alert-success">
        После добавления запусти локально <code>tp-sync-students</code>, чтобы Mac-runner обновил{" "}
        <code>students.json</code>.
      </div>

      <article className="admin-card">
        <form className="admin-form-stack" action={createTrainingPeaksStudentAction}>
          <input type="hidden" name="redirectTo" value="/admin/students/new" />
          <StudentIdentityFields
            initialStudentId={initialStudentId}
            initialStudentName={initialStudentName}
          />

          <label className="admin-field">
            <span>TrainingPeaks athlete URL</span>
            <input
              className="admin-input"
              name="trainingpeaks_athlete_url"
              type="url"
              placeholder="https://app.trainingpeaks.com/#calendar/athletes/123456"
              defaultValue={initialTrainingPeaksAthleteUrl}
              required
            />
          </label>

          <label className="admin-field">
            <span>Статус качества данных</span>
            <input
              className="admin-input"
              name="data_quality_status"
              placeholder="ok"
              defaultValue={initialDataQualityStatus}
            />
            <span className="admin-muted">Поле опционально. Если не нужно, оставь пустым.</span>
          </label>

          <fieldset className="admin-card" style={{ border: "1px solid #e2e8f0" }}>
            <legend>
              <strong>Биллинг</strong> <span className="admin-muted">(необязательно)</span>
            </legend>
            <p className="admin-muted">
              Заполни сумму, чтобы сразу завести оплату для этого ученика. Оставь сумму пустой — ученик
              создастся без биллинга, оплату можно добавить позже.
            </p>

            <label className="admin-field">
              <span>Сумма в месяц</span>
              <input
                className="admin-input"
                name="billing_monthly_amount"
                type="number"
                min={1}
                step={1}
                placeholder="5000"
              />
            </label>

            <label className="admin-field">
              <span>Валюта</span>
              <select className="admin-input" name="billing_currency" defaultValue="RUB">
                {BILLING_CURRENCY_VALUES.map((currency) => (
                  <option key={currency} value={currency}>
                    {BILLING_CURRENCY_LABELS[currency] ?? currency}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field">
              <span>День оплаты</span>
              <input
                className="admin-input"
                name="billing_payment_day"
                type="number"
                min={1}
                max={31}
                step={1}
                placeholder="5"
              />
            </label>

            <label className="admin-field">
              <span>Метод оплаты</span>
              <select className="admin-input" name="billing_payment_method" defaultValue="tbank_link_a">
                {BILLING_PAYMENT_METHOD_VALUES.map((method) => (
                  <option key={method} value={method}>
                    {getBillingPaymentMethodLabel(method)}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          <label className="admin-field">
            <span>Заметки</span>
            <textarea className="admin-textarea admin-textarea-compact" name="notes" rows={5} />
          </label>

          <div className="admin-actions">
            <FormActionButton className="admin-button" pendingText="Создание...">
              Создать ученика
            </FormActionButton>
            <Link className="admin-button admin-button-secondary" href="/admin/students">
              Отмена
            </Link>
          </div>
        </form>
      </article>
    </section>
  );
}
