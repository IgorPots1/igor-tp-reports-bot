export type CsvDelimiter = "," | ";" | "\t";

export type RawCsvRecord = Record<string, string>;

export type ParsedBillingClientsCsv = {
  mode: "normalized" | "raw";
  delimiter: CsvDelimiter;
  records: RawCsvRecord[];
};

const RUSSIAN_MONTH_LABELS = new Set([
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
]);

const HEADER_LABELS = new Set([
  "дата оплаты",
  "дата",
  "сумма",
  "имя",
  "клиент",
  "клиенты",
  "name",
  "amount",
  "monthly_amount",
  "payment_day",
  "planned_payment_day",
]);

const NAME_COLUMN_ALIASES = ["name", "client_name", "student_name", "billing_name"];
const AMOUNT_COLUMN_ALIASES = ["monthly_amount", "amount", "price"];

export function parseBillingClientsCsv(content: string): ParsedBillingClientsCsv {
  const normalizedContent = content.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(normalizedContent);

  if (isNormalizedCsv(normalizedContent, delimiter)) {
    return {
      mode: "normalized",
      delimiter,
      records: parseNormalizedCsv(normalizedContent, delimiter),
    };
  }

  return {
    mode: "raw",
    delimiter,
    records: parseRawCoachSpreadsheet(normalizedContent, delimiter),
  };
}

function detectDelimiter(content: string): CsvDelimiter {
  const sampleLines = content
    .split(/\n/)
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim().length > 0)
    .slice(0, 25);

  if (sampleLines.length === 0) {
    return ",";
  }

  const candidates: CsvDelimiter[] = [",", ";", "\t"];
  let bestDelimiter: CsvDelimiter = ",";
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const columnCounts = sampleLines.map((line) => parseCsvLine(line, candidate).length);
    const maxColumns = Math.max(...columnCounts);
    if (maxColumns <= 1) {
      continue;
    }

    const multiColumnRows = columnCounts.filter((count) => count >= 2).length;
    const averageColumns =
      columnCounts.reduce((sum, count) => sum + count, 0) / Math.max(columnCounts.length, 1);
    const score = multiColumnRows * 10 + averageColumns;

    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = candidate;
    }
  }

  return bestDelimiter;
}

function isNormalizedCsv(content: string, delimiter: CsvDelimiter): boolean {
  const firstLine = content
    .split(/\n/)
    .map((line) => line.replace(/\r$/, ""))
    .find((line) => line.trim().length > 0);

  if (!firstLine) {
    return false;
  }

  const headerCells = parseCsvLine(firstLine, delimiter).map(normalizeHeader);
  const hasNameColumn = NAME_COLUMN_ALIASES.some((alias) => headerCells.includes(normalizeHeader(alias)));
  const hasAmountColumn = AMOUNT_COLUMN_ALIASES.some((alias) => headerCells.includes(normalizeHeader(alias)));

  return hasNameColumn && hasAmountColumn;
}

function parseNormalizedCsv(content: string, delimiter: CsvDelimiter): RawCsvRecord[] {
  const lines = content
    .split(/\n/)
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    throw new Error("CSV file is empty.");
  }

  const headerCells = parseCsvLine(lines[0], delimiter).map(normalizeHeader);
  if (headerCells.length === 0) {
    throw new Error("CSV header row is empty.");
  }

  return lines.slice(1).map((line, index) => {
    const valueCells = parseCsvLine(line, delimiter);
    const record: RawCsvRecord = {};

    headerCells.forEach((header, headerIndex) => {
      record[header] = valueCells[headerIndex] ?? "";
    });

    if (valueCells.length > headerCells.length) {
      for (let extraIndex = headerCells.length; extraIndex < valueCells.length; extraIndex += 1) {
        record[`__extra_${extraIndex}`] = valueCells[extraIndex] ?? "";
      }
    }

    record.__row_number = String(index + 2);
    return record;
  });
}

function parseRawCoachSpreadsheet(content: string, delimiter: CsvDelimiter): RawCsvRecord[] {
  const rawLines = content.split(/\n/).map((line) => line.replace(/\r$/, ""));
  const matrix: Array<{ lineNumber: number; cells: string[] }> = [];

  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex += 1) {
    const cells = parseCsvLine(rawLines[lineIndex], delimiter);
    if (!cells.some((cell) => cell.trim().length > 0)) {
      continue;
    }

    matrix.push({
      lineNumber: lineIndex + 1,
      cells,
    });
  }

  if (matrix.length === 0) {
    throw new Error("CSV file is empty.");
  }

  const columnCount = Math.max(...matrix.map((row) => row.cells.length));
  const normalizedMatrix = matrix.map((row) => {
    const padded = [...row.cells];
    while (padded.length < columnCount) {
      padded.push("");
    }

    return {
      lineNumber: row.lineNumber,
      cells: padded,
    };
  });

  const nonEmptyColumnIndexes = Array.from({ length: columnCount }, (_, columnIndex) => columnIndex).filter(
    (columnIndex) => normalizedMatrix.some((row) => row.cells[columnIndex]?.trim())
  );

  const trimmedMatrix = normalizedMatrix.map((row) => ({
    lineNumber: row.lineNumber,
    cells: nonEmptyColumnIndexes.map((columnIndex) => row.cells[columnIndex] ?? ""),
  }));

  const records: RawCsvRecord[] = [];

  for (const row of trimmedMatrix) {
    const cells = row.cells.map((cell) => cell.trim());
    if (cells.every((cell) => cell.length === 0)) {
      continue;
    }

    if (cells.every((cell) => isIgnoredLabel(cell))) {
      continue;
    }

    const extracted = extractRawRow(cells);
    if (!extracted) {
      continue;
    }

    records.push({
      name: extracted.clientName,
      monthly_amount: String(extracted.monthlyAmount),
      planned_payment_day: extracted.plannedPaymentDay == null ? "" : String(extracted.plannedPaymentDay),
      __row_number: String(row.lineNumber),
    });
  }

  if (records.length === 0) {
    throw new Error("No client rows detected in raw spreadsheet CSV.");
  }

  return records;
}

function extractRawRow(cells: string[]): {
  clientName: string;
  monthlyAmount: number;
  plannedPaymentDay: number | null;
} | null {
  const amountIndex = cells.findIndex((cell) => parseAmount(cell) != null);
  if (amountIndex < 0) {
    return null;
  }

  const monthlyAmount = parseAmount(cells[amountIndex]);
  if (monthlyAmount == null) {
    return null;
  }

  const nameCell = cells.slice(0, amountIndex).find((cell) => isMeaningfulNameCell(cell));
  if (!nameCell) {
    return null;
  }

  const paymentDayCell = cells.slice(amountIndex + 1).find((cell) => cell.trim().length > 0);
  const plannedPaymentDay = paymentDayCell ? parsePaymentDayCell(paymentDayCell) : null;

  return {
    clientName: nameCell.trim(),
    monthlyAmount,
    plannedPaymentDay,
  };
}

export function parseAmount(rawValue: string): number | null {
  const normalized = rawValue
    .trim()
    .replace(/\u00A0/g, " ")
    .replace(/[₽руб\.]/gi, "")
    .replace(/\s+/g, "");

  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export function parsePaymentDayCell(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const dottedDateMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (dottedDateMatch) {
    return Number.parseInt(dottedDateMatch[1], 10);
  }

  const isoDateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateMatch) {
    return Number.parseInt(isoDateMatch[3], 10);
  }

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  return Number.parseInt(trimmed, 10);
}

function isMeaningfulNameCell(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (isIgnoredLabel(trimmed)) {
    return false;
  }

  if (parseAmount(trimmed) != null) {
    return false;
  }

  if (parsePaymentDayCell(trimmed) != null && /^\d+$/.test(trimmed)) {
    return false;
  }

  return true;
}

function isIgnoredLabel(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) {
    return true;
  }

  if (RUSSIAN_MONTH_LABELS.has(normalized)) {
    return true;
  }

  if (HEADER_LABELS.has(normalized)) {
    return true;
  }

  return false;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function parseCsvLine(line: string, delimiter: CsvDelimiter): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (inQuotes) {
    throw new Error("Unclosed quoted field in CSV.");
  }

  cells.push(current);
  return cells.map((cell) => cell.replace(/\r/g, ""));
}
