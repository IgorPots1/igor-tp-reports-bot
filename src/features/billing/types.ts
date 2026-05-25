export const BILLING_TIME_ZONE = "Europe/Belgrade";

export const BILLING_CSV_COLUMNS = [
  "group_name",
  "client_name",
  "monthly_amount",
  "currency",
  "planned_payment_day",
  "planned_payment_date",
  "actual_payment_date",
  "paid_amount",
  "status",
  "payment_method",
  "notes",
] as const;

export type BillingMonthInput = string | Date;
export type BillingDateInput = string | Date;

export type BillingCurrency = "RUB" | "EUR" | "OTHER";
export type BillingPaymentMethod = "tbank_link_a" | "tbank_link_b" | "manual_eur" | "manual_other";
export type BillingPaymentStatus =
  | "pending"
  | "paid"
  | "overdue"
  | "paused"
  | "manual_review"
  | "refunded";
export type BillingPaymentSource = "manual" | "email_import";

export type BillingClient = {
  id: string;
  studentId: string | null;
  clientName: string;
  groupName: string | null;
  monthlyAmount: number;
  currency: BillingCurrency;
  plannedPaymentDay: number;
  paymentMethod: BillingPaymentMethod;
  isActive: boolean;
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BillingMonthlyPayment = {
  id: string;
  billingClientId: string;
  billingMonth: string;
  plannedPaymentDate: string;
  actualPaymentDate: string | null;
  plannedAmount: number;
  paidAmount: number | null;
  currency: BillingCurrency;
  status: BillingPaymentStatus;
  source: BillingPaymentSource;
  externalPaymentHash: string | null;
  overdueRemindedAt: string | null;
  markedPaidBy: string | null;
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BillingMonthlyPaymentWithClient = BillingMonthlyPayment & {
  client: BillingClient;
};

export type BillingMonthStatusRow = {
  clientId: string;
  clientName: string;
  groupName: string | null;
  plannedAmount: number;
  paidAmount: number | null;
  currency: BillingCurrency;
  plannedPaymentDay: number;
  plannedPaymentDate: string;
  actualPaymentDate: string | null;
  status: BillingPaymentStatus;
  paymentMethod: BillingPaymentMethod;
  notes: string | null;
  daysOverdue: number | null;
};

export type EnsureBillingMonthRowsResult = {
  billingMonth: string;
  activeClientCount: number;
  existingPaymentCount: number;
  insertedCount: number;
};

export type BillingMonthGenerationPreview = {
  billingMonth: string;
  activeClientCount: number;
  existingPaymentCount: number;
  missingClientCount: number;
  wouldGenerateRows: boolean;
};

export type MarkBillingClientPaidInput = {
  billingClientId: string;
  month: BillingMonthInput;
  paidAmount?: number | null;
  actualPaymentDate?: BillingDateInput | null;
  actor?: string | null;
};

export type MarkBillingClientPaidResult =
  | {
      kind: "paid";
      payment: BillingMonthlyPayment;
    }
  | {
      kind: "already_paid";
      payment: BillingMonthlyPayment;
    };

export type MarkBillingClientUnpaidInput = {
  billingClientId: string;
  month: BillingMonthInput;
  actor?: string | null;
};

export type GetBillingOverdueCandidatesOptions = {
  includeAlreadyReminded?: boolean;
  today?: Date;
};

export type BuildBillingCsvForMonthResult = {
  billingMonth: string;
  rowCount: number;
  content: string;
};
