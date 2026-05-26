import { readFile } from "node:fs/promises";

import {
  BILLING_CURRENCY_VALUES,
  BILLING_PAYMENT_METHOD_VALUES,
  type BillingCurrency,
  type BillingPaymentMethod,
} from "@/features/billing/types";

const REQUIRED_COLUMNS = [
  "client_name",
  "monthly_amount",
  "currency",
  "planned_payment_day",
  "payment_method",
] as const;

type ParsedBillingClientCsvRow = {
  rowNumber: number;
  clientName: string;
  groupName: string | null;
  monthlyAmount: number;
  currency: BillingCurrency;
  plannedPaymentDay: number;
  paymentMethod: BillingPaymentMethod;
  notes: string | null;
  trainingpeaksStudentId: string | null;
  trainingpeaksStudentName: string | null;
  isActive: boolean;
};

type ParseBillingClientsCsvError = {
  rowNumber: number;
  message: string;
};

type ParseBillingClientsCsvWarning = {
  rowNumber: number;
  message: string;
};

export type ParseBillingClientsCsvResult = {
  rowsRead: number;
  validRows: ParsedBillingClientCsvRow[];
  errors: ParseBillingClientsCsvError[];
  warnings: ParseBillingClientsCsvWarning[];
};

function normalizeCell(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
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

function parseCsvRows(text: string): string[][] {
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  return normalized
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map(splitCsvLine);
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value) {
    return null;
  }

  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parsePlannedPaymentDay(value: string | null): number | null {
  const parsed = parsePositiveInteger(value);
  if (parsed == null) {
    return null;
  }

  return parsed >= 1 && parsed <= 31 ? parsed : null;
}

function parseCurrency(value: string | null): BillingCurrency | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return BILLING_CURRENCY_VALUES.includes(normalized as BillingCurrency)
    ? (normalized as BillingCurrency)
    : null;
}

function isBillingPaymentMethodValue(value: string): value is (typeof BILLING_PAYMENT_METHOD_VALUES)[number] {
  return (BILLING_PAYMENT_METHOD_VALUES as readonly string[]).includes(value);
}

function parsePaymentMethod(value: string | null): BillingPaymentMethod | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return isBillingPaymentMethodValue(normalized) ? normalized : null;
}

function parseBooleanDefaultTrue(value: string | null): boolean | null {
  if (value == null) {
    return true;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }

  if (["1", "true", "yes", "y", "да"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "нет"].includes(normalized)) {
    return false;
  }

  return null;
}

function getCell(row: string[], indexByColumn: Map<string, number>, column: string): string | null {
  const index = indexByColumn.get(column);
  if (index == null) {
    return null;
  }

  return normalizeCell(row[index]);
}

export async function parseBillingClientsCsv(filePath: string): Promise<ParseBillingClientsCsvResult> {
  const text = await readFile(filePath, "utf8");
  const parsedRows = parseCsvRows(text);
  if (parsedRows.length === 0) {
    throw new Error("CSV file is empty.");
  }

  const header = parsedRows[0].map((cell) => cell.trim().toLowerCase());
  const indexByColumn = new Map<string, number>(header.map((name, index) => [name, index]));

  const missingColumns = REQUIRED_COLUMNS.filter((column) => !indexByColumn.has(column));
  if (missingColumns.length > 0) {
    throw new Error(`Missing required columns: ${missingColumns.join(", ")}`);
  }

  const validRows: ParsedBillingClientCsvRow[] = [];
  const errors: ParseBillingClientsCsvError[] = [];
  const warnings: ParseBillingClientsCsvWarning[] = [];

  for (let index = 1; index < parsedRows.length; index += 1) {
    const row = parsedRows[index];
    const rowNumber = index + 1;

    const clientName = getCell(row, indexByColumn, "client_name");
    const groupName = getCell(row, indexByColumn, "group_name");
    const monthlyAmountRaw = getCell(row, indexByColumn, "monthly_amount");
    const currencyRaw = getCell(row, indexByColumn, "currency");
    const plannedPaymentDayRaw = getCell(row, indexByColumn, "planned_payment_day");
    const paymentMethodRaw = getCell(row, indexByColumn, "payment_method");
    const notes = getCell(row, indexByColumn, "notes");
    const trainingpeaksStudentId = getCell(row, indexByColumn, "trainingpeaks_student_id");
    const trainingpeaksStudentName = getCell(row, indexByColumn, "trainingpeaks_student_name");
    const isActiveRaw = getCell(row, indexByColumn, "is_active");

    if (!clientName) {
      errors.push({ rowNumber, message: "client_name is required." });
      continue;
    }

    const monthlyAmount = parsePositiveInteger(monthlyAmountRaw);
    if (monthlyAmount == null) {
      errors.push({ rowNumber, message: "monthly_amount must be a positive integer." });
      continue;
    }

    const currency = parseCurrency(currencyRaw);
    if (currency == null) {
      errors.push({ rowNumber, message: "currency must be one of RUB, EUR, OTHER." });
      continue;
    }

    const plannedPaymentDay = parsePlannedPaymentDay(plannedPaymentDayRaw);
    if (plannedPaymentDay == null) {
      errors.push({ rowNumber, message: "planned_payment_day must be an integer in range 1..31." });
      continue;
    }

    const paymentMethod = parsePaymentMethod(paymentMethodRaw);
    if (paymentMethod == null) {
      errors.push({
        rowNumber,
        message:
          "payment_method must be one of: tbank_link_a, tbank_link_b, tbank_link_c, manual_other, manual_eur.",
      });
      continue;
    }

    if ((currency === "EUR" || currency === "OTHER") && paymentMethod !== "manual_other") {
      warnings.push({
        rowNumber,
        message: "EUR/OTHER rows should normally use payment_method=manual_other.",
      });
    }

    const isActive = parseBooleanDefaultTrue(isActiveRaw);
    if (isActive == null) {
      errors.push({ rowNumber, message: "is_active must be a boolean-like value (true/false, 1/0, yes/no)." });
      continue;
    }

    validRows.push({
      rowNumber,
      clientName,
      groupName,
      monthlyAmount,
      currency,
      plannedPaymentDay,
      paymentMethod,
      notes,
      trainingpeaksStudentId,
      trainingpeaksStudentName,
      isActive,
    });
  }

  return {
    rowsRead: Math.max(0, parsedRows.length - 1),
    validRows,
    errors,
    warnings,
  };
}
