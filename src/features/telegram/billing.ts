import { listActiveBillingClients } from "@/features/billing/repository";
import {
  BILLING_TIME_ZONE,
  type BillingClient,
  type BillingMonthStatusRow,
  type BillingPaymentStatus,
} from "@/features/billing/types";
import {
  buildBillingCsvForMonth,
  listBillingMonthStatus,
  markBillingClientPaid,
  markBillingClientUnpaid,
  resolveBillingMonth,
} from "@/features/billing/service";
import type { ParsedTelegramMessageUpdate } from "@/features/telegram/parser";
import { sendTelegramDocument, sendTelegramMessage } from "@/features/telegram/telegram-client";
import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";

const BILLING_COMMAND_PATTERN = /^\/bill(?:_(?:list|paid|unpaid|export|help))?(?:@\w+)?(?:\s+|$)/i;
const BILLING_MONTH_PATTERN = /^\d{4}-\d{2}$/;
const INTEGER_AMOUNT_PATTERN = /^\d+$/;
const COACH_ONLY_MESSAGE = "⛔ Эта команда доступна только тренеру.";
const BILLING_DISABLED_MESSAGE = "Billing is disabled.";
const TELEGRAM_MESSAGE_LIMIT = 4000;
const MAX_OVERDUE_PREVIEW_ROWS = 8;
const MAX_AMBIGUITY_MATCHES = 10;

type BillingListFilter = "pending" | "paid" | "overdue" | "manual_review" | "all";
type BillingCommandName =
  | "/bill"
  | "/bill_list"
  | "/bill_paid"
  | "/bill_unpaid"
  | "/bill_export"
  | "/bill_help";

type ParsedBillingCommand = {
  command: BillingCommandName;
  argsText: string;
};

type BillingClientMatchResult =
  | {
      kind: "none";
    }
  | {
      kind: "single";
      client: BillingClient;
    }
  | {
      kind: "multiple";
      matches: BillingClient[];
    };

function isBillingEnabled(): boolean {
  const value = process.env.BILLING_ENABLED?.trim().toLowerCase();
  return value === "1" || value === "true";
}

function isCoachChat(chatId: number | string): boolean {
  return new Set(getTrainingPeaksCoachChatIds()).has(String(chatId));
}

function splitTelegramMessage(text: string): string[] {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return [];
  }

  if (normalizedText.length <= TELEGRAM_MESSAGE_LIMIT) {
    return [normalizedText];
  }

  const chunks: string[] = [];
  let rest = normalizedText;

  while (rest.length > 0) {
    if (rest.length <= TELEGRAM_MESSAGE_LIMIT) {
      chunks.push(rest);
      break;
    }

    let boundary = rest.lastIndexOf("\n\n", TELEGRAM_MESSAGE_LIMIT);
    if (boundary < Math.floor(TELEGRAM_MESSAGE_LIMIT * 0.5)) {
      boundary = rest.lastIndexOf("\n", TELEGRAM_MESSAGE_LIMIT);
    }
    if (boundary < Math.floor(TELEGRAM_MESSAGE_LIMIT * 0.5)) {
      boundary = rest.lastIndexOf(" ", TELEGRAM_MESSAGE_LIMIT);
    }
    if (boundary <= 0) {
      boundary = TELEGRAM_MESSAGE_LIMIT;
    }

    chunks.push(rest.slice(0, boundary).trimEnd());
    rest = rest.slice(boundary).trimStart();
  }

  return chunks.filter(Boolean);
}

async function sendBillingMessage(chatId: number | string, text: string): Promise<void> {
  const chunks = splitTelegramMessage(text);
  for (const chunk of chunks) {
    await sendTelegramMessage(chatId, chunk);
  }
}

function getTelegramCommandParts(text: string): ParsedBillingCommand | null {
  const match = text.trim().match(/^\/([a-z_]+)(?:@\w+)?(?:\s+(.*))?$/i);
  if (!match) {
    return null;
  }

  const command = `/${match[1].toLowerCase()}` as BillingCommandName;
  if (
    command !== "/bill" &&
    command !== "/bill_list" &&
    command !== "/bill_paid" &&
    command !== "/bill_unpaid" &&
    command !== "/bill_export" &&
    command !== "/bill_help"
  ) {
    return null;
  }

  return {
    command,
    argsText: match[2]?.trim() ?? "",
  };
}

function parseBillingMonthToken(token: string | undefined): string | null {
  if (!token) {
    return null;
  }

  return BILLING_MONTH_PATTERN.test(token.trim()) ? token.trim() : null;
}

function getEffectiveBillingStatus(row: BillingMonthStatusRow): BillingPaymentStatus | "overdue" {
  if (row.status === "pending" && row.daysOverdue != null && row.daysOverdue > 0) {
    return "overdue";
  }

  return row.status;
}

function getBillingStatusLabel(status: BillingPaymentStatus | "overdue"): string {
  switch (status) {
    case "paid":
      return "Оплачено";
    case "pending":
      return "Ожидают";
    case "overdue":
      return "Просрочено";
    case "manual_review":
      return "Проверить вручную";
    case "paused":
      return "Пауза";
    case "refunded":
      return "Возврат";
    default:
      return status;
  }
}

function getBillListTitle(filter: BillingListFilter, billingMonth: string): string {
  if (filter === "all") {
    return `Список оплат · ${formatMonthLabel(billingMonth)}`;
  }

  return `${getBillingStatusLabel(filter)} · ${formatMonthLabel(billingMonth)}`;
}

function formatMonthLabel(billingMonth: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: BILLING_TIME_ZONE,
    month: "long",
    year: "numeric",
  }).format(new Date(`${billingMonth}T12:00:00.000Z`));
}

function formatShortDate(isoDate: string | null): string {
  if (!isoDate) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: BILLING_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(`${isoDate}T12:00:00.000Z`));
}

function formatLongDate(isoDate: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: BILLING_TIME_ZONE,
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(`${isoDate}T12:00:00.000Z`));
}

function formatMoney(amount: number, currency: string): string {
  return `${new Intl.NumberFormat("ru-RU").format(amount)} ${currency}`;
}

function getBillingHelpFooter(): string {
  return [
    "Команды:",
    "/bill_list",
    "/bill_paid <name_or_id> [amount]",
    "/bill_export",
  ].join("\n");
}

function getBillingHelpText(): string {
  return [
    getBillingHelpFooter(),
    "",
    "Дополнительно:",
    "/bill_unpaid <name_or_id> [YYYY-MM]",
    "/bill_help",
  ].join("\n");
}

function buildClientMatchLabel(client: BillingClient): string {
  const parts = [`${client.clientName}`, `id ${client.id.slice(0, 8)}`];
  if (client.groupName) {
    parts.push(client.groupName);
  }
  if (client.studentId) {
    parts.push(`student ${client.studentId}`);
  }
  return parts.join(" · ");
}

function sortClientsForMatch(clients: BillingClient[]): BillingClient[] {
  return [...clients].sort((left, right) => {
    const groupCompare = (left.groupName ?? "").localeCompare(right.groupName ?? "", "ru");
    if (groupCompare !== 0) {
      return groupCompare;
    }

    return left.clientName.localeCompare(right.clientName, "ru");
  });
}

async function resolveBillingClientMatch(query: string): Promise<BillingClientMatchResult> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return { kind: "none" };
  }

  const normalizedQueryLower = normalizedQuery.toLowerCase();
  const clients = sortClientsForMatch(await listActiveBillingClients());

  const byIdPrefix = clients.filter((client) => client.id.toLowerCase().startsWith(normalizedQueryLower));
  if (byIdPrefix.length === 1) {
    return { kind: "single", client: byIdPrefix[0] };
  }
  if (byIdPrefix.length > 1) {
    return { kind: "multiple", matches: byIdPrefix };
  }

  const byExactName = clients.filter((client) => client.clientName === normalizedQuery);
  if (byExactName.length === 1) {
    return { kind: "single", client: byExactName[0] };
  }
  if (byExactName.length > 1) {
    return { kind: "multiple", matches: byExactName };
  }

  const byPartialName = clients.filter((client) =>
    client.clientName.toLowerCase().includes(normalizedQueryLower)
  );
  if (byPartialName.length === 1) {
    return { kind: "single", client: byPartialName[0] };
  }
  if (byPartialName.length > 1) {
    return { kind: "multiple", matches: byPartialName };
  }

  const byStudentSlug = clients.filter((client) => {
    const studentId = client.studentId?.toLowerCase();
    return Boolean(studentId && studentId.includes(normalizedQueryLower));
  });
  if (byStudentSlug.length === 1) {
    return { kind: "single", client: byStudentSlug[0] };
  }
  if (byStudentSlug.length > 1) {
    return { kind: "multiple", matches: byStudentSlug };
  }

  return { kind: "none" };
}

function parseBillListArgs(argsText: string, now = new Date()): {
  filter: BillingListFilter;
  billingMonth: string;
} {
  const tokens = argsText.split(/\s+/).filter(Boolean);
  const defaultBillingMonth = resolveBillingMonth(now);
  let filter: BillingListFilter = "pending";
  let billingMonth = defaultBillingMonth;

  if (tokens.length === 0) {
    return { filter, billingMonth };
  }

  const [firstToken, secondToken] = tokens;
  const normalizedFirst = firstToken.toLowerCase();

  if (
    normalizedFirst === "pending" ||
    normalizedFirst === "paid" ||
    normalizedFirst === "overdue" ||
    normalizedFirst === "manual_review" ||
    normalizedFirst === "all"
  ) {
    filter = normalizedFirst;
    const explicitMonth = parseBillingMonthToken(secondToken);
    if (explicitMonth) {
      billingMonth = resolveBillingMonth(explicitMonth);
    }
    return { filter, billingMonth };
  }

  const explicitMonth = parseBillingMonthToken(firstToken);
  if (explicitMonth) {
    billingMonth = resolveBillingMonth(explicitMonth);
  }

  return { filter, billingMonth };
}

function parseBillPaidArgs(argsText: string, now = new Date()): {
  query: string;
  billingMonth: string;
  amount: number | null;
} {
  const tokens = argsText.split(/\s+/).filter(Boolean);
  let billingMonth = resolveBillingMonth(now);
  let amount: number | null = null;

  if (tokens.length === 0) {
    return { query: "", billingMonth, amount };
  }

  const maybeMonth = parseBillingMonthToken(tokens[tokens.length - 1]);
  if (maybeMonth) {
    billingMonth = resolveBillingMonth(maybeMonth);
    tokens.pop();
  }

  const maybeAmount = tokens[tokens.length - 1];
  if (maybeAmount && INTEGER_AMOUNT_PATTERN.test(maybeAmount)) {
    amount = Number.parseInt(maybeAmount, 10);
    tokens.pop();
  }

  return {
    query: tokens.join(" ").trim(),
    billingMonth,
    amount,
  };
}

function parseBillUnpaidArgs(argsText: string, now = new Date()): {
  query: string;
  billingMonth: string;
} {
  const tokens = argsText.split(/\s+/).filter(Boolean);
  let billingMonth = resolveBillingMonth(now);

  if (tokens.length === 0) {
    return { query: "", billingMonth };
  }

  const maybeMonth = parseBillingMonthToken(tokens[tokens.length - 1]);
  if (maybeMonth) {
    billingMonth = resolveBillingMonth(maybeMonth);
    tokens.pop();
  }

  return {
    query: tokens.join(" ").trim(),
    billingMonth,
  };
}

function parseBillExportArgs(argsText: string, now = new Date()): { billingMonth: string } {
  const maybeMonth = parseBillingMonthToken(argsText.split(/\s+/).filter(Boolean)[0]);
  return {
    billingMonth: resolveBillingMonth(maybeMonth ?? now),
  };
}

function buildAmbiguousMatchMessage(matches: BillingClient[]): string {
  const preview = matches.slice(0, MAX_AMBIGUITY_MATCHES).map((client) => `- ${buildClientMatchLabel(client)}`);
  const remainingCount = Math.max(matches.length - preview.length, 0);

  return [
    "Найдено несколько клиентов. Уточни имя или id.",
    "",
    ...preview,
    ...(remainingCount > 0 ? [`... и ещё ${remainingCount}`] : []),
  ].join("\n");
}

function buildMissingClientMessage(query: string): string {
  return query
    ? `Клиент не найден: ${query}`
    : "Укажи клиента: /bill_paid <name_or_id> [amount] [YYYY-MM]";
}

function buildSummaryMessage(billingMonth: string, rows: BillingMonthStatusRow[]): string {
  const counts = {
    paid: 0,
    pending: 0,
    overdue: 0,
    manual_review: 0,
    refunded: 0,
    paused: 0,
  };

  for (const row of rows) {
    const status = getEffectiveBillingStatus(row);
    if (status === "paid") {
      counts.paid += 1;
      continue;
    }
    if (status === "pending") {
      counts.pending += 1;
      continue;
    }
    if (status === "overdue") {
      counts.overdue += 1;
      continue;
    }
    if (status === "manual_review") {
      counts.manual_review += 1;
      continue;
    }
    if (status === "refunded") {
      counts.refunded += 1;
      continue;
    }
    if (status === "paused") {
      counts.paused += 1;
    }
  }

  const overdueRows = rows
    .filter((row) => getEffectiveBillingStatus(row) === "overdue")
    .sort((left, right) => (right.daysOverdue ?? 0) - (left.daysOverdue ?? 0));

  const lines = [
    `Биллинг за ${formatMonthLabel(billingMonth)}`,
    `Оплачено: ${counts.paid}`,
    `Ожидают: ${counts.pending}`,
    `Просрочено: ${counts.overdue}`,
    `Проверить вручную: ${counts.manual_review}`,
  ];

  const refundedOrPausedCount = counts.refunded + counts.paused;
  if (refundedOrPausedCount > 0) {
    lines.push(`Возврат/пауза: ${refundedOrPausedCount}`);
  }

  if (overdueRows.length > 0) {
    lines.push("");
    lines.push("Просрочено:");
    for (const row of overdueRows.slice(0, MAX_OVERDUE_PREVIEW_ROWS)) {
      const overdueDays = row.daysOverdue ?? 0;
      lines.push(`- ${row.clientName} · ${overdueDays} дн. · до ${formatShortDate(row.plannedPaymentDate)}`);
    }
    if (overdueRows.length > MAX_OVERDUE_PREVIEW_ROWS) {
      lines.push(`... и ещё ${overdueRows.length - MAX_OVERDUE_PREVIEW_ROWS}`);
    }
  }

  lines.push("");
  lines.push(getBillingHelpFooter());

  return lines.join("\n");
}

function buildBillListMessage(
  filter: BillingListFilter,
  billingMonth: string,
  rows: BillingMonthStatusRow[]
): string {
  const filteredRows =
    filter === "all" ? rows : rows.filter((row) => getEffectiveBillingStatus(row) === filter);

  if (filteredRows.length === 0) {
    return [
      getBillListTitle(filter, billingMonth),
      "",
      "Ничего не найдено.",
    ].join("\n");
  }

  const title = getBillListTitle(filter, billingMonth);

  const lines = [title, `Всего: ${filteredRows.length}`, ""];

  for (const row of filteredRows) {
    const group = row.groupName?.trim() || "Без группы";
    const amount = formatMoney(row.plannedAmount, row.currency);
    const status = getBillingStatusLabel(getEffectiveBillingStatus(row));
    lines.push(
      `${group} · ${row.clientName} · ${formatShortDate(row.plannedPaymentDate)} · ${amount} · ${status}`
    );
  }

  return lines.join("\n");
}

function getActor(parsedMessage: ParsedTelegramMessageUpdate): string {
  return parsedMessage.username
    ? `telegram:${parsedMessage.username}`
    : `telegram:${parsedMessage.userId ?? parsedMessage.chatId}`;
}

async function handleBillSummary(parsedMessage: ParsedTelegramMessageUpdate): Promise<void> {
  const billingMonth = resolveBillingMonth(new Date());
  const rows = await listBillingMonthStatus(billingMonth);
  await sendBillingMessage(parsedMessage.chatId, buildSummaryMessage(billingMonth, rows));
}

async function handleBillList(parsedMessage: ParsedTelegramMessageUpdate, argsText: string): Promise<void> {
  const { filter, billingMonth } = parseBillListArgs(argsText);
  const rows = await listBillingMonthStatus(billingMonth);
  await sendBillingMessage(parsedMessage.chatId, buildBillListMessage(filter, billingMonth, rows));
}

async function handleBillPaid(parsedMessage: ParsedTelegramMessageUpdate, argsText: string): Promise<void> {
  const { query, billingMonth, amount } = parseBillPaidArgs(argsText);
  const match = await resolveBillingClientMatch(query);

  if (match.kind === "none") {
    await sendBillingMessage(parsedMessage.chatId, buildMissingClientMessage(query));
    return;
  }

  if (match.kind === "multiple") {
    await sendBillingMessage(parsedMessage.chatId, buildAmbiguousMatchMessage(match.matches));
    return;
  }

  const result = await markBillingClientPaid({
    billingClientId: match.client.id,
    month: billingMonth,
    paidAmount: amount,
    actor: getActor(parsedMessage),
  });

  const amountText = formatMoney(result.payment.paidAmount ?? result.payment.plannedAmount, result.payment.currency);
  const monthText = formatMonthLabel(result.payment.billingMonth);

  if (result.kind === "already_paid") {
    const paidDateText = result.payment.actualPaymentDate ? formatLongDate(result.payment.actualPaymentDate) : "дата не указана";
    await sendBillingMessage(
      parsedMessage.chatId,
      `Оплата уже отмечена: ${match.client.clientName} — ${monthText} — ${amountText}. Дата: ${paidDateText}.`
    );
    return;
  }

  await sendBillingMessage(
    parsedMessage.chatId,
    `✅ Оплата отмечена: ${match.client.clientName} — ${monthText} — ${amountText}.`
  );
}

async function handleBillUnpaid(parsedMessage: ParsedTelegramMessageUpdate, argsText: string): Promise<void> {
  const { query, billingMonth } = parseBillUnpaidArgs(argsText);
  const match = await resolveBillingClientMatch(query);

  if (match.kind === "none") {
    await sendBillingMessage(parsedMessage.chatId, buildMissingClientMessage(query));
    return;
  }

  if (match.kind === "multiple") {
    await sendBillingMessage(parsedMessage.chatId, buildAmbiguousMatchMessage(match.matches));
    return;
  }

  const payment = await markBillingClientUnpaid({
    billingClientId: match.client.id,
    month: billingMonth,
    actor: getActor(parsedMessage),
  });

  await sendBillingMessage(
    parsedMessage.chatId,
    `↩️ Оплата возвращена в ожидание: ${match.client.clientName} — ${formatMonthLabel(payment.billingMonth)}.`
  );
}

async function handleBillExport(parsedMessage: ParsedTelegramMessageUpdate, argsText: string): Promise<void> {
  const { billingMonth } = parseBillExportArgs(argsText);
  const csv = await buildBillingCsvForMonth(billingMonth);
  const monthCode = csv.billingMonth.slice(0, 7);

  await sendTelegramDocument(parsedMessage.chatId, csv.content, {
    filename: `billing-${monthCode}.csv`,
    contentType: "text/csv;charset=utf-8",
    caption: `Экспорт биллинга за ${formatMonthLabel(csv.billingMonth)}. Строк: ${csv.rowCount}.`,
  });
}

export function isBillingCommand(text: string): boolean {
  return BILLING_COMMAND_PATTERN.test(text.trim());
}

export async function handleBillingTelegramCommand(
  parsedMessage: ParsedTelegramMessageUpdate,
  messageText: string
): Promise<void> {
  if (!isCoachChat(parsedMessage.chatId)) {
    await sendBillingMessage(parsedMessage.chatId, COACH_ONLY_MESSAGE);
    return;
  }

  if (!isBillingEnabled()) {
    await sendBillingMessage(parsedMessage.chatId, BILLING_DISABLED_MESSAGE);
    return;
  }

  const command = getTelegramCommandParts(messageText);
  if (!command) {
    return;
  }

  try {
    if (command.command === "/bill") {
      await handleBillSummary(parsedMessage);
      return;
    }

    if (command.command === "/bill_list") {
      await handleBillList(parsedMessage, command.argsText);
      return;
    }

    if (command.command === "/bill_paid") {
      await handleBillPaid(parsedMessage, command.argsText);
      return;
    }

    if (command.command === "/bill_unpaid") {
      await handleBillUnpaid(parsedMessage, command.argsText);
      return;
    }

    if (command.command === "/bill_export") {
      await handleBillExport(parsedMessage, command.argsText);
      return;
    }

    await sendBillingMessage(parsedMessage.chatId, getBillingHelpText());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка";
    await sendBillingMessage(parsedMessage.chatId, `Не удалось обработать billing-команду: ${message}`);
  }
}
