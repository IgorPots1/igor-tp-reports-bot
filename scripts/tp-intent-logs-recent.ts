import process from "node:process";

import { listRecentTrainingPeaksMessageIntentLogs } from "@/features/trainingpeaks/repository";

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
    console.log(
      JSON.stringify(
        {
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
          metadata: log.metadata,
        },
        null,
        2
      )
    );
    console.log("---");
  }

  console.log(`[tp-intent-logs-recent] Listed ${logs.length} log(s).`);
}

run().catch((error) => {
  console.error("[tp-intent-logs-recent] FAIL", error);
  process.exitCode = 1;
});
