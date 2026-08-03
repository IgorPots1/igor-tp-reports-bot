import { parseTelegramUpdate } from "@/features/telegram/parser";
import { logTelegramUpdateIngress } from "@/features/telegram/ingress-logging";
import {
  handleBillingTelegramCommand,
  isBillingCommand,
} from "@/features/telegram/billing";
import { buildTelegramContextTextPreview } from "@/features/trainingpeaks/telegram-context";
import {
  answerTelegramCallbackQuery,
  sendTelegramMessage,
} from "@/features/telegram/telegram-client";
import {
  handleTrainingPeaksTelegramHelp,
  handleTrainingPeaksTelegramReplyKeyboardMessage,
  handleTrainingPeaksTelegramCallback,
  handleTrainingPeaksTelegramBusinessMessage,
  handleTrainingPeaksTelegramCommand,
  isTrainingPeaksCallback,
  isTrainingPeaksCommand,
} from "@/features/telegram/trainingpeaks";
import {
  handleTrainingPeaksContextObserverMessage,
  isTrainingPeaksContextObserverEnabled,
} from "@/features/trainingpeaks/context-observer";
import { handleTrainingPeaksGroupProbe } from "@/features/trainingpeaks/group-probe";
import { handleClubStartCommand } from "@/features/club/start-onboarding";
import { describeSupabaseError } from "@/features/supabase/server";
import { getTrainingPeaksTelegramContextObservationByChatMessage } from "@/features/trainingpeaks/repository";
import type { TelegramMessage, TelegramUpdate } from "@/features/telegram/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const jsonHeaders = {
  "Content-Type": "application/json",
};

const HELP_COMMAND_PATTERN = /^\/help(?:@\w+)?(?:\s+|$)/;
const START_COMMAND_PATTERN = /^\/start(?:@\w+)?(?:\s+|$)/;
const UNKNOWN_COMMAND_MESSAGE =
  "Не поняла команду. Используй кнопки внизу или отправь /start.";
let hasLoggedMissingWebhookSecretWarning = false;

function okResponse() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: jsonHeaders,
  });
}

function errorResponse(status: number, error: string) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: jsonHeaders,
  });
}

function isTelegramGroupChat(message: TelegramMessage): boolean {
  const chatType = message.chat.type;
  return chatType === "group" || chatType === "supergroup";
}

function getTelegramMessageTextOrCaption(message: TelegramMessage): string {
  return (message.text ?? message.caption ?? "").trim();
}

function mapStartMessageToTrainingPeaksCommand(messageText: string): string {
  const payload = messageText.replace(START_COMMAND_PATTERN, "").trim();
  if (!payload) {
    return "/tp";
  }

  return `/tp_start ${payload}`;
}

type WebhookAuthorizationResult =
  | { authorized: true }
  | { authorized: false; status: 401 | 403; error: string; logMessage: string };

function getTelegramWebhookAuthorizationResult(request: Request): WebhookAuthorizationResult {
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const isProduction = process.env.NODE_ENV === "production";

  if (!webhookSecret) {
    if (isProduction) {
      return {
        authorized: false,
        status: 403,
        error: "Telegram webhook secret is required in production.",
        logMessage: "Telegram webhook rejected: TELEGRAM_WEBHOOK_SECRET is required in production",
      };
    }

    if (!hasLoggedMissingWebhookSecretWarning) {
      hasLoggedMissingWebhookSecretWarning = true;
      console.warn(
        "Telegram webhook secret verification is disabled because TELEGRAM_WEBHOOK_SECRET is not set."
      );
    }

    return { authorized: true };
  }

  const incomingSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (incomingSecret !== webhookSecret) {
    return {
      authorized: false,
      status: 401,
      error: "Invalid Telegram webhook secret token.",
      logMessage: "Telegram webhook rejected: invalid secret token",
    };
  }

  return { authorized: true };
}

export async function GET() {
  return okResponse();
}

export async function POST(request: Request) {
  const authorization = getTelegramWebhookAuthorizationResult(request);

  if (!authorization.authorized) {
    console.warn(authorization.logMessage);
    return errorResponse(authorization.status, authorization.error);
  }

  let update: TelegramUpdate | null = null;

  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    console.warn("Telegram webhook received invalid JSON payload");
    return okResponse();
  }

  logTelegramUpdateIngress(update);

  if (update.business_connection) {
    console.info("Telegram business connection update", {
      connectionId: update.business_connection.id,
      userChatId: update.business_connection.user_chat_id,
      isEnabled: update.business_connection.is_enabled,
      canReply: update.business_connection.can_reply,
    });
    return okResponse();
  }

  if (update.business_message) {
    const businessMessageText =
      update.business_message.text ?? update.business_message.caption ?? null;
    const bmChatId =
      update.business_message.chat?.id !== undefined && update.business_message.chat?.id !== null
        ? String(update.business_message.chat.id)
        : null;
    const bmMessageId = String(update.business_message.message_id);

    // Dedup guard: Telegram retries the webhook with the same update_id if it does not receive
    // a timely 200. The observation table records each processed (chat_id, message_id) pair, so
    // a "found" hit here means this exact message was already handled — skip everything
    // (including any Haiku call) and return 200 immediately.
    //
    // FAIL CLOSED. Until 2026-08-03 a failed check was treated as "no duplicate" and processing
    // continued: during the ~50 min Supabase 522 outage that fired 36 times and produced a real
    // double pass (chat 444252056 / message 852639 at 10:44:50 and 10:46:10 UTC). When we cannot
    // tell whether this message was already handled, the only safe answer is to run NO side
    // effects and let Telegram redeliver — its retry is the designed recovery path, and a delayed
    // update is strictly better than a duplicated one (duplicate coach memory, duplicate contact
    // events, a second Haiku extraction).
    if (bmChatId) {
      const dedupLookup = await getTrainingPeaksTelegramContextObservationByChatMessage({
        chatId: bmChatId,
        messageId: bmMessageId,
      });

      if (dedupLookup.status === "found") {
        console.info("Telegram business message dedup: skipping already-processed message", {
          event: "telegram_business_message_dedup_skip",
          updateId: update.update_id,
          chatId: bmChatId,
          messageId: bmMessageId,
        });
        return okResponse();
      }

      if (dedupLookup.status === "unavailable") {
        console.error("Telegram business message dedup check unavailable, refusing to process", {
          event: "telegram_business_message_dedup_unavailable",
          updateId: update.update_id,
          chatId: bmChatId,
          messageId: bmMessageId,
          reason: dedupLookup.reason,
        });
        return errorResponse(503, "Dedup check unavailable, retry later.");
      }
    }

    console.info("Telegram business message received", {
      businessConnectionId: update.business_message.business_connection_id,
      chatId: update.business_message.chat?.id,
      textPreview: buildTelegramContextTextPreview(businessMessageText),
    });

    // FAIL CLOSED, part two — and this is where the 2026-08-03 messages were actually lost. The
    // dedup guard above was only half the story: handling threw (35x "Failed to upsert TrainingPeaks
    // business chat"), the catch swallowed it, and we still answered 200. Telegram takes 200 as
    // "delivered", stops retrying, and the message is gone for good — no observation row, no coach
    // memory, no operational signal. Measured aftermath: business observations fell from 25/h and
    // 20/h before the outage to 2, 2 and 1 in the outage hours, with ZERO duplicates in the table.
    //
    // Answering 503 instead hands the update back to Telegram, which redelivers it — and the dedup
    // guard above makes that redelivery safe, because a first pass that DID write the observation
    // is recognised and skipped. Loss is permanent; a retry is not.
    try {
      await handleTrainingPeaksTelegramBusinessMessage(update.business_message);
    } catch (error) {
      console.error("Failed to handle Telegram business message, asking Telegram to redeliver", {
        event: "telegram_business_message_handling_failed",
        updateId: update.update_id,
        businessConnectionId: update.business_message.business_connection_id,
        chatId: update.business_message.chat?.id,
        error: describeSupabaseError(error),
      });
      return errorResponse(503, "Business message handling failed, retry later.");
    }

    return okResponse();
  }

  if (update.edited_business_message) {
    const editedBusinessMessageText =
      update.edited_business_message.text ?? update.edited_business_message.caption ?? null;

    console.info("Telegram edited business message received", {
      businessConnectionId: update.edited_business_message.business_connection_id,
      chatId: update.edited_business_message.chat?.id,
      textPreview: buildTelegramContextTextPreview(editedBusinessMessageText),
    });
    return okResponse();
  }

  if (update.deleted_business_messages) {
    console.info("Telegram deleted business messages received", {
      businessConnectionId: update.deleted_business_messages.business_connection_id,
      chatId: update.deleted_business_messages.chat?.id,
      count: Array.isArray(update.deleted_business_messages.message_ids)
        ? update.deleted_business_messages.message_ids.length
        : 0,
    });
    return okResponse();
  }

  const parsedMessage = parseTelegramUpdate(update);

  if (!parsedMessage) {
    console.info("Telegram update ignored: no supported message or callback");
    return okResponse();
  }

  if (parsedMessage.kind === "callback_query") {
    if (isTrainingPeaksCallback(parsedMessage.data)) {
      await answerTelegramCallbackQuery(parsedMessage.callbackQueryId);
      await handleTrainingPeaksTelegramCallback(parsedMessage);
      return okResponse();
    }

    await answerTelegramCallbackQuery(parsedMessage.callbackQueryId);
    return okResponse();
  }

  const messageText = parsedMessage.text?.trim() ?? "";
  const messageChatType = update.message?.chat.type;

  if (HELP_COMMAND_PATTERN.test(messageText)) {
    await handleTrainingPeaksTelegramHelp(parsedMessage);
    return okResponse();
  }

  // Club onboarding deep link (t.me/<bot>?start=club) from the group chat. Handled BEFORE the
  // coach-only /start path so a plain user is greeted (not blocked). Pressing Start also gives
  // the bot a DM with them, so later form broadcasts can reach them. Falls through when it is
  // not a club start or the club is off — existing /start (case_/action_/student_/coach) intact.
  const clubStartParam = messageText.match(/^\/start(?:@\w+)?\s+(\S+)/)?.[1];
  if (clubStartParam === "club") {
    const from = update.message?.from;
    const handled = await handleClubStartCommand({
      chatId: parsedMessage.chatId,
      from: from ? { id: from.id, username: from.username ?? null, first_name: from.first_name ?? null } : null,
    });
    if (handled) return okResponse();
  }

  if (START_COMMAND_PATTERN.test(messageText)) {
    await handleTrainingPeaksTelegramCommand(
      parsedMessage,
      mapStartMessageToTrainingPeaksCommand(messageText),
      messageChatType
    );
    return okResponse();
  }

  if ((await handleTrainingPeaksTelegramReplyKeyboardMessage(parsedMessage, messageText)) === "handled") {
    return okResponse();
  }

  if (isBillingCommand(messageText)) {
    await handleBillingTelegramCommand(parsedMessage, messageText);
    return okResponse();
  }

  if (isTrainingPeaksCommand(messageText)) {
    await handleTrainingPeaksTelegramCommand(parsedMessage, messageText, messageChatType);
    return okResponse();
  }

  const rawMessage = update.message;
  const observerEnabled = isTrainingPeaksContextObserverEnabled();

  if (rawMessage && observerEnabled) {
    try {
      const observerResult = await handleTrainingPeaksContextObserverMessage(rawMessage);
      if (observerResult.handled && !isTelegramGroupChat(rawMessage)) {
        return okResponse();
      }
    } catch (error) {
      console.warn("TrainingPeaks context observer failed", {
        chatId: rawMessage.chat.id,
        messageId: rawMessage.message_id,
        error,
      });
    }
  }

  if (rawMessage && isTelegramGroupChat(rawMessage) && !getTelegramMessageTextOrCaption(rawMessage).startsWith("/")) {
    try {
      await handleTrainingPeaksGroupProbe(rawMessage);
    } catch (error) {
      console.warn("TrainingPeaks group probe failed", {
        chatId: rawMessage.chat.id,
        messageId: rawMessage.message_id,
        error,
      });
    }

    return okResponse();
  }

  await sendTelegramMessage(parsedMessage.chatId, UNKNOWN_COMMAND_MESSAGE);

  return okResponse();
}
