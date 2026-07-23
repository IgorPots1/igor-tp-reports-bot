// Conscious send of a reviewed workout-feedback draft (Mini App «Отчёты»).
// INVARIANT: draft → Igor reads → edits → taps Send. Zero auto-send. This runs
// ONLY from a coach tap in the review route, never from a cron or the generator.
//
// Two guards stand between a tap and a real Telegram message:
//   1. FEEDBACK_SEND_ENABLED (default OFF) — the kill-switch. Off = prepare-only:
//      validate the target and echo the final text, but DO NOT deliver ('prepared').
//      Igor flips this on himself after running the cycle dry.
//   2. Same student gates as reply-draft delivery (active / linked / delivery on).
//
// The validation + kill-switch decision is the pure decideFeedbackSend(); this
// module is the thin orchestrator that fetches, decides, and (only on 'deliver')
// claims-before-send and delivers — mirroring reply-draft-delivery.ts.

import {
  claimFeedbackJobForSend,
  getTrainingPeaksFeedbackJobById,
  rollbackFeedbackJobSend,
} from "@/features/trainingpeaks/feedback/feedback-queue";
import type { FeedbackJobStatus } from "@/features/trainingpeaks/feedback/feedback-queue";
import { decideFeedbackSend } from "@/features/trainingpeaks/feedback/feedback-send-decision";
import type { SendRefusalKind } from "@/features/trainingpeaks/feedback/feedback-send-decision";
import {
  getTrainingPeaksStudentById,
  recordTrainingPeaksStudentContactEvent,
} from "@/features/trainingpeaks/repository";
import {
  getRequiredTrainingPeaksBusinessConnectionId,
  isTrainingPeaksTelegramBusinessPeerMissingError,
  sendTrainingPeaksTelegramBusinessMessage,
  shortenTrainingPeaksTelegramDeliveryError,
} from "@/features/trainingpeaks/telegram-business";

/** The send kill-switch. Default OFF (prepare-only) — Igor turns it on after a dry cycle. */
export function isFeedbackSendEnabled(): boolean {
  return process.env.FEEDBACK_SEND_ENABLED === "true";
}

export type SendFeedbackDraftResult =
  | { kind: "sent"; jobId: string; studentName: string; deliveredChunks: number }
  // Kill-switch off: everything validated, target is deliverable, NOTHING was sent.
  | { kind: "prepared"; jobId: string; studentName: string; finalText: string }
  | {
      kind: SendRefusalKind | "missing_business_connection" | "peer_usage_missing" | "delivery_failed" | "state_conflict";
      message: string;
      status?: FeedbackJobStatus;
      studentName?: string | null;
    };

export async function sendFeedbackDraftToStudent(input: {
  jobId: string;
  actorTelegramChatId: string;
}): Promise<SendFeedbackDraftResult> {
  const job = await getTrainingPeaksFeedbackJobById(input.jobId);
  // Student is only needed once the job is a sendable 'done' — fetch it lazily so a
  // refusal on status never does a wasted lookup.
  const student = job && job.status === "done" ? await getTrainingPeaksStudentById(job.studentId) : null;

  const decision = decideFeedbackSend({ sendEnabled: isFeedbackSendEnabled(), job, student });

  if (decision.action === "refuse") {
    return { kind: decision.kind, message: decision.message, status: job?.status, studentName: student?.studentName ?? null };
  }
  // From here job & student are guaranteed present (decision proved them).
  const studentName = student!.studentName;

  if (decision.action === "prepare") {
    return { kind: "prepared", jobId: job!.id, studentName, finalText: decision.finalText };
  }

  // action === "deliver"
  let businessConnectionId: string;
  try {
    businessConnectionId = getRequiredTrainingPeaksBusinessConnectionId();
  } catch (error) {
    return { kind: "missing_business_connection", message: shortenTrainingPeaksTelegramDeliveryError(error), studentName };
  }

  // Claim BEFORE sending (done→sent, freezing sent_text). A second tap now sees
  // status≠done and is refused — the draft can never be delivered twice.
  const claimed = await claimFeedbackJobForSend({
    jobId: job!.id,
    sentText: decision.finalText,
    actorChatId: input.actorTelegramChatId,
  });
  if (!claimed) {
    const reloaded = await getTrainingPeaksFeedbackJobById(job!.id);
    if (reloaded && reloaded.status === "sent") {
      return { kind: "not_reviewable", status: "sent", message: "Черновик уже отправлен.", studentName };
    }
    return { kind: "state_conflict", message: "Черновик сейчас нельзя отправить из-за конфликта состояния.", studentName };
  }

  try {
    const deliveredChunks = await sendTrainingPeaksTelegramBusinessMessage(
      student!.telegramChatId!,
      decision.finalText,
      businessConnectionId
    );

    await recordTrainingPeaksStudentContactEvent({
      studentId: job!.studentId,
      eventType: "report_sent",
      source: "telegram_business_dm",
      referenceId: job!.id,
      metadata: { feedback_job_id: job!.id, coach_edited: job!.coachEditedText !== null },
    }).catch((error) => {
      // The message is already delivered — a contact-event write failure must not
      // undo that or surface as a send error. Log-and-continue.
      console.warn("[feedback.send] contact event failed", {
        jobId: job!.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return { kind: "sent", jobId: job!.id, studentName, deliveredChunks };
  } catch (error) {
    const message = shortenTrainingPeaksTelegramDeliveryError(error);
    await rollbackFeedbackJobSend({ jobId: job!.id, errorReason: message }).catch((rollbackError) => {
      console.warn("[feedback.send] rollback failed", {
        jobId: job!.id,
        error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      });
    });
    if (isTrainingPeaksTelegramBusinessPeerMissingError(error)) {
      return { kind: "peer_usage_missing", message, studentName };
    }
    return { kind: "delivery_failed", message, studentName };
  }
}
