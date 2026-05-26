import { access } from "node:fs/promises";
import { constants } from "node:fs";
import process from "node:process";

import { parseBillingClientsCsv } from "@/features/billing/import/parse-billing-clients-csv";
import { createSupabaseServerClient } from "@/features/supabase/server";

type CliOptions = {
  filePath: string | null;
  apply: boolean;
  allowNonEmpty: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  let filePath: string | null = null;
  let apply = false;
  let allowNonEmpty = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--file") {
      filePath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg.startsWith("--file=")) {
      filePath = arg.slice("--file=".length);
      continue;
    }

    if (arg === "--apply") {
      apply = true;
      continue;
    }

    if (arg === "--dry-run") {
      apply = false;
      continue;
    }

    if (arg === "--allow-non-empty") {
      allowNonEmpty = true;
      continue;
    }
  }

  return { filePath, apply, allowNonEmpty };
}

function printUsage(): void {
  console.log("Usage:");
  console.log(
    "  npm run billing:import-clients -- --file ./path/to/billing-clients-v2.csv [--dry-run|--apply] [--allow-non-empty]"
  );
}

async function ensureFileReadable(filePath: string): Promise<void> {
  await access(filePath, constants.R_OK);
}

function ensureSupabaseEnv(): void {
  if (!process.env.SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }

  if (!process.env.SUPABASE_URL?.trim()) {
    throw new Error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL).");
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function printMap(label: string, map: Map<string, number>): void {
  const asEntries = Array.from(map.entries()).sort(([left], [right]) => left.localeCompare(right));
  const serialized = asEntries.map(([key, value]) => `${key}:${value}`).join(", ");
  console.log(`${label}=${serialized || "none"}`);
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (!options.filePath) {
    printUsage();
    throw new Error("Missing required --file argument.");
  }

  await ensureFileReadable(options.filePath);

  const parsed = await parseBillingClientsCsv(options.filePath);
  const currencyCounts = new Map<string, number>();
  const paymentMethodCounts = new Map<string, number>();
  let withTrainingPeaksLinkCount = 0;

  for (const row of parsed.validRows) {
    incrementCount(currencyCounts, row.currency);
    incrementCount(paymentMethodCounts, row.paymentMethod);
    if (row.trainingpeaksStudentId) {
      withTrainingPeaksLinkCount += 1;
    }
  }

  ensureSupabaseEnv();
  const supabase = createSupabaseServerClient();

  const tpIdsToValidate = Array.from(
    new Set(parsed.validRows.flatMap((row) => (row.trainingpeaksStudentId ? [row.trainingpeaksStudentId] : [])))
  );

  let existingTpIds = new Set<string>();
  if (tpIdsToValidate.length > 0) {
    const { data, error } = await supabase
      .from("trainingpeaks_students")
      .select("id, student_name")
      .in("id", tpIdsToValidate);

    if (error) {
      throw new Error(`Failed to validate trainingpeaks_student_id references: ${error.message}`);
    }

    existingTpIds = new Set(((data as Array<{ id: string }>) ?? []).map((row) => row.id));
    for (const row of parsed.validRows) {
      if (row.trainingpeaksStudentId && !existingTpIds.has(row.trainingpeaksStudentId)) {
        parsed.errors.push({
          rowNumber: row.rowNumber,
          message: `trainingpeaks_student_id not found: ${row.trainingpeaksStudentId}`,
        });
      }
    }
  }

  if (parsed.errors.length === 0 && tpIdsToValidate.length > 0) {
    const { data, error } = await supabase
      .from("trainingpeaks_students")
      .select("id, student_name")
      .in("id", tpIdsToValidate);

    if (error) {
      throw new Error(`Failed to verify trainingpeaks_student_name advisories: ${error.message}`);
    }

    const byId = new Map(
      ((data as Array<{ id: string; student_name: string | null }>) ?? []).map((row) => [row.id, row.student_name ?? ""])
    );
    for (const row of parsed.validRows) {
      if (!row.trainingpeaksStudentId || !row.trainingpeaksStudentName) {
        continue;
      }
      const actualName = (byId.get(row.trainingpeaksStudentId) ?? "").trim();
      if (!actualName) {
        continue;
      }
      if (actualName !== row.trainingpeaksStudentName.trim()) {
        parsed.warnings.push({
          rowNumber: row.rowNumber,
          message: "trainingpeaks_student_name differs from DB record (advisory only).",
        });
      }
    }
  }

  const validRowsWithoutErrors = parsed.validRows.filter(
    (row) => !parsed.errors.some((error) => error.rowNumber === row.rowNumber)
  );

  const { count: existingClientsCount, error: countError } = await supabase
    .from("billing_clients")
    .select("id", { count: "exact", head: true });

  if (countError) {
    throw new Error(`Failed to check existing billing_clients rows: ${countError.message}`);
  }

  if ((existingClientsCount ?? 0) > 0 && !options.allowNonEmpty) {
    throw new Error(
      "Refusing to import because billing_clients is not empty. Pass --allow-non-empty to override."
    );
  }

  console.log("[billing-import-clients] Billing client roster CSV v2 import");
  console.log(`mode=${options.apply ? "apply" : "dry-run"}`);
  console.log(`rows_read=${parsed.rowsRead}`);
  console.log(`valid_rows=${validRowsWithoutErrors.length}`);
  console.log(`invalid_rows=${parsed.errors.length}`);
  printMap("rows_per_currency", currencyCounts);
  printMap("rows_per_payment_method", paymentMethodCounts);
  console.log(`rows_with_tp_link=${withTrainingPeaksLinkCount}`);
  console.log(`${options.apply ? "inserted" : "would_insert"}=${validRowsWithoutErrors.length}`);

  if (parsed.warnings.length > 0) {
    console.log(`warnings=${parsed.warnings.length}`);
    for (const warning of parsed.warnings) {
      console.log(`warning_row_${warning.rowNumber}=${warning.message}`);
    }
  }

  if (parsed.errors.length > 0) {
    console.log("validation_errors_by_row:");
    for (const validationError of parsed.errors) {
      console.log(`row_${validationError.rowNumber}: ${validationError.message}`);
    }
  }

  if (!options.apply || validRowsWithoutErrors.length === 0 || parsed.errors.length > 0) {
    if (options.apply && parsed.errors.length > 0) {
      throw new Error("Import aborted due to validation errors.");
    }
    return;
  }

  const rowsToInsert = validRowsWithoutErrors.map((row) => ({
    student_id: row.trainingpeaksStudentId,
    client_name: row.clientName,
    group_name: row.groupName,
    monthly_amount: row.monthlyAmount,
    currency: row.currency,
    planned_payment_day: row.plannedPaymentDay,
    payment_method: row.paymentMethod,
    is_active: row.isActive,
    notes: row.notes,
    created_by: "script:billing-import-clients",
    updated_by: "script:billing-import-clients",
  }));

  const { error: insertError } = await supabase.from("billing_clients").insert(rowsToInsert);
  if (insertError) {
    throw new Error(`Failed to insert billing clients: ${insertError.message}`);
  }
}

void run().catch((error) => {
  console.error("[billing-import-clients] FAIL");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
