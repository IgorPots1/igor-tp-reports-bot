import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";

const REASSIGN_ACTOR = "script:billing-reassign-imported-payment";

type CliOptions = {
  execute: boolean;
  importedPaymentId: string | null;
  targetMonth: string | null;
};

type ImportedPaymentRow = {
  id: string;
  payment_date: string;
  amount: number;
  currency: string;
  status: string;
  external_hash: string;
  matched_monthly_payment_id: string | null;
};

type MonthlyPaymentRow = {
  id: string;
  billing_client_id: string;
  billing_month: string;
  status: string;
  actual_payment_date: string | null;
  paid_amount: number | null;
  planned_amount: number;
  currency: string;
  source: string;
  external_payment_hash: string | null;
  planned_payment_date: string | null;
  marked_paid_by: string | null;
};

type ClientRow = {
  id: string;
  client_name: string;
};

type ReassignReason =
  | "safe"
  | "missing_imported"
  | "missing_old_monthly_row"
  | "missing_old_client"
  | "missing_target_row"
  | "imported_not_matched"
  | "imported_not_linked"
  | "old_month_already_target"
  | "old_month_not_paid"
  | "old_external_hash_missing"
  | "old_external_hash_mismatch"
  | "currency_mismatch_old"
  | "currency_mismatch_target"
  | "target_paid_other_import"
  | "target_paid_same_import"
  | "target_linked_other_import"
  | "target_partial_amount_present"
  | "amount_mismatch_target";

type ReassignCandidate = {
  imported: ImportedPaymentRow;
  oldMonthly: MonthlyPaymentRow | null;
  targetMonthly: MonthlyPaymentRow | null;
  client: ClientRow | null;
  reason: ReassignReason;
  safe: boolean;
};

type ExecutionResult = {
  repaired: boolean;
  skipped: boolean;
  error: string | null;
};

function parseArgs(argv: string[]): CliOptions {
  let execute = false;
  let importedPaymentId: string | null = null;
  let targetMonth: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--execute") {
      execute = true;
      continue;
    }
    if (arg === "--dry-run") {
      execute = false;
      continue;
    }

    if (arg === "--imported-payment-id") {
      importedPaymentId = (argv[index + 1] ?? "").trim() || null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--imported-payment-id=")) {
      importedPaymentId = arg.slice("--imported-payment-id=".length).trim() || null;
      continue;
    }

    if (arg === "--target-month") {
      targetMonth = (argv[index + 1] ?? "").trim() || null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--target-month=")) {
      targetMonth = arg.slice("--target-month=".length).trim() || null;
      continue;
    }
  }

  return { execute, importedPaymentId, targetMonth };
}

function getEnvValue(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function printUsage(): void {
  console.log("Usage:");
  console.log(
    "  npm run billing:reassign-imported-payment -- [--dry-run|--execute] --imported-payment-id <uuid> --target-month YYYY-MM-01"
  );
}

function normalizeTargetMonth(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-01$/.test(trimmed)) {
    return null;
  }
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const normalized = parsed.toISOString().slice(0, 10);
  return normalized === trimmed ? trimmed : null;
}

function reasonText(reason: ReassignReason): string {
  switch (reason) {
    case "safe":
      return "safe_to_reassign";
    case "missing_imported":
      return "imported payment not found";
    case "missing_old_monthly_row":
      return "missing linked monthly payment";
    case "missing_old_client":
      return "missing billing client";
    case "missing_target_row":
      return "missing target monthly row";
    case "imported_not_matched":
      return "imported payment is not matched";
    case "imported_not_linked":
      return "imported payment has no matched_monthly_payment_id";
    case "old_month_already_target":
      return "already linked to target month";
    case "old_month_not_paid":
      return "old linked month is not paid";
    case "old_external_hash_missing":
      return "old linked month missing external hash";
    case "old_external_hash_mismatch":
      return "old linked month hash mismatch";
    case "currency_mismatch_old":
      return "currency mismatch with old month row";
    case "currency_mismatch_target":
      return "currency mismatch with target month row";
    case "target_paid_other_import":
      return "target row already paid by another import";
    case "target_paid_same_import":
      return "target row already paid by this import";
    case "target_linked_other_import":
      return "target row linked to another import hash";
    case "target_partial_amount_present":
      return "target row has paid amount already set";
    case "amount_mismatch_target":
      return "imported amount does not match target planned amount";
  }
}

function evaluateCandidate(input: {
  imported: ImportedPaymentRow;
  oldMonthly: MonthlyPaymentRow | null;
  targetMonthly: MonthlyPaymentRow | null;
  client: ClientRow | null;
  targetMonth: string;
}): ReassignCandidate {
  const { imported, oldMonthly, targetMonthly, client, targetMonth } = input;

  if (imported.status !== "matched") {
    return { imported, oldMonthly, targetMonthly, client, reason: "imported_not_matched", safe: false };
  }
  if (!imported.matched_monthly_payment_id) {
    return { imported, oldMonthly, targetMonthly, client, reason: "imported_not_linked", safe: false };
  }
  if (!oldMonthly) {
    return { imported, oldMonthly, targetMonthly, client, reason: "missing_old_monthly_row", safe: false };
  }
  if (!client) {
    return { imported, oldMonthly, targetMonthly, client, reason: "missing_old_client", safe: false };
  }
  if (oldMonthly.billing_month === targetMonth) {
    return { imported, oldMonthly, targetMonthly, client, reason: "old_month_already_target", safe: false };
  }
  if (oldMonthly.status !== "paid") {
    return { imported, oldMonthly, targetMonthly, client, reason: "old_month_not_paid", safe: false };
  }
  if (!oldMonthly.external_payment_hash) {
    return { imported, oldMonthly, targetMonthly, client, reason: "old_external_hash_missing", safe: false };
  }
  if (oldMonthly.external_payment_hash !== imported.external_hash) {
    return { imported, oldMonthly, targetMonthly, client, reason: "old_external_hash_mismatch", safe: false };
  }
  if (oldMonthly.currency !== imported.currency) {
    return { imported, oldMonthly, targetMonthly, client, reason: "currency_mismatch_old", safe: false };
  }
  if (!targetMonthly) {
    return { imported, oldMonthly, targetMonthly, client, reason: "missing_target_row", safe: false };
  }
  if (targetMonthly.billing_client_id !== oldMonthly.billing_client_id) {
    return { imported, oldMonthly, targetMonthly, client, reason: "missing_target_row", safe: false };
  }
  if (targetMonthly.currency !== imported.currency) {
    return { imported, oldMonthly, targetMonthly, client, reason: "currency_mismatch_target", safe: false };
  }
  if (targetMonthly.planned_amount !== imported.amount) {
    return { imported, oldMonthly, targetMonthly, client, reason: "amount_mismatch_target", safe: false };
  }
  if (targetMonthly.status === "paid") {
    if (targetMonthly.external_payment_hash === imported.external_hash) {
      return { imported, oldMonthly, targetMonthly, client, reason: "target_paid_same_import", safe: false };
    }
    return { imported, oldMonthly, targetMonthly, client, reason: "target_paid_other_import", safe: false };
  }
  if (targetMonthly.external_payment_hash && targetMonthly.external_payment_hash !== imported.external_hash) {
    return { imported, oldMonthly, targetMonthly, client, reason: "target_linked_other_import", safe: false };
  }
  if (targetMonthly.paid_amount != null && targetMonthly.paid_amount !== 0) {
    return { imported, oldMonthly, targetMonthly, client, reason: "target_partial_amount_present", safe: false };
  }

  return { imported, oldMonthly, targetMonthly, client, reason: "safe", safe: true };
}

function printCandidate(candidate: ReassignCandidate, targetMonth: string): void {
  const clientLabel = candidate.client
    ? `${candidate.client.client_name} (${candidate.client.id})`
    : "unknown_client";
  const targetStatus = candidate.targetMonthly
    ? `status=${candidate.targetMonthly.status} id=${candidate.targetMonthly.id} planned_amount=${candidate.targetMonthly.planned_amount}`
    : "missing";

  console.log("------------------------------------------------------------");
  console.log(`client=${clientLabel}`);
  console.log(`imported_payment_id=${candidate.imported.id}`);
  console.log(`payment_date=${candidate.imported.payment_date}`);
  console.log(`amount=${candidate.imported.amount} ${candidate.imported.currency}`);
  console.log(`imported_status=${candidate.imported.status}`);
  console.log(`external_hash=${candidate.imported.external_hash}`);
  console.log(`current_monthly_id=${candidate.oldMonthly?.id ?? "missing"}`);
  console.log(`current_monthly_month=${candidate.oldMonthly?.billing_month ?? "missing"}`);
  console.log(`current_monthly_status=${candidate.oldMonthly?.status ?? "missing"}`);
  console.log(`target_month=${targetMonth}`);
  console.log(`target_monthly_row=${targetStatus}`);
  console.log(`reassign_safe=${candidate.safe}`);
  console.log(`decision=${reasonText(candidate.reason)}`);
}

async function loadCandidate(options: CliOptions): Promise<ReassignCandidate | null> {
  if (!options.importedPaymentId || !options.targetMonth) {
    return null;
  }

  const supabase = createSupabaseServerClient();

  const { data: importedData, error: importedError } = await supabase
    .from("billing_imported_payments")
    .select("id,payment_date,amount,currency,status,external_hash,matched_monthly_payment_id")
    .eq("id", options.importedPaymentId)
    .maybeSingle();

  if (importedError) {
    throw new Error(`Failed to load imported payment: ${importedError.message}`);
  }
  if (!importedData) {
    return {
      imported: {
        id: options.importedPaymentId,
        payment_date: "",
        amount: 0,
        currency: "",
        status: "",
        external_hash: "",
        matched_monthly_payment_id: null,
      },
      oldMonthly: null,
      targetMonthly: null,
      client: null,
      reason: "missing_imported",
      safe: false,
    };
  }

  const imported = importedData as ImportedPaymentRow;

  let oldMonthly: MonthlyPaymentRow | null = null;
  if (imported.matched_monthly_payment_id) {
    const { data: oldMonthlyData, error: oldMonthlyError } = await supabase
      .from("billing_monthly_payments")
      .select(
        "id,billing_client_id,billing_month,status,actual_payment_date,paid_amount,planned_amount,currency,source,external_payment_hash,planned_payment_date,marked_paid_by"
      )
      .eq("id", imported.matched_monthly_payment_id)
      .maybeSingle();

    if (oldMonthlyError) {
      throw new Error(`Failed to load linked monthly payment: ${oldMonthlyError.message}`);
    }
    oldMonthly = (oldMonthlyData as MonthlyPaymentRow | null) ?? null;
  }

  let targetMonthly: MonthlyPaymentRow | null = null;
  let client: ClientRow | null = null;

  if (oldMonthly) {
    const { data: targetMonthlyData, error: targetMonthlyError } = await supabase
      .from("billing_monthly_payments")
      .select(
        "id,billing_client_id,billing_month,status,actual_payment_date,paid_amount,planned_amount,currency,source,external_payment_hash,planned_payment_date,marked_paid_by"
      )
      .eq("billing_client_id", oldMonthly.billing_client_id)
      .eq("billing_month", options.targetMonth)
      .maybeSingle();

    if (targetMonthlyError) {
      throw new Error(`Failed to load target monthly payment: ${targetMonthlyError.message}`);
    }
    targetMonthly = (targetMonthlyData as MonthlyPaymentRow | null) ?? null;

    const { data: clientData, error: clientError } = await supabase
      .from("billing_clients")
      .select("id,client_name")
      .eq("id", oldMonthly.billing_client_id)
      .maybeSingle();

    if (clientError) {
      throw new Error(`Failed to load billing client: ${clientError.message}`);
    }
    client = (clientData as ClientRow | null) ?? null;
  }

  return evaluateCandidate({
    imported,
    oldMonthly,
    targetMonthly,
    client,
    targetMonth: options.targetMonth,
  });
}

async function executeReassign(candidate: ReassignCandidate, targetMonth: string): Promise<ExecutionResult> {
  if (!candidate.safe) {
    return { repaired: false, skipped: true, error: null };
  }

  const supabase = createSupabaseServerClient();

  try {
    const { data: importedData, error: importedError } = await supabase
      .from("billing_imported_payments")
      .select("id,payment_date,amount,currency,status,external_hash,matched_monthly_payment_id")
      .eq("id", candidate.imported.id)
      .maybeSingle();
    if (importedError) {
      throw new Error(`reload imported failed: ${importedError.message}`);
    }
    if (!importedData) {
      throw new Error("imported row missing during execute");
    }

    const freshImported = importedData as ImportedPaymentRow;
    if (!freshImported.matched_monthly_payment_id) {
      throw new Error("imported row is no longer matched");
    }

    const { data: oldData, error: oldError } = await supabase
      .from("billing_monthly_payments")
      .select(
        "id,billing_client_id,billing_month,status,actual_payment_date,paid_amount,planned_amount,currency,source,external_payment_hash,planned_payment_date,marked_paid_by"
      )
      .eq("id", freshImported.matched_monthly_payment_id)
      .maybeSingle();
    if (oldError) {
      throw new Error(`reload old monthly failed: ${oldError.message}`);
    }
    if (!oldData) {
      throw new Error("old monthly row missing during execute");
    }

    const freshOld = oldData as MonthlyPaymentRow;
    const { data: targetData, error: targetError } = await supabase
      .from("billing_monthly_payments")
      .select(
        "id,billing_client_id,billing_month,status,actual_payment_date,paid_amount,planned_amount,currency,source,external_payment_hash,planned_payment_date,marked_paid_by"
      )
      .eq("billing_client_id", freshOld.billing_client_id)
      .eq("billing_month", targetMonth)
      .maybeSingle();
    if (targetError) {
      throw new Error(`reload target monthly failed: ${targetError.message}`);
    }

    const freshCandidate = evaluateCandidate({
      imported: freshImported,
      oldMonthly: freshOld,
      targetMonthly: (targetData as MonthlyPaymentRow | null) ?? null,
      client: candidate.client,
      targetMonth,
    });
    if (!freshCandidate.safe || !freshCandidate.targetMonthly) {
      console.warn(
        `[billing-reassign-imported-payment] SKIP imported=${candidate.imported.id} reason=${reasonText(
          freshCandidate.reason
        )}`
      );
      return { repaired: false, skipped: true, error: null };
    }

    const matchedAt = new Date().toISOString();
    const { error: targetUpdateError } = await supabase
      .from("billing_monthly_payments")
      .update({
        status: "paid",
        actual_payment_date: freshImported.payment_date,
        paid_amount: freshImported.amount,
        source: "email_import",
        external_payment_hash: freshImported.external_hash,
        marked_paid_by: REASSIGN_ACTOR,
        updated_by: REASSIGN_ACTOR,
      })
      .eq("id", freshCandidate.targetMonthly.id);
    if (targetUpdateError) {
      throw new Error(`update target monthly failed: ${targetUpdateError.message}`);
    }

    const { error: importedUpdateError } = await supabase
      .from("billing_imported_payments")
      .update({
        status: "matched",
        matched_monthly_payment_id: freshCandidate.targetMonthly.id,
        matched_at: matchedAt,
        matched_by_coach_chat_id: REASSIGN_ACTOR,
      })
      .eq("id", freshImported.id);
    if (importedUpdateError) {
      throw new Error(`update imported link failed: ${importedUpdateError.message}`);
    }

    const { error: oldUpdateError } = await supabase
      .from("billing_monthly_payments")
      .update({
        status: "pending",
        actual_payment_date: null,
        paid_amount: null,
        source: "manual",
        external_payment_hash: null,
        marked_paid_by: null,
        updated_by: REASSIGN_ACTOR,
      })
      .eq("id", freshCandidate.oldMonthly!.id);
    if (oldUpdateError) {
      throw new Error(`reset old monthly failed: ${oldUpdateError.message}`);
    }

    console.log(
      `[billing-reassign-imported-payment] REASSIGNED imported=${freshImported.id} old_monthly=${freshCandidate.oldMonthly!.id} target_monthly=${freshCandidate.targetMonthly.id}`
    );
    return { repaired: true, skipped: false, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[billing-reassign-imported-payment] ERROR imported=${candidate.imported.id} ${message}`);
    return { repaired: false, skipped: false, error: message };
  }
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (!getEnvValue("SUPABASE_SERVICE_ROLE_KEY")) {
    console.log("[billing-reassign-imported-payment] SKIP");
    console.log("Missing SUPABASE_SERVICE_ROLE_KEY.");
    printUsage();
    return;
  }

  if (!getEnvValue("SUPABASE_URL") && !getEnvValue("NEXT_PUBLIC_SUPABASE_URL")) {
    console.log("[billing-reassign-imported-payment] SKIP");
    console.log("Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.");
    printUsage();
    return;
  }

  if (process.env.SUPABASE_URL == null && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }

  if (!options.importedPaymentId) {
    console.log("[billing-reassign-imported-payment] SKIP");
    console.log("Missing required --imported-payment-id.");
    printUsage();
    return;
  }

  if (!options.targetMonth) {
    console.log("[billing-reassign-imported-payment] SKIP");
    console.log("Missing required --target-month (YYYY-MM-01).");
    printUsage();
    return;
  }

  const normalizedTargetMonth = normalizeTargetMonth(options.targetMonth);
  if (!normalizedTargetMonth) {
    console.log("[billing-reassign-imported-payment] SKIP");
    console.log(`Invalid --target-month=${options.targetMonth}. Expected YYYY-MM-01.`);
    printUsage();
    return;
  }

  options.targetMonth = normalizedTargetMonth;
  createSupabaseServerClient();

  const candidate = await loadCandidate(options);

  console.log(`[billing-reassign-imported-payment] ${options.execute ? "EXECUTE" : "DRY RUN"}`);
  console.log(`imported_payment_id=${options.importedPaymentId}`);
  console.log(`target_month=${options.targetMonth}`);
  console.log("note=Non-transactional single-item update. Review dry-run before --execute.");

  if (!candidate) {
    console.log("candidate=missing");
    return;
  }

  printCandidate(candidate, options.targetMonth);

  if (!options.execute) {
    console.log("dry_run_only=true");
    console.log("no_changes_applied=true");
    return;
  }

  const execution = await executeReassign(candidate, options.targetMonth);
  console.log(`reassigned=${execution.repaired}`);
  console.log(`execute_skipped=${execution.skipped}`);
  if (execution.error) {
    console.log(`execute_error=${execution.error}`);
  }
}

void run().catch((error) => {
  console.error("[billing-reassign-imported-payment] FAIL");
  console.error(error instanceof Error ? error.message : String(error));
  printUsage();
  process.exit(1);
});
