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

/**
 * ЖУРНАЛ ВХОДЯЩИХ ВЫЗОВОВ — ПЕРВЫМ ДЕЙСТВИЕМ, ДО ПРОВЕРКИ СЕКРЕТА.
 *
 * Диагностика 13.08 упёрлась в тупик: за 11-12.08 записей о прогонах нет, и отличить
 * «вызов не пришёл» от «вызов пришёл и упал на 401» было НЕЧЕМ — маршрут отдавал ошибку
 * до создания строки прогона и не оставлял следа нигде. Обе версии остались догадками.
 *
 * Запись никогда не мешает работе: любая ошибка журналирования проглатывается, потому что
 * потерять импорт из-за неудачной записи в служебную таблицу хуже, чем потерять запись.
 */
async function logAttempt(
  outcome: string,
  request: Request,
  extra: { httpStatus?: number; note?: string; runId?: string | null } = {},
): Promise<void> {
  try {
    const { createSupabaseServerClient } = await import("@/features/supabase/server");
    await createSupabaseServerClient().from("billing_email_import_attempts").insert({
      outcome,
      // версия деплоя: видно, менялось ли что-то между удачными и пропущенными днями
      deployment_id: process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      caller: request.headers.get("x-vercel-cron") ? "vercel-cron" : (request.headers.get("x-failsafe-caller") ?? "unknown"),
      http_status: extra.httpStatus ?? null,
      note: extra.note ?? null,
      run_id: extra.runId ?? null,
    });
  } catch {
    // молча: журнал не важнее самого импорта
  }
}

async function handleBillingEmailImport(request: Request) {
  if (!process.env.CRON_SECRET?.trim()) {
    await logAttempt("misconfigured", request, { httpStatus: 500, note: "CRON_SECRET не задан" });
    return jsonResponse(500, {
      ok: false,
      error: "Internal server error",
    });
  }

  if (!isValidBillingCronSecret(request)) {
    await logAttempt("unauthorized", request, { httpStatus: 401 });
    return jsonResponse(401, {
      ok: false,
      error: "Unauthorized",
    });
  }

  await logAttempt("started", request);

  try {
    const summary = await runBillingEmailImport({ apply: true });
    await logAttempt("ok", request, { httpStatus: 200, runId: summary.runId ?? null });
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
  } catch (error) {
    await logAttempt("failed", request, { httpStatus: 500, note: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) });
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
