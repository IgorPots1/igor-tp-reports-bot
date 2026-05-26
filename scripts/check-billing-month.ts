import process from "node:process";

import { listBillingMonthlyPaymentsForMonth } from "@/features/billing/repository";
import { createSupabaseServerClient } from "@/features/supabase/server";
import {
  getBillingOverdueCandidatePayments,
  ensureBillingMonthRows,
  getBillingMonthGenerationPreview,
  getCurrentBelgradeDateIso,
  resolveBillingMonth,
} from "@/features/billing/service";
import { BILLING_CSV_COLUMNS } from "@/features/billing/types";

type CheckOptions = {
  targetMonth: string;
  dryRun: boolean;
  withTestClient: boolean;
};

function parseArgs(argv: string[]): CheckOptions {
  const now = new Date();
  let targetMonth = resolveBillingMonth(now).slice(0, 7);
  let dryRun = true;
  let withTestClient = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--month") {
      targetMonth = argv[index + 1] ?? targetMonth;
      index += 1;
      continue;
    }

    if (arg.startsWith("--month=")) {
      targetMonth = arg.slice("--month=".length);
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

    if (arg === "--with-test-client") {
      withTestClient = true;
    }
  }

  return {
    targetMonth,
    dryRun,
    withTestClient,
  };
}

function getEnvValue(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY" | "SUPABASE_URL"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function printJson(label: string, value: unknown): void {
  console.log(`${label}=${JSON.stringify(value, null, 2)}`);
}

async function getDryRunOverdueCandidateCount(now: Date): Promise<number> {
  const currentMonth = resolveBillingMonth(now);
  const belgradeDate = getCurrentBelgradeDateIso(now);
  const existingRows = await listBillingMonthlyPaymentsForMonth(currentMonth);

  return existingRows.filter((row) => {
    const isCandidateStatus = row.status === "pending" || row.status === "overdue";
    if (!isCandidateStatus || row.overdueRemindedAt) {
      return false;
    }
    if (!row.plannedPaymentDate) {
      return false;
    }

    const thresholdDate = new Date(`${row.plannedPaymentDate}T12:00:00.000Z`);
    thresholdDate.setUTCDate(thresholdDate.getUTCDate() + 2);
    const thresholdIso = thresholdDate.toISOString().slice(0, 10);
    return belgradeDate >= thresholdIso;
  }).length;
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const now = new Date();
  const targetMonth = resolveBillingMonth(options.targetMonth);
  const belgradeDate = getCurrentBelgradeDateIso(now);

  if (!getEnvValue("SUPABASE_SERVICE_ROLE_KEY")) {
    console.log("[check-billing-month] SKIP");
    console.log("Missing SUPABASE_SERVICE_ROLE_KEY.");
    console.log("Load service-role env before running the billing check.");
    return;
  }

  if (!getEnvValue("NEXT_PUBLIC_SUPABASE_URL") && !getEnvValue("SUPABASE_URL")) {
    console.log("[check-billing-month] SKIP");
    console.log("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL.");
    console.log("Load Supabase env before running the billing check.");
    return;
  }

  if (process.env.SUPABASE_URL == null && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }

  if (options.withTestClient) {
    console.log("[check-billing-month] NOTE");
    console.log("--with-test-client was passed, but test client creation is not implemented in v1.");
  }

  createSupabaseServerClient();

  const preview = await getBillingMonthGenerationPreview(targetMonth);
  let overdueCandidateCount = 0;
  const csvPreviewHeader = BILLING_CSV_COLUMNS.join(";");

  if (!options.dryRun) {
    await ensureBillingMonthRows({
      targetMonth,
      actor: "scripts/check-billing-month.ts",
    });

    overdueCandidateCount = (await getBillingOverdueCandidatePayments({ today: now })).length;
  } else {
    overdueCandidateCount = await getDryRunOverdueCandidateCount(now);
  }

  console.log("[check-billing-month] OK");
  console.log(`target_month=${targetMonth}`);
  console.log(`belgrade_date=${belgradeDate}`);
  console.log(`dry_run=${options.dryRun}`);
  console.log(`would_generate_rows=${preview.wouldGenerateRows}`);
  console.log(`missing_client_count=${preview.missingClientCount}`);
  console.log(`csv_preview_header=${csvPreviewHeader}`);
  console.log(`overdue_candidate_count=${overdueCandidateCount}`);
  printJson("generation_preview", preview);
}

void run().catch((error) => {
  console.error("[check-billing-month] FAIL");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
