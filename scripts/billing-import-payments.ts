import process from "node:process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";

import { parseTBankStatement } from "@/features/billing/import/parse-tbank-statement";
import { importBillingPaymentsFromParsedRows } from "@/features/billing/service";
import { createSupabaseServerClient } from "@/features/supabase/server";

type CliOptions = {
  filePath: string | null;
  apply: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  let filePath: string | null = null;
  let apply = false;

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
  }

  return { filePath, apply };
}

function getEnvValue(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  npm run billing:import-payments -- --file ./path/to/statement.csv [--dry-run|--apply]");
}

async function ensureFileReadable(filePath: string): Promise<void> {
  await access(filePath, constants.R_OK);
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (!options.filePath) {
    printUsage();
    throw new Error("Missing required --file argument.");
  }

  await ensureFileReadable(options.filePath);
  const parsed = await parseTBankStatement(options.filePath);

  if (!options.apply) {
    console.log("[billing-import-payments] DRY RUN");
    console.log(`file=${options.filePath.split(/[\\/]/).pop() ?? options.filePath}`);
    console.log(`format=${parsed.sourceFormat}`);
    console.log(`parsed_rows=${parsed.parsedRows.length}`);
    console.log(`skipped_rows=${parsed.skippedRows.length}`);
    console.log("inserted_rows=0");
    console.log("duplicate_rows=0");
    console.log("batch_id=n/a (dry-run)");
    console.log(`rows_with_name_flag=${parsed.parsedRows.filter((row) => row.rawRow.dataFlags.hasName).length}`);
    console.log(`rows_with_email_flag=${parsed.parsedRows.filter((row) => row.rawRow.dataFlags.hasEmail).length}`);
    console.log(`rows_with_phone_flag=${parsed.parsedRows.filter((row) => row.rawRow.dataFlags.hasPhone).length}`);
    if (parsed.warnings.length > 0) {
      console.log(`warnings=${parsed.warnings.length}`);
    }
    if (parsed.skippedRows.length > 0) {
      console.log(`skip_reasons=${parsed.skippedRows.map((row) => row.reason).join("; ")}`);
    }
    return;
  }

  if (!getEnvValue("SUPABASE_SERVICE_ROLE_KEY")) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY for --apply.");
  }

  if (!getEnvValue("SUPABASE_URL") && !getEnvValue("NEXT_PUBLIC_SUPABASE_URL")) {
    throw new Error("Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL for --apply.");
  }

  if (process.env.SUPABASE_URL == null && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }

  // Ensures env validation is explicit before insert path.
  createSupabaseServerClient();

  const importResult = await importBillingPaymentsFromParsedRows({
    parsedRows: parsed.parsedRows,
    sourceFileName: options.filePath,
  });

  console.log("[billing-import-payments] APPLIED");
  console.log(`file=${importResult.sourceFileName}`);
  console.log(`format=${parsed.sourceFormat}`);
  console.log(`parsed_rows=${parsed.parsedRows.length}`);
  console.log(`skipped_rows=${parsed.skippedRows.length}`);
  console.log(`inserted_rows=${importResult.insertedRowCount}`);
  console.log(`duplicate_rows=${importResult.duplicateRowCount}`);
  console.log(`batch_id=${importResult.importBatchId}`);
}

void run().catch((error) => {
  console.error("[billing-import-payments] FAIL");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
