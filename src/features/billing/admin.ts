import {
  getBillingClientById,
  getBillingClientByStudentId,
  getBillingMonthlyPaymentWithClientById,
  listActiveBillingClients,
  listBillingClientsByStudentId,
  listBillingClientsIncludingInactive,
  listBillingImportedPayments,
  listBillingMonthlyPaymentsForClient,
  listUnpaidBillingMonthlyPaymentsWithClients,
} from "@/features/billing/repository";
import {
  BILLING_TIME_ZONE,
  type AdminImportedPaymentsOverview,
  type BillingClient,
  type BillingImportedPayment,
  type BillingImportedPaymentReviewStatusFilter,
  type BillingMonthlyPaymentWithClient,
  type BillingMonthStatusRow,
  type ImportedPaymentReviewRow,
  type ImportedPaymentSuggestion,
} from "@/features/billing/types";
import { getCurrentBelgradeDateIso, listBillingMonthStatus, resolveBillingMonth } from "@/features/billing/service";
import { listTrainingPeaksAdminStudents, type TrainingPeaksAdminStudentRecord } from "@/features/trainingpeaks/admin";

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

export type BillingClientDetail = {
  client: BillingClient;
  currentMonth: string;
  currentMonthStatus: BillingMonthStatusRow | null;
  paymentHistory: BillingMonthStatusRow[];
};

export type BillingClientSuggestion = {
  student: TrainingPeaksAdminStudentRecord;
  score: number;
  explanation: string;
};

export type UnlinkedBillingClientMatchRecord = {
  client: BillingClient;
  suggestions: BillingClientSuggestion[];
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

function normalizeNamePart(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenizeName(value: string | null | undefined): string[] {
  return normalizeNamePart(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function buildBillingClientSuggestion(
  client: BillingClient,
  student: TrainingPeaksAdminStudentRecord
): BillingClientSuggestion | null {
  const clientTokens = tokenizeName(client.clientName);
  const studentTokens = tokenizeName(student.studentName);
  if (clientTokens.length === 0 || studentTokens.length === 0) {
    return null;
  }

  const clientNormalized = clientTokens.join(" ");
  const studentNormalized = studentTokens.join(" ");
  let score = 0;
  const explanationParts: string[] = [];

  if (clientNormalized === studentNormalized) {
    score += 100;
    explanationParts.push("полное совпадение имени");
  }

  const intersection = clientTokens.filter((token) => studentTokens.includes(token));
  if (intersection.length > 0) {
    score += intersection.length * 20;
    explanationParts.push(`общие части: ${intersection.join(", ")}`);
  }

  if (clientNormalized.includes(studentNormalized) || studentNormalized.includes(clientNormalized)) {
    score += 15;
    explanationParts.push("одно имя вложено в другое");
  }

  if (client.groupName && student.notes) {
    const normalizedGroup = normalizeNamePart(client.groupName);
    const normalizedNotes = normalizeNamePart(student.notes);
    if (normalizedGroup && normalizedNotes.includes(normalizedGroup)) {
      score += 8;
      explanationParts.push("группа похожа на заметки ученика");
    }
  }

  if (score <= 0) {
    return null;
  }

  return {
    student,
    score,
    explanation: explanationParts.join("; "),
  };
}

export async function listBillingActiveStudentsForManualLink(): Promise<TrainingPeaksAdminStudentRecord[]> {
  const students = await listTrainingPeaksAdminStudents("active");
  return students.filter((student) => student.isActive);
}

export async function listBillingAvailableStudentsForManualLink(): Promise<TrainingPeaksAdminStudentRecord[]> {
  const [students, billingClients] = await Promise.all([
    listBillingActiveStudentsForManualLink(),
    listBillingClientsIncludingInactive(),
  ]);

  const linkedStudentIds = new Set(
    billingClients.flatMap((client) => (client.studentId ? [client.studentId] : []))
  );

  return students.filter((student) => !linkedStudentIds.has(student.id));
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

export async function getBillingClientDetail(id: string): Promise<BillingClientDetail | null> {
  const client = await getBillingClientById(id);
  if (!client) {
    return null;
  }

  const currentMonth = getCurrentBelgradeMonth();
  const [historyRows, currentMonthRows] = await Promise.all([
    listBillingMonthlyPaymentsForClient(client.id),
    listBillingMonthStatus(currentMonth),
  ]);
  const currentMonthStatus = currentMonthRows.find((row) => row.clientId === client.id) ?? null;
  const todayIso = getCurrentBelgradeDateIso();

  const paymentHistory: BillingMonthStatusRow[] = historyRows.map((row) => ({
    clientId: client.id,
    studentId: client.studentId,
    clientName: client.clientName,
    groupName: client.groupName,
    plannedAmount: row.plannedAmount,
    paidAmount: row.paidAmount,
    currency: row.currency,
    plannedPaymentDay: client.plannedPaymentDay,
    plannedPaymentDate: row.plannedPaymentDate,
    actualPaymentDate: row.actualPaymentDate,
    status: row.status,
    paymentMethod: client.paymentMethod,
    notes: row.notes ?? client.notes,
    daysOverdue:
      row.status === "paid"
        ? null
        : row.plannedPaymentDate < todayIso
          ? Math.max(
              1,
              Math.floor(
                (new Date(`${todayIso}T12:00:00.000Z`).getTime() -
                  new Date(`${row.plannedPaymentDate}T12:00:00.000Z`).getTime()) /
                  86400000
              )
            )
          : null,
  }));

  return {
    client,
    currentMonth,
    currentMonthStatus,
    paymentHistory,
  };
}

export async function getBillingClientForStudent(studentId: string): Promise<BillingClient | null> {
  return getBillingClientByStudentId(studentId);
}

export async function assertBillingStudentLinkAvailable(
  clientId: string,
  studentId: string
): Promise<{ existingClient: BillingClient | null }> {
  const existingClients = await listBillingClientsByStudentId(studentId);
  const existingClient = existingClients.find((client) => client.id !== clientId) ?? null;
  return { existingClient };
}

export async function listUnlinkedBillingClients(): Promise<BillingClient[]> {
  const clients = await listActiveBillingClients();
  return clients.filter((client) => !client.studentId);
}

export async function listUnlinkedBillingClientsWithSuggestions(): Promise<UnlinkedBillingClientMatchRecord[]> {
  const [clients, students] = await Promise.all([
    listUnlinkedBillingClients(),
    listBillingAvailableStudentsForManualLink(),
  ]);

  return clients.map((client) => ({
    client,
    suggestions: students
      .map((student) => buildBillingClientSuggestion(client, student))
      .filter((suggestion): suggestion is BillingClientSuggestion => suggestion !== null)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3),
  }));
}

function parseBillingIsoDate(value: string): Date {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid billing ISO date: ${value}`);
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
}

function getDaysBetween(leftIso: string, rightIso: string): number {
  const diffMs = Math.abs(parseBillingIsoDate(leftIso).getTime() - parseBillingIsoDate(rightIso).getTime());
  return Math.floor(diffMs / 86400000);
}

function getBillingMonthEndIso(billingMonth: string): string {
  const date = parseBillingIsoDate(billingMonth);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12, 0, 0)).toISOString().slice(0, 10);
}

function isPaymentDateWithinBillingMonth(paymentDate: string, billingMonth: string): boolean {
  const monthEnd = getBillingMonthEndIso(billingMonth);
  return paymentDate >= billingMonth && paymentDate <= monthEnd;
}

function buildImportedPaymentSuggestion(
  imported: BillingImportedPayment,
  candidate: BillingMonthlyPaymentWithClient
): ImportedPaymentSuggestion | null {
  if (imported.currency !== candidate.currency) {
    return null;
  }

  let score = 0;
  const reasons: string[] = [];

  score += 10;
  reasons.push("валюта совпадает");

  if (imported.amount === candidate.plannedAmount) {
    score += 50;
    reasons.push("точная сумма");
  } else {
    const tolerance = Math.max(Math.round(candidate.plannedAmount * 0.05), 100);
    if (Math.abs(imported.amount - candidate.plannedAmount) <= tolerance) {
      score += 20;
      reasons.push("сумма близка");
    }
  }

  const dayDiff = getDaysBetween(imported.paymentDate, candidate.plannedPaymentDate);
  if (dayDiff <= 5) {
    score += 30;
    reasons.push("дата в пределах 5 дней от плана");
  } else if (dayDiff <= 15) {
    score += 15;
    reasons.push("дата в пределах 6–15 дней от плана");
  }

  if (isPaymentDateWithinBillingMonth(imported.paymentDate, candidate.billingMonth)) {
    score += 5;
    reasons.push("дата внутри месяца биллинга");
  }

  const payerNormalized = normalizeNamePart(imported.payerHint);
  const clientNormalized = normalizeNamePart(candidate.client.clientName);
  const payerTokens = tokenizeName(imported.payerHint);
  const clientTokens = tokenizeName(candidate.client.clientName);

  if (payerNormalized && clientNormalized && payerNormalized === clientNormalized) {
    score += 40;
    reasons.push("полное совпадение имени плательщика");
  } else {
    const sharedTokens = payerTokens.filter((token) => clientTokens.includes(token));
    if (sharedTokens.length > 0) {
      score += sharedTokens.length * 15;
      reasons.push(`общие части имени: ${sharedTokens.join(", ")}`);
    }

    if (
      payerNormalized &&
      clientNormalized &&
      (payerNormalized.includes(clientNormalized) || clientNormalized.includes(payerNormalized))
    ) {
      score += 10;
      reasons.push("имя плательщика частично совпадает");
    }
  }

  if (candidate.client.paymentMethod.startsWith("tbank_")) {
    score += 5;
    reasons.push("метод оплаты T-Банк");
  }

  if (score < 25) {
    return null;
  }

  return {
    monthlyPayment: candidate,
    score,
    reasons,
  };
}

function buildImportedPaymentSuggestions(
  imported: BillingImportedPayment,
  candidates: BillingMonthlyPaymentWithClient[]
): ImportedPaymentSuggestion[] {
  return candidates
    .map((candidate) => buildImportedPaymentSuggestion(imported, candidate))
    .filter((suggestion): suggestion is ImportedPaymentSuggestion => suggestion !== null)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
}

export async function getAdminImportedPaymentsOverview(
  statusFilter: BillingImportedPaymentReviewStatusFilter = "new"
): Promise<AdminImportedPaymentsOverview> {
  const [allImported, filteredImported, candidates] = await Promise.all([
    listBillingImportedPayments(),
    statusFilter === "all" ? listBillingImportedPayments() : listBillingImportedPayments({ status: statusFilter }),
    listUnpaidBillingMonthlyPaymentsWithClients(),
  ]);

  const counts = {
    new: allImported.filter((row) => row.status === "new").length,
    matched: allImported.filter((row) => row.status === "matched").length,
    ignored: allImported.filter((row) => row.status === "ignored").length,
    total: allImported.length,
  };

  const matchedMonthlyIds = filteredImported
    .flatMap((row) => (row.matchedMonthlyPaymentId ? [row.matchedMonthlyPaymentId] : []));
  const matchedMonthlyPayments = await Promise.all(
    matchedMonthlyIds.map((id) => getBillingMonthlyPaymentWithClientById(id))
  );
  const matchedMonthlyById = new Map(
    matchedMonthlyPayments.flatMap((payment) => (payment ? [[payment.id, payment] as const] : []))
  );

  const rows: ImportedPaymentReviewRow[] = filteredImported.map((imported) => ({
    imported,
    suggestions: imported.status === "new" ? buildImportedPaymentSuggestions(imported, candidates) : [],
    matchedMonthlyPayment: imported.matchedMonthlyPaymentId
      ? matchedMonthlyById.get(imported.matchedMonthlyPaymentId) ?? null
      : null,
  }));

  return {
    statusFilter,
    counts,
    rows,
    candidates,
  };
}
