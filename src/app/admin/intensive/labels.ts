import type { ApplicationStatus } from "@/features/intensive/repository";

export function statusLabel(status: ApplicationStatus): string {
  switch (status) {
    case "new":
      return "Новая";
    case "confirmed":
      return "Подтверждена";
    case "waitlist":
      return "Лист ожидания";
    case "cancelled":
      return "Отменена";
    default:
      return status;
  }
}

export function statusBadgeClass(status: ApplicationStatus): string {
  switch (status) {
    case "confirmed":
      return "admin-badge admin-badge-success";
    case "waitlist":
      // Жёлтый: анкета живая и ждёт решения, но места за ней нет.
      return "admin-badge admin-badge-warning";
    case "cancelled":
      return "admin-badge admin-badge-muted";
    default:
      return "admin-badge admin-badge-accent";
  }
}

/** Занимает ли статус место в потоке. Дублирует OCCUPYING_STATUSES репозитория,
 *  но нужен на странице, чтобы предупредить о превышении лимита до нажатия. */
export function statusTakesSeat(status: ApplicationStatus): boolean {
  return status === "new" || status === "confirmed";
}

const DAY_LABELS: Record<string, string> = {
  mon: "Пн",
  tue: "Вт",
  wed: "Ср",
  thu: "Чт",
  fri: "Пт",
  sat: "Сб",
  sun: "Вс",
};

/** Дни в базе лежат кодами (mon/tue/…), тренеру показываем по-русски. */
export function dayLabels(days: string[]): string {
  if (days.length === 0) return "—";
  const order = Object.keys(DAY_LABELS);
  return [...days]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((day) => DAY_LABELS[day] ?? day)
    .join(", ");
}

export function sexLabel(sex: string | null): string {
  if (sex === "female") return "Женский";
  if (sex === "male") return "Мужской";
  return sex ?? "—";
}

export function strengthLabel(value: string | null): string {
  if (value === "yes") return "Да";
  if (value === "no") return "Нет";
  if (value === "already") return "Уже делаю";
  return value ?? "—";
}

export function listLabel(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "—";
}

export function orDash(value: string | number | null): string {
  if (value === null || value === "") return "—";
  return String(value);
}

export function shorten(value: string | null, limit: number): string {
  if (!value) return "—";
  const collapsed = value.replace(/\s+/gu, " ").trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit)}…` : collapsed;
}
