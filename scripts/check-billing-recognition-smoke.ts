import process from "node:process";
import { randomUUID } from "node:crypto";

import {
  autoMatchTrustedImportedPayments,
  confirmImportedPaymentMatch,
  resolveBillingMonth,
} from "@/features/billing/service";
import { listBillingPayerIdentitiesForClient } from "@/features/billing/repository";
import { createSupabaseServerClient } from "@/features/supabase/server";

const MARKER = "script:check-billing-recognition-smoke";
const TEST_ACTOR = MARKER;

function getEnvValue(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function monthPaymentDate(isoMonthStart: string, day = 10): string {
  const date = new Date(`${isoMonthStart}T12:00:00.000Z`);
  const safeDay = Math.max(1, Math.min(28, day));
  const shifted = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), safeDay, 12, 0, 0));
  return shifted.toISOString().slice(0, 10);
}

async function run(): Promise<void> {
  if (!getEnvValue("SUPABASE_SERVICE_ROLE_KEY")) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }
  if (!getEnvValue("SUPABASE_URL") && !getEnvValue("NEXT_PUBLIC_SUPABASE_URL")) {
    throw new Error("Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.");
  }
  if (process.env.SUPABASE_URL == null && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }

  const supabase = createSupabaseServerClient();
  const runTag = randomUUID().slice(0, 8);
  const payerHint = `Smoke Payer ${runTag} Stable`;
  const description = null;
  const sourceFileName = `${MARKER}:${runTag}`;
  const importBatchId1 = randomUUID();
  const importBatchId2 = randomUUID();
  const externalHash1 = `smoke-ext-1-${runTag}`;
  const externalHash2 = `smoke-ext-2-${runTag}`;

  const month1 = resolveBillingMonth("2098-11");
  const month2 = resolveBillingMonth("2098-12");
  const paymentDate1 = monthPaymentDate(month1, 11);
  const paymentDate2 = monthPaymentDate(month2, 12);

  let createdClientId: string | null = null;
  const createdMonthlyIds: string[] = [];
  const createdImportedIds: string[] = [];
  let learnedIdentitiesCount = 0;
  let dryRunTrustedMatches = 0;
  let applyMatchedCount = 0;
  const cleanupErrors: string[] = [];

  try {
    const { data: insertedClient, error: clientInsertError } = await supabase
      .from("billing_clients")
      .insert({
        client_name: `Smoke Billing Client ${runTag}`,
        group_name: "Smoke QA",
        monthly_amount: 5000,
        currency: "RUB",
        planned_payment_day: 10,
        payment_method: "manual_other",
        is_active: true,
        notes: MARKER,
        created_by: MARKER,
        updated_by: MARKER,
      })
      .select("id, client_name")
      .single();
    if (clientInsertError || !insertedClient) {
      throw new Error(`Failed to insert smoke billing client: ${clientInsertError?.message ?? "unknown error"}`);
    }
    createdClientId = insertedClient.id;

    const { data: monthly1, error: monthly1Error } = await supabase
      .from("billing_monthly_payments")
      .insert({
        billing_client_id: createdClientId,
        billing_month: month1,
        planned_payment_date: monthPaymentDate(month1, 10),
        planned_amount: 5000,
        currency: "RUB",
        status: "pending",
        source: "manual",
        notes: MARKER,
        created_by: MARKER,
        updated_by: MARKER,
      })
      .select("id")
      .single();
    if (monthly1Error || !monthly1) {
      throw new Error(`Failed to insert monthly payment #1: ${monthly1Error?.message ?? "unknown error"}`);
    }
    createdMonthlyIds.push(monthly1.id);

    const { data: imported1, error: imported1Error } = await supabase
      .from("billing_imported_payments")
      .insert({
        import_batch_id: importBatchId1,
        payment_date: paymentDate1,
        amount: 5000,
        currency: "RUB",
        payer_hint: payerHint,
        description,
        raw_row: {
          sourceFormat: "tbank_csv",
          rowNumber: 1,
          orderNumber: "SMOKE-1",
          operationDateRaw: paymentDate1,
          operationTimeRaw: "12:00:00",
          amountRaw: "5000",
          commissionRaw: null,
          payoutAmountRaw: "5000",
          operationType: "income",
          paymentId: `SMOKE-PAY-1-${runTag}`,
          terminalName: "SMOKE",
          descriptionRaw: null,
          dataFlags: {
            hasEmail: false,
            hasPhone: false,
            hasName: true,
          },
        },
        external_hash: externalHash1,
        status: "new",
        source_file_name: sourceFileName,
      })
      .select("id")
      .single();
    if (imported1Error || !imported1) {
      throw new Error(`Failed to insert imported payment #1: ${imported1Error?.message ?? "unknown error"}`);
    }
    createdImportedIds.push(imported1.id);

    const confirmed1 = await confirmImportedPaymentMatch({
      importedPaymentId: imported1.id,
      monthlyPaymentId: monthly1.id,
      actor: TEST_ACTOR,
    });
    assert(confirmed1.monthlyPayment.status === "paid", "Expected monthly payment #1 to be paid after manual confirm.");
    assert(confirmed1.importedPayment.status === "matched", "Expected imported payment #1 to be matched after manual confirm.");

    const smokeClientId = createdClientId;
    if (!smokeClientId) {
      throw new Error("Smoke billing client id is missing.");
    }

    const learned = await listBillingPayerIdentitiesForClient(smokeClientId);
    learnedIdentitiesCount = learned.length;
    assert(learnedIdentitiesCount > 0, "Expected at least one learned payer identity after manual confirm.");

    const { data: monthly2, error: monthly2Error } = await supabase
      .from("billing_monthly_payments")
      .insert({
        billing_client_id: createdClientId,
        billing_month: month2,
        planned_payment_date: monthPaymentDate(month2, 10),
        planned_amount: 5000,
        currency: "RUB",
        status: "pending",
        source: "manual",
        notes: MARKER,
        created_by: MARKER,
        updated_by: MARKER,
      })
      .select("id")
      .single();
    if (monthly2Error || !monthly2) {
      throw new Error(`Failed to insert monthly payment #2: ${monthly2Error?.message ?? "unknown error"}`);
    }
    createdMonthlyIds.push(monthly2.id);

    const { data: imported2, error: imported2Error } = await supabase
      .from("billing_imported_payments")
      .insert({
        import_batch_id: importBatchId2,
        payment_date: paymentDate2,
        amount: 5000,
        currency: "RUB",
        payer_hint: payerHint,
        description,
        raw_row: {
          sourceFormat: "tbank_csv",
          rowNumber: 2,
          orderNumber: "SMOKE-2",
          operationDateRaw: paymentDate2,
          operationTimeRaw: "12:00:00",
          amountRaw: "5000",
          commissionRaw: null,
          payoutAmountRaw: "5000",
          operationType: "income",
          paymentId: `SMOKE-PAY-2-${runTag}`,
          terminalName: "SMOKE",
          descriptionRaw: null,
          dataFlags: {
            hasEmail: false,
            hasPhone: false,
            hasName: true,
          },
        },
        external_hash: externalHash2,
        status: "new",
        source_file_name: sourceFileName,
      })
      .select("id")
      .single();
    if (imported2Error || !imported2) {
      throw new Error(`Failed to insert imported payment #2: ${imported2Error?.message ?? "unknown error"}`);
    }
    createdImportedIds.push(imported2.id);

    const dryRun = await autoMatchTrustedImportedPayments({
      apply: false,
      month: month2.slice(0, 7),
    });
    dryRunTrustedMatches = dryRun.trustedMatches;
    const dryRunFoundOurCandidate = dryRun.trustedMatchDetails.some(
      (detail) =>
        detail.importedPaymentId === imported2.id &&
        detail.monthlyPaymentId === monthly2.id &&
        detail.billingClientId === smokeClientId &&
        detail.targetMonth === month2
    );
    assert(
      dryRunFoundOurCandidate,
      "Expected dry-run trusted auto-match to include the smoke imported payment #2 candidate."
    );

    const apply = await autoMatchTrustedImportedPayments({
      apply: true,
      month: month2.slice(0, 7),
    });
    applyMatchedCount = apply.matched;

    const { data: imported2After, error: imported2AfterError } = await supabase
      .from("billing_imported_payments")
      .select("status, matched_monthly_payment_id")
      .eq("id", imported2.id)
      .single();
    if (imported2AfterError || !imported2After) {
      throw new Error(
        `Failed to read imported payment #2 after apply: ${imported2AfterError?.message ?? "unknown error"}`
      );
    }
    assert(imported2After.status === "matched", "Expected imported payment #2 to be matched after apply.");
    assert(
      imported2After.matched_monthly_payment_id === monthly2.id,
      "Expected imported payment #2 to be matched to monthly payment #2."
    );

    const { data: monthly2After, error: monthly2AfterError } = await supabase
      .from("billing_monthly_payments")
      .select("status, paid_amount")
      .eq("id", monthly2.id)
      .single();
    if (monthly2AfterError || !monthly2After) {
      throw new Error(
        `Failed to read monthly payment #2 after apply: ${monthly2AfterError?.message ?? "unknown error"}`
      );
    }
    assert(monthly2After.status === "paid", "Expected monthly payment #2 to be paid after apply.");
    assert(monthly2After.paid_amount === 5000, "Expected monthly payment #2 paid amount to equal imported amount.");

    console.log("[check-billing-recognition-smoke] PASS");
    console.log("backend=db");
    console.log(`marker=${MARKER}`);
    console.log(`temporary_rows_created_clients=${createdClientId ? 1 : 0}`);
    console.log(`temporary_rows_created_monthly_payments=${createdMonthlyIds.length}`);
    console.log(`temporary_rows_created_imported_payments=${createdImportedIds.length}`);
    console.log(`learned_identities_count=${learnedIdentitiesCount}`);
    console.log(`dry_run_trusted_matches=${dryRunTrustedMatches}`);
    console.log(`apply_matched=${applyMatchedCount}`);
  } finally {
    if (createdImportedIds.length > 0) {
      const { error } = await supabase.from("billing_imported_payments").delete().in("id", createdImportedIds);
      if (error) {
        cleanupErrors.push(`imported_payments:${error.message}`);
      }
    }
    if (createdMonthlyIds.length > 0) {
      const { error } = await supabase.from("billing_monthly_payments").delete().in("id", createdMonthlyIds);
      if (error) {
        cleanupErrors.push(`monthly_payments:${error.message}`);
      }
    }
    if (createdClientId) {
      const { error: identitiesError } = await supabase
        .from("billing_payer_identities")
        .delete()
        .eq("billing_client_id", createdClientId);
      if (identitiesError) {
        cleanupErrors.push(`payer_identities:${identitiesError.message}`);
      }

      const { error: clientError } = await supabase.from("billing_clients").delete().eq("id", createdClientId);
      if (clientError) {
        cleanupErrors.push(`billing_client:${clientError.message}`);
      }
    }

    if (cleanupErrors.length === 0) {
      console.log("cleanup=ok");
    } else {
      console.log("cleanup=failed");
      console.log(`cleanup_errors=${cleanupErrors.join(" | ")}`);
    }
  }
}

void run().catch((error) => {
  console.error("[check-billing-recognition-smoke] FAIL");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
