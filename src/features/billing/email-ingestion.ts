import { createHash, timingSafeEqual } from "node:crypto";
import { ImapFlow } from "imapflow";

import {
  createBillingEmailImportAttachment,
  createBillingEmailImportRun,
  getBillingEmailImportAttachmentByMessageUidHash,
  updateBillingEmailImportAttachmentById,
  updateBillingEmailImportRunById,
} from "@/features/billing/repository";
import { parseTBankStatementBuffer } from "@/features/billing/import/parse-tbank-statement";
import { autoMatchTrustedImportedPayments, importBillingPaymentsFromParsedRows } from "@/features/billing/service";
import type { BillingEmailImportSummary } from "@/features/billing/types";
import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";
import { sendTelegramMessageStrict } from "@/features/telegram/telegram-client";

type BillingEmailImportOptions = {
  apply?: boolean;
  lookbackDays?: number;
  mailbox?: string;
};

type BillingEmailConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  mailbox: string;
  lookbackDays: number;
  fromQuery: string | null;
  subjectQuery: string | null;
  filenameQuery: string | null;
};

type ImapAttachment = {
  part: string;
  filename: string;
  contentType: string | null;
};

type ImapEnvelopeAddress = {
  address?: string | null;
  name?: string | null;
};

type ImapEnvelope = {
  subject?: string | null;
  from?: ImapEnvelopeAddress[] | null;
  messageId?: string | null;
};

type ImapBodyStructure = {
  part?: string | null;
  type?: string | null;
  disposition?: string | null;
  dispositionParameters?: Record<string, string> | null;
  parameters?: Record<string, string> | null;
  childNodes?: ImapBodyStructure[] | null;
};

type AttachmentProcessCounts = {
  importedPaymentsCount: number;
  duplicatePaymentsCount: number;
  skippedCount: number;
  errorsCount: number;
};

const DEFAULT_IMAP_HOST = "imap.yandex.com";
const DEFAULT_IMAP_PORT = 993;
const DEFAULT_IMAP_MAILBOX = "INBOX";
const DEFAULT_LOOKBACK_DAYS = 7;

function getOptionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getRequiredEnv(name: string): string {
  const value = getOptionalEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getSupabaseUrl(): string {
  const direct = getOptionalEnv("SUPABASE_URL");
  if (direct) {
    return direct;
  }

  const fallback = getOptionalEnv("NEXT_PUBLIC_SUPABASE_URL");
  if (fallback) {
    process.env.SUPABASE_URL = fallback;
    return fallback;
  }

  throw new Error("Missing required environment variable: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
}

function ensureConfiguredForBillingApplyImport(): void {
  getSupabaseUrl();
  getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
}

function resolveConfig(options: BillingEmailImportOptions): BillingEmailConfig {
  const host = getOptionalEnv("BILLING_EMAIL_IMAP_HOST") ?? DEFAULT_IMAP_HOST;
  const portValue = getOptionalEnv("BILLING_EMAIL_IMAP_PORT");
  const port = portValue ? Number.parseInt(portValue, 10) : DEFAULT_IMAP_PORT;

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("BILLING_EMAIL_IMAP_PORT must be a positive integer.");
  }

  const configuredLookback = getOptionalEnv("BILLING_EMAIL_LOOKBACK_DAYS");
  const lookbackDays = options.lookbackDays ?? (configuredLookback ? Number.parseInt(configuredLookback, 10) : DEFAULT_LOOKBACK_DAYS);

  if (!Number.isInteger(lookbackDays) || lookbackDays < 0) {
    throw new Error("BILLING_EMAIL_LOOKBACK_DAYS must be a non-negative integer.");
  }

  return {
    host,
    port,
    username: getRequiredEnv("BILLING_EMAIL_IMAP_USERNAME"),
    password: getRequiredEnv("BILLING_EMAIL_IMAP_PASSWORD"),
    mailbox: options.mailbox?.trim() || getOptionalEnv("BILLING_EMAIL_MAILBOX") || DEFAULT_IMAP_MAILBOX,
    lookbackDays,
    fromQuery: getOptionalEnv("BILLING_EMAIL_FROM_QUERY"),
    subjectQuery: getOptionalEnv("BILLING_EMAIL_SUBJECT_QUERY"),
    filenameQuery: getOptionalEnv("BILLING_EMAIL_FILENAME_QUERY"),
  };
}

function getLookbackSinceDate(lookbackDays: number): Date {
  return new Date(Date.now() - lookbackDays * 86400000);
}

function normalizeForContains(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().trim();
}

function attachmentLooksLikeCsv(filename: string, contentType: string | null): boolean {
  const lowerFileName = filename.toLowerCase();
  const lowerType = (contentType ?? "").toLowerCase();
  return (
    lowerFileName.endsWith(".csv") ||
    lowerFileName.endsWith(".txt") ||
    lowerType === "text/csv" ||
    lowerType === "text/plain"
  );
}

function matchesFilenameQuery(filename: string, query: string | null): boolean {
  if (!query) {
    return true;
  }

  return normalizeForContains(filename).includes(normalizeForContains(query));
}

function matchesEnvelopeQueries(envelope: ImapEnvelope | null | undefined, config: BillingEmailConfig): boolean {
  const subject = normalizeForContains(envelope?.subject);
  const fromAddresses = (envelope?.from ?? [])
    .map((entry) => normalizeForContains(entry.address) || normalizeForContains(entry.name))
    .filter(Boolean)
    .join(" ");

  if (config.subjectQuery && !subject.includes(normalizeForContains(config.subjectQuery))) {
    return false;
  }

  if (config.fromQuery && !fromAddresses.includes(normalizeForContains(config.fromQuery))) {
    return false;
  }

  return true;
}

function findAttachments(node: ImapBodyStructure | null | undefined): ImapAttachment[] {
  if (!node) {
    return [];
  }

  const attachments: ImapAttachment[] = [];
  const topType = (node.type ?? "").split("/")[0];
  const isAttachment =
    node.disposition === "attachment" || (!!node.type && topType !== "text" && topType !== "multipart" && !node.disposition);

  if (isAttachment) {
    attachments.push({
      part: node.part || "1",
      contentType: node.type ?? null,
      filename:
        node.dispositionParameters?.filename ||
        node.parameters?.name ||
        "attachment",
    });
  }

  for (const child of node.childNodes ?? []) {
    attachments.push(...findAttachments(child));
  }

  return attachments;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function buildAttachmentHash(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function buildSafeSourceFileName(messageUid: string, filename: string): string {
  const cleanFilename = filename.replace(/[^\w.-]+/g, "_").slice(0, 120) || "attachment.csv";
  return `email-${messageUid}-${cleanFilename}`;
}

async function maybeSendTelegramSummary(summary: BillingEmailImportSummary, mode: "apply" | "dry_run") {
  if (mode !== "apply") {
    return { status: "skipped", reason: "dry_run" } as const;
  }

  const token = getOptionalEnv("TELEGRAM_BOT_TOKEN");
  const coachChatIds = getTrainingPeaksCoachChatIds();
  if (!token || coachChatIds.length === 0) {
    return { status: "skipped", reason: "telegram_not_configured" } as const;
  }

  const text = `Оплаты: найдено ${summary.foundAttachmentsCount} вложений, импортировано ${summary.importedPaymentsCount}, автозачтено ${summary.autoMatchedCount}, на проверке ${summary.reviewRequiredCount}.`;

  try {
    await Promise.all(coachChatIds.map((chatId) => sendTelegramMessageStrict(chatId, text)));
    return { status: "sent", reason: null } as const;
  } catch {
    return { status: "failed", reason: "telegram_send_failed" } as const;
  }
}

async function processAttachment(input: {
  apply: boolean;
  runId: string | null;
  messageUid: string;
  messageId: string | null;
  attachment: ImapAttachment;
  content: Buffer;
}): Promise<AttachmentProcessCounts> {
  const attachmentHash = buildAttachmentHash(input.content);
  const existingAttachment = await getBillingEmailImportAttachmentByMessageUidHash({
    messageUid: input.messageUid,
    attachmentHash,
  });

  if (existingAttachment) {
    return {
      importedPaymentsCount: 0,
      duplicatePaymentsCount: 0,
      skippedCount: 1,
      errorsCount: 0,
    };
  }

  const parsed = parseTBankStatementBuffer(input.content);
  const dedupedWithinAttachment = new Set(parsed.parsedRows.map((row) => row.externalHash)).size;
  const duplicateWithinAttachment = parsed.parsedRows.length - dedupedWithinAttachment;

  if (!input.apply) {
    return {
      importedPaymentsCount: dedupedWithinAttachment,
      duplicatePaymentsCount: duplicateWithinAttachment,
      skippedCount: parsed.skippedRows.length,
      errorsCount: 0,
    };
  }

  const createdAttachment = await createBillingEmailImportAttachment({
    run_id: input.runId,
    message_uid: input.messageUid,
    attachment_filename: input.attachment.filename,
    attachment_hash: attachmentHash,
    status: "found",
  });

  try {
    const importResult = await importBillingPaymentsFromParsedRows({
      parsedRows: parsed.parsedRows,
      sourceFileName: buildSafeSourceFileName(input.messageUid, input.attachment.filename),
      emailMessageId: input.messageId ?? `uid:${input.messageUid}`,
    });

    await updateBillingEmailImportAttachmentById(createdAttachment.id, {
      status: importResult.insertedRowCount > 0 ? "imported" : "duplicate",
      imported_count: importResult.insertedRowCount,
      duplicate_count: importResult.duplicateRowCount + duplicateWithinAttachment,
      error_message: null,
    });

    return {
      importedPaymentsCount: importResult.insertedRowCount,
      duplicatePaymentsCount: importResult.duplicateRowCount + duplicateWithinAttachment,
      skippedCount: parsed.skippedRows.length,
      errorsCount: 0,
    };
  } catch (error) {
    await updateBillingEmailImportAttachmentById(createdAttachment.id, {
      status: "failed",
      imported_count: 0,
      duplicate_count: duplicateWithinAttachment,
      error_message: error instanceof Error ? error.message : "Unknown attachment import error",
    });

    return {
      importedPaymentsCount: 0,
      duplicatePaymentsCount: duplicateWithinAttachment,
      skippedCount: parsed.skippedRows.length,
      errorsCount: 1,
    };
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function getBillingCronBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme !== "Bearer" || !token?.trim()) {
    return null;
  }

  return token.trim();
}

export function isValidBillingCronSecret(request: Request): boolean {
  const secret = getOptionalEnv("CRON_SECRET");
  const token = getBillingCronBearerToken(request);
  if (!secret || !token) {
    return false;
  }
  return safeEqual(token, secret);
}

export async function runBillingEmailImport(
  options: BillingEmailImportOptions = {}
): Promise<BillingEmailImportSummary> {
  const config = resolveConfig(options);
  const apply = options.apply === true;
  const mode = apply ? "apply" : "dry_run";
  let runId: string | null = null;

  if (apply) {
    ensureConfiguredForBillingApplyImport();
    const run = await createBillingEmailImportRun({
      status: "running",
      mode,
    });
    runId = run.id;
  }

  const summary: BillingEmailImportSummary = {
    mode,
    scannedMessagesCount: 0,
    foundAttachmentsCount: 0,
    importedPaymentsCount: 0,
    duplicatePaymentsCount: 0,
    autoMatchedCount: 0,
    reviewRequiredCount: 0,
    skippedCount: 0,
    errorsCount: 0,
    runId,
    telegramSummaryStatus: "skipped",
    telegramSummaryReason: null,
  };

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: {
      user: config.username,
      pass: config.password,
    },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(config.mailbox);

    try {
      const searchQuery: Record<string, unknown> = {
        since: getLookbackSinceDate(config.lookbackDays),
      };

      if (config.fromQuery) {
        searchQuery.from = config.fromQuery;
      }
      if (config.subjectQuery) {
        searchQuery.subject = config.subjectQuery;
      }

      const messageUidsResult = await client.search(searchQuery, { uid: true });
      const messageUids = Array.isArray(messageUidsResult) ? messageUidsResult : [];
      summary.scannedMessagesCount = messageUids.length;

      for (const messageUid of messageUids) {
        const message = await client.fetchOne(
          messageUid,
          {
            uid: true,
            envelope: true,
            bodyStructure: true,
          },
          { uid: true }
        );

        if (!message || !matchesEnvelopeQueries(message.envelope as ImapEnvelope, config)) {
          continue;
        }

        const attachments = findAttachments(message.bodyStructure as ImapBodyStructure).filter(
          (attachment) =>
            attachmentLooksLikeCsv(attachment.filename, attachment.contentType) &&
            matchesFilenameQuery(attachment.filename, config.filenameQuery)
        );

        for (const attachment of attachments) {
          try {
            const downloadResult = await client.download(messageUid, attachment.part, { uid: true });
            const content = await streamToBuffer(downloadResult.content);

            let parsedLooksValid = false;
            try {
              parseTBankStatementBuffer(content);
              parsedLooksValid = true;
            } catch {
              parsedLooksValid = false;
            }

            if (!parsedLooksValid) {
              summary.skippedCount += 1;
              continue;
            }

            summary.foundAttachmentsCount += 1;
            const counts = await processAttachment({
              apply,
              runId,
              messageUid: String(messageUid),
              messageId: (message.envelope as ImapEnvelope | undefined)?.messageId ?? null,
              attachment,
              content,
            });

            summary.importedPaymentsCount += counts.importedPaymentsCount;
            summary.duplicatePaymentsCount += counts.duplicatePaymentsCount;
            summary.skippedCount += counts.skippedCount;
            summary.errorsCount += counts.errorsCount;
          } catch {
            summary.errorsCount += 1;
          }
        }
      }
    } finally {
      lock.release();
    }

    if (apply) {
      const autoMatchResult = await autoMatchTrustedImportedPayments({ apply: true });
      summary.autoMatchedCount = autoMatchResult.matched;
      summary.reviewRequiredCount = Math.max(summary.importedPaymentsCount - summary.autoMatchedCount, 0);
    } else {
      summary.reviewRequiredCount = Math.max(summary.importedPaymentsCount, 0);
    }

    const telegramStatus = await maybeSendTelegramSummary(summary, mode);
    summary.telegramSummaryStatus = telegramStatus.status;
    summary.telegramSummaryReason = telegramStatus.reason;

    if (runId) {
      await updateBillingEmailImportRunById(runId, {
        finished_at: new Date().toISOString(),
        status: summary.errorsCount > 0 ? "failed" : "success",
        scanned_messages_count: summary.scannedMessagesCount,
        found_attachments_count: summary.foundAttachmentsCount,
        imported_payments_count: summary.importedPaymentsCount,
        duplicate_payments_count: summary.duplicatePaymentsCount,
        auto_matched_count: summary.autoMatchedCount,
        review_required_count: summary.reviewRequiredCount,
        error_message: summary.errorsCount > 0 ? `${summary.errorsCount} attachment processing errors` : null,
      });
    }

    return summary;
  } catch (error) {
    if (runId) {
      await updateBillingEmailImportRunById(runId, {
        finished_at: new Date().toISOString(),
        status: "failed",
        scanned_messages_count: summary.scannedMessagesCount,
        found_attachments_count: summary.foundAttachmentsCount,
        imported_payments_count: summary.importedPaymentsCount,
        duplicate_payments_count: summary.duplicatePaymentsCount,
        auto_matched_count: summary.autoMatchedCount,
        review_required_count: summary.reviewRequiredCount,
        error_message: error instanceof Error ? error.message : "Unknown billing email import error",
      });
    }

    throw error;
  } finally {
    await client.logout().catch(() => undefined);
  }
}
