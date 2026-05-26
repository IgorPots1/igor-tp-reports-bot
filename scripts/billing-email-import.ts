import process from "node:process";
import { pathToFileURL } from "node:url";

import { runBillingEmailImport } from "@/features/billing/email-ingestion";

type CliOptions = {
  apply: boolean;
  lookbackDays?: number;
  mailbox?: string;
  since?: string;
  until?: string;
  fromEmail?: string;
  subjectContains?: string;
  maxMessages?: number;
};

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return parsed;
}

function parseDateOnly(value: string, flag: "--since" | "--until"): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${flag} must be in YYYY-MM-DD format.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${flag} must be a valid calendar date in YYYY-MM-DD format.`);
  }
  return value;
}

export function parseArgs(argv: string[]): CliOptions {
  let apply = false;
  let lookbackDays: number | undefined;
  let mailbox: string | undefined;
  let since: string | undefined;
  let until: string | undefined;
  let fromEmail: string | undefined;
  let subjectContains: string | undefined;
  let maxMessages: number | undefined;

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
        lookbackDays = parseNonNegativeInteger(value, "--lookback-days");
        index += 1;
      } else {
        throw new Error("--lookback-days requires a value.");
      }
      continue;
    }

    if (arg.startsWith("--lookback-days=")) {
      lookbackDays = parseNonNegativeInteger(arg.slice("--lookback-days=".length), "--lookback-days");
      continue;
    }

    if (arg === "--mailbox") {
      mailbox = argv[index + 1];
      if (!mailbox) {
        throw new Error("--mailbox requires a value.");
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--mailbox=")) {
      mailbox = arg.slice("--mailbox=".length);
      continue;
    }

    if (arg === "--since") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--since requires a value.");
      }
      since = parseDateOnly(value, "--since");
      index += 1;
      continue;
    }

    if (arg.startsWith("--since=")) {
      since = parseDateOnly(arg.slice("--since=".length), "--since");
      continue;
    }

    if (arg === "--until") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--until requires a value.");
      }
      until = parseDateOnly(value, "--until");
      index += 1;
      continue;
    }

    if (arg.startsWith("--until=")) {
      until = parseDateOnly(arg.slice("--until=".length), "--until");
      continue;
    }

    if (arg === "--from-email") {
      const value = argv[index + 1];
      if (!value?.trim()) {
        throw new Error("--from-email requires a value.");
      }
      fromEmail = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--from-email=")) {
      const value = arg.slice("--from-email=".length).trim();
      if (!value) {
        throw new Error("--from-email requires a value.");
      }
      fromEmail = value;
      continue;
    }

    if (arg === "--subject-contains") {
      const value = argv[index + 1];
      if (!value?.trim()) {
        throw new Error("--subject-contains requires a value.");
      }
      subjectContains = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--subject-contains=")) {
      const value = arg.slice("--subject-contains=".length).trim();
      if (!value) {
        throw new Error("--subject-contains requires a value.");
      }
      subjectContains = value;
      continue;
    }

    if (arg === "--max-messages") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--max-messages requires a value.");
      }
      maxMessages = parsePositiveInteger(value, "--max-messages");
      index += 1;
      continue;
    }

    if (arg.startsWith("--max-messages=")) {
      maxMessages = parsePositiveInteger(arg.slice("--max-messages=".length), "--max-messages");
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
  }

  if (since && until && since > until) {
    throw new Error("--since cannot be later than --until.");
  }

  return {
    apply,
    lookbackDays,
    mailbox,
    since,
    until,
    fromEmail,
    subjectContains,
    maxMessages,
  };
}

function printUsage(): void {
  console.log("Usage:");
  console.log(
    "  npm run billing:email-import -- [--dry-run|--apply] [--lookback-days N] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--from-email EMAIL] [--subject-contains TEXT] [--max-messages N] [--mailbox INBOX]"
  );
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const summary = await runBillingEmailImport({
    apply: options.apply,
    lookbackDays: options.lookbackDays,
    mailbox: options.mailbox,
    since: options.since,
    until: options.until,
    fromEmail: options.fromEmail,
    subjectContains: options.subjectContains,
    maxMessages: options.maxMessages,
  });

  console.log(`[billing-email-import] ${summary.mode === "apply" ? "APPLIED" : "DRY RUN"}`);
  console.log(`mode=${summary.mode}`);
  console.log(`date_range_since=${summary.dateRange.since ?? "lookback"}`);
  console.log(`date_range_until=${summary.dateRange.until ?? "open"}`);
  console.log(`lookback_days_used=${summary.dateRange.lookbackDays ?? "n/a"}`);
  console.log(`sender_filter_used=${summary.filters.fromEmail ?? "none"}`);
  console.log(`subject_filter_used=${summary.filters.subjectContains ?? "none"}`);
  console.log(`max_messages_used=${summary.maxMessages ?? "unbounded"}`);
  console.log(`processing_order=${summary.processingOrder}`);
  console.log(`scanned_messages_count=${summary.scannedMessagesCount}`);
  console.log(`matched_messages_count=${summary.matchedMessagesCount}`);
  console.log(`found_attachments_count=${summary.foundAttachmentsCount}`);
  console.log(`imported_payments_count=${summary.importedPaymentsCount}`);
  console.log(`duplicate_payments_count=${summary.duplicatePaymentsCount}`);
  console.log(`skipped_attachments_count=${summary.skippedAttachmentsCount}`);
  console.log(`already_processed_attachments_count=${summary.alreadyProcessedAttachmentsCount}`);
  console.log(`auto_matched_count=${summary.autoMatchedCount}`);
  console.log(`review_required_count=${summary.reviewRequiredCount}`);
  console.log(`skipped_count=${summary.skippedCount}`);
  console.log(`errors_count=${summary.errorsCount}`);
  console.log(`run_id=${summary.runId ?? "n/a"}`);
  console.log(`telegram_summary_status=${summary.telegramSummaryStatus}`);
}

function isMainModule(): boolean {
  if (!process.argv[1]) {
    return false;
  }
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  void run().catch((error) => {
    console.error("[billing-email-import] FAIL");
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exit(1);
  });
}
