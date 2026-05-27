import process from "node:process";

import { ensureBillingMonthRows, getBillingMonthGenerationPreview, resolveBillingMonth } from "@/features/billing/service";
import { createSupabaseServerClient } from "@/features/supabase/server";

type CliOptions = {
  month: string | null;
  execute: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  let month: string | null = null;
  let execute = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--execute") {
      execute = true;
      continue;
    }

    if (arg === "--month") {
      month = (argv[index + 1] ?? "").trim() || null;
      index += 1;
      continue;
    }

    if (arg.startsWith("--month=")) {
      month = arg.slice("--month=".length).trim() || null;
    }
  }

  return { month, execute };
}

function getEnvValue(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  npm run billing:ensure-month -- --month YYYY-MM-01 [--execute]");
}

function normalizeMonth(rawMonth: string): string | null {
  if (!/^\d{4}-\d{2}-01$/.test(rawMonth)) {
    return null;
  }

  const parsed = new Date(`${rawMonth}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const normalized = parsed.toISOString().slice(0, 10);
  if (normalized !== rawMonth) {
    return null;
  }

  return resolveBillingMonth(rawMonth);
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (!options.month) {
    console.log("[billing-ensure-month] SKIP");
    console.log("Missing required --month (YYYY-MM-01).");
    printUsage();
    return;
  }

  const normalizedMonth = normalizeMonth(options.month);
  if (!normalizedMonth) {
    console.log("[billing-ensure-month] SKIP");
    console.log(`Invalid --month=${options.month}. Expected YYYY-MM-01.`);
    printUsage();
    return;
  }

  if (!getEnvValue("SUPABASE_SERVICE_ROLE_KEY")) {
    console.log("[billing-ensure-month] SKIP");
    console.log("Missing SUPABASE_SERVICE_ROLE_KEY.");
    printUsage();
    return;
  }

  if (!getEnvValue("SUPABASE_URL") && !getEnvValue("NEXT_PUBLIC_SUPABASE_URL")) {
    console.log("[billing-ensure-month] SKIP");
    console.log("Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.");
    printUsage();
    return;
  }

  if (process.env.SUPABASE_URL == null && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }

  createSupabaseServerClient();

  const preview = await getBillingMonthGenerationPreview(normalizedMonth);
  const executeRequired = preview.missingClientCount > 0;

  console.log(`[billing-ensure-month] ${options.execute ? "EXECUTE" : "DRY RUN"}`);
  console.log(`target_month=${preview.billingMonth}`);
  console.log(`active_clients_count=${preview.activeClientCount}`);
  console.log(`existing_rows_count=${preview.existingPaymentCount}`);
  console.log(`missing_rows_count=${preview.missingClientCount}`);
  console.log(`creatable_rows_count=${preview.creatableRowCount}`);
  console.log(`rows_with_planned_date_count=${preview.rowsWithPlannedDateCount}`);
  console.log(`rows_without_planned_date_count=${preview.rowsWithoutPlannedDateCount}`);
  console.log(`skipped_invalid_clients_count=${preview.skippedInvalidClientCount}`);
  if (preview.skippedInvalidClients.length > 0) {
    for (const skipped of preview.skippedInvalidClients) {
      console.log(
        `skipped_invalid_client=client_id:${skipped.clientId};client_name:${skipped.clientName};reason:${skipped.reason}`
      );
    }
  }
  console.log(`execute_required=${executeRequired}`);

  if (!options.execute) {
    console.log("dry_run_only=true");
    console.log("no_changes_applied=true");
    return;
  }

  const ensureResult = await ensureBillingMonthRows({
    targetMonth: normalizedMonth,
    actor: "script:billing-ensure-month",
  });

  const skippedExistingCount = Math.max(
    0,
    ensureResult.missingClientCount - ensureResult.creatableRowCount - ensureResult.skippedInvalidClientCount
  );
  console.log(`created_rows_count=${ensureResult.insertedCount}`);
  console.log(`creatable_rows_count=${ensureResult.creatableRowCount}`);
  console.log(`rows_with_planned_date_count=${ensureResult.rowsWithPlannedDateCount}`);
  console.log(`rows_without_planned_date_count=${ensureResult.rowsWithoutPlannedDateCount}`);
  console.log(`skipped_invalid_clients_count=${ensureResult.skippedInvalidClientCount}`);
  console.log(`skipped_existing_rows_count=${skippedExistingCount}`);
  console.log("no_imported_payments_mutated=true");
  console.log("no_paid_status_mutation=true");
}

void run().catch((error) => {
  console.error("[billing-ensure-month] FAIL");
  console.error(error instanceof Error ? error.message : String(error));
  printUsage();
  process.exit(1);
});
