import { createHash } from "node:crypto";
import readXlsxFile from "read-excel-file/node";

import type {
  BillingCurrency,
  ParseTBankStatementResult,
  ParsedBillingImportedPaymentRow,
} from "@/features/billing/types";

type HeaderMatch = {
  rowIndex: number;
  dateIndex: number;
  amountIndex: number;
  payerIndex: number | null;
  descriptionIndex: number | null;
  currencyIndex: number | null;
  operationIdIndex: number | null;
};

type NormalizedCell = string | null;

const DATE_HEADER_KEYS = ["date", "дата", "операц"];
const AMOUNT_HEADER_KEYS = ["amount", "сумм"];
const PAYER_HEADER_KEYS = ["payer", "плательщик", "контрагент", "отправител"];
const DESCRIPTION_HEADER_KEYS = ["назнач", "описан", "comment", "детал"];
const CURRENCY_HEADER_KEYS = ["currency", "валют"];
const OPERATION_ID_HEADER_KEYS = ["id", "операц", "reference", "номер"];

function normalizeCell(value: unknown): NormalizedCell {
  if (value == null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeHeader(value: string | null): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function includesAny(value: string, keys: string[]): boolean {
  return keys.some((key) => value.includes(key));
}

function tryExtractDate(input: string | null): string | null {
  if (!input) {
    return null;
  }

  const isoMatch = input.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const dmYMatch = input.match(/\b(\d{2})[./-](\d{2})[./-](\d{4})\b/);
  if (dmYMatch) {
    return `${dmYMatch[3]}-${dmYMatch[2]}-${dmYMatch[1]}`;
  }

  return null;
}

function parseCurrency(input: string | null): BillingCurrency {
  const value = (input ?? "").toUpperCase();
  if (value.includes("RUB") || value.includes("RUR") || value.includes("₽")) {
    return "RUB";
  }
  if (value.includes("EUR") || value.includes("€")) {
    return "EUR";
  }
  return "OTHER";
}

function parseAmountInteger(input: string | null): { amount: number | null; reason?: string } {
  if (!input) {
    return { amount: null, reason: "amount is empty" };
  }

  const normalized = input.replace(/\s+/g, "").replace(",", ".");
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) {
    return { amount: null, reason: "amount is not numeric" };
  }

  if (numeric <= 0) {
    return { amount: null, reason: "amount must be positive" };
  }

  if (!Number.isInteger(numeric)) {
    return { amount: null, reason: "amount is fractional" };
  }

  return { amount: numeric };
}

function sanitizeText(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function canonicalizeHashText(value: string | null): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function buildExternalHash(input: {
  paymentDate: string;
  amount: number;
  currency: BillingCurrency;
  payerHint: string | null;
  description: string | null;
  operationReference: string | null;
}): string {
  const canonicalParts = [
    "provider:tbank",
    `payment_date:${input.paymentDate}`,
    `amount:${input.amount}`,
    `currency:${input.currency}`,
    `payer_hint:${canonicalizeHashText(input.payerHint)}`,
    `description:${canonicalizeHashText(input.description)}`,
    `operation_ref:${canonicalizeHashText(input.operationReference)}`,
  ];

  return createHash("sha256").update(canonicalParts.join("|"), "utf8").digest("hex");
}

function detectHeaderRow(rows: NormalizedCell[][]): HeaderMatch | null {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const headers = row.map((cell) => normalizeHeader(cell));

    const dateIndex = headers.findIndex((value) => includesAny(value, DATE_HEADER_KEYS));
    const amountIndex = headers.findIndex((value) => includesAny(value, AMOUNT_HEADER_KEYS));
    if (dateIndex < 0 || amountIndex < 0) {
      continue;
    }

    const payerIndex = headers.findIndex((value) => includesAny(value, PAYER_HEADER_KEYS));
    const descriptionIndex = headers.findIndex((value) => includesAny(value, DESCRIPTION_HEADER_KEYS));
    const currencyIndex = headers.findIndex((value) => includesAny(value, CURRENCY_HEADER_KEYS));
    const operationIdIndex = headers.findIndex((value) => includesAny(value, OPERATION_ID_HEADER_KEYS));

    return {
      rowIndex,
      dateIndex,
      amountIndex,
      payerIndex: payerIndex >= 0 ? payerIndex : null,
      descriptionIndex: descriptionIndex >= 0 ? descriptionIndex : null,
      currencyIndex: currencyIndex >= 0 ? currencyIndex : null,
      operationIdIndex: operationIdIndex >= 0 ? operationIdIndex : null,
    };
  }

  return null;
}

function getCell(row: NormalizedCell[], index: number | null): string | null {
  if (index == null || index < 0 || index >= row.length) {
    return null;
  }

  return row[index];
}

export async function parseTBankStatementXlsx(filePath: string): Promise<ParseTBankStatementResult> {
  const rawRows = (await readXlsxFile(filePath)) as unknown as unknown[][];
  const rows = rawRows.map((row) => row.map(normalizeCell));
  const warnings: string[] = [];
  const skippedRows: ParseTBankStatementResult["skippedRows"] = [];
  const parsedRows: ParsedBillingImportedPaymentRow[] = [];

  const header = detectHeaderRow(rows);
  if (!header) {
    throw new Error("Unable to detect statement header row with required date and amount columns.");
  }

  if (header.payerIndex == null) {
    warnings.push("Payer column not detected; payer_hint will be empty.");
  }

  if (header.descriptionIndex == null) {
    warnings.push("Description column not detected; description will be empty.");
  }

  for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const rowNumber = rowIndex + 1;

    const dateCell = getCell(row, header.dateIndex);
    const amountCell = getCell(row, header.amountIndex);
    const payerCell = getCell(row, header.payerIndex);
    const descriptionCell = getCell(row, header.descriptionIndex);
    const currencyCell = getCell(row, header.currencyIndex);
    const operationIdCell = getCell(row, header.operationIdIndex);

    if (!dateCell && !amountCell && !payerCell && !descriptionCell) {
      continue;
    }

    const parsedDate = tryExtractDate(dateCell);
    if (!parsedDate) {
      skippedRows.push({ rowNumber, reason: "unsupported date format" });
      continue;
    }

    const parsedAmount = parseAmountInteger(amountCell);
    if (parsedAmount.amount == null) {
      skippedRows.push({ rowNumber, reason: parsedAmount.reason ?? "invalid amount" });
      continue;
    }

    const currency = parseCurrency(currencyCell);
    const payerHint = sanitizeText(payerCell);
    const description = sanitizeText(descriptionCell);
    const parseWarnings: string[] = [];

    if (currency === "OTHER") {
      parseWarnings.push("currency not recognized, normalized as OTHER");
    }

    const externalHash = buildExternalHash({
      paymentDate: parsedDate,
      amount: parsedAmount.amount,
      currency,
      payerHint,
      description,
      operationReference: sanitizeText(operationIdCell),
    });

    parsedRows.push({
      paymentDate: parsedDate,
      amount: parsedAmount.amount,
      currency,
      payerHint,
      description,
      externalHash,
      rawRow: {
        rowNumber,
        originalDate: dateCell ?? "",
        originalAmount: amountCell ?? "",
        payerCell: payerCell ?? null,
        descriptionCell: descriptionCell ?? null,
        parseWarnings,
      },
    });
  }

  return {
    provider: "tbank",
    parsedRows,
    skippedRows,
    warnings,
  };
}
