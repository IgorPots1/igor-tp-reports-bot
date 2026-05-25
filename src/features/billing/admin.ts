import { listActiveBillingClients } from "@/features/billing/repository";
import { BILLING_TIME_ZONE, type BillingMonthStatusRow } from "@/features/billing/types";
import { listBillingMonthStatus, resolveBillingMonth } from "@/features/billing/service";

type AdminBillingMonthOverview = {
  billingMonth: string;
  total: number;
  paid: number;
  pending: number;
  overdue: number;
  manualReview: number;
  paused: number;
  unlinkedCount: number;
  rows: BillingMonthStatusRow[];
};

function getCurrentBelgradeMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BILLING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  const year = Number.parseInt(parts.find((part) => part.type === "year")?.value ?? "", 10);
  const month = Number.parseInt(parts.find((part) => part.type === "month")?.value ?? "", 10);

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error(`Unable to derive current billing month for ${now.toISOString()}.`);
  }

  return resolveBillingMonth(`${year}-${String(month).padStart(2, "0")}`);
}

function isRowOverdue(row: BillingMonthStatusRow): boolean {
  return row.status === "overdue" || (row.status === "pending" && row.daysOverdue != null && row.daysOverdue > 0);
}

export async function getAdminBillingMonthOverview(month?: string): Promise<AdminBillingMonthOverview> {
  const billingMonth = month ? resolveBillingMonth(month) : getCurrentBelgradeMonth();
  const [rows, activeClients] = await Promise.all([
    listBillingMonthStatus(billingMonth),
    listActiveBillingClients(),
  ]);

  return {
    billingMonth,
    total: rows.length,
    paid: rows.filter((row) => row.status === "paid").length,
    pending: rows.filter((row) => row.status === "pending" && !isRowOverdue(row)).length,
    overdue: rows.filter(isRowOverdue).length,
    manualReview: rows.filter((row) => row.status === "manual_review").length,
    paused: rows.filter((row) => row.status === "paused").length,
    unlinkedCount: activeClients.filter((client) => !client.studentId).length,
    rows,
  };
}
