import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";

type CliOptions = {
  apply: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  let apply = false;

  for (const arg of argv) {
    if (arg === "--apply") {
      apply = true;
    }
    if (arg === "--dry-run") {
      apply = false;
    }
  }

  return { apply };
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

async function countRows(table: "billing_imported_payments" | "billing_monthly_payments" | "billing_clients"): Promise<number> {
  const supabase = createSupabaseServerClient();
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true });
  if (error) {
    throw new Error(`Failed counting ${table}: ${error.message}`);
  }
  return count ?? 0;
}

async function deleteAllRows(table: "billing_imported_payments" | "billing_monthly_payments" | "billing_clients"): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from(table).delete().not("id", "is", null);
  if (error) {
    throw new Error(`Failed deleting ${table}: ${error.message}`);
  }
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  ensureSupabaseEnv();

  if (options.apply && process.env.BILLING_RESET_CONFIRM !== "RESET_BILLING_DATA") {
    throw new Error(
      "Refusing --apply. Set BILLING_RESET_CONFIRM=RESET_BILLING_DATA to confirm billing-only reset."
    );
  }

  const before = {
    billing_imported_payments: await countRows("billing_imported_payments"),
    billing_monthly_payments: await countRows("billing_monthly_payments"),
    billing_clients: await countRows("billing_clients"),
  };

  console.log("[billing-reset] Billing-only reset");
  console.log(`mode=${options.apply ? "apply" : "dry-run"}`);
  console.log(
    "scope=billing_imported_payments,billing_monthly_payments,billing_clients (trainingpeaks_students/reports/jobs/telegram/trainingpeaks-actions untouched)"
  );
  console.log(
    "transaction=not_available_via_current_supabase_helper (running explicit safe delete order)"
  );
  console.log(`before.billing_imported_payments=${before.billing_imported_payments}`);
  console.log(`before.billing_monthly_payments=${before.billing_monthly_payments}`);
  console.log(`before.billing_clients=${before.billing_clients}`);

  if (options.apply) {
    await deleteAllRows("billing_imported_payments");
    await deleteAllRows("billing_monthly_payments");
    await deleteAllRows("billing_clients");
  }

  const after = {
    billing_imported_payments: await countRows("billing_imported_payments"),
    billing_monthly_payments: await countRows("billing_monthly_payments"),
    billing_clients: await countRows("billing_clients"),
  };

  console.log(`after.billing_imported_payments=${after.billing_imported_payments}`);
  console.log(`after.billing_monthly_payments=${after.billing_monthly_payments}`);
  console.log(`after.billing_clients=${after.billing_clients}`);
}

void run().catch((error) => {
  console.error("[billing-reset] FAIL");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
