import {
  getBillingImportedPaymentsByExternalHashes,
  getBillingClientById,
  getBillingImportedPaymentById,
  getBillingMonthlyPaymentWithClientById,
  insertBillingImportedPayments,
  listBillingClientsByStudentId,
  getBillingMonthlyPaymentForClientMonth,
  insertBillingMonthlyPayments,
  listActiveBillingClients,
  listBillingMonthlyPaymentsForMonth,
  listBillingMonthlyPaymentsWithClientsForMonth,
  updateBillingClientById as updateBillingClientByIdInRepository,
  updateBillingImportedPaymentById,
  updateBillingMonthlyPaymentById,
} from "@/features/billing/repository";
import {
  BILLING_CSV_COLUMNS,
  BILLING_TIME_ZONE,
  type BillingClient,
  type BillingClientUpdateInput,
  type BillingDateInput,
  type ConfirmImportedPaymentMatchInput,
  type ConfirmImportedPaymentMatchResult,
  type IgnoreImportedPaymentInput,
  type ImportBillingPaymentsInput,
  type ImportBillingPaymentsResult,
  type BillingMonthGenerationPreview,
  type BillingMonthInput,
  type BillingMonthStatusRow,
  type BillingImportedPayment,
  type BillingMonthlyPayment,
  type BuildBillingCsvForMonthResult,
  type EnsureBillingMonthRowsResult,
  type GetBillingOverdueCandidatesOptions,
  type MarkBillingClientPaidInput,
  type MarkBillingClientPaidResult,
  type MarkBillingClientUnpaidInput,
} from "@/features/billing/types";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";

function getDateParts(date: Date, timeZone = BILLING_TIME_ZONE): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = Number.parseInt(parts.find((part) => part.type === "year")?.value ?? "", 10);
  const month = Number.parseInt(parts.find((part) => part.type === "month")?.value ?? "", 10);
  const day = Number.parseInt(parts.find((part) => part.type === "day")?.value ?? "", 10);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Unable to derive billing date parts for ${date.toISOString()}.`);
  }

  return { year, month, day };
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildUtcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function shiftIsoDate(isoDate: string, days: number): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid billing ISO date: ${isoDate}`);
  }

  const shifted = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12, 0, 0)
  );
  return formatIsoDate(shifted);
}

function parseIsoDate(value: string): Date {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid billing ISO date: ${value}`);
  }

  return buildUtcDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function getTodayIsoInBelgrade(now = new Date()): string {
  const { year, month, day } = getDateParts(now, BILLING_TIME_ZONE);
  return formatIsoDate(buildUtcDate(year, month, day));
}

export function resolveBillingMonth(input: BillingMonthInput, now = new Date()): string {
  if (input instanceof Date) {
    const { year, month } = getDateParts(input, BILLING_TIME_ZONE);
    return formatIsoDate(buildUtcDate(year, month, 1));
  }

  const normalized = input.trim();
  const monthMatch = normalized.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    return formatIsoDate(buildUtcDate(Number(monthMatch[1]), Number(monthMatch[2]), 1));
  }

  const dateMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateMatch) {
    return formatIsoDate(buildUtcDate(Number(dateMatch[1]), Number(dateMatch[2]), 1));
  }

  throw new Error(`Invalid billing month input: ${String(input ?? now)}`);
}

export function resolveBillingDate(input: BillingDateInput): string {
  if (input instanceof Date) {
    const { year, month, day } = getDateParts(input, BILLING_TIME_ZONE);
    return formatIsoDate(buildUtcDate(year, month, day));
  }

  const normalized = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Invalid billing date input: ${normalized}`);
  }

  return normalized;
}

export function getBillingMonthGenerationPreview(
  targetMonth: BillingMonthInput
): Promise<BillingMonthGenerationPreview> {
  return (async () => {
    const billingMonth = resolveBillingMonth(targetMonth);
    const [clients, existingRows] = await Promise.all([
      listActiveBillingClients(),
      listBillingMonthlyPaymentsForMonth(billingMonth),
    ]);

    const existingClientIds = new Set(existingRows.map((row) => row.billingClientId));
    const missingClientCount = clients.filter((client) => !existingClientIds.has(client.id)).length;

    return {
      billingMonth,
      activeClientCount: clients.length,
      existingPaymentCount: existingRows.length,
      missingClientCount,
      wouldGenerateRows: missingClientCount > 0,
    };
  })();
}

function buildMonthlyInsertRow(client: BillingClient, billingMonth: string, actor?: string | null) {
  return {
    billing_client_id: client.id,
    billing_month: billingMonth,
    planned_payment_date: shiftIsoDate(billingMonth, client.plannedPaymentDay - 1),
    planned_amount: client.monthlyAmount,
    currency: client.currency,
    status: "pending" as const,
    source: "manual" as const,
    created_by: actor ?? null,
    updated_by: actor ?? null,
  };
}

export async function ensureBillingMonthRows(input: {
  targetMonth: BillingMonthInput;
  actor?: string | null;
}): Promise<EnsureBillingMonthRowsResult> {
  const billingMonth = resolveBillingMonth(input.targetMonth);
  const [clients, existingRows] = await Promise.all([
    listActiveBillingClients(),
    listBillingMonthlyPaymentsForMonth(billingMonth),
  ]);

  const existingClientIds = new Set(existingRows.map((row) => row.billingClientId));
  const rowsToInsert = clients
    .filter((client) => !existingClientIds.has(client.id))
    .map((client) => buildMonthlyInsertRow(client, billingMonth, input.actor));

  await insertBillingMonthlyPayments(rowsToInsert);

  return {
    billingMonth,
    activeClientCount: clients.length,
    existingPaymentCount: existingRows.length,
    insertedCount: rowsToInsert.length,
  };
}

function getDaysOverdue(todayIso: string, plannedPaymentDate: string, status: BillingMonthlyPayment["status"]): number | null {
  if (status === "paid") {
    return null;
  }

  const diffMs = parseIsoDate(todayIso).getTime() - parseIsoDate(plannedPaymentDate).getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays <= 0) {
    return null;
  }

  return diffDays;
}

function isBillingPaymentOverdueCandidate(
  payment: BillingMonthlyPayment,
  todayIso: string,
  includeAlreadyReminded: boolean
): boolean {
  const isCandidateStatus = payment.status === "pending" || payment.status === "overdue";
  if (!isCandidateStatus) {
    return false;
  }

  if (!includeAlreadyReminded && payment.overdueRemindedAt) {
    return false;
  }

  const thresholdDate = shiftIsoDate(payment.plannedPaymentDate, 2);
  return todayIso >= thresholdDate;
}

export async function listBillingMonthStatus(targetMonth: BillingMonthInput): Promise<BillingMonthStatusRow[]> {
  const ensureResult = await ensureBillingMonthRows({ targetMonth });
  const rows = await listBillingMonthlyPaymentsWithClientsForMonth(ensureResult.billingMonth);
  const todayIso = getTodayIsoInBelgrade();

  return rows.map((row) => ({
    clientId: row.client.id,
    studentId: row.client.studentId,
    clientName: row.client.clientName,
    groupName: row.client.groupName,
    plannedAmount: row.plannedAmount,
    paidAmount: row.paidAmount,
    currency: row.currency,
    plannedPaymentDay: row.client.plannedPaymentDay,
    plannedPaymentDate: row.plannedPaymentDate,
    actualPaymentDate: row.actualPaymentDate,
    status: row.status,
    paymentMethod: row.client.paymentMethod,
    notes: row.notes ?? row.client.notes,
    daysOverdue: getDaysOverdue(todayIso, row.plannedPaymentDate, row.status),
  }));
}

async function getExistingPaymentForClientMonth(input: {
  billingClientId: string;
  month: BillingMonthInput;
}): Promise<BillingMonthlyPayment> {
  const billingMonth = resolveBillingMonth(input.month);
  await ensureBillingMonthRows({ targetMonth: billingMonth });

  const payment = await getBillingMonthlyPaymentForClientMonth({
    billingClientId: input.billingClientId,
    billingMonth,
  });

  if (!payment) {
    throw new Error(`Billing payment row missing for client ${input.billingClientId} and month ${billingMonth}.`);
  }

  return payment;
}

export async function markBillingClientPaid(
  input: MarkBillingClientPaidInput
): Promise<MarkBillingClientPaidResult> {
  const client = await getBillingClientById(input.billingClientId);
  if (!client) {
    throw new Error(`Billing client ${input.billingClientId} not found.`);
  }

  const payment = await getExistingPaymentForClientMonth({
    billingClientId: input.billingClientId,
    month: input.month,
  });

  if (payment.status === "paid") {
    return {
      kind: "already_paid",
      payment,
    };
  }

  const actualPaymentDate = input.actualPaymentDate
    ? resolveBillingDate(input.actualPaymentDate)
    : getTodayIsoInBelgrade();
  const paidAmount = input.paidAmount ?? payment.plannedAmount;

  const updated = await updateBillingMonthlyPaymentById(payment.id, {
    status: "paid",
    actual_payment_date: actualPaymentDate,
    paid_amount: paidAmount,
    source: "manual",
    marked_paid_by: input.actor ?? null,
    updated_by: input.actor ?? null,
  });

  if (!updated) {
    throw new Error(`Billing payment ${payment.id} disappeared while marking paid.`);
  }

  return {
    kind: "paid",
    payment: updated,
  };
}

export async function markBillingClientUnpaid(input: MarkBillingClientUnpaidInput): Promise<BillingMonthlyPayment> {
  const client = await getBillingClientById(input.billingClientId);
  if (!client) {
    throw new Error(`Billing client ${input.billingClientId} not found.`);
  }

  const payment = await getExistingPaymentForClientMonth({
    billingClientId: input.billingClientId,
    month: input.month,
  });

  const updated = await updateBillingMonthlyPaymentById(payment.id, {
    status: "pending",
    actual_payment_date: null,
    paid_amount: null,
    external_payment_hash: null,
    marked_paid_by: null,
    source: "manual",
    updated_by: input.actor ?? null,
  });

  if (!updated) {
    throw new Error(`Billing payment ${payment.id} disappeared while marking unpaid.`);
  }

  return updated;
}

export async function getBillingOverdueCandidates(
  options: GetBillingOverdueCandidatesOptions = {}
): Promise<BillingMonthStatusRow[]> {
  const now = options.today ?? new Date();
  const currentMonth = resolveBillingMonth(now);
  await ensureBillingMonthRows({ targetMonth: currentMonth });
  const [statusRows, paymentRows] = await Promise.all([
    listBillingMonthStatus(currentMonth),
    listBillingMonthlyPaymentsForMonth(currentMonth),
  ]);
  const todayIso = getTodayIsoInBelgrade(now);
  const candidateClientIds = new Set(
    paymentRows
      .filter((payment) =>
        isBillingPaymentOverdueCandidate(payment, todayIso, options.includeAlreadyReminded ?? false)
      )
      .map((payment) => payment.billingClientId)
  );

  return statusRows.filter((row) => candidateClientIds.has(row.clientId));
}

export async function getBillingOverdueCandidatePayments(
  options: GetBillingOverdueCandidatesOptions = {}
): Promise<BillingMonthlyPayment[]> {
  const now = options.today ?? new Date();
  const billingMonth = resolveBillingMonth(now);
  await ensureBillingMonthRows({ targetMonth: billingMonth });
  const rows = await listBillingMonthlyPaymentsForMonth(billingMonth);
  const todayIso = getTodayIsoInBelgrade(now);

  return rows.filter((row) =>
    isBillingPaymentOverdueCandidate(row, todayIso, options.includeAlreadyReminded ?? false)
  );
}

function escapeCsvCell(value: string | number | null): string {
  const stringValue = value == null ? "" : String(value);
  const escaped = stringValue.replace(/"/g, "\"\"");
  return `"${escaped}"`;
}

export async function buildBillingCsvForMonth(
  targetMonth: BillingMonthInput
): Promise<BuildBillingCsvForMonthResult> {
  const rows = await listBillingMonthStatus(targetMonth);
  const billingMonth = resolveBillingMonth(targetMonth);
  const header = BILLING_CSV_COLUMNS.join(";");
  const body = rows
    .map((row) =>
      [
        row.groupName,
        row.clientName,
        row.plannedAmount,
        row.currency,
        row.plannedPaymentDay,
        row.plannedPaymentDate,
        row.actualPaymentDate,
        row.paidAmount,
        row.status,
        row.paymentMethod,
        row.notes,
      ]
        .map(escapeCsvCell)
        .join(";")
    )
    .join("\r\n");

  return {
    billingMonth,
    rowCount: rows.length,
    content: `\uFEFF${header}\r\n${body}`,
  };
}

export function getCurrentBelgradeDateIso(now = new Date()): string {
  return getTodayIsoInBelgrade(now);
}

function validateBillingClientUpdateInput(input: BillingClientUpdateInput): void {
  if ("clientName" in input && !input.clientName?.trim()) {
    throw new Error("Имя клиента не может быть пустым.");
  }

  if ("monthlyAmount" in input) {
    const monthlyAmount = input.monthlyAmount;
    if (!Number.isInteger(monthlyAmount) || (monthlyAmount ?? 0) <= 0) {
      throw new Error("Сумма должна быть положительным целым числом.");
    }
  }

  if ("plannedPaymentDay" in input) {
    const plannedPaymentDay = input.plannedPaymentDay;
    if (
      !Number.isInteger(plannedPaymentDay) ||
      (plannedPaymentDay ?? 0) < 1 ||
      (plannedPaymentDay ?? 0) > 28
    ) {
      throw new Error("Плановый день оплаты должен быть в диапазоне 1-28.");
    }
  }
}

export async function updateBillingClientById(
  id: string,
  patch: BillingClientUpdateInput
): Promise<BillingClient> {
  const client = await getBillingClientById(id);
  if (!client) {
    throw new Error(`Billing client ${id} not found.`);
  }

  validateBillingClientUpdateInput(patch);

  const normalizedPatch: BillingClientUpdateInput = { ...patch };
  if ("clientName" in patch) {
    normalizedPatch.clientName = patch.clientName?.trim() ?? "";
  }
  if ("groupName" in patch) {
    normalizedPatch.groupName = patch.groupName?.trim() || null;
  }

  const updated = await updateBillingClientByIdInRepository(id, normalizedPatch);

  if (!updated) {
    throw new Error(`Billing client ${id} disappeared while updating.`);
  }

  return updated;
}

export async function linkBillingClientToStudent(
  billingClientId: string,
  studentId: string,
  actor?: string | null
): Promise<BillingClient> {
  const client = await getBillingClientById(billingClientId);
  if (!client) {
    throw new Error(`Billing client ${billingClientId} not found.`);
  }

  if (client.studentId && client.studentId !== studentId) {
    throw new Error("Клиент уже привязан к другому ученику. Сначала отвяжи текущую связь.");
  }

  const existingClients = await listBillingClientsByStudentId(studentId);
  const conflictingClient = existingClients.find((existingClient) => existingClient.id !== billingClientId) ?? null;
  if (conflictingClient) {
    throw new Error(
      `У этого ученика уже есть billing-клиент: ${conflictingClient.clientName}. Сначала отвяжи текущую связь.`
    );
  }

  const updated = await updateBillingClientByIdInRepository(billingClientId, {
    studentId,
    updatedBy: actor ?? null,
  });

  if (!updated) {
    throw new Error(`Billing client ${billingClientId} disappeared while linking.`);
  }

  return updated;
}

export async function unlinkBillingClientFromStudent(
  billingClientId: string,
  actor?: string | null
): Promise<BillingClient> {
  const client = await getBillingClientById(billingClientId);
  if (!client) {
    throw new Error(`Billing client ${billingClientId} not found.`);
  }

  const updated = await updateBillingClientByIdInRepository(billingClientId, {
    studentId: null,
    updatedBy: actor ?? null,
  });

  if (!updated) {
    throw new Error(`Billing client ${billingClientId} disappeared while unlinking.`);
  }

  return updated;
}

function sanitizeSourceFileName(fileName: string): string {
  return basename(fileName).trim();
}

export async function importBillingPaymentsFromParsedRows(
  input: ImportBillingPaymentsInput
): Promise<ImportBillingPaymentsResult> {
  const importBatchId = input.importBatchId ?? randomUUID();
  const sourceFileName = sanitizeSourceFileName(input.sourceFileName);
  const receivedRowCount = input.parsedRows.length;

  if (receivedRowCount === 0) {
    return {
      importBatchId,
      sourceFileName,
      receivedRowCount,
      parsedRowCount: 0,
      insertedRowCount: 0,
      duplicateRowCount: 0,
    };
  }

  const dedupedRows = Array.from(
    new Map(input.parsedRows.map((row) => [row.externalHash, row])).values()
  );
  const existingRows = await getBillingImportedPaymentsByExternalHashes(
    dedupedRows.map((row) => row.externalHash)
  );
  const existingHashes = new Set(existingRows.map((row) => row.externalHash));

  const rowsToInsert = dedupedRows
    .filter((row) => !existingHashes.has(row.externalHash))
    .map((row) => ({
      import_batch_id: importBatchId,
      payment_date: row.paymentDate,
      amount: row.amount,
      currency: row.currency,
      payer_hint: row.payerHint,
      description: row.description,
      raw_row: row.rawRow,
      external_hash: row.externalHash,
      status: "new" as const,
      matched_monthly_payment_id: null,
      matched_at: null,
      matched_by_coach_chat_id: null,
      source_file_name: sourceFileName,
      email_message_id: null,
    }));

  const insertedRows = await insertBillingImportedPayments(rowsToInsert);
  const duplicateRowCount = dedupedRows.length - insertedRows.length;

  return {
    importBatchId,
    sourceFileName,
    receivedRowCount,
    parsedRowCount: dedupedRows.length,
    insertedRowCount: insertedRows.length,
    duplicateRowCount,
  };
}

export async function confirmImportedPaymentMatch(
  input: ConfirmImportedPaymentMatchInput
): Promise<ConfirmImportedPaymentMatchResult> {
  const imported = await getBillingImportedPaymentById(input.importedPaymentId);
  if (!imported) {
    throw new Error(`Imported payment ${input.importedPaymentId} not found.`);
  }

  if (imported.status !== "new") {
    throw new Error("Этот платёж уже обработан.");
  }

  const monthly = await getBillingMonthlyPaymentWithClientById(input.monthlyPaymentId);
  if (!monthly) {
    throw new Error(`Billing payment ${input.monthlyPaymentId} not found.`);
  }

  if (monthly.status === "paid") {
    throw new Error("Этот месяц уже оплачен для данного клиента.");
  }

  if (monthly.externalPaymentHash) {
    throw new Error("Этот месячный платёж уже связан с другой импортированной оплатой.");
  }

  if (imported.currency !== monthly.currency) {
    throw new Error(
      `Валюта импортированного платежа (${imported.currency}) не совпадает с валютой месяца (${monthly.currency}).`
    );
  }

  const matchedAt = new Date().toISOString();
  const updatedMonthly = await updateBillingMonthlyPaymentById(monthly.id, {
    status: "paid",
    paid_amount: imported.amount,
    actual_payment_date: imported.paymentDate,
    source: "email_import",
    external_payment_hash: imported.externalHash,
    marked_paid_by: input.actor,
    updated_by: input.actor,
  });

  if (!updatedMonthly) {
    throw new Error(`Billing payment ${monthly.id} disappeared while confirming imported match.`);
  }

  const updatedImported = await updateBillingImportedPaymentById(imported.id, {
    status: "matched",
    matchedMonthlyPaymentId: monthly.id,
    matchedAt,
    matchedByCoachChatId: input.actor,
  });

  if (!updatedImported) {
    throw new Error(`Imported payment ${imported.id} disappeared while confirming match.`);
  }

  return {
    importedPayment: updatedImported,
    monthlyPayment: {
      ...updatedMonthly,
      client: monthly.client,
    },
  };
}

export async function ignoreImportedPayment(input: IgnoreImportedPaymentInput): Promise<BillingImportedPayment> {
  const imported = await getBillingImportedPaymentById(input.importedPaymentId);
  if (!imported) {
    throw new Error(`Imported payment ${input.importedPaymentId} not found.`);
  }

  if (imported.status !== "new") {
    throw new Error("Этот платёж уже обработан.");
  }

  const updated = await updateBillingImportedPaymentById(imported.id, {
    status: "ignored",
    matchedByCoachChatId: input.actor,
    notes: input.notes ?? null,
  });

  if (!updated) {
    throw new Error(`Imported payment ${imported.id} disappeared while ignoring.`);
  }

  return updated;
}
