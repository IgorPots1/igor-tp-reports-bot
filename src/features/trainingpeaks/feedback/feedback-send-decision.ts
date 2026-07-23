// Pure decision for "may this reviewed draft be delivered, and with what text?".
// Alias-free and side-effect-free so the SAFETY invariant — prepare-only never
// delivers — is unit-testable without a DB or Telegram. The orchestrator
// (feedback-send.ts) fetches the job/student, calls this, and only on
// { action: "deliver" } touches Telegram.

import type { FeedbackJobStatus } from "./feedback-queue.ts";

export type SendRefusalKind =
  | "not_found"
  | "blocked"
  | "not_reviewable"
  | "missing_draft_text"
  | "student_missing"
  | "student_inactive"
  | "telegram_not_linked"
  | "delivery_disabled";

export type SendDecision =
  | { action: "refuse"; kind: SendRefusalKind; message: string }
  | { action: "prepare"; finalText: string } // validated & ready; kill-switch OFF → do NOT send
  | { action: "deliver"; finalText: string };

export type DecisionJob = {
  status: FeedbackJobStatus;
  draftText: string | null;
  coachEditedText: string | null;
};

export type DecisionStudent = {
  isActive: boolean;
  telegramChatId: string | null;
  telegramDeliveryEnabled: boolean;
};

/** Igor's edit wins over the machine draft; both trimmed. */
export function resolveFinalText(job: Pick<DecisionJob, "draftText" | "coachEditedText">): string {
  return (job.coachEditedText?.trim() || job.draftText?.trim()) ?? "";
}

/**
 * Decide the send outcome. `student` is only consulted once the job is confirmed
 * 'done' with text — the caller may pass null before that point. The kill-switch
 * (`sendEnabled`) is checked LAST, after every validation, so prepare-only still
 * proves the draft WOULD deliver to a real, linked, active student.
 */
export function decideFeedbackSend(input: {
  sendEnabled: boolean;
  job: DecisionJob | null;
  student: DecisionStudent | null;
}): SendDecision {
  const { job } = input;
  if (!job) return { action: "refuse", kind: "not_found", message: "Черновик не найден." };

  if (job.status === "blocked") {
    return { action: "refuse", kind: "blocked", message: "Тренировка заблокирована (нет данных) — это сигнал «разберись», ученику не отправляется." };
  }
  if (job.status !== "done") {
    const message =
      job.status === "sent" ? "Черновик уже отправлен." : job.status === "dismissed" ? "Черновик пропущен." : "Черновик ещё не готов к отправке.";
    return { action: "refuse", kind: "not_reviewable", message };
  }

  const finalText = resolveFinalText(job);
  if (!finalText) return { action: "refuse", kind: "missing_draft_text", message: "У черновика нет текста для отправки." };

  const { student } = input;
  if (!student) return { action: "refuse", kind: "student_missing", message: "Ученик не найден в базе." };
  if (!student.isActive) return { action: "refuse", kind: "student_inactive", message: "Ученик архивирован или отключён." };
  if (!student.telegramChatId) return { action: "refuse", kind: "telegram_not_linked", message: "У ученика не привязан Telegram." };
  if (!student.telegramDeliveryEnabled) return { action: "refuse", kind: "delivery_disabled", message: "У ученика отключена Telegram-доставка." };

  // Kill-switch LAST: everything validated, target is deliverable.
  if (!input.sendEnabled) return { action: "prepare", finalText };
  return { action: "deliver", finalText };
}
