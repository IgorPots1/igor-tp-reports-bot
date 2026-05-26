import { derivePayerIdentitiesFromImportedPayment } from "@/features/billing/payer-identity";
import type { BillingImportedPayment } from "@/features/billing/types";

function buildSampleImportedPayment(input: {
  payerHint: string | null;
  description: string | null;
}): BillingImportedPayment {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    importBatchId: "00000000-0000-0000-0000-000000000002",
    paymentDate: "2026-05-26",
    amount: 10000,
    currency: "RUB",
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
    externalHash: "sample-hash",
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
  const safeCase = derivePayerIdentitiesFromImportedPayment(
    buildSampleImportedPayment({
      payerHint: "  Иванов   Пётр  ",
      description: "Оплата тренерского плана за май",
    })
  );
  assert(safeCase.length >= 2, "Expected at least two derived identities for safe text.");

  const sensitiveCase = derivePayerIdentitiesFromImportedPayment(
    buildSampleImportedPayment({
      payerHint: "ivan@example.com +7 999 123-45-67 2200123412341234",
      description: "acct: 40817810 0000 12345678",
    })
  );
  assert(sensitiveCase.length === 0, "Sensitive-only input should not produce identities.");

  const normalizedCase = derivePayerIdentitiesFromImportedPayment(
    buildSampleImportedPayment({
      payerHint: "ИвАнОв!!!   ПЕТР",
      description: "Оплата, май...",
    })
  );
  assert(normalizedCase.length > 0, "Normalized case should derive identities.");
  assert(
    normalizedCase.every((identity) => (identity.displayHint?.length ?? 0) <= 120),
    "Display hint length must be <= 120."
  );

  console.log("check-billing-payer-identities: ok");
}

run();
