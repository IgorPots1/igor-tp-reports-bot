import process from "node:process";

import { buildTrainingPeaksReplyDraftContext } from "@/features/trainingpeaks/reply-draft-context";

async function run(): Promise<void> {
  const studentUuid = process.env.TP_REPLY_DRAFT_CHECK_STUDENT_ID?.trim();
  const studentSlug = process.env.TP_REPLY_DRAFT_CHECK_STUDENT_SLUG?.trim();
  const studentName = process.env.TP_REPLY_DRAFT_CHECK_STUDENT_NAME?.trim();

  if (!studentUuid || !studentSlug || !studentName) {
    console.log(
      [
        "[check-trainingpeaks-reply-draft-context] Skipped.",
        "Set TP_REPLY_DRAFT_CHECK_STUDENT_ID, TP_REPLY_DRAFT_CHECK_STUDENT_SLUG, and TP_REPLY_DRAFT_CHECK_STUDENT_NAME to run a local read-only context check.",
      ].join("\n")
    );
    return;
  }

  const context = await buildTrainingPeaksReplyDraftContext({
    studentUuid,
    studentSlug,
    studentName,
  });

  const requiredSafetyChecks = [
    { ok: !context.promptContext.includes("text_preview"), message: "promptContext must not include raw observation previews." },
    { ok: !context.promptContext.includes("metadata"), message: "promptContext must not include raw metadata payloads." },
    { ok: context.promptContext.includes(`cache_status=${context.cacheStatus}`), message: "promptContext must include cache_status." },
  ];

  const failed = requiredSafetyChecks.filter((check) => !check.ok);
  if (failed.length > 0) {
    for (const check of failed) {
      console.error(`[check-trainingpeaks-reply-draft-context] FAIL: ${check.message}`);
    }
    process.exit(1);
  }

  console.log("[check-trainingpeaks-reply-draft-context] PASS");
  console.log(`cacheStatus=${context.cacheStatus}`);
  console.log(`telegramContextBullets=${context.telegramContextBullets.length}`);
  console.log(
    `hasContactStatusLines=${/contact_(silence_days|last_athlete_message_at|last_coach_touch_at|unanswered_since|unanswered_seconds)=/.test(
      context.promptContext
    )}`
  );
  console.log(`hasRecentContactEvents=${context.promptContext.includes("recent_contact_events=")}`);
}

void run();
