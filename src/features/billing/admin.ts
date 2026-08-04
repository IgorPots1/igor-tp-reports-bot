import {
  getBillingClientById,
  getBillingClientByStudentId,
  getBillingMonthlyPaymentWithClientById,
  listBillingPayerIdentitiesByTypeHash,
  listBillingPayerIdentitiesForClient,
  listActiveBillingClients,
  listBillingClientsByStudentId,
  listBillingClientsIncludingInactive,
  listBillingImportedPayments,
  listBillingMonthlyPaymentsForClient,
  listUnpaidBillingMonthlyPaymentsWithClients,
} from "@/features/billing/repository";
import { derivePayerIdentitiesFromImportedPayment } from "@/features/billing/payer-identity";
import { scoreBillingNameMatch } from "@/features/billing/name-matching";
import {
  BILLING_TIME_ZONE,
  type AdminImportedPaymentsOverview,
  type BillingClient,
  type BillingPayerIdentity,
  type BillingImportedPayment,
  type BillingImportedPaymentReviewStatusFilter,
  type BillingMonthlyPaymentWithClient,
  type BillingMonthStatusFilter,
  type BillingMonthStatusRow,
  type ImportedPaymentReviewRow,
  type ImportedPaymentStudentSuggestion,
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
  statusFilter: BillingMonthStatusFilter;
  filterCounts: {
    all: number;
    unpaid: number;
    overdue: number;
    paid: number;
  };
  rows: BillingMonthStatusRow[];
};

export type BillingClientDetail = {
  client: BillingClient;
  currentMonth: string;
  currentMonthStatus: BillingMonthStatusRow | null;
  paymentHistory: BillingMonthStatusRow[];
  payerIdentities: BillingPayerIdentity[];
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

export function isBillingRowEffectivelyOverdue(row: BillingMonthStatusRow): boolean {
  // partial просрочивается по тому же правилу, что pending: пришла часть ожидаемого,
  // и если плановая дата прошла — это просрочка, а не закрытый месяц.
  const isOpenStatus = row.status === "pending" || row.status === "partial";
  return row.status === "overdue" || (isOpenStatus && row.daysOverdue != null && row.daysOverdue > 0);
}

export function getEffectiveBillingRowStatus(row: BillingMonthStatusRow): BillingMonthStatusRow["status"] | "overdue" {
  if ((row.status === "pending" || row.status === "partial") && row.daysOverdue != null && row.daysOverdue > 0) {
    return "overdue";
  }

  return row.status;
}

function isBillingRowUnpaid(row: BillingMonthStatusRow): boolean {
  return (
    row.status === "pending" ||
    row.status === "manual_review" ||
    row.status === "overdue" ||
    row.status === "partial" ||
    isBillingRowEffectivelyOverdue(row)
  );
}

function getBillingRowSortBucket(row: BillingMonthStatusRow): number {
  if (isBillingRowEffectivelyOverdue(row)) {
    return 0;
  }

  switch (row.status) {
    case "manual_review":
      return 1;
    case "partial":
      return 1;
    case "pending":
      return 2;
    case "paid":
      return 3;
    case "paused":
    case "refunded":
      return 4;
    default:
      return 5;
  }
}

function getBillingRowNameSortKey(row: BillingMonthStatusRow): string {
  return `${row.groupName ?? ""}\0${row.clientName}`.toLocaleLowerCase("ru-RU");
}

function compareBillingMonthStatusRows(left: BillingMonthStatusRow, right: BillingMonthStatusRow): number {
  const bucketDiff = getBillingRowSortBucket(left) - getBillingRowSortBucket(right);
  if (bucketDiff !== 0) {
    return bucketDiff;
  }

  const leftDate = left.plannedPaymentDate?.trim() ?? "";
  const rightDate = right.plannedPaymentDate?.trim() ?? "";
  const leftHasDate = leftDate.length > 0;
  const rightHasDate = rightDate.length > 0;

  if (leftHasDate && rightHasDate && leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }

  if (leftHasDate !== rightHasDate) {
    return leftHasDate ? -1 : 1;
  }

  return getBillingRowNameSortKey(left).localeCompare(getBillingRowNameSortKey(right), "ru-RU");
}

export function sortBillingMonthStatusRows(rows: BillingMonthStatusRow[]): BillingMonthStatusRow[] {
  return [...rows].sort(compareBillingMonthStatusRows);
}

export function filterBillingMonthStatusRows(
  rows: BillingMonthStatusRow[],
  statusFilter: BillingMonthStatusFilter
): BillingMonthStatusRow[] {
  switch (statusFilter) {
    case "all":
      return rows;
    case "unpaid":
      return rows.filter(isBillingRowUnpaid);
    case "overdue":
      return rows.filter(isBillingRowEffectivelyOverdue);
    case "paid":
      return rows.filter((row) => row.status === "paid");
    default:
      return rows.filter(isBillingRowUnpaid);
  }
}

function getBillingMonthFilterCounts(rows: BillingMonthStatusRow[]): AdminBillingMonthOverview["filterCounts"] {
  return {
    all: rows.length,
    unpaid: rows.filter(isBillingRowUnpaid).length,
    overdue: rows.filter(isBillingRowEffectivelyOverdue).length,
    paid: rows.filter((row) => row.status === "paid").length,
  };
}

function normalizeNamePart(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Порог отображения подсказки. Транслитерационное сопоставление имён
// (кириллица клиента ↔ латиница ученика) даёт за фамилию ~45, за полное имя 100.
const BILLING_CLIENT_SUGGESTION_THRESHOLD = 40;

function buildBillingClientSuggestion(
  client: BillingClient,
  student: TrainingPeaksAdminStudentRecord
): BillingClientSuggestion | null {
  const nameMatch = scoreBillingNameMatch(client.clientName, student.studentName);
  let score = nameMatch.score;
  const explanationParts = [...nameMatch.reasons];

  // Небольшой бонус, если группа клиента упоминается в заметках ученика.
  if (client.groupName && student.notes) {
    const normalizedGroup = normalizeNamePart(client.groupName);
    const normalizedNotes = normalizeNamePart(student.notes);
    if (normalizedGroup && normalizedNotes.includes(normalizedGroup)) {
      score += 8;
      explanationParts.push("группа похожа на заметки ученика");
    }
  }

  if (score < BILLING_CLIENT_SUGGESTION_THRESHOLD) {
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

export async function getAdminBillingMonthOverview(
  month?: string,
  statusFilter: BillingMonthStatusFilter = "unpaid"
): Promise<AdminBillingMonthOverview> {
  const billingMonth = month ? resolveBillingMonth(month) : getCurrentBelgradeMonth();
  const [rows, activeClients] = await Promise.all([
    listBillingMonthStatus(billingMonth),
    listActiveBillingClients(),
  ]);
  const sortedRows = sortBillingMonthStatusRows(rows);
  const filterCounts = getBillingMonthFilterCounts(sortedRows);

  return {
    billingMonth,
    total: rows.length,
    paid: rows.filter((row) => row.status === "paid").length,
    pending: rows.filter((row) => row.status === "pending" && !isBillingRowEffectivelyOverdue(row)).length,
    overdue: rows.filter(isBillingRowEffectivelyOverdue).length,
    manualReview: rows.filter((row) => row.status === "manual_review").length,
    paused: rows.filter((row) => row.status === "paused").length,
    unlinkedCount: activeClients.filter((client) => !client.studentId).length,
    statusFilter,
    filterCounts,
    rows: filterBillingMonthStatusRows(sortedRows, statusFilter),
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
  const payerIdentities = await listBillingPayerIdentitiesForClient(client.id);
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
    billingMonth: row.billingMonth,
    plannedPaymentDate: row.plannedPaymentDate,
    actualPaymentDate: row.actualPaymentDate,
    status: row.status,
    paymentMethod: client.paymentMethod,
    notes: row.notes ?? client.notes,
    daysOverdue:
      row.status === "paid" || !row.plannedPaymentDate
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
    payerIdentities,
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

// Большой буст, чтобы знакомый плательщик (по прошлым подтверждённым оплатам)
// всегда оказывался первым в подсказках и проходил порог отображения.
const KNOWN_PAYER_SUGGESTION_BOOST = 1000;

export function buildImportedPaymentSuggestion(
  imported: BillingImportedPayment,
  candidate: BillingMonthlyPaymentWithClient,
  knownPayerClientIds: ReadonlySet<string> = new Set<string>()
): ImportedPaymentSuggestion | null {
  if (!candidate.plannedPaymentDate) {
    return null;
  }

  if (imported.currency !== candidate.currency) {
    return null;
  }

  let score = 0;
  const reasons: string[] = [];
  const isKnownPayer = knownPayerClientIds.has(candidate.client.id);

  if (isKnownPayer) {
    score += KNOWN_PAYER_SUGGESTION_BOOST;
    reasons.push("знакомый плательщик (по прошлым оплатам)");
  }

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

  // Сравнение имени плательщика и клиента с транслитерацией (кириллица ↔ латиница),
  // чтобы платёж «Левина Екатерина» из выписки матчился с клиентом «Levina Ekaterina».
  const payerNameMatch = scoreBillingNameMatch(imported.payerHint, candidate.client.clientName);
  if (payerNameMatch.score >= 100) {
    score += 40;
    reasons.push("совпадение имени плательщика");
  } else if (payerNameMatch.score >= 45) {
    score += 25;
    reasons.push("совпадение по фамилии плательщика");
  } else if (payerNameMatch.score >= 40) {
    score += 15;
    reasons.push("частичное совпадение имени плательщика");
  }

  if (candidate.client.paymentMethod.startsWith("tbank_")) {
    score += 5;
    reasons.push("метод оплаты T-Банк");
  }

  if (!isKnownPayer && score < 25) {
    return null;
  }

  return {
    monthlyPayment: candidate,
    score,
    reasons,
    knownPayer: isKnownPayer,
  };
}

function buildImportedPaymentSuggestions(
  imported: BillingImportedPayment,
  candidates: BillingMonthlyPaymentWithClient[],
  knownPayerClientIds: ReadonlySet<string> = new Set<string>()
): ImportedPaymentSuggestion[] {
  return candidates
    .map((candidate) => buildImportedPaymentSuggestion(imported, candidate, knownPayerClientIds))
    .filter((suggestion): suggestion is ImportedPaymentSuggestion => suggestion !== null)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
}

// Сопоставляет импортированный платёж с уже изученными плательщиками.
// Возвращает id billing-клиентов, за которыми ранее закреплён этот плательщик.
// Read-only: только чтение billing_payer_identities, без записей и без авто-зачёта.
async function resolveKnownPayerClientIdsForImported(
  imported: BillingImportedPayment
): Promise<Set<string>> {
  const derivedIdentities = derivePayerIdentitiesFromImportedPayment(imported);
  if (derivedIdentities.length === 0) {
    return new Set<string>();
  }

  const matchedIdentities = (
    await Promise.all(
      derivedIdentities.map((identity) =>
        listBillingPayerIdentitiesByTypeHash({
          identityType: identity.identityType,
          identityHash: identity.identityHash,
        })
      )
    )
  ).flat();

  return new Set(matchedIdentities.map((identity) => identity.billingClientId));
}

// Подсказки «завести клиента из платежа»: активные ученики БЕЗ billing-клиента,
// чьё имя похоже на плательщика из выписки (транслитерация). Это закрывает кейс,
// когда платёж есть, ученик в базе есть, а billing-клиента для него ещё нет.
const BILLING_STUDENT_SUGGESTION_THRESHOLD = 40;

function buildImportedPaymentStudentSuggestions(
  imported: BillingImportedPayment,
  availableStudents: TrainingPeaksAdminStudentRecord[]
): ImportedPaymentStudentSuggestion[] {
  const payerText = (imported.payerHint ?? imported.description ?? "").trim();
  if (!payerText) {
    return [];
  }
  return availableStudents
    .map((student) => ({
      studentId: student.id,
      studentName: student.studentName,
      studentExternalId: student.studentId,
      score: scoreBillingNameMatch(payerText, student.studentName).score,
    }))
    .filter((suggestion) => suggestion.score >= BILLING_STUDENT_SUGGESTION_THRESHOLD)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
}

export async function getAdminImportedPaymentsOverview(
  statusFilter: BillingImportedPaymentReviewStatusFilter = "new"
): Promise<AdminImportedPaymentsOverview> {
  const [allImported, filteredImported, unsortedCandidates, activeStudents, activeClients] = await Promise.all([
    listBillingImportedPayments(),
    statusFilter === "all" ? listBillingImportedPayments() : listBillingImportedPayments({ status: statusFilter }),
    listUnpaidBillingMonthlyPaymentsWithClients(),
    listTrainingPeaksAdminStudents("active"),
    listActiveBillingClients(),
  ]);

  // Активные ученики, у которых ещё нет billing-клиента (для «завести клиента из платежа»).
  const linkedStudentIds = new Set(
    activeClients.flatMap((client) => (client.studentId ? [client.studentId] : []))
  );
  const availableStudents = activeStudents.filter(
    (student) => student.isActive && !linkedStudentIds.has(student.id)
  );

  // Только активные клиенты как цели для зачёта (ушедшие/на паузе не должны
  // засорять подсказки и ручной список), отсортированы по имени и месяцу.
  const candidates = unsortedCandidates
    .filter((candidate) => candidate.client.isActive)
    .sort((left, right) => {
      const nameDiff = left.client.clientName.localeCompare(right.client.clientName, "ru-RU");
      if (nameDiff !== 0) {
        return nameDiff;
      }
      return left.billingMonth.localeCompare(right.billingMonth);
    });

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

  const rows: ImportedPaymentReviewRow[] = await Promise.all(
    filteredImported.map(async (imported) => {
      const knownPayerClientIds =
        imported.status === "new" ? await resolveKnownPayerClientIdsForImported(imported) : new Set<string>();

      return {
        imported,
        suggestions:
          imported.status === "new"
            ? buildImportedPaymentSuggestions(imported, candidates, knownPayerClientIds)
            : [],
        studentSuggestions:
          imported.status === "new" ? buildImportedPaymentStudentSuggestions(imported, availableStudents) : [],
        matchedMonthlyPayment: imported.matchedMonthlyPaymentId
          ? matchedMonthlyById.get(imported.matchedMonthlyPaymentId) ?? null
          : null,
      };
    })
  );

  return {
    statusFilter,
    counts,
    rows,
    candidates,
  };
}
