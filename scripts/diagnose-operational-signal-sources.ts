import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  listTrainingPeaksOperationalSignals,
  listTrainingPeaksStudents,
  getTrainingPeaksTelegramContextObservationById,
} from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[diagnose-operational-signal-sources]";
const DEFAULT_LIMIT = 30;

type CliOptions = {
  limit: number;
  student: string | null;
  status: "active" | "all";
};

function loadLocalEnvFiles(): void {
  const repoRoot = path.resolve(process.cwd());
  for (const envPath of [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")]) {
    if (!fs.existsSync(envPath)) continue;
    const content = fs.readFileSync(envPath, "utf8");
    for (const rawLine of content.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) continue;
      const key = line.slice(0, separatorIndex).trim();
      if (!key || process.env[key] !== undefined) continue;
      let value = line.slice(separatorIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = { limit: DEFAULT_LIMIT, student: null, status: "active" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg.startsWith("--limit=")) {
      options.limit = Math.max(1, Number(arg.slice("--limit=".length)) || DEFAULT_LIMIT);
      continue;
    }
    if (arg === "--limit") {
      options.limit = Math.max(1, Number(argv[index + 1]) || DEFAULT_LIMIT);
      index += 1;
      continue;
    }
    if (arg.startsWith("--student=")) {
      options.student = arg.slice("--student=".length).trim() || null;
      continue;
    }
    if (arg === "--student") {
      options.student = argv[index + 1]?.trim() || null;
      index += 1;
      continue;
    }
    if (arg === "--all-status") {
      options.status = "all";
    }
  }
  return options;
}

async function main(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));
  const students = await listTrainingPeaksStudents();
  const studentById = new Map(students.map((student) => [student.id, student]));
  const { items: signals } = await listTrainingPeaksOperationalSignals({
    status: options.status === "active" ? "active" : undefined,
    studentQuery: options.student ?? undefined,
    limit: Math.min(options.limit, 200),
  });

  console.log(`${LOG_PREFIX} rows=${signals.length} status=${options.status}`);
  console.log(
    [
      "student",
      "signal_id",
      "signal_type",
      "status",
      "source_observation_id",
      "source_type",
      "chat_id",
      "thread_id",
      "sender_role",
      "matched_student_id",
      "message_excerpt",
    ].join("\t")
  );

  for (const signal of signals.slice(0, options.limit)) {
    const student = studentById.get(signal.studentId);
    const observation = signal.sourceObservationId
      ? await getTrainingPeaksTelegramContextObservationById(signal.sourceObservationId)
      : null;
    const metadata =
      observation?.metadata && typeof observation.metadata === "object" && !Array.isArray(observation.metadata)
        ? (observation.metadata as Record<string, unknown>)
        : {};
    const senderRole = typeof metadata.senderRole === "string" ? metadata.senderRole : "";
    console.log(
      [
        student?.studentName ?? signal.studentId,
        signal.id,
        signal.signalType,
        signal.status,
        signal.sourceObservationId ?? "",
        observation?.sourceType ?? signal.sourceType ?? "",
        observation?.chatId ?? signal.telegramChatId ?? "",
        observation?.messageThreadId ?? signal.telegramMessageThreadId ?? "",
        senderRole,
        observation?.studentId ?? signal.studentId,
        (observation?.textPreview ?? "").replace(/\s+/gu, " ").slice(0, 120),
      ].join("\t")
    );
  }

  console.log(`\n${LOG_PREFIX} source coverage summary:`);
  console.log("- ingestion table: trainingpeaks_telegram_context_observations -> trainingpeaks_student_operational_signals");
  console.log("- business_dm: athlete incoming Telegram Business DMs matched by telegram_chat_id");
  console.log("- private_dm: student private chats via context observer when sender matches linked student");
  console.log("- group_topic/group_general: linked student group topics/general when senderRole=linked_student and explicit signal");
  console.log("- excluded: coach/admin/bot group messages, unknown private DMs, ack/noise-only text");
}

main().catch((error) => {
  console.error(`${LOG_PREFIX} FAIL`, error);
  process.exit(1);
});
