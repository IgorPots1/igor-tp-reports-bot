import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";

const MAY_2026_MONTH = "2026-05-01";
const MAY_2026_START = "2026-05-01";
const JUNE_2026_START = "2026-06-01";
const REPAIR_ACTOR = "script:billing-repair-may-2026-payment-allocation";

type CliOptions = {
  execute: boolean;
  clientId: string | null;
  clientName: string | null;
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

type CandidateReason =
  | "safe"
  | "missing_old_monthly_row"
  | "missing_old_client"
  | "missing_may_row"
  | "imported_not_matched"
  | "old_month_already_may"
  | "old_month_not_paid"
  | "old_external_hash_missing"
  | "old_external_hash_mismatch"
  | "currency_mismatch_old"
  | "currency_mismatch_may"
  | "may_paid_other_import"
  | "may_paid_same_import"
  | "may_linked_other_import"
  | "may_partial_amount_present";

type RepairCandidate = {
  imported: ImportedPaymentRow;
  oldMonthly: MonthlyPaymentRow | null;
  mayMonthly: MonthlyPaymentRow | null;
  client: ClientRow | null;
  reason: CandidateReason;
  safe: boolean;
};

type ExecutionResult = {
  repaired: number;
  skipped: number;
  errors: number;
};

function parseArgs(argv: string[]): CliOptions {
  let execute = false;
  let clientId: string | null = null;
  let clientName: string | null = null;

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

    if (arg === "--client-id") {
      clientId = (argv[index + 1] ?? "").trim() || null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--client-id=")) {
      clientId = arg.slice("--client-id=".length).trim() || null;
      continue;
    }

    if (arg === "--client-name") {
      clientName = (argv[index + 1] ?? "").trim() || null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--client-name=")) {
      clientName = arg.slice("--client-name=".length).trim() || null;
      continue;
    }
  }

  return { execute, clientId, clientName };
}

function getEnvValue(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function printUsage(): void {
  console.log("Usage:");
  console.log(
    "  npm run billing:repair-may-2026-allocation -- [--dry-run|--execute] [--client-id <uuid>] [--client-name <text>]"
  );
}

function reasonText(reason: CandidateReason): string {
  switch (reason) {
    case "safe":
      return "safe_to_repair";
    case "missing_old_monthly_row":
      return "missing linked monthly payment";
    case "missing_old_client":
      return "missing billing client";
    case "missing_may_row":
      return "missing May monthly row";
    case "imported_not_matched":
      return "imported payment is not matched";
    case "old_month_already_may":
      return "already linked to May";
    case "old_month_not_paid":
      return "old linked month is not paid";
    case "old_external_hash_missing":
      return "old linked month missing external hash";
    case "old_external_hash_mismatch":
      return "old linked month hash mismatch";
    case "currency_mismatch_old":
      return "currency mismatch with old month row";
    case "currency_mismatch_may":
      return "currency mismatch with May row";
    case "may_paid_other_import":
      return "May row already paid by another import";
    case "may_paid_same_import":
      return "May row already paid by this import";
    case "may_linked_other_import":
      return "May row linked to another import hash";
    case "may_partial_amount_present":
      return "May row has paid amount already set";
  }
}

function evaluateCandidate(input: {
  imported: ImportedPaymentRow;
  oldMonthly: MonthlyPaymentRow | null;
  mayMonthly: MonthlyPaymentRow | null;
  client: ClientRow | null;
}): RepairCandidate {
  const { imported, oldMonthly, mayMonthly, client } = input;

  if (!oldMonthly) {
    return { imported, oldMonthly, mayMonthly, client, reason: "missing_old_monthly_row", safe: false };
  }
  if (!client) {
    return { imported, oldMonthly, mayMonthly, client, reason: "missing_old_client", safe: false };
  }
  if (imported.status !== "matched") {
    return { imported, oldMonthly, mayMonthly, client, reason: "imported_not_matched", safe: false };
  }
  if (oldMonthly.billing_month === MAY_2026_MONTH) {
    return { imported, oldMonthly, mayMonthly, client, reason: "old_month_already_may", safe: false };
  }
  if (oldMonthly.status !== "paid") {
    return { imported, oldMonthly, mayMonthly, client, reason: "old_month_not_paid", safe: false };
  }
  if (!oldMonthly.external_payment_hash) {
    return { imported, oldMonthly, mayMonthly, client, reason: "old_external_hash_missing", safe: false };
  }
  if (oldMonthly.external_payment_hash !== imported.external_hash) {
    return { imported, oldMonthly, mayMonthly, client, reason: "old_external_hash_mismatch", safe: false };
  }
  if (oldMonthly.currency !== imported.currency) {
    return { imported, oldMonthly, mayMonthly, client, reason: "currency_mismatch_old", safe: false };
  }
  if (!mayMonthly) {
    return { imported, oldMonthly, mayMonthly, client, reason: "missing_may_row", safe: false };
  }
  if (mayMonthly.currency !== imported.currency) {
    return { imported, oldMonthly, mayMonthly, client, reason: "currency_mismatch_may", safe: false };
  }
  if (mayMonthly.status === "paid") {
    if (mayMonthly.external_payment_hash === imported.external_hash) {
      return { imported, oldMonthly, mayMonthly, client, reason: "may_paid_same_import", safe: false };
    }
    return { imported, oldMonthly, mayMonthly, client, reason: "may_paid_other_import", safe: false };
  }
  if (mayMonthly.external_payment_hash && mayMonthly.external_payment_hash !== imported.external_hash) {
    return { imported, oldMonthly, mayMonthly, client, reason: "may_linked_other_import", safe: false };
  }
  if (mayMonthly.paid_amount != null && mayMonthly.paid_amount !== 0) {
    return { imported, oldMonthly, mayMonthly, client, reason: "may_partial_amount_present", safe: false };
  }

  return { imported, oldMonthly, mayMonthly, client, reason: "safe", safe: true };
}

function printCandidate(candidate: RepairCandidate): void {
  const clientLabel = candidate.client
    ? `${candidate.client.client_name} (${candidate.client.id})`
    : "unknown_client";
  const mayStatus = candidate.mayMonthly
    ? `status=${candidate.mayMonthly.status} id=${candidate.mayMonthly.id}`
    : "missing";

  console.log("------------------------------------------------------------");
  console.log(`client=${clientLabel}`);
  console.log(`imported_payment_id=${candidate.imported.id}`);
  console.log(`payment_date=${candidate.imported.payment_date}`);
  console.log(`amount=${candidate.imported.amount} ${candidate.imported.currency}`);
  console.log(`current_linked_billing_month=${candidate.oldMonthly?.billing_month ?? "missing"}`);
  console.log(`expected_billing_month=${MAY_2026_MONTH}`);
  console.log(`current_monthly_status=${candidate.oldMonthly?.status ?? "missing"}`);
  console.log(`may_monthly_row=${mayStatus}`);
  console.log(`repair_safe=${candidate.safe}`);
  console.log(`decision=${reasonText(candidate.reason)}`);
}

async function loadCandidates(options: CliOptions): Promise<RepairCandidate[]> {
  const supabase = createSupabaseServerClient();
  const { data: importedData, error: importedError } = await supabase
    .from("billing_imported_payments")
    .select("id,payment_date,amount,currency,status,external_hash,matched_monthly_payment_id")
    .gte("payment_date", MAY_2026_START)
    .lt("payment_date", JUNE_2026_START)
    .not("matched_monthly_payment_id", "is", null)
    .order("payment_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (importedError) {
    throw new Error(`Failed to list imported payments for May 2026: ${importedError.message}`);
  }

  const importedRows = ((importedData as ImportedPaymentRow[] | null) ?? []).filter(
    (row) => row.matched_monthly_payment_id
  );
  if (importedRows.length === 0) {
    return [];
  }

  const oldMonthlyIds = Array.from(
    new Set(importedRows.map((row) => row.matched_monthly_payment_id).filter((id): id is string => Boolean(id)))
  );

  const { data: oldMonthlyData, error: oldMonthlyError } = await supabase
    .from("billing_monthly_payments")
    .select(
      "id,billing_client_id,billing_month,status,actual_payment_date,paid_amount,currency,source,external_payment_hash,planned_payment_date,marked_paid_by"
    )
    .in("id", oldMonthlyIds);

  if (oldMonthlyError) {
    throw new Error(`Failed to load linked monthly payments: ${oldMonthlyError.message}`);
  }

  const oldMonthlyRows = (oldMonthlyData as MonthlyPaymentRow[] | null) ?? [];
  const oldMonthlyById = new Map(oldMonthlyRows.map((row) => [row.id, row]));
  const billingClientIds = Array.from(new Set(oldMonthlyRows.map((row) => row.billing_client_id)));

  const mayRowsByClient = new Map<string, MonthlyPaymentRow>();
  if (billingClientIds.length > 0) {
    const { data: mayMonthlyData, error: mayMonthlyError } = await supabase
      .from("billing_monthly_payments")
      .select(
        "id,billing_client_id,billing_month,status,actual_payment_date,paid_amount,currency,source,external_payment_hash,planned_payment_date,marked_paid_by"
      )
      .eq("billing_month", MAY_2026_MONTH)
      .in("billing_client_id", billingClientIds);

    if (mayMonthlyError) {
      throw new Error(`Failed to load May monthly payments: ${mayMonthlyError.message}`);
    }

    for (const row of (mayMonthlyData as MonthlyPaymentRow[] | null) ?? []) {
      mayRowsByClient.set(row.billing_client_id, row);
    }
  }

  const clientsById = new Map<string, ClientRow>();
  if (billingClientIds.length > 0) {
    const clientsQuery = supabase.from("billing_clients").select("id,client_name").in("id", billingClientIds);
    if (options.clientId) {
      clientsQuery.eq("id", options.clientId);
    }
    if (options.clientName) {
      clientsQuery.ilike("client_name", `%${options.clientName}%`);
    }

    const { data: clientsData, error: clientsError } = await clientsQuery;
    if (clientsError) {
      throw new Error(`Failed to load billing clients: ${clientsError.message}`);
    }

    for (const row of (clientsData as ClientRow[] | null) ?? []) {
      clientsById.set(row.id, row);
    }
  }

  const filteredImportedRows = importedRows.filter((imported) => {
    const old = imported.matched_monthly_payment_id ? oldMonthlyById.get(imported.matched_monthly_payment_id) : null;
    if (!old) {
      return true;
    }
    if (options.clientId && old.billing_client_id !== options.clientId) {
      return false;
    }
    if (options.clientName && !clientsById.has(old.billing_client_id)) {
      return false;
    }
    return true;
  });

  return filteredImportedRows
    .map((imported) => {
      const oldMonthly = imported.matched_monthly_payment_id
        ? (oldMonthlyById.get(imported.matched_monthly_payment_id) ?? null)
        : null;
      const client = oldMonthly ? (clientsById.get(oldMonthly.billing_client_id) ?? null) : null;
      const mayMonthly = oldMonthly ? (mayRowsByClient.get(oldMonthly.billing_client_id) ?? null) : null;
      return evaluateCandidate({ imported, oldMonthly, mayMonthly, client });
    })
    .filter((candidate) => candidate.reason !== "old_month_already_may");
}

async function executeRepair(candidates: RepairCandidate[]): Promise<ExecutionResult> {
  const supabase = createSupabaseServerClient();
  const result: ExecutionResult = { repaired: 0, skipped: 0, errors: 0 };

  for (const candidate of candidates) {
    if (!candidate.safe) {
      result.skipped += 1;
      continue;
    }

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
          "id,billing_client_id,billing_month,status,actual_payment_date,paid_amount,currency,source,external_payment_hash,planned_payment_date,marked_paid_by"
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
      const { data: mayData, error: mayError } = await supabase
        .from("billing_monthly_payments")
        .select(
          "id,billing_client_id,billing_month,status,actual_payment_date,paid_amount,currency,source,external_payment_hash,planned_payment_date,marked_paid_by"
        )
        .eq("billing_client_id", freshOld.billing_client_id)
        .eq("billing_month", MAY_2026_MONTH)
        .maybeSingle();
      if (mayError) {
        throw new Error(`reload May monthly failed: ${mayError.message}`);
      }

      const freshCandidate = evaluateCandidate({
        imported: freshImported,
        oldMonthly: freshOld,
        mayMonthly: (mayData as MonthlyPaymentRow | null) ?? null,
        client: candidate.client,
      });
      if (!freshCandidate.safe || !freshCandidate.mayMonthly) {
        result.skipped += 1;
        console.warn(
          `[billing-repair-may-2026-payment-allocation] SKIP imported=${candidate.imported.id} reason=${reasonText(
            freshCandidate.reason
          )}`
        );
        continue;
      }

      const matchedAt = new Date().toISOString();
      const { error: mayUpdateError } = await supabase
        .from("billing_monthly_payments")
        .update({
          status: "paid",
          actual_payment_date: freshImported.payment_date,
          paid_amount: freshImported.amount,
          source: "email_import",
          external_payment_hash: freshImported.external_hash,
          marked_paid_by: REPAIR_ACTOR,
          updated_by: REPAIR_ACTOR,
        })
        .eq("id", freshCandidate.mayMonthly.id);
      if (mayUpdateError) {
        throw new Error(`update May monthly failed: ${mayUpdateError.message}`);
      }

      const { error: importedUpdateError } = await supabase
        .from("billing_imported_payments")
        .update({
          status: "matched",
          matched_monthly_payment_id: freshCandidate.mayMonthly.id,
          matched_at: matchedAt,
          matched_by_coach_chat_id: REPAIR_ACTOR,
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
          updated_by: REPAIR_ACTOR,
        })
        .eq("id", freshCandidate.oldMonthly!.id);
      if (oldUpdateError) {
        throw new Error(`reset old monthly failed: ${oldUpdateError.message}`);
      }

      result.repaired += 1;
      console.log(
        `[billing-repair-may-2026-payment-allocation] REPAIRED imported=${freshImported.id} old_monthly=${freshCandidate.oldMonthly!.id} may_monthly=${freshCandidate.mayMonthly.id}`
      );
    } catch (error) {
      result.errors += 1;
      console.error(
        `[billing-repair-may-2026-payment-allocation] ERROR imported=${candidate.imported.id} ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return result;
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (!getEnvValue("SUPABASE_SERVICE_ROLE_KEY")) {
    console.log("[billing-repair-may-2026-payment-allocation] SKIP");
    console.log("Missing SUPABASE_SERVICE_ROLE_KEY.");
    printUsage();
    return;
  }

  if (!getEnvValue("SUPABASE_URL") && !getEnvValue("NEXT_PUBLIC_SUPABASE_URL")) {
    console.log("[billing-repair-may-2026-payment-allocation] SKIP");
    console.log("Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.");
    printUsage();
    return;
  }

  if (process.env.SUPABASE_URL == null && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }

  createSupabaseServerClient();

  const candidates = await loadCandidates(options);
  const safeCandidates = candidates.filter((candidate) => candidate.safe);
  const skippedCandidates = candidates.length - safeCandidates.length;
  const missingMayCount = candidates.filter((candidate) => candidate.reason === "missing_may_row").length;
  const ambiguousCount = candidates.filter((candidate) => !candidate.safe && candidate.reason !== "missing_may_row").length;

  console.log(
    `[billing-repair-may-2026-payment-allocation] ${options.execute ? "EXECUTE" : "DRY RUN"}`
  );
  console.log(`month_scope=${MAY_2026_START}..${JUNE_2026_START} (payment_date)`);
  console.log(`client_id_filter=${options.clientId ?? "none"}`);
  console.log(`client_name_filter=${options.clientName ?? "none"}`);
  console.log(`candidate_count=${candidates.length}`);
  console.log(`safe_candidate_count=${safeCandidates.length}`);
  console.log(`skipped_candidate_count=${skippedCandidates}`);
  console.log(`skipped_missing_may_row=${missingMayCount}`);
  console.log(`skipped_ambiguous_or_unsafe=${ambiguousCount}`);
  console.log("note=Non-transactional per-item updates. Review dry-run before --execute.");

  for (const candidate of candidates) {
    printCandidate(candidate);
  }

  if (!options.execute) {
    console.log("dry_run_only=true");
    console.log("no_changes_applied=true");
    return;
  }

  const execution = await executeRepair(candidates);
  console.log(`repaired_count=${execution.repaired}`);
  console.log(`execute_skipped_count=${execution.skipped}`);
  console.log(`execute_error_count=${execution.errors}`);
}

void run().catch((error) => {
  console.error("[billing-repair-may-2026-payment-allocation] FAIL");
  console.error(error instanceof Error ? error.message : String(error));
  printUsage();
  process.exit(1);
});
