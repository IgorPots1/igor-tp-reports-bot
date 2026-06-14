import { buildImportedPaymentSuggestion } from "@/features/billing/admin";
import type {
  BillingImportedPayment,
  BillingMonthlyPaymentWithClient,
} from "@/features/billing/types";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function buildImported(input: {
  amount: number;
  payerHint: string | null;
  description: string | null;
}): BillingImportedPayment {
  return {
    id: "00000000-0000-0000-0000-0000000000a1",
    importBatchId: "00000000-0000-0000-0000-0000000000a2",
    paymentDate: "2026-06-03",
    amount: input.amount,
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
      dataFlags: { hasEmail: false, hasPhone: false, hasName: true },
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

function buildCandidate(input: {
  clientId: string;
  clientName: string;
  plannedAmount: number;
  billingMonth?: string;
  plannedPaymentDate?: string;
  paymentMethod?: string;
}): BillingMonthlyPaymentWithClient {
  return {
    id: `monthly-${input.clientId}`,
    billingClientId: input.clientId,
    billingMonth: input.billingMonth ?? "2026-06-01",
    plannedPaymentDate: input.plannedPaymentDate ?? "2026-06-05",
    actualPaymentDate: null,
    plannedAmount: input.plannedAmount,
    paidAmount: null,
    currency: "RUB",
    status: "pending",
    source: "manual",
    externalPaymentHash: null,
    overdueRemindedAt: null,
    markedPaidBy: null,
    notes: null,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    client: {
      id: input.clientId,
      studentId: null,
      clientName: input.clientName,
      groupName: null,
      monthlyAmount: input.plannedAmount,
      currency: "RUB",
      plannedPaymentDay: 5,
      paymentMethod: input.paymentMethod ?? "tbank_link_a",
      isActive: true,
      notes: null,
      createdBy: null,
      updatedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

// Слабый кандидат: неверная сумма, далёкая дата вне месяца платежа, непохожее имя, не-T-Банк метод.
function buildWeakCandidate(clientId: string): BillingMonthlyPaymentWithClient {
  return buildCandidate({
    clientId,
    clientName: "Совсем Другое Имя",
    plannedAmount: 10000,
    billingMonth: "2026-01-01",
    plannedPaymentDate: "2026-01-15",
    paymentMethod: "manual_other",
  });
}

// 1. Незнакомый плательщик, слабый кандидат → ниже порога → null.
{
  const imported = buildImported({ amount: 3333, payerHint: "Неизвестный Отправитель", description: null });
  const candidate = buildWeakCandidate("c1");
  const suggestion = buildImportedPaymentSuggestion(imported, candidate, new Set<string>());
  assert(suggestion === null, "Незнакомый слабый кандидат должен отсеяться (null).");
}

// 2. Тот же слабый кандидат, но это ЗНАКОМЫЙ плательщик → проходит порог, knownPayer=true.
{
  const imported = buildImported({ amount: 3333, payerHint: "Неизвестный Отправитель", description: null });
  const candidate = buildWeakCandidate("c1");
  const suggestion = buildImportedPaymentSuggestion(imported, candidate, new Set<string>(["c1"]));
  assert(suggestion !== null, "Знакомый плательщик должен пройти порог даже при слабом базовом score.");
  assert(suggestion!.knownPayer === true, "knownPayer должен быть true для известного клиента.");
  assert(
    suggestion!.reasons.some((reason) => reason.includes("знакомый плательщик")),
    "Должна быть причина про знакомого плательщика."
  );
}

// 3. Знакомый плательщик ранжируется выше обычного точного совпадения по сумме/имени.
{
  const imported = buildImported({ amount: 10000, payerHint: "Иван Петров", description: null });
  const knownCandidate = buildCandidate({ clientId: "c2", clientName: "Другой Клиент", plannedAmount: 3333 });
  const exactCandidate = buildCandidate({ clientId: "c3", clientName: "Иван Петров", plannedAmount: 10000 });

  const knownSuggestion = buildImportedPaymentSuggestion(imported, knownCandidate, new Set<string>(["c2"]));
  const exactSuggestion = buildImportedPaymentSuggestion(imported, exactCandidate, new Set<string>());

  assert(knownSuggestion !== null && exactSuggestion !== null, "Оба кандидата должны вернуться.");
  assert(
    knownSuggestion!.score > exactSuggestion!.score,
    "Знакомый плательщик должен иметь приоритет над обычным точным совпадением."
  );
  assert(exactSuggestion!.knownPayer === false, "Обычный кандидат должен иметь knownPayer=false.");
}

console.log("check-billing-imported-payment-suggestions: ok");
