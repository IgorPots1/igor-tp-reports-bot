import process from "node:process";

import { runBillingEmailImport } from "@/features/billing/email-ingestion";

type CliOptions = {
  apply: boolean;
  lookbackDays?: number;
  mailbox?: string;
};

function parseArgs(argv: string[]): CliOptions {
  let apply = false;
  let lookbackDays: number | undefined;
  let mailbox: string | undefined;

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

    if (arg === "--lookback-days") {
      const value = argv[index + 1];
      if (value) {
        lookbackDays = Number.parseInt(value, 10);
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--lookback-days=")) {
      lookbackDays = Number.parseInt(arg.slice("--lookback-days=".length), 10);
      continue;
    }

    if (arg === "--mailbox") {
      mailbox = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--mailbox=")) {
      mailbox = arg.slice("--mailbox=".length);
    }
  }

  return { apply, lookbackDays, mailbox };
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  npm run billing:email-import -- [--dry-run|--apply] [--lookback-days N] [--mailbox INBOX]");
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const summary = await runBillingEmailImport({
    apply: options.apply,
    lookbackDays: options.lookbackDays,
    mailbox: options.mailbox,
  });

  console.log(`[billing-email-import] ${summary.mode === "apply" ? "APPLIED" : "DRY RUN"}`);
  console.log(`mode=${summary.mode}`);
  console.log(`scanned_messages_count=${summary.scannedMessagesCount}`);
  console.log(`found_attachments_count=${summary.foundAttachmentsCount}`);
  console.log(`imported_payments_count=${summary.importedPaymentsCount}`);
  console.log(`duplicate_payments_count=${summary.duplicatePaymentsCount}`);
  console.log(`auto_matched_count=${summary.autoMatchedCount}`);
  console.log(`review_required_count=${summary.reviewRequiredCount}`);
  console.log(`skipped_count=${summary.skippedCount}`);
  console.log(`errors_count=${summary.errorsCount}`);
  console.log(`run_id=${summary.runId ?? "n/a"}`);
  console.log(`telegram_summary_status=${summary.telegramSummaryStatus}`);
}

void run().catch((error) => {
  console.error("[billing-email-import] FAIL");
  console.error(error instanceof Error ? error.message : String(error));
  printUsage();
  process.exit(1);
});
