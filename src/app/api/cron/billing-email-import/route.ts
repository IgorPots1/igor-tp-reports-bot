import { runBillingEmailImport, isValidBillingCronSecret } from "@/features/billing/email-ingestion";

export const runtime = "nodejs";

const jsonHeaders = {
  "Content-Type": "application/json",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}

async function handleBillingEmailImport(request: Request) {
  if (!process.env.CRON_SECRET?.trim()) {
    return jsonResponse(500, {
      ok: false,
      error: "Internal server error",
    });
  }

  if (!isValidBillingCronSecret(request)) {
    return jsonResponse(401, {
      ok: false,
      error: "Unauthorized",
    });
  }

  try {
    const summary = await runBillingEmailImport({ apply: true });
    return jsonResponse(200, {
      ok: true,
      summary: {
        mode: summary.mode,
        date_range: summary.dateRange,
        filters: summary.filters,
        max_messages: summary.maxMessages,
        processing_order: summary.processingOrder,
        scanned_messages_count: summary.scannedMessagesCount,
        matched_messages_count: summary.matchedMessagesCount,
        found_attachments_count: summary.foundAttachmentsCount,
        imported_payments_count: summary.importedPaymentsCount,
        duplicate_payments_count: summary.duplicatePaymentsCount,
        skipped_attachments_count: summary.skippedAttachmentsCount,
        already_processed_attachments_count: summary.alreadyProcessedAttachmentsCount,
        auto_matched_count: summary.autoMatchedCount,
        review_required_count: summary.reviewRequiredCount,
        skipped_count: summary.skippedCount,
        errors_count: summary.errorsCount,
        run_id: summary.runId,
        telegram_summary_status: summary.telegramSummaryStatus,
      },
    });
  } catch {
    return jsonResponse(500, {
      ok: false,
      error: "Internal server error",
    });
  }
}

export async function GET(request: Request) {
  return handleBillingEmailImport(request);
}

export async function POST(request: Request) {
  return handleBillingEmailImport(request);
}
