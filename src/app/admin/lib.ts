export function formatIsoDate(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function formatWeekRange(weekFrom: string, weekTo: string): string {
  return `${weekFrom} — ${weekTo}`;
}

export function getSingleSearchParam(
  value: string | string[] | undefined
): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export function getBillingPaymentStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "pending":
      return "Ожидаем";
    case "paid":
      return "Оплачено";
    case "overdue":
      return "Просрочено";
    case "paused":
      return "Пауза";
    case "manual_review":
      return "Проверить";
    case "refunded":
      return "Возврат";
    default:
      return status ?? "Не указано";
  }
}

export function getBillingPaymentMethodLabel(method: string | null | undefined): string {
  switch (method) {
    case "tbank_link_a":
      return "T-Банк A";
    case "tbank_link_b":
      return "T-Банк B";
    case "tbank_link_c":
      return "T-Банк C";
    case "manual_eur":
      return "EUR вручную";
    case "manual_other":
      return "Вручную / другое";
    default:
      return method?.trim() ? method : "Не указано";
  }
}

export function formatBillingAmount(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null) {
    return "—";
  }

  if (currency === "RUB" || currency === "EUR") {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }

  const value = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);

  return currency ? `${value} ${currency}` : value;
}

export function getReviewStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Черновик";
    case "approved":
      return "Готов к отправке";
    case "sent":
      return "Отправлен";
    case "failed":
      return "Ошибка доставки";
    case "skipped":
      return "Пропущен";
    default:
      return status;
  }
}

export function getRegistryStatusLabel(status: string): string {
  switch (status) {
    case "ready":
      return "Есть отчёт";
    case "parsed_only":
      return "Только markdown без ручной правки";
    case "data_loaded":
      return "Только данные";
    case "no_report":
      return "Нет markdown";
    case "no_data":
      return "Нет данных";
    default:
      return status;
  }
}
