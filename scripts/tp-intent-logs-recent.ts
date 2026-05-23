import process from "node:process";

import {
  listRecentTrainingPeaksMessageIntentLogs,
  type TrainingPeaksMessageIntentLog,
} from "@/features/trainingpeaks/repository";

function readNestedField(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return (value as Record<string, unknown>)[key] ?? null;
}

function buildCompactAiIntent(
  aiIntent: Record<string, unknown>
): Record<string, unknown> {
  const workoutReference = aiIntent.workout_reference;
  const targetDate = aiIntent.target_date;

  return {
    intent: aiIntent.intent ?? null,
    workout_reference: {
      kind: readNestedField(workoutReference, "kind"),
    },
    target_date: {
      value: readNestedField(targetDate, "value"),
      text: readNestedField(targetDate, "text"),
    },
  };
}

function buildIntentLogCliOutput(log: TrainingPeaksMessageIntentLog): Record<string, unknown> {
  const output: Record<string, unknown> = {
    id: log.id,
    createdAt: log.createdAt,
    status: log.status,
    reason: log.reason,
    studentId: log.studentId,
    telegramChatId: log.telegramChatId,
    telegramMessageId: log.telegramMessageId,
    textPreview: log.textPreview,
    textSha256: log.textSha256,
    ruleConfidence: log.ruleConfidence,
    actionId: log.actionId,
  };

  if (log.aiConfidence !== null) {
    output.aiConfidence = log.aiConfidence;
  }

  if (log.aiIntent) {
    output.aiIntent = buildCompactAiIntent(log.aiIntent);
  }

  if (Object.keys(log.metadata).length > 0) {
    output.metadata = log.metadata;
  }

  return output;
}

async function run(): Promise<void> {
  const limitArg = process.argv[2];
  const limit = limitArg ? Number.parseInt(limitArg, 10) : 20;

  if (!Number.isFinite(limit) || limit <= 0) {
    console.error("Usage: npm run tp-intent-logs-recent -- [limit]");
    process.exitCode = 1;
    return;
  }

  const logs = await listRecentTrainingPeaksMessageIntentLogs(limit);

  if (logs.length === 0) {
    console.log("[tp-intent-logs-recent] No intent logs found.");
    return;
  }

  for (const log of logs) {
    console.log(JSON.stringify(buildIntentLogCliOutput(log), null, 2));
    console.log("---");
  }

  console.log(`[tp-intent-logs-recent] Listed ${logs.length} log(s).`);
}

run().catch((error) => {
  console.error("[tp-intent-logs-recent] FAIL", error);
  process.exitCode = 1;
});
