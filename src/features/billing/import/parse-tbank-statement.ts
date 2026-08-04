import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { normalizeBillingPhone } from "@/features/billing/phone";
import type {
  BillingImportedPaymentDataFlags,
  BillingImportedPaymentRawRow,
  ParseTBankStatementResult,
  ParsedBillingImportedPaymentRow,
} from "@/features/billing/types";

const TBANK_CSV_UNSUPPORTED_MESSAGE = "Импорт оплат сейчас поддерживает только CSV-файл Т-Банка.";
const TBANK_DATE_HEADER = "дата операции";
const TBANK_AMOUNT_HEADER = "сумма операции (руб.)";

type HeaderMatch = {
  rowIndex: number;
  orderNumberIndex: number | null;
  operationDateIndex: number;
  operationTimeIndex: number | null;
  amountIndex: number;
  commissionIndex: number | null;
  payoutAmountIndex: number | null;
  operationTypeIndex: number | null;
  paymentIdIndex: number | null;
  authCodeIndex: number | null;
  rrnIndex: number | null;
  terminalNameIndex: number | null;
  dataIndex: number | null;
  descriptionIndex: number | null;
};

function normalizeCell(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function findHeaderIndex(headers: string[], exactHeader: string): number {
  return headers.findIndex((header) => header === exactHeader);
}

function findHeaderIndexByIncludes(headers: string[], fragment: string): number {
  const normalizedFragment = normalizeHeader(fragment);
  return headers.findIndex((header) => header.includes(normalizedFragment));
}

function assertTextCsvBuffer(buffer: Buffer): void {
  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    throw new Error(TBANK_CSV_UNSUPPORTED_MESSAGE);
  }

  if (buffer.includes(0x00)) {
    throw new Error(TBANK_CSV_UNSUPPORTED_MESSAGE);
  }
}

function decodeStatementText(buffer: Buffer): string {
  const utf8Text = buffer.toString("utf8");
  if (utf8Text.includes("Дата операции") && utf8Text.includes("Сумма операции")) {
    return utf8Text;
  }

  try {
    const cp1251Text = new TextDecoder("windows-1251").decode(buffer);
    if (cp1251Text.includes("Дата операции") && cp1251Text.includes("Сумма операции")) {
      return cp1251Text;
    }
  } catch {
    // Fall back to UTF-8 below.
  }

  return utf8Text;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ";" && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function parseStatementLines(text: string): string[][] {
  const normalizedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalizedText
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map(splitCsvLine);
}

function detectHeaderRow(rows: string[][]): HeaderMatch | null {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const headers = rows[rowIndex].map((cell) => normalizeHeader(cell));
    const operationDateIndex = findHeaderIndex(headers, TBANK_DATE_HEADER);
    const amountIndex = findHeaderIndex(headers, TBANK_AMOUNT_HEADER);

    if (operationDateIndex < 0 || amountIndex < 0) {
      continue;
    }

    return {
      rowIndex,
      orderNumberIndex: findHeaderIndexByIncludes(headers, "номер заказа"),
      operationDateIndex,
      operationTimeIndex: findHeaderIndexByIncludes(headers, "время операции"),
      amountIndex,
      commissionIndex: findHeaderIndexByIncludes(headers, "комиссия банка"),
      payoutAmountIndex: findHeaderIndexByIncludes(headers, "к перечислению"),
      operationTypeIndex: findHeaderIndexByIncludes(headers, "тип операции"),
      paymentIdIndex: findHeaderIndex(headers, "payment id"),
      authCodeIndex: findHeaderIndexByIncludes(headers, "код авторизации"),
      rrnIndex: findHeaderIndex(headers, "rrn"),
      terminalNameIndex: findHeaderIndexByIncludes(headers, "название терминала"),
      dataIndex: findHeaderIndex(headers, "data"),
      descriptionIndex: findHeaderIndexByIncludes(headers, "описание"),
    };
  }

  return null;
}

function getCell(row: string[], index: number | null): string | null {
  if (index == null || index < 0 || index >= row.length) {
    return null;
  }

  return normalizeCell(row[index]);
}

function tryExtractDate(input: string | null): string | null {
  if (!input) {
    return null;
  }

  const dmYMatch = input.match(/\b(\d{2})[./-](\d{2})[./-](\d{4})\b/);
  if (dmYMatch) {
    return `${dmYMatch[3]}-${dmYMatch[2]}-${dmYMatch[1]}`;
  }

  const isoMatch = input.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  return null;
}

function parseAmountInteger(input: string | null): { amount: number | null; reason?: string } {
  if (!input) {
    return { amount: null, reason: "amount is empty" };
  }

  const normalized = input.replace(/\s+/g, "").replace(",", ".");
  const match = normalized.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) {
    return { amount: null, reason: "amount is not numeric" };
  }

  const integerPart = Number(match[1]);
  const fractionalPart = match[2] ?? "";

  if (integerPart <= 0) {
    return { amount: null, reason: "amount must be positive" };
  }

  if (fractionalPart.length > 0 && fractionalPart !== "00" && fractionalPart !== "0") {
    return { amount: null, reason: "amount is fractional" };
  }

  return { amount: integerPart };
}

function sanitizeDescription(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return null;
  }

  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function sanitizeTerminalName(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return null;
  }

  if (/^\d+$/.test(normalized)) {
    return normalized;
  }

  if (/^[a-zA-Z0-9 ._-]{1,64}$/.test(normalized)) {
    return normalized;
  }

  return null;
}

function parseDataField(data: string | null): {
  payerHint: string | null;
  payerEmail: string | null;
  payerPhone: string | null;
  dataFlags: BillingImportedPaymentDataFlags;
} {
  const dataFlags: BillingImportedPaymentDataFlags = {
    hasEmail: false,
    hasPhone: false,
    hasName: false,
  };

  if (!data) {
    return { payerHint: null, payerEmail: null, payerPhone: null, dataFlags };
  }

  // Раньше отсюда забирались только булевы флаги, а сами значения выбрасывались —
  // поэтому плательщика нельзя было опознать иначе как по имени, и опечатка в имени
  // расщепляла человека надвое. Теперь значения сохраняются в raw_row и служат
  // точными ключами (identity_type 'phone' / 'email').
  const emailMatch = data.match(/(?:^|\|)Email=([^|]*)/i);
  const phoneMatch = data.match(/(?:^|\|)Phone=([^|]*)/i);
  dataFlags.hasEmail = emailMatch != null;
  dataFlags.hasPhone = phoneMatch != null;

  const payerEmail = normalizeCell(emailMatch?.[1])?.toLowerCase() ?? null;
  const payerPhone = normalizeBillingPhone(normalizeCell(phoneMatch?.[1]));

  const nameMatch = data.match(/(?:^|\|)Name=([^|]+)/i);
  if (!nameMatch) {
    return { payerHint: null, payerEmail, payerPhone, dataFlags };
  }

  const payerHint = normalizeCell(nameMatch[1]);
  if (payerHint) {
    dataFlags.hasName = true;
  }

  return { payerHint, payerEmail, payerPhone, dataFlags };
}

function canonicalizeHashText(value: string | null): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function buildExternalHash(input: {
  paymentId: string | null;
  orderNumber: string | null;
  paymentDate: string;
  amount: number;
  payerHint: string | null;
  description: string | null;
}): string {
  const canonicalParts = [
    "provider:tbank",
    "sourceFormat:tbank_csv",
    input.paymentId ? `paymentId:${input.paymentId}` : null,
    input.orderNumber ? `orderNumber:${input.orderNumber}` : null,
    `operationDate:${input.paymentDate}`,
    `amount:${input.amount}`,
    "currency:RUB",
    `payer_hint:${canonicalizeHashText(input.payerHint)}`,
    `description:${canonicalizeHashText(input.description)}`,
  ].filter((part): part is string => part != null);

  return createHash("sha256").update(canonicalParts.join("|"), "utf8").digest("hex");
}

function isEmptyDataRow(cells: Array<string | null>): boolean {
  return cells.every((cell) => cell == null);
}

export function parseTBankStatementBuffer(buffer: Buffer): ParseTBankStatementResult {
  assertTextCsvBuffer(buffer);

  const text = decodeStatementText(buffer);
  const rows = parseStatementLines(text);
  const warnings: string[] = [];
  const skippedRows: ParseTBankStatementResult["skippedRows"] = [];
  const parsedRows: ParsedBillingImportedPaymentRow[] = [];

  const header = detectHeaderRow(rows);
  if (!header) {
    throw new Error("Unable to detect T-Bank CSV header row with required date and amount columns.");
  }

  if (header.dataIndex == null) {
    warnings.push("DATA column not detected; payer_hint will be empty.");
  }

  if (header.descriptionIndex == null) {
    warnings.push("Description column not detected; description will be empty.");
  }

  for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const rowNumber = rowIndex + 1;

    const orderNumber = getCell(row, header.orderNumberIndex);
    const operationDateRaw = getCell(row, header.operationDateIndex);
    const operationTimeRaw = getCell(row, header.operationTimeIndex);
    const amountRaw = getCell(row, header.amountIndex);
    const commissionRaw = getCell(row, header.commissionIndex);
    const payoutAmountRaw = getCell(row, header.payoutAmountIndex);
    const operationType = getCell(row, header.operationTypeIndex);
    const paymentId = getCell(row, header.paymentIdIndex);
    const authCode = getCell(row, header.authCodeIndex);
    const rrn = getCell(row, header.rrnIndex);
    const terminalName = sanitizeTerminalName(getCell(row, header.terminalNameIndex));
    const dataCell = getCell(row, header.dataIndex);
    const descriptionCell = getCell(row, header.descriptionIndex);

    if (
      isEmptyDataRow([
        orderNumber,
        operationDateRaw,
        operationTimeRaw,
        amountRaw,
        paymentId,
        dataCell,
        descriptionCell,
      ])
    ) {
      continue;
    }

    const parsedDate = tryExtractDate(operationDateRaw);
    if (!parsedDate) {
      skippedRows.push({ rowNumber, reason: "unsupported date format" });
      continue;
    }

    const parsedAmount = parseAmountInteger(amountRaw);
    if (parsedAmount.amount == null) {
      skippedRows.push({ rowNumber, reason: parsedAmount.reason ?? "invalid amount" });
      continue;
    }

    const { payerHint, payerEmail, payerPhone, dataFlags } = parseDataField(dataCell);
    const description = sanitizeDescription(descriptionCell);

    const rawRow: BillingImportedPaymentRawRow = {
      sourceFormat: "tbank_csv",
      rowNumber,
      orderNumber,
      operationDateRaw,
      operationTimeRaw,
      amountRaw,
      commissionRaw,
      payoutAmountRaw,
      operationType,
      paymentId,
      terminalName,
      descriptionRaw: description,
      payerEmail,
      payerPhone,
      dataFlags,
    };

    const externalHash = buildExternalHash({
      paymentId,
      orderNumber,
      paymentDate: parsedDate,
      amount: parsedAmount.amount,
      payerHint,
      description,
    });

    parsedRows.push({
      paymentDate: parsedDate,
      amount: parsedAmount.amount,
      currency: "RUB",
      payerHint,
      description,
      externalHash,
      rawRow,
    });

    if (!paymentId && !orderNumber && !authCode && !rrn) {
      warnings.push(`Row ${rowNumber}: no operation identifier detected.`);
    }
  }

  return {
    provider: "tbank",
    sourceFormat: "tbank_csv",
    parsedRows,
    skippedRows,
    warnings,
  };
}

export async function parseTBankStatement(filePath: string): Promise<ParseTBankStatementResult> {
  const buffer = await readFile(filePath);
  return parseTBankStatementBuffer(buffer);
}
