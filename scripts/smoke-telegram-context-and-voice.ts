/**
 * Automated smoke test for the telegram-context-and-voice наряд (Blocks A + B). Runs ONLY
 * against a Supabase dev branch — never prod, checked in code below, not just by convention.
 * The branch clones the SCHEMA but not the data, so every fixture this test needs (a student, a
 * business-DM chat link) is created here, not assumed to already exist.
 *
 * Telegram itself is real (there is only one bot, one token, shared across every DB branch) —
 * test 1 sends a real voice note to the coach's own chat via the bot to get a live file_id, since
 * transcribeTelegramFile needs one Telegram actually has on file; a synthetic id would just fail
 * the download. Every other test writes directly to the dev-branch DB, bypassing the webhook.
 *
 * Usage:
 *   SMOKE_TEST_SUPABASE_URL=... SMOKE_TEST_SUPABASE_SERVICE_ROLE_KEY=... \
 *     node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/smoke-telegram-context-and-voice.ts
 *
 * Exit code 0 = every check passed and cleanup succeeded. Non-zero = report and stop; cleanup
 * still runs in a finally block so a failed run never leaves synthetic rows behind.
 */

// Prod ref, hardcoded on purpose (see the CLAUDE.md rule this repo already lives by: verify by
// ref, never by project name — names lie). This check exists so a missing/wrong env var fails
// LOUD instead of quietly running against the real database.
const PROD_SUPABASE_REF = "wlbswdnpqrcdaqwlfnoo";

const branchUrl = process.env.SMOKE_TEST_SUPABASE_URL?.trim();
const branchKey = process.env.SMOKE_TEST_SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!branchUrl || !branchKey) {
  console.error(
    "SMOKE_TEST_SUPABASE_URL and SMOKE_TEST_SUPABASE_SERVICE_ROLE_KEY are required (a Supabase dev branch — never prod)."
  );
  process.exit(1);
}

if (branchUrl.includes(PROD_SUPABASE_REF)) {
  console.error(`Refusing to run: SMOKE_TEST_SUPABASE_URL points at prod (${PROD_SUPABASE_REF}).`);
  process.exit(1);
}

// Repository functions call createSupabaseServerClient() fresh on every invocation (it reads
// process.env each time, not once at import) — overriding here before any of them run is enough
// to redirect the ENTIRE existing codebase at the branch, with zero forked "smoke test" clients.
process.env.SUPABASE_URL = branchUrl;
process.env.SUPABASE_SERVICE_ROLE_KEY = branchKey;

import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSupabaseServerClient } from "@/features/supabase/server";
import { insertTrainingPeaksStudent } from "@/features/trainingpeaks/repository";
import {
  recordTrainingPeaksTelegramBusinessContextObservation,
  recordTrainingPeaksTelegramBusinessOutgoingContextObservation,
} from "@/features/trainingpeaks/telegram-context";
import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";
import { sendTelegramVoiceReturningFileId, getTelegramChatType } from "@/features/telegram/telegram-client";
import { insertVoiceTranscriptionJob, markVoiceTranscriptionJobDone } from "@/features/voice-transcription/repository";
import { transcribeTelegramFile } from "@/features/voice-transcription/transcribe";
import { handleManualVoiceTranscriptionRequest } from "@/features/voice-transcription/webhook";
import type { TelegramMessage } from "@/features/telegram/types";
import { POST as telegramWebhookPost } from "@/app/api/telegram/webhook/route";

const execFileAsync = promisify(execFile);

type CheckResult = { name: string; ok: boolean; detail: string };
const results: CheckResult[] = [];
function record(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}: ${detail}`);
}

// Cleanup registry — populated as fixtures/rows are created, always run in the finally block.
const cleanup: Array<() => Promise<void>> = [];

async function generateRussianTestVoiceOgg(): Promise<{ buffer: Buffer; expectedWords: string[] }> {
  const workDir = await mkdtemp(join(tmpdir(), "smoke-voice-"));
  try {
    const phrase = "Сегодня пробежала десять километров, всё хорошо.";
    const aiffPath = join(workDir, "phrase.aiff");
    const oggPath = join(workDir, "phrase.ogg");
    // macOS built-in TTS — the same Mac this whole pipeline already runs on, no new dependency.
    await execFileAsync("say", ["-v", "Milena", "-o", aiffPath, phrase]);
    const ffmpegStaticPath = (await import("ffmpeg-static")).default as string;
    await execFileAsync(ffmpegStaticPath, ["-y", "-i", aiffPath, "-c:a", "libopus", "-b:a", "32k", oggPath]);
    const buffer = await readFile(oggPath);
    return { buffer, expectedWords: ["пробежала", "километров"] };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function test1_realAudioTranscription(coachChatId: string): Promise<void> {
  try {
    const { buffer, expectedWords } = await generateRussianTestVoiceOgg();
    const sent = await sendTelegramVoiceReturningFileId(coachChatId, buffer, {
      filename: "smoke-test-voice.ogg",
      caption: "🧪 SMOKE TEST (telegram-context-and-voice) — можно игнорировать",
    });

    if (!sent) {
      record("1. real audio -> transcript", false, "sendVoice did not return a file_id");
      return;
    }

    const job = await insertVoiceTranscriptionJob({
      telegramChatId: String(coachChatId),
      telegramMessageId: String(sent.messageId),
      ackMessageId: null,
      fileId: sent.fileId,
      fileUniqueId: null,
      durationSec: null,
      mimeType: null,
      fileSizeBytes: null,
      sourceKind: "voice",
    });
    cleanup.push(async () => {
      const sb = createSupabaseServerClient();
      await sb.from("voice_transcription_jobs").delete().eq("id", job.id);
    });

    const result = await transcribeTelegramFile(sent.fileId);
    await markVoiceTranscriptionJobDone({
      id: job.id,
      transcript: result.transcript,
      transcriptModel: result.model,
      processingMs: result.processingMs,
    });

    const transcriptLower = result.transcript.toLowerCase();
    const missingWords = expectedWords.filter((w) => !transcriptLower.includes(w));
    const ok = result.transcript.trim().length > 0 && missingWords.length === 0;
    record(
      "1. real audio -> transcript",
      ok,
      ok
        ? `"${result.transcript}" (${result.processingMs}ms)`
        : `transcript "${result.transcript}" missing expected word(s): ${missingWords.join(", ")}`
    );
  } catch (error) {
    record("1. real audio -> transcript", false, error instanceof Error ? error.message : String(error));
  }
}

async function test2_inboundOutboundAndIntentLogs(studentId: string, chatId: string): Promise<void> {
  const sb = createSupabaseServerClient();
  try {
    const inboundMessageId = `smoke-inbound-${randomUUID().slice(0, 8)}`;
    const outboundMessageId = `smoke-outbound-${randomUUID().slice(0, 8)}`;

    const inbound = await recordTrainingPeaksTelegramBusinessContextObservation({
      chatId,
      messageId: inboundMessageId,
      text: "Отбегала сегодня легкую, всё нормально",
    });
    if (inbound) cleanup.push(async () => { await sb.from("trainingpeaks_telegram_context_observations").delete().eq("id", inbound.id); });

    const outbound = await recordTrainingPeaksTelegramBusinessOutgoingContextObservation({
      chatId,
      messageId: outboundMessageId,
      text: "Отлично, продолжай в том же духе",
    });
    if (outbound) cleanup.push(async () => { await sb.from("trainingpeaks_telegram_context_observations").delete().eq("id", outbound.id); });

    const directionOk = inbound?.direction === "inbound" && outbound?.direction === "outbound";
    const senderRoleOk = outbound?.senderRole === "coach";
    record(
      "2a. direction + sender_role",
      directionOk && senderRoleOk,
      `inbound.direction=${inbound?.direction}, outbound.direction=${outbound?.direction}, outbound.senderRole=${outbound?.senderRole}`
    );

    const { data: intentLogs, error: intentError } = await sb
      .from("trainingpeaks_message_intent_logs")
      .select("id")
      .eq("telegram_chat_id", chatId)
      .eq("telegram_message_id", outboundMessageId);
    const noIntentLogs = !intentError && Array.isArray(intentLogs) && intentLogs.length === 0;
    record(
      "2b. outbound did not trigger intent parsing",
      noIntentLogs,
      intentError ? intentError.message : `${intentLogs?.length ?? "?"} intent log row(s) for the outbound message (expected 0)`
    );
  } catch (error) {
    record("2. inbound/outbound + intent logs", false, error instanceof Error ? error.message : String(error));
  }
}

async function test3_nonTextMessageStoresAttachment(chatId: string): Promise<void> {
  const sb = createSupabaseServerClient();
  try {
    const messageId = `smoke-attachment-${randomUUID().slice(0, 8)}`;
    const observation = await recordTrainingPeaksTelegramBusinessContextObservation({
      chatId,
      messageId,
      text: null,
      attachment: { attachmentType: "photo", fileId: "smoke-test-photo-file-id", fileUniqueId: null, durationSec: null },
    });
    if (observation) cleanup.push(async () => { await sb.from("trainingpeaks_telegram_context_observations").delete().eq("id", observation.id); });

    const ok = observation !== null && observation.attachmentType === "photo";
    record("3. non-text message stores attachment_type", ok, `attachmentType=${observation?.attachmentType ?? "null (row not created)"}`);
  } catch (error) {
    record("3. non-text message stores attachment_type", false, error instanceof Error ? error.message : String(error));
  }
}

async function test4_unlinkedChatWritesNullStudent(): Promise<void> {
  const sb = createSupabaseServerClient();
  try {
    const unlinkedChatId = `smoke-unlinked-chat-${randomUUID().slice(0, 8)}`;
    const messageId = `smoke-unlinked-msg-${randomUUID().slice(0, 8)}`;
    const observation = await recordTrainingPeaksTelegramBusinessContextObservation({
      chatId: unlinkedChatId,
      messageId,
      text: "Привет, я не привязан ни к какому ученику",
    });
    if (observation) cleanup.push(async () => { await sb.from("trainingpeaks_telegram_context_observations").delete().eq("id", observation.id); });

    const ok = observation !== null && observation.studentId === null;
    record("4. unlinked chat writes student_id=null", ok, observation ? `studentId=${observation.studentId}` : "row was not created at all");
  } catch (error) {
    record("4. unlinked chat writes student_id=null", false, error instanceof Error ? error.message : String(error));
  }
}

async function test5_foreignChatIdNeverEnqueues(): Promise<void> {
  const sb = createSupabaseServerClient();
  try {
    const foreignChatId = 900000000 + Math.floor(Math.random() * 99999);
    const messageId = 123456;
    const fakeMessage: TelegramMessage = {
      message_id: messageId,
      chat: { id: foreignChatId, type: "private" },
      from: { id: foreignChatId },
      voice: { file_id: "smoke-foreign-file-id", file_unique_id: "smoke-foreign-unique", duration: 3 },
    };

    const outcome = await handleManualVoiceTranscriptionRequest(fakeMessage);

    const { data: jobs } = await sb
      .from("voice_transcription_jobs")
      .select("id")
      .eq("telegram_chat_id", String(foreignChatId))
      .eq("telegram_message_id", String(messageId));

    const ok = outcome.kind === "not_applicable" && Array.isArray(jobs) && jobs.length === 0;
    record("5. foreign chat_id never enqueues a job", ok, `outcome=${outcome.kind}, jobs found=${jobs?.length ?? "?"}`);
  } catch (error) {
    record("5. foreign chat_id never enqueues a job", false, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Route-level regression test (not just handleManualVoiceTranscriptionRequest in isolation,
 * which never looks at forward_from at all): a REAL Telegram update through the actual POST
 * handler, for the coach forwarding a voice note whose forward_from is an ALREADY-ENROLLED
 * student. route.ts runs the voice check before the enrollment block specifically so this
 * doesn't get swallowed by enrollment's own forward_from branch (which has no content-type
 * check) — a real prod test on 2026-09-15 hit exactly this shape and initially looked like a
 * regression before turning out to be a deploy-timing coincidence. This closes that gap for
 * real, at the route level, so a genuine reordering regression would fail here.
 */
async function test8_forwardedVoiceFromEnrolledStudentSkipsEnrollment(coachChatId: string): Promise<void> {
  const sb = createSupabaseServerClient();
  const forwardedTelegramUserId = 800000000 + Math.floor(Math.random() * 99999);
  let enrolledStudentRowId: string | null = null;

  try {
    const { data: inserted, error: insertError } = await sb
      .from("trainingpeaks_students")
      .insert({
        student_id: `smoke-forward-known-${randomUUID().slice(0, 8)}`,
        student_name: "SMOKE TEST — forwarded-voice known student",
        is_active: true,
        telegram_user_id: forwardedTelegramUserId,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      record("8. forwarded voice from enrolled student -> job, not enrollment", false, `fixture insert failed: ${insertError?.message}`);
      return;
    }
    enrolledStudentRowId = (inserted as { id: string }).id;
    cleanup.push(async () => { await sb.from("trainingpeaks_students").delete().eq("id", enrolledStudentRowId!); });

    const messageId = 900000 + Math.floor(Math.random() * 90000);
    const coachUserId = Number(coachChatId);
    const fakeUpdate = {
      update_id: 800000000 + Math.floor(Math.random() * 99999),
      message: {
        message_id: messageId,
        chat: { id: coachUserId, type: "private" },
        from: { id: coachUserId },
        forward_from: { id: forwardedTelegramUserId, first_name: "SMOKE" },
        voice: { file_id: "smoke-forwarded-voice-file-id", file_unique_id: "smoke-forwarded-unique", duration: 5 },
      },
    };

    const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    const response = await telegramWebhookPost(
      new Request("http://localhost/api/telegram/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}),
        },
        body: JSON.stringify(fakeUpdate),
      })
    );

    const { data: jobs } = await sb
      .from("voice_transcription_jobs")
      .select("id")
      .eq("telegram_chat_id", String(coachUserId))
      .eq("telegram_message_id", String(messageId));

    if (jobs && jobs.length > 0) {
      cleanup.push(async () => { await sb.from("voice_transcription_jobs").delete().eq("id", jobs[0]!.id); });
    }

    const jobCreated = Array.isArray(jobs) && jobs.length === 1;
    const ok = response.status === 200 && jobCreated;
    record(
      "8. forwarded voice from enrolled student -> job, not enrollment",
      ok,
      jobCreated
        ? "job created — enrollment's forward_from branch did not intercept it"
        : `no job created (status ${response.status}) — enrollment likely ran instead of the voice check`
    );
  } catch (error) {
    record("8. forwarded voice from enrolled student -> job, not enrollment", false, error instanceof Error ? error.message : String(error));
  }
}

async function test6_coachChatIdsArePrivate(): Promise<void> {
  try {
    const coachChatIds = getTrainingPeaksCoachChatIds();
    if (coachChatIds.length === 0) {
      record("6. TELEGRAM_COACH_CHAT_IDS are private chats", true, "list is empty — nothing to check");
      return;
    }
    const badOnes: string[] = [];
    for (const chatId of coachChatIds) {
      const chatType = await getTelegramChatType(chatId);
      if (chatType === "group" || chatType === "supergroup") {
        badOnes.push(`${chatId} (${chatType})`);
      }
    }
    record(
      "6. TELEGRAM_COACH_CHAT_IDS are private chats",
      badOnes.length === 0,
      badOnes.length === 0 ? `all ${coachChatIds.length} id(s) are private/other, none are groups` : `group/supergroup id(s): ${badOnes.join(", ")}`
    );
  } catch (error) {
    record("6. TELEGRAM_COACH_CHAT_IDS are private chats", false, error instanceof Error ? error.message : String(error));
  }
}

async function main(): Promise<void> {
  console.log(`[smoke] running against branch ${branchUrl}`);
  const sb = createSupabaseServerClient();

  const coachChatIds = getTrainingPeaksCoachChatIds();
  if (coachChatIds.length === 0) {
    console.error("TELEGRAM_COACH_CHAT_IDS is empty — test 1 needs a real chat to send the test voice note to.");
    process.exit(1);
  }
  const coachChatId = coachChatIds[0]!;

  // Fixture: one test student with a synthetic (but real-shaped) telegram_chat_id, used by
  // tests 2 and 3 (the "linked" cases). Test 4 deliberately uses a DIFFERENT, never-linked
  // chat_id to prove the unlinked path.
  const testChatId = `smoke-test-chat-${randomUUID().slice(0, 8)}`;
  const student = await insertTrainingPeaksStudent({
    studentId: `smoke-test-${randomUUID().slice(0, 8)}`,
    studentName: "SMOKE TEST — telegram-context-and-voice",
    trainingPeaksAthleteUrl: "https://smoke-test.invalid/athlete",
    telegramChatId: testChatId,
    isActive: true,
  });
  cleanup.push(async () => { await sb.from("trainingpeaks_students").delete().eq("id", student.id); });

  try {
    await test1_realAudioTranscription(coachChatId);
    await test2_inboundOutboundAndIntentLogs(student.id, testChatId);
    await test3_nonTextMessageStoresAttachment(testChatId);
    await test4_unlinkedChatWritesNullStudent();
    await test5_foreignChatIdNeverEnqueues();
    await test6_coachChatIdsArePrivate();
    await test8_forwardedVoiceFromEnrolledStudentSkipsEnrollment(coachChatId);
  } finally {
    console.log(`[smoke] cleaning up ${cleanup.length} fixture(s)/row(s)...`);
    let cleanupFailures = 0;
    for (const step of cleanup.reverse()) {
      try {
        await step();
      } catch (error) {
        cleanupFailures++;
        console.error("[smoke] cleanup step failed", error);
      }
    }
    record("7. cleanup", cleanupFailures === 0, cleanupFailures === 0 ? "all fixtures removed" : `${cleanupFailures} cleanup step(s) failed`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n[smoke] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    console.log("[smoke] FAILED:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[smoke] unhandled failure", error);
  process.exit(1);
});
