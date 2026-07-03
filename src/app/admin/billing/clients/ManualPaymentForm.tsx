"use client";

import { useState } from "react";

import FormActionButton from "@/app/admin/FormActionButton";

type MonthEntry = { month: string; amount: string };

type ManualPaymentFormProps = {
  clientId: string;
  redirectTo: string;
  defaultCurrency: string;
  defaultAmount: number;
  defaultMonth: string;
  availableMonths: Array<{ value: string; label: string }>;
  recordAction: (formData: FormData) => Promise<void>;
};

export default function ManualPaymentForm({
  clientId,
  redirectTo,
  defaultCurrency,
  defaultAmount,
  defaultMonth,
  availableMonths,
  recordAction,
}: ManualPaymentFormProps) {
  const [entries, setEntries] = useState<MonthEntry[]>([
    { month: defaultMonth, amount: String(defaultAmount) },
  ]);
  const [currency, setCurrency] = useState(defaultCurrency);

  function addEntry() {
    setEntries((prev) => [...prev, { month: defaultMonth, amount: String(defaultAmount) }]);
  }

  function removeEntry(index: number) {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }

  function updateEntry(index: number, field: keyof MonthEntry, value: string) {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, [field]: value } : e)));
  }

  return (
    <form action={recordAction} className="admin-form-stack">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="redirectTo" value={redirectTo} />

      <div className="admin-form-row">
        <label className="admin-field">
          <span>Валюта платежа</span>
          <select
            className="admin-input"
            name="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            <option value="RUB">RUB</option>
            <option value="EUR">EUR</option>
            <option value="OTHER">OTHER</option>
          </select>
        </label>

        <label className="admin-field">
          <span>Дата фактической оплаты</span>
          <input className="admin-input" name="actualDate" type="date" required />
        </label>
      </div>

      {entries.map((entry, i) => (
        <div key={i} className="admin-form-inline">
          <label className="admin-field">
            <span>Месяц {entries.length > 1 ? i + 1 : ""}</span>
            <select
              className="admin-input"
              name="month"
              value={entry.month}
              onChange={(e) => updateEntry(i, "month", e.target.value)}
              required
            >
              {availableMonths.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <label className="admin-field">
            <span>Сумма</span>
            <input
              className="admin-input"
              name="amount"
              type="number"
              min="1"
              step="1"
              value={entry.amount}
              onChange={(e) => updateEntry(i, "amount", e.target.value)}
              required
            />
          </label>

          {entries.length > 1 && (
            <button
              type="button"
              className="admin-button admin-button-secondary"
              onClick={() => removeEntry(i)}
              style={{ alignSelf: "flex-end" }}
            >
              ×
            </button>
          )}
        </div>
      ))}

      <div className="admin-card-actions">
        <button type="button" className="admin-button admin-button-secondary" onClick={addEntry}>
          + Добавить месяц
        </button>
        <FormActionButton className="admin-button" pendingText="Запись...">
          Внести оплату
        </FormActionButton>
      </div>
    </form>
  );
}
