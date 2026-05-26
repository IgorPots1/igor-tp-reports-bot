import process from "node:process";

import { autoMatchTrustedImportedPayments, resolveBillingMonth } from "@/features/billing/service";
import { createSupabaseServerClient } from "@/features/supabase/server";

type CliOptions = {
  apply: boolean;
  month: string | null;
};

function parseArgs(argv: string[]): CliOptions {
  let apply = false;
  let month: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--apply") {
      apply = true;
      continue;
    }

    if (arg === "--dry-run") {
      apply = false;
      continue;
    }

    if (arg === "--month") {
      month = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg.startsWith("--month=")) {
      month = arg.slice("--month=".length);
    }
  }

  return { apply, month };
}

function getEnvValue(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  npm run billing:auto-match-payments -- [--dry-run|--apply] [--month YYYY-MM]");
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const normalizedMonth = options.month ? resolveBillingMonth(options.month).slice(0, 7) : null;

  if (!getEnvValue("SUPABASE_SERVICE_ROLE_KEY")) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  if (!getEnvValue("SUPABASE_URL") && !getEnvValue("NEXT_PUBLIC_SUPABASE_URL")) {
    throw new Error("Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.");
  }

  if (process.env.SUPABASE_URL == null && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }

  // Ensures env validation is explicit before service path.
  createSupabaseServerClient();

  const result = await autoMatchTrustedImportedPayments({
    apply: options.apply,
    month: normalizedMonth ?? undefined,
  });

  console.log(`[billing-auto-match-payments] ${result.mode === "apply" ? "APPLIED" : "DRY RUN"}`);
  console.log(`mode=${result.mode}`);
  console.log(`month_scope=${normalizedMonth ?? "auto-by-payment-date"}`);
  console.log(`scanned_new_imported_payments=${result.scannedNewImportedPayments}`);
  console.log(`trusted_matches=${result.trustedMatches}`);
  console.log(`would_match=${result.wouldMatch}`);
  console.log(`matched=${result.matched}`);
  console.log(`skipped_no_identity=${result.skippedNoIdentity}`);
  console.log(`skipped_multiple_identities=${result.skippedMultipleIdentities}`);
  console.log(`skipped_inactive_client=${result.skippedInactiveClient}`);
  console.log(`skipped_non_rub=${result.skippedNonRub}`);
  console.log(`skipped_amount_mismatch=${result.skippedAmountMismatch}`);
  console.log(`skipped_already_paid=${result.skippedAlreadyPaid}`);
  console.log(`skipped_no_monthly_payment=${result.skippedNoMonthlyPayment}`);
  console.log(`skipped_ambiguous=${result.skippedAmbiguous}`);
  console.log(`errors=${result.errors}`);

  if (result.trustedMatchDetails.length > 0) {
    console.log("trusted_match_candidates:");
    for (const detail of result.trustedMatchDetails.slice(0, 20)) {
      console.log(
        `  - date=${detail.paymentDate} amount=${detail.amount} ${detail.currency} client=${detail.billingClientName} month=${detail.targetMonth.slice(0, 7)}`
      );
    }
    if (result.trustedMatchDetails.length > 20) {
      console.log(`  ... and ${result.trustedMatchDetails.length - 20} more`);
    }
  }
}

void run().catch((error) => {
  console.error("[billing-auto-match-payments] FAIL");
  console.error(error instanceof Error ? error.message : String(error));
  printUsage();
  process.exit(1);
});
