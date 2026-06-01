import process from "node:process";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildObservationLogPayload } from "@/features/trainingpeaks/context-observer";
import type { TrainingPeaksObserverLabel } from "@/features/trainingpeaks/context-observer";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function evaluateProbeFlag(rawValue: string | undefined, nodeEnv: string | undefined): boolean {
  const normalized = rawValue?.trim();
  if (normalized !== "true") {
    return false;
  }
  return nodeEnv !== "production";
}

function checkProbeFlagParsing(): void {
  assert(!evaluateProbeFlag(undefined, "development"), "unset flag must stay disabled");
  assert(!evaluateProbeFlag("", "development"), "empty flag must stay disabled");
  assert(!evaluateProbeFlag("false", "development"), '"false" must stay disabled');
  assert(!evaluateProbeFlag("0", "development"), '"0" must stay disabled');
  assert(!evaluateProbeFlag("1", "development"), '"1" must stay disabled');
  assert(!evaluateProbeFlag("TRUE", "development"), '"TRUE" must stay disabled');
  assert(evaluateProbeFlag(" true ", "development"), "trimmed true in non-production should enable debug probe");
  assert(evaluateProbeFlag("true", "development"), '"true" in non-production must enable debug probe');
  assert(!evaluateProbeFlag("true", "production"), "debug probe must stay disabled in production");
}

function checkObserverStaysQuiet(): void {
  const labels: TrainingPeaksObserverLabel[] = ["noise_or_ack"];
  const payload = buildObservationLogPayload({
    studentId: "student-1",
    sourceType: "group_general",
    chatId: "-100123456",
    messageThreadId: null,
    messageId: 101,
    fromId: "12345",
    fromUsername: "athlete_1",
    isTopicMessage: false,
    labels,
    messageLength: 5,
    hasAttachment: false,
    text: "ok",
    senderRole: "known_student",
    senderMatchMethod: "telegram_chat_id",
  });

  assert(payload.sourceType === "group_general", "group_general payload should be built");
  assert(Array.isArray(payload.labels) && payload.labels.includes("noise_or_ack"), "noise label should be preserved");
  assert(payload.textPreview === "ok", "preview should be derived without notifications");
}

function checkImportantImmediateNotificationPathStillPresent(): void {
  const groupProbePath = resolve(process.cwd(), "src/features/trainingpeaks/group-probe.ts");
  const source = readFileSync(groupProbePath, "utf8");

  assert(
    source.includes("notifyCoachGroupMoveCase"),
    "move_workout_needs_review immediate notification helper must remain present"
  );
  assert(
    source.includes("if (caseResult.kind === \"created\")"),
    "created move case should still trigger immediate coach notification"
  );
}

function run(): void {
  checkProbeFlagParsing();
  checkObserverStaysQuiet();
  checkImportantImmediateNotificationPathStillPresent();
  console.log("[check-trainingpeaks-group-probe-gating] PASS");
}

try {
  run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[check-trainingpeaks-group-probe-gating] FAIL");
  console.error(message);
  process.exit(1);
}
