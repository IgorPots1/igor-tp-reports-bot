export const BILLING_TIME_ZONE = "Europe/Belgrade";
export const BILLING_CURRENCY_VALUES = ["RUB", "EUR", "OTHER"] as const;
export const BILLING_PAYMENT_METHOD_VALUES = [
  "tbank_link_a",
  "tbank_link_b",
  "tbank_link_c",
  "manual_eur",
  "manual_other",
] as const;

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

export type BillingCurrency = (typeof BILLING_CURRENCY_VALUES)[number];
export type BillingPaymentMethod = (typeof BILLING_PAYMENT_METHOD_VALUES)[number] | (string & {});
export type BillingPaymentStatus =
  | "pending"
  | "paid"
  | "overdue"
  | "paused"
  | "manual_review"
  | "refunded";
export type BillingPaymentSource = "manual" | "email_import";
export type BillingImportedPaymentStatus = "new" | "matched" | "ignored";
export type BillingPayerIdentityType = "payer_hint" | "description_hint" | "payment_description";
export type BillingPayerIdentityConfidence = "trusted_manual";

export type BillingClient = {
  id: string;
  studentId: string | null;
  clientName: string;
  groupName: string | null;
  monthlyAmount: number;
  currency: BillingCurrency;
  plannedPaymentDay: number | null;
  paymentMethod: BillingPaymentMethod;
  isActive: boolean;
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BillingClientUpdateInput = Partial<{
  studentId: string | null;
  clientName: string;
  groupName: string | null;
  monthlyAmount: number;
  plannedPaymentDay: number | null;
  paymentMethod: BillingPaymentMethod;
  isActive: boolean;
  updatedBy: string | null;
}>;

export type BillingMonthlyPayment = {
  id: string;
  billingClientId: string;
  billingMonth: string;
  plannedPaymentDate: string | null;
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

export type BillingImportedPaymentDataFlags = {
  hasEmail: boolean;
  hasPhone: boolean;
  hasName: boolean;
};

export type BillingImportedPaymentRawRow = {
  sourceFormat: "tbank_csv";
  rowNumber: number;
  orderNumber: string | null;
  operationDateRaw: string | null;
  operationTimeRaw: string | null;
  amountRaw: string | null;
  commissionRaw: string | null;
  payoutAmountRaw: string | null;
  operationType: string | null;
  paymentId: string | null;
  terminalName: string | null;
  descriptionRaw: string | null;
  dataFlags: BillingImportedPaymentDataFlags;
};

export type BillingImportedPayment = {
  id: string;
  importBatchId: string;
  paymentDate: string;
  amount: number;
  currency: BillingCurrency;
  payerHint: string | null;
  description: string | null;
  rawRow: BillingImportedPaymentRawRow;
  externalHash: string;
  status: BillingImportedPaymentStatus;
  matchedMonthlyPaymentId: string | null;
  matchedAt: string | null;
  matchedByCoachChatId: string | null;
  sourceFileName: string | null;
  emailMessageId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BillingPayerIdentity = {
  id: string;
  billingClientId: string;
  identityType: BillingPayerIdentityType;
  identityHash: string;
  displayHint: string | null;
  sourceImportedPaymentId: string | null;
  confidence: BillingPayerIdentityConfidence;
  firstSeenAt: string;
  lastSeenAt: string;
  matchCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ParsedBillingImportedPaymentRow = {
  paymentDate: string;
  amount: number;
  currency: BillingCurrency;
  payerHint: string | null;
  description: string | null;
  rawRow: BillingImportedPaymentRawRow;
  externalHash: string;
};

export type ParsedBillingImportedPaymentSkippedRow = {
  rowNumber: number;
  reason: string;
};

export type ParseTBankStatementResult = {
  provider: "tbank";
  sourceFormat: "tbank_csv";
  parsedRows: ParsedBillingImportedPaymentRow[];
  skippedRows: ParsedBillingImportedPaymentSkippedRow[];
  warnings: string[];
};

export type ImportBillingPaymentsInput = {
  parsedRows: ParsedBillingImportedPaymentRow[];
  sourceFileName: string;
  importBatchId?: string;
  emailMessageId?: string | null;
};

export type ImportBillingPaymentsResult = {
  importBatchId: string;
  sourceFileName: string;
  receivedRowCount: number;
  parsedRowCount: number;
  insertedRowCount: number;
  duplicateRowCount: number;
};

export type BillingEmailImportMode = "dry_run" | "apply";
export type BillingEmailImportRunStatus = "running" | "success" | "failed" | "dry_run";
export type BillingEmailImportAttachmentStatus = "found" | "imported" | "duplicate" | "failed" | "skipped";

export type BillingEmailImportRun = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: BillingEmailImportRunStatus;
  mode: BillingEmailImportMode;
  scannedMessagesCount: number;
  foundAttachmentsCount: number;
  importedPaymentsCount: number;
  duplicatePaymentsCount: number;
  autoMatchedCount: number;
  reviewRequiredCount: number;
  errorMessage: string | null;
  createdAt: string;
};

export type BillingEmailImportAttachment = {
  id: string;
  runId: string | null;
  messageUid: string;
  attachmentFilename: string;
  attachmentHash: string;
  status: BillingEmailImportAttachmentStatus;
  importedCount: number;
  duplicateCount: number;
  errorMessage: string | null;
  createdAt: string;
};

export type BillingEmailImportSummary = {
  mode: BillingEmailImportMode;
  scannedMessagesCount: number;
  matchedMessagesCount: number;
  foundAttachmentsCount: number;
  importedPaymentsCount: number;
  duplicatePaymentsCount: number;
  autoMatchedCount: number;
  reviewRequiredCount: number;
  skippedAttachmentsCount: number;
  alreadyProcessedAttachmentsCount: number;
  skippedCount: number;
  errorsCount: number;
  runId: string | null;
  telegramSummaryStatus: "sent" | "skipped" | "failed";
  telegramSummaryReason: string | null;
  dateRange: {
    since: string | null;
    until: string | null;
    lookbackDays: number | null;
  };
  filters: {
    fromEmail: string | null;
    subjectContains: string | null;
    filenameContains: string | null;
  };
  maxMessages: number | null;
  processingOrder: "asc" | "desc";
};

export type BillingMonthlyPaymentWithClient = BillingMonthlyPayment & {
  client: BillingClient;
};

export type BillingMonthStatusRow = {
  clientId: string;
  studentId: string | null;
  clientName: string;
  groupName: string | null;
  plannedAmount: number;
  paidAmount: number | null;
  currency: BillingCurrency;
  plannedPaymentDay: number | null;
  plannedPaymentDate: string | null;
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
  missingClientCount: number;
  creatableRowCount: number;
  rowsWithPlannedDateCount: number;
  rowsWithoutPlannedDateCount: number;
  skippedInvalidClientCount: number;
  insertedCount: number;
};

export type BillingMonthGenerationSkippedClient = {
  clientId: string;
  clientName: string;
  reason: "invalid_planned_payment_day" | "invalid_monthly_amount";
};

export type BillingMonthGenerationPreview = {
  billingMonth: string;
  activeClientCount: number;
  existingPaymentCount: number;
  missingClientCount: number;
  creatableRowCount: number;
  rowsWithPlannedDateCount: number;
  rowsWithoutPlannedDateCount: number;
  skippedInvalidClientCount: number;
  skippedInvalidClients: BillingMonthGenerationSkippedClient[];
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

export type BillingImportedPaymentReviewStatusFilter = BillingImportedPaymentStatus | "all";
export type BillingMonthStatusFilter = "all" | "unpaid" | "overdue" | "paid";

export type BillingImportedPaymentUpdateInput = Partial<{
  status: BillingImportedPaymentStatus;
  matchedMonthlyPaymentId: string | null;
  matchedAt: string | null;
  matchedByCoachChatId: string | null;
  notes: string | null;
}>;

export type ImportedPaymentSuggestion = {
  monthlyPayment: BillingMonthlyPaymentWithClient;
  score: number;
  reasons: string[];
  knownPayer: boolean;
};

export type ImportedPaymentReviewRow = {
  imported: BillingImportedPayment;
  suggestions: ImportedPaymentSuggestion[];
  matchedMonthlyPayment: BillingMonthlyPaymentWithClient | null;
};

export type AdminImportedPaymentsOverview = {
  statusFilter: BillingImportedPaymentReviewStatusFilter;
  counts: {
    new: number;
    matched: number;
    ignored: number;
    total: number;
  };
  rows: ImportedPaymentReviewRow[];
  candidates: BillingMonthlyPaymentWithClient[];
};

export type ConfirmImportedPaymentMatchInput = {
  importedPaymentId: string;
  monthlyPaymentId: string;
  actor: string;
};

export type ConfirmImportedPaymentMatchResult = {
  importedPayment: BillingImportedPayment;
  monthlyPayment: BillingMonthlyPaymentWithClient;
  identityLearningWarnings: string[];
};

export type IgnoreImportedPaymentInput = {
  importedPaymentId: string;
  actor: string;
  notes?: string | null;
};

export type BillingTrustedAutoMatchSkipReason =
  | "skipped_no_identity"
  | "skipped_multiple_identities"
  | "skipped_inactive_client"
  | "skipped_non_rub"
  | "skipped_amount_mismatch"
  | "skipped_already_paid"
  | "skipped_no_monthly_payment"
  | "skipped_ambiguous";

export type BillingTrustedAutoMatchDetail = {
  importedPaymentId: string;
  paymentDate: string;
  amount: number;
  currency: BillingCurrency;
  billingClientId: string;
  billingClientName: string;
  targetMonth: string;
  monthlyPaymentId: string;
};

export type AutoMatchTrustedImportedPaymentsInput = {
  apply: boolean;
  month?: string;
};

export type AutoMatchTrustedImportedPaymentsResult = {
  mode: "dry-run" | "apply";
  scannedNewImportedPayments: number;
  trustedMatches: number;
  wouldMatch: number;
  matched: number;
  skippedNoIdentity: number;
  skippedMultipleIdentities: number;
  skippedInactiveClient: number;
  skippedNonRub: number;
  skippedAmountMismatch: number;
  skippedAlreadyPaid: number;
  skippedNoMonthlyPayment: number;
  skippedAmbiguous: number;
  errors: number;
  trustedMatchDetails: BillingTrustedAutoMatchDetail[];
};
