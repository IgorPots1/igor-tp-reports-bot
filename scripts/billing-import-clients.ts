import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { loadEnvConfig } from "@next/env";

import {
  parseAmount,
  parseBillingClientsCsv,
  parsePaymentDayCell,
} from "@/features/billing/import/parse-billing-clients-csv";
import { createSupabaseServerClient } from "@/features/supabase/server";
import type { BillingCurrency, BillingPaymentMethod } from "@/features/billing/types";

const IMPORT_ACTOR = "billing_import_clients";
const DEFAULT_PAYMENT_DAY = 10;
const VALID_CURRENCIES = new Set<BillingCurrency>(["RUB", "EUR", "OTHER"]);
const VALID_PAYMENT_METHODS = new Set<BillingPaymentMethod>([
  "tbank_link_a",
  "tbank_link_b",
  "tbank_link_c",
  "manual_eur",
  "manual_other",
]);

const COLUMN_ALIASES = {
  name: ["name", "client_name", "student_name", "billing_name"],
  groupName: ["group", "group_name"],
  monthlyAmount: ["monthly_amount", "amount", "price"],
  plannedPaymentDay: ["planned_payment_day", "payment_day", "day"],
  paymentMethod: ["payment_method", "method"],
  currency: ["currency"],
  notes: ["notes"],
  studentSlug: ["student_id", "trainingpeaks_student_id", "tp_student_id", "slug"],
} as const;

type CliOptions = {
  filePath: string;
  dryRun: boolean;
  allowUnlinked: boolean;
  strictLinks: boolean;
  tariffAAmount: number | null;
  tariffBAmount: number | null;
  tariffCAmount: number | null;
  defaultPaymentDay: number;
};

type ParsedRow = {
  rowNumber: number;
  groupName: string | null;
  clientName: string;
  monthlyAmount: number;
  currency: BillingCurrency;
  plannedPaymentDay: number;
  paymentMethod: BillingPaymentMethod;
  notes: string | null;
  studentSlug: string | null;
};

type RowWarning = {
  rowNumber: number;
  message: string;
};

type RowError = {
  rowNumber: number;
  message: string;
};

type StudentLookupRow = {
  id: string;
  student_id: string;
};

type BillingClientLookupRow = {
  id: string;
  student_id: string | null;
  client_name: string;
  monthly_amount: number;
  currency: BillingCurrency;
};

type ImportPlanRow = ParsedRow & {
  resolvedStudentId: string | null;
  action: "insert" | "update";
  existingBillingClientId: string | null;
};

function printUsage(): void {
  console.log("Usage:");
  console.log(
    "  npm run billing:import-clients -- <csv-file> [--dry-run] [--apply] [--allow-unlinked] [--strict-links] [--tariff-a-amount 4000] [--tariff-b-amount 5000] [--tariff-c-amount 6000] [--default-payment-day 10]"
  );
}

function parsePositiveInteger(value: string, flagName: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`${flagName} must be a positive integer.`);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer.`);
  }

  return parsed;
}

function parsePaymentDay(value: string, context: string): number {
  const parsed = parsePositiveInteger(value, context);
  if (parsed < 1 || parsed > 31) {
    throw new Error(`${context} must be between 1 and 31.`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  let filePath: string | null = null;
  let dryRun = true;
  let allowUnlinked = true;
  let strictLinks = false;
  let tariffAAmount: number | null = null;
  let tariffBAmount: number | null = null;
  let tariffCAmount: number | null = null;
  let defaultPaymentDay = DEFAULT_PAYMENT_DAY;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (!arg.startsWith("--")) {
      if (filePath) {
        throw new Error(`Unexpected extra positional argument: ${arg}`);
      }
      filePath = arg;
      continue;
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--apply") {
      dryRun = false;
      continue;
    }

    if (arg === "--allow-unlinked") {
      allowUnlinked = true;
      continue;
    }

    if (arg === "--strict-links") {
      strictLinks = true;
      continue;
    }

    if (arg === "--help") {
      printUsage();
      process.exit(0);
    }

    const nextValue = argv[index + 1];

    if (arg === "--tariff-a-amount") {
      if (!nextValue) {
        throw new Error("Missing value for --tariff-a-amount.");
      }
      tariffAAmount = parsePositiveInteger(nextValue, "--tariff-a-amount");
      index += 1;
      continue;
    }

    if (arg === "--tariff-b-amount") {
      if (!nextValue) {
        throw new Error("Missing value for --tariff-b-amount.");
      }
      tariffBAmount = parsePositiveInteger(nextValue, "--tariff-b-amount");
      index += 1;
      continue;
    }

    if (arg === "--tariff-c-amount") {
      if (!nextValue) {
        throw new Error("Missing value for --tariff-c-amount.");
      }
      tariffCAmount = parsePositiveInteger(nextValue, "--tariff-c-amount");
      index += 1;
      continue;
    }

    if (arg === "--default-payment-day") {
      if (!nextValue) {
        throw new Error("Missing value for --default-payment-day.");
      }
      defaultPaymentDay = parsePaymentDay(nextValue, "--default-payment-day");
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!filePath) {
    throw new Error("Missing CSV file path.");
  }

  if (strictLinks) {
    allowUnlinked = false;
  }

  return {
    filePath,
    dryRun,
    allowUnlinked,
    strictLinks,
    tariffAAmount,
    tariffBAmount,
    tariffCAmount,
    defaultPaymentDay,
  };
}

function getEnvValue(name: "SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function normalizeCell(value: string | undefined): string {
  return (value ?? "").trim();
}

function getAliasValue(record: Record<string, string>, aliases: readonly string[]): string {
  for (const alias of aliases) {
    const value = record[normalizeHeader(alias)];
    if (value != null && value.trim() !== "") {
      return value.trim();
    }
  }

  return "";
}

function inferPaymentMethod(input: {
  currency: BillingCurrency;
  monthlyAmount: number;
  explicitPaymentMethod: string;
  tariffAAmount: number | null;
  tariffBAmount: number | null;
  tariffCAmount: number | null;
}): BillingPaymentMethod | null {
  const explicit = input.explicitPaymentMethod.trim();
  if (explicit) {
    return explicit as BillingPaymentMethod;
  }

  if (input.currency === "RUB") {
    if (input.tariffAAmount != null && input.monthlyAmount === input.tariffAAmount) {
      return "tbank_link_a";
    }

    if (input.tariffBAmount != null && input.monthlyAmount === input.tariffBAmount) {
      return "tbank_link_b";
    }

    if (input.tariffCAmount != null && input.monthlyAmount === input.tariffCAmount) {
      return "tbank_link_c";
    }

    return "manual_other";
  }

  if (input.currency === "EUR") {
    return "manual_eur";
  }

  return "manual_other";
}

function parseRow(record: Record<string, string>, options: CliOptions): { row: ParsedRow | null; errors: string[] } {
  const errors: string[] = [];
  const rowNumber = Number.parseInt(record.__row_number ?? "0", 10);

  const clientName = normalizeCell(getAliasValue(record, COLUMN_ALIASES.name));
  if (!clientName) {
    errors.push("name is required");
  }

  const amountRaw = normalizeCell(getAliasValue(record, COLUMN_ALIASES.monthlyAmount));
  let monthlyAmount = 0;
  if (!amountRaw) {
    errors.push("monthly_amount is required");
  } else {
    const parsedAmount = parseAmount(amountRaw);
    if (parsedAmount == null) {
      errors.push("monthly_amount must be a positive integer");
    } else {
      monthlyAmount = parsedAmount;
    }
  }

  const currencyRaw = normalizeCell(getAliasValue(record, COLUMN_ALIASES.currency)).toUpperCase() || "RUB";
  const currency = currencyRaw as BillingCurrency;
  if (!VALID_CURRENCIES.has(currency)) {
    errors.push("currency must be RUB, EUR, or OTHER");
  }

  const plannedPaymentDayRaw = normalizeCell(getAliasValue(record, COLUMN_ALIASES.plannedPaymentDay));
  let plannedPaymentDay = options.defaultPaymentDay;
  if (plannedPaymentDayRaw) {
    const parsedPaymentDay = parsePaymentDayCell(plannedPaymentDayRaw);
    if (parsedPaymentDay == null) {
      errors.push("planned_payment_day must be an integer between 1 and 31");
    } else {
      plannedPaymentDay = parsedPaymentDay;
    }
  }

  if (!Number.isSafeInteger(plannedPaymentDay) || plannedPaymentDay < 1 || plannedPaymentDay > 31) {
    errors.push("planned_payment_day must be an integer between 1 and 31");
  }

  const explicitPaymentMethod = normalizeCell(getAliasValue(record, COLUMN_ALIASES.paymentMethod));
  const paymentMethodCandidate = inferPaymentMethod({
    currency: VALID_CURRENCIES.has(currency) ? currency : "RUB",
    monthlyAmount,
    explicitPaymentMethod,
    tariffAAmount: options.tariffAAmount,
    tariffBAmount: options.tariffBAmount,
    tariffCAmount: options.tariffCAmount,
  });

  if (!paymentMethodCandidate || !VALID_PAYMENT_METHODS.has(paymentMethodCandidate)) {
    errors.push(
      "payment_method must be one of tbank_link_a, tbank_link_b, tbank_link_c, manual_eur, manual_other"
    );
  }

  const paymentMethod =
    paymentMethodCandidate && VALID_PAYMENT_METHODS.has(paymentMethodCandidate) ? paymentMethodCandidate : null;

  if (paymentMethod === "manual_eur" && currency !== "EUR") {
    errors.push("payment_method manual_eur requires currency EUR");
  }

  if (
    (paymentMethod === "tbank_link_a" ||
      paymentMethod === "tbank_link_b" ||
      paymentMethod === "tbank_link_c") &&
    currency !== "RUB"
  ) {
    errors.push("tbank link payment methods require currency RUB");
  }

  if (errors.length > 0) {
    return { row: null, errors };
  }

  if (!paymentMethod) {
    return {
      row: null,
      errors: ["payment_method could not be resolved"],
    };
  }

  return {
    row: {
      rowNumber,
      groupName: normalizeCell(getAliasValue(record, COLUMN_ALIASES.groupName)) || null,
      clientName,
      monthlyAmount,
      currency,
      plannedPaymentDay,
      paymentMethod,
      notes: normalizeCell(getAliasValue(record, COLUMN_ALIASES.notes)) || null,
      studentSlug: normalizeCell(getAliasValue(record, COLUMN_ALIASES.studentSlug)) || null,
    },
    errors: [],
  };
}

function summarizeWarnings(warnings: RowWarning[]): void {
  if (warnings.length === 0) {
    return;
  }

  console.log(`warnings=${warnings.length}`);
  for (const warning of warnings) {
    console.log(`warning row ${warning.rowNumber}: ${warning.message}`);
  }
}

function summarizeErrors(errors: RowError[]): void {
  if (errors.length === 0) {
    return;
  }

  console.log(`errors=${errors.length}`);
  for (const error of errors) {
    console.log(`error row ${error.rowNumber}: ${error.message}`);
  }
}

async function loadCsvRows(filePath: string) {
  const content = await fs.readFile(filePath, "utf8");
  return parseBillingClientsCsv(content);
}

async function fetchStudentLookup(slugs: string[]): Promise<Map<string, StudentLookupRow>> {
  if (slugs.length === 0) {
    return new Map();
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_id")
    .in("student_id", slugs);

  if (error) {
    throw new Error(`Failed to load TrainingPeaks students: ${error.message}`);
  }

  return new Map(((data as StudentLookupRow[] | null) ?? []).map((row) => [row.student_id, row]));
}

async function fetchExistingBillingClients(input: {
  resolvedStudentIds: string[];
  compositeKeys: string[];
}): Promise<BillingClientLookupRow[]> {
  const supabase = createSupabaseServerClient();
  const results = new Map<string, BillingClientLookupRow>();

  if (input.resolvedStudentIds.length > 0) {
    const { data, error } = await supabase
      .from("billing_clients")
      .select("id, student_id, client_name, monthly_amount, currency")
      .in("student_id", input.resolvedStudentIds);

    if (error) {
      throw new Error(`Failed to load existing billing clients by student_id: ${error.message}`);
    }

    for (const row of (data as BillingClientLookupRow[] | null) ?? []) {
      results.set(row.id, row);
    }
  }

  if (input.compositeKeys.length > 0) {
    const { data, error } = await supabase
      .from("billing_clients")
      .select("id, student_id, client_name, monthly_amount, currency");

    if (error) {
      throw new Error(`Failed to load existing billing clients for composite matching: ${error.message}`);
    }

    for (const row of (data as BillingClientLookupRow[] | null) ?? []) {
      const key = buildCompositeKey({
        clientName: row.client_name,
        monthlyAmount: row.monthly_amount,
        currency: row.currency,
      });

      if (input.compositeKeys.includes(key)) {
        results.set(row.id, row);
      }
    }
  }

  return Array.from(results.values());
}

function buildCompositeKey(input: {
  clientName: string;
  monthlyAmount: number;
  currency: BillingCurrency;
}): string {
  return `${input.clientName}|||${input.monthlyAmount}|||${input.currency}`;
}

async function buildImportPlan(rows: ParsedRow[], options: CliOptions): Promise<{
  plan: ImportPlanRow[];
  warnings: RowWarning[];
  errors: RowError[];
}> {
  const warnings: RowWarning[] = [];
  const errors: RowError[] = [];

  const slugs = Array.from(
    new Set(rows.map((row) => row.studentSlug).filter((value): value is string => Boolean(value)))
  );
  const studentLookup = await fetchStudentLookup(slugs);

  const resolvedStudentIds = Array.from(new Set(Array.from(studentLookup.values()).map((row) => row.id)));
  const compositeKeys = Array.from(
    new Set(
      rows
        .filter((row) => !row.studentSlug || !studentLookup.has(row.studentSlug))
        .map((row) =>
          buildCompositeKey({
            clientName: row.clientName,
            monthlyAmount: row.monthlyAmount,
            currency: row.currency,
          })
        )
    )
  );
  const existingClients = await fetchExistingBillingClients({ resolvedStudentIds, compositeKeys });

  const existingByStudentId = new Map(
    existingClients.filter((row) => row.student_id).map((row) => [row.student_id as string, row])
  );
  const existingByCompositeKey = new Map(
    existingClients.map((row) => [
      buildCompositeKey({
        clientName: row.client_name,
        monthlyAmount: row.monthly_amount,
        currency: row.currency,
      }),
      row,
    ])
  );

  const plan: ImportPlanRow[] = [];

  for (const row of rows) {
    let resolvedStudentId: string | null = null;

    if (row.studentSlug) {
      const matchedStudent = studentLookup.get(row.studentSlug);

      if (matchedStudent) {
        resolvedStudentId = matchedStudent.id;
      } else {
        const message = "student_id slug not found; importing without TrainingPeaks link";
        if (options.strictLinks) {
          errors.push({ rowNumber: row.rowNumber, message });
          continue;
        }

        if (!options.allowUnlinked) {
          errors.push({ rowNumber: row.rowNumber, message: "unlinked students are not allowed in current mode" });
          continue;
        }

        warnings.push({ rowNumber: row.rowNumber, message });
      }
    }

    const existing = resolvedStudentId
      ? (existingByStudentId.get(resolvedStudentId) ?? null)
      : (existingByCompositeKey.get(
          buildCompositeKey({
            clientName: row.clientName,
            monthlyAmount: row.monthlyAmount,
            currency: row.currency,
          })
        ) ?? null);

    plan.push({
      ...row,
      resolvedStudentId,
      action: existing ? "update" : "insert",
      existingBillingClientId: existing?.id ?? null,
    });
  }

  return { plan, warnings, errors };
}

async function applyImportPlan(plan: ImportPlanRow[]): Promise<void> {
  const supabase = createSupabaseServerClient();

  for (const row of plan) {
    const updatePayload = {
      group_name: row.groupName,
      client_name: row.clientName,
      monthly_amount: row.monthlyAmount,
      currency: row.currency,
      planned_payment_day: row.plannedPaymentDay,
      payment_method: row.paymentMethod,
      notes: row.notes,
      is_active: true,
      updated_by: IMPORT_ACTOR,
    };

    if (row.action === "update" && row.existingBillingClientId) {
      const { error } = await supabase
        .from("billing_clients")
        .update(updatePayload)
        .eq("id", row.existingBillingClientId);
      if (error) {
        throw new Error(`Failed to update billing client for row ${row.rowNumber}: ${error.message}`);
      }
      continue;
    }

    const insertPayload = {
      ...updatePayload,
      student_id: row.resolvedStudentId,
      created_by: IMPORT_ACTOR,
    };

    const { error } = await supabase.from("billing_clients").insert(insertPayload);

    if (error) {
      throw new Error(`Failed to insert billing client for row ${row.rowNumber}: ${error.message}`);
    }
  }
}

function printSummary(input: {
  filePath: string;
  options: CliOptions;
  inputMode: "normalized" | "raw";
  totalRows: number;
  validRows: number;
  invalidRows: number;
  insertCount: number;
  updateCount: number;
  linkedCount: number;
  unlinkedCount: number;
}): void {
  console.log("[billing-import-clients] OK");
  console.log(`mode=${input.options.dryRun ? "dry-run" : "apply"}`);
  console.log(`input_mode=${input.inputMode}`);
  console.log(`file=${path.relative(process.cwd(), input.filePath)}`);
  console.log(`total_rows=${input.totalRows}`);
  console.log(`valid_rows=${input.validRows}`);
  console.log(`invalid_rows=${input.invalidRows}`);
  console.log(`would_insert=${input.insertCount}`);
  console.log(`would_update=${input.updateCount}`);
  console.log(`linked_count=${input.linkedCount}`);
  console.log(`unlinked_count=${input.unlinkedCount}`);
  console.log(`allow_unlinked=${input.options.allowUnlinked}`);
  console.log(`strict_links=${input.options.strictLinks}`);
  console.log(`default_payment_day=${input.options.defaultPaymentDay}`);
}

async function run(): Promise<void> {
  loadEnvConfig(process.cwd());

  const options = parseArgs(process.argv.slice(2));

  if (!getEnvValue("SUPABASE_SERVICE_ROLE_KEY")) {
    console.log("[billing-import-clients] SKIP");
    console.log("Missing SUPABASE_SERVICE_ROLE_KEY.");
    return;
  }

  if (!getEnvValue("SUPABASE_URL") && !getEnvValue("NEXT_PUBLIC_SUPABASE_URL")) {
    console.log("[billing-import-clients] SKIP");
    console.log("Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.");
    return;
  }

  if (process.env.SUPABASE_URL == null && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }

  const resolvedPath = path.resolve(process.cwd(), options.filePath);
  const parsedCsv = await loadCsvRows(resolvedPath);

  const parsedRows: ParsedRow[] = [];
  const rowErrors: RowError[] = [];

  for (const record of parsedCsv.records) {
    const parsed = parseRow(record, options);
    if (parsed.row) {
      parsedRows.push(parsed.row);
      continue;
    }

    const rowNumber = Number.parseInt(record.__row_number ?? "0", 10);
    for (const message of parsed.errors) {
      rowErrors.push({ rowNumber, message });
    }
  }

  const planResult = await buildImportPlan(parsedRows, options);
  const allErrors = [...rowErrors, ...planResult.errors];

  summarizeErrors(allErrors);
  summarizeWarnings(planResult.warnings);

  printSummary({
    filePath: resolvedPath,
    options,
    inputMode: parsedCsv.mode,
    totalRows: parsedCsv.records.length,
    validRows: planResult.plan.length,
    invalidRows: rowErrors.length,
    insertCount: planResult.plan.filter((row) => row.action === "insert").length,
    updateCount: planResult.plan.filter((row) => row.action === "update").length,
    linkedCount: planResult.plan.filter((row) => row.resolvedStudentId != null).length,
    unlinkedCount: planResult.plan.filter((row) => row.resolvedStudentId == null).length,
  });

  if (allErrors.length > 0) {
    throw new Error("Import aborted due to validation errors.");
  }

  if (!options.dryRun) {
    await applyImportPlan(planResult.plan);
  }
}

void run().catch((error) => {
  console.error("[billing-import-clients] FAIL");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
