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
