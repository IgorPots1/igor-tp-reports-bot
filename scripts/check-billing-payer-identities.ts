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
  // Теперь идентификатор только один — по имени плательщика (payer_hint).
  // Описание из банка больше НЕ используется (generic, ложные совпадения).
  assert(safeCase.length === 1, "Expected exactly one derived identity (payer name only).");
  assert(safeCase[0].identityType === "payer_hint", "Only payer_hint identity must be derived.");

  // Описание без имени плательщика не должно давать идентификатор (фикс «Товар 1»).
  const descriptionOnlyCase = derivePayerIdentitiesFromImportedPayment(
    buildSampleImportedPayment({
      payerHint: null,
      description: "Товар 1",
    })
  );
  assert(descriptionOnlyCase.length === 0, "Description-only payment must not derive any identity.");

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
