import process from "node:process";

import {
  listTrainingPeaksMessageIntentLogsForTriage,
  type TrainingPeaksMessageIntentLog,
  type TrainingPeaksMessageIntentLogStatus,
} from "@/features/trainingpeaks/repository";

type TriageCliOptions = {
  limit: number;
  status?: TrainingPeaksMessageIntentLogStatus;
  aiMoveOnly: boolean;
  minAiConfidence?: number;
  studentId?: string;
  sinceHours?: number;
};

const VALID_STATUSES = new Set<TrainingPeaksMessageIntentLogStatus>([
  "action_created",
  "unrecognized",
  "ignored",
  "student_not_found",
  "parse_failed",
  "needs_review",
]);

function readNestedField(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return (value as Record<string, unknown>)[key] ?? null;
}

function formatOptionalNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  return value.toFixed(2);
}

function formatOptionalText(value: string | null | undefined): string {
  return value?.trim() ? value.trim() : "—";
}

function formatAiIntentSummary(aiIntent: Record<string, unknown> | null): string[] {
  if (!aiIntent) {
    return ["  ai: —"];
  }

  const workoutReference = aiIntent.workout_reference;
  const targetDate = aiIntent.target_date;
  const workoutKind = readNestedField(workoutReference, "kind");
  const targetValue = readNestedField(targetDate, "value");
  const targetText = readNestedField(targetDate, "text");
  const targetSummary =
    typeof targetText === "string" && targetText.trim()
      ? targetText.trim()
      : typeof targetValue === "string" && targetValue.trim()
        ? targetValue.trim()
        : "—";

  return [
    `  ai: intent=${formatOptionalText(typeof aiIntent.intent === "string" ? aiIntent.intent : null)}`,
    `      workout=${formatOptionalText(typeof workoutKind === "string" ? workoutKind : null)}`,
    `      target=${targetSummary}`,
    `      needs_clarification=${aiIntent.needs_clarification === true ? "true" : "false"}`,
  ];
}

function buildTriageRecommendation(log: TrainingPeaksMessageIntentLog): string {
  if (log.status === "action_created" || log.actionId) {
    return "Already action_created";
  }

  if (log.status === "student_not_found") {
    return "Student not linked";
  }

  const aiIntent = typeof log.aiIntent?.intent === "string" ? log.aiIntent.intent : null;

  if (aiIntent === "none") {
    return "No action: AI says none";
  }

  if (
    aiIntent === "move_workout" &&
    (log.status === "unrecognized" || log.status === "parse_failed" || log.status === "needs_review")
  ) {
    return "AI suggests move_workout; rule missed it";
  }

  if (log.status === "unrecognized" || log.status === "parse_failed") {
    return "Needs parser alias?";
  }

  if (log.status === "needs_review") {
    return "Needs clarification";
  }

  return "Review manually";
}

function formatTriageLog(log: TrainingPeaksMessageIntentLog): string {
  const reasonSuffix = log.reason ? ` (${log.reason})` : "";
  const lines = [
    `${log.createdAt} | ${log.status}${reasonSuffix} | student=${formatOptionalText(log.studentId)}`,
    `  text: ${formatOptionalText(log.textPreview)}`,
    `  rule_confidence: ${formatOptionalNumber(log.ruleConfidence)}`,
    `  ai_confidence: ${formatOptionalNumber(log.aiConfidence)}`,
    ...formatAiIntentSummary(log.aiIntent),
    `  action_id: ${formatOptionalText(log.actionId)}`,
    `  → ${buildTriageRecommendation(log)}`,
  ];

  return lines.join("\n");
}

function printUsage(): void {
  console.error(`Usage: npm run tp-intent-logs-triage -- [options]

Options:
  --limit <n>                 Max rows (default: 30)
  --status <status>           Filter by status
  --ai-move-only              Only AI move_workout suggestions
  --min-ai-confidence <n>   Minimum AI confidence (e.g. 0.75)
  --student <student_id>      Filter by student
  --since-hours <n>           Only logs from the last N hours`);
}

function parseCliOptions(argv: string[]): TriageCliOptions | null {
  const options: TriageCliOptions = {
    limit: 30,
    aiMoveOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      printUsage();
      return null;
    }

    if (arg === "--ai-move-only") {
      options.aiMoveOnly = true;
      continue;
    }

    if (arg === "--limit") {
      const value = argv[index + 1];
      if (!value) {
        console.error("[tp-intent-logs-triage] Missing value for --limit");
        return null;
      }

      const limit = Number.parseInt(value, 10);
      if (!Number.isFinite(limit) || limit <= 0) {
        console.error("[tp-intent-logs-triage] --limit must be a positive integer");
        return null;
      }

      options.limit = limit;
      index += 1;
      continue;
    }

    if (arg === "--status") {
      const value = argv[index + 1];
      if (!value || !VALID_STATUSES.has(value as TrainingPeaksMessageIntentLogStatus)) {
        console.error("[tp-intent-logs-triage] --status must be one of:", [...VALID_STATUSES].join(", "));
        return null;
      }

      options.status = value as TrainingPeaksMessageIntentLogStatus;
      index += 1;
      continue;
    }

    if (arg === "--min-ai-confidence") {
      const value = argv[index + 1];
      if (!value) {
        console.error("[tp-intent-logs-triage] Missing value for --min-ai-confidence");
        return null;
      }

      const minAiConfidence = Number.parseFloat(value);
      if (!Number.isFinite(minAiConfidence) || minAiConfidence < 0 || minAiConfidence > 1) {
        console.error("[tp-intent-logs-triage] --min-ai-confidence must be between 0 and 1");
        return null;
      }

      options.minAiConfidence = minAiConfidence;
      index += 1;
      continue;
    }

    if (arg === "--student") {
      const value = argv[index + 1]?.trim();
      if (!value) {
        console.error("[tp-intent-logs-triage] Missing value for --student");
        return null;
      }

      options.studentId = value;
      index += 1;
      continue;
    }

    if (arg === "--since-hours") {
      const value = argv[index + 1];
      if (!value) {
        console.error("[tp-intent-logs-triage] Missing value for --since-hours");
        return null;
      }

      const sinceHours = Number.parseFloat(value);
      if (!Number.isFinite(sinceHours) || sinceHours <= 0) {
        console.error("[tp-intent-logs-triage] --since-hours must be a positive number");
        return null;
      }

      options.sinceHours = sinceHours;
      index += 1;
      continue;
    }

    console.error(`[tp-intent-logs-triage] Unknown argument: ${arg}`);
    printUsage();
    return null;
  }

  return options;
}

async function run(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  if (!options) {
    process.exitCode = 1;
    return;
  }

  const logs = await listTrainingPeaksMessageIntentLogsForTriage({
    limit: options.limit,
    status: options.status,
    aiMoveOnly: options.aiMoveOnly,
    minAiConfidence: options.minAiConfidence,
    studentId: options.studentId,
    sinceHours: options.sinceHours,
  });

  if (logs.length === 0) {
    console.log("[tp-intent-logs-triage] No triage items found.");
    return;
  }

  for (const log of logs) {
    console.log(formatTriageLog(log));
    console.log("---");
  }

  console.log(`[tp-intent-logs-triage] Listed ${logs.length} triage item(s). Read-only.`);
}

run().catch((error) => {
  console.error("[tp-intent-logs-triage] FAIL", error);
  process.exitCode = 1;
});
