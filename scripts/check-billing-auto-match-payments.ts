import { derivePayerIdentitiesFromImportedPayment } from "@/features/billing/payer-identity";
import { resolveBillingMonth } from "@/features/billing/service";
import type { BillingImportedPayment } from "@/features/billing/types";

function buildSampleImportedPayment(input: {
  paymentDate: string;
  amount: number;
  currency: "RUB" | "EUR";
  payerHint: string | null;
  description: string | null;
}): BillingImportedPayment {
  return {
    id: "00000000-0000-0000-0000-000000000011",
    importBatchId: "00000000-0000-0000-0000-000000000012",
    paymentDate: input.paymentDate,
    amount: input.amount,
    currency: input.currency,
    payerHint: input.payerHint,
    description: input.description,
    rawRow: {
      sourceFormat: "tbank_csv",
      rowNumber: 1,
      orderNumber: null,
      operationDateRaw: null,
      operationTimeRaw: null,
      amountRaw: null,
      commissionRaw: null,
      payoutAmountRaw: null,
      operationType: null,
      paymentId: null,
      terminalName: null,
      descriptionRaw: null,
      dataFlags: {
        hasEmail: false,
        hasPhone: false,
        hasName: true,
      },
    },
    externalHash: "sample-auto-match-hash",
    status: "new",
    matchedMonthlyPaymentId: null,
    matchedAt: null,
    matchedByCoachChatId: null,
    sourceFileName: "sample.csv",
    emailMessageId: null,
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function run(): void {
  const rubImport = buildSampleImportedPayment({
    paymentDate: "2026-05-18",
    amount: 12000,
    currency: "RUB",
    payerHint: "Иванов Петр",
    description: "Оплата плана за май",
  });
  const rubMonth = resolveBillingMonth(rubImport.paymentDate);
  assert(rubMonth === "2026-05-01", "Expected canonical month from payment date.");
  const rubIdentities = derivePayerIdentitiesFromImportedPayment(rubImport);
  assert(rubIdentities.length > 0, "Trusted flow requires derived identities.");

  const eurImport = buildSampleImportedPayment({
    paymentDate: "2026-05-18",
    amount: 12000,
    currency: "EUR",
    payerHint: "Иванов Петр",
    description: "Оплата плана за май",
  });
  assert(eurImport.currency !== "RUB", "Non-RUB fixture should stay non-RUB.");

  const noIdentityImport = buildSampleImportedPayment({
    paymentDate: "2026-05-18",
    amount: 12000,
    currency: "RUB",
    payerHint: null,
    description: null,
  });
  const noIdentityDerived = derivePayerIdentitiesFromImportedPayment(noIdentityImport);
  assert(noIdentityDerived.length === 0, "No payer data should produce no learned identity candidates.");

  console.log("check-billing-auto-match-payments: ok");
}

run();
