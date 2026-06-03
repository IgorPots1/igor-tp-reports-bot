import process from "node:process";

import {
  getTrainingPeaksStudentByTelegramUsername,
  listActiveTrainingPeaksMoveActions,
  listRecentTrainingPeaksActions,
  listRecentTrainingPeaksCoachCases,
  listTrainingPeaksOperationalSignals,
  listTrainingPeaksStudentsByTelegramUsername,
  listTrainingPeaksTelegramContextObservationsForStudent,
  type TrainingPeaksAction,
  type TrainingPeaksStudent,
  type TrainingPeaksStudentOperationalSignal,
} from "@/features/trainingpeaks/repository";
import {
  buildTrainingPeaksOperationalSignalsSnapshotFromSignals,
  getTrainingPeaksStudentCard,
  getTrainingPeaksStudentCardByInternalId,
  type TrainingPeaksRegistryStudentSnapshot,
} from "@/features/trainingpeaks/service";

const SCRIPT_NAME = "trace-trainingpeaks-operational-signals";

type CliArgs = {
  studentQuery: string | null;
  studentId: string | null;
  telegramUsername: string | null;
};

function getEnvValue(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function parseArgs(argv: string[]): CliArgs {
  let studentQuery: string | null = null;
  let studentId: string | null = null;
  let telegramUsername: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--student") {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error("Missing value for --student.");
      }
      studentQuery = value;
      index += 1;
      continue;
    }
    if (token === "--student-id") {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error("Missing value for --student-id.");
      }
      studentId = value;
      index += 1;
      continue;
    }
    if (token === "--telegram") {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error("Missing value for --telegram.");
      }
      telegramUsername = value;
      index += 1;
      continue;
    }
    if (token.startsWith("--")) {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  const selectors = [studentQuery, studentId, telegramUsername].filter(Boolean);
  if (selectors.length !== 1) {
    throw new Error("Use exactly one selector: --student, --student-id, or --telegram.");
  }

  return { studentQuery, studentId, telegramUsername };
}

function printUsage(): void {
  console.log(`Usage: npm run ${SCRIPT_NAME} -- --student "Viktoria Sergeeva"`);
  console.log(`       npm run ${SCRIPT_NAME} -- --student-id "<internal-id>"`);
  console.log(`       npm run ${SCRIPT_NAME} -- --telegram "@username"`);
}

function redactPreview(value: string | null | undefined, maxLength = 80): string {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "null";
  }
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}

function formatKeys(record: Record<string, unknown>): string {
  const keys = Object.keys(record ?? {}).sort();
  return keys.length > 0 ? keys.join(",") : "none";
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readMoveActionDates(action: Pick<TrainingPeaksAction, "parsedPayload">): {
  sourceDate: string | null;
  targetDate: string | null;
} {
  if (!action.parsedPayload || typeof action.parsedPayload !== "object") {
    return { sourceDate: null, targetDate: null };
  }
  const payload = action.parsedPayload as {
    source?: { kind?: string; value?: string };
    target?: { kind?: string; value?: string };
    sourceDate?: string;
    source_date?: string;
  };
  const sourceDate =
    (typeof payload.sourceDate === "string" && payload.sourceDate.trim() ? payload.sourceDate.trim() : null) ??
    (typeof payload.source_date === "string" && payload.source_date.trim() ? payload.source_date.trim() : null) ??
    (payload.source?.kind === "date" && typeof payload.source.value === "string" ? payload.source.value.trim() : null);
  const targetDate =
    payload.target?.kind === "date" && typeof payload.target.value === "string" ? payload.target.value.trim() : null;
  return { sourceDate, targetDate };
}

function isMoveSignalVisible(
  signal: Pick<TrainingPeaksStudentOperationalSignal, "studentId" | "linkedActionId" | "sourceDate" | "targetDate">,
  actions: readonly TrainingPeaksAction[]
): { visible: boolean; reason: string } {
  const matched = actions.find((action) => {
    if (action.studentId !== signal.studentId) {
      return false;
    }
    if (signal.linkedActionId && action.id === signal.linkedActionId) {
      return true;
    }
    const dates = readMoveActionDates(action);
    return dates.sourceDate === (signal.sourceDate ?? null) && dates.targetDate === (signal.targetDate ?? null);
  });

  if (!matched) {
    return { visible: false, reason: "hidden: no matching active move action" };
  }

  return {
    visible: true,
    reason: `visible: matched active action ${matched.id.slice(0, 8)} status=${matched.status} execution=${matched.executionStatus}`,
  };
}

async function resolveStudent(args: CliArgs): Promise<TrainingPeaksStudent | TrainingPeaksRegistryStudentSnapshot | null> {
  if (args.studentId) {
    const card = await getTrainingPeaksStudentCardByInternalId(args.studentId);
    return card;
  }

  if (args.telegramUsername) {
    const exact = await getTrainingPeaksStudentByTelegramUsername(args.telegramUsername);
    if (exact) {
      return exact;
    }
    const matches = await listTrainingPeaksStudentsByTelegramUsername(args.telegramUsername);
    if (matches.length === 0) {
      console.log(`No students found for telegram username: ${args.telegramUsername}`);
      return null;
    }
    if (matches.length > 1) {
      console.log("Multiple students match the telegram username. Refine the selector.");
      for (const student of matches) {
        console.log(`- ${student.studentName} | internal_id=${student.id} | telegram=@${student.telegramUsername ?? "null"}`);
      }
      return null;
    }
    return matches[0] ?? null;
  }

  const card = await getTrainingPeaksStudentCard(args.studentQuery ?? "");
  if (card.kind === "not_found") {
    console.log(`No students found for query: ${args.studentQuery}`);
    console.log(
      "Tip: try --telegram if known, or use --student-id / exact admin student name."
    );
    return null;
  }
  if (card.kind === "ambiguous") {
    console.log("Multiple students match the query. Please refine --student.");
    for (const match of card.matches) {
      console.log(`- ${match.studentName} | student_id=${match.studentId}`);
    }
    return null;
  }
  return card.student;
}

function printStudentHeader(student: TrainingPeaksStudent | TrainingPeaksRegistryStudentSnapshot): void {
  console.log(`Student: ${student.studentName}`);
  console.log(`internal_id: ${student.id}`);
  console.log(`student_id: ${student.studentId}`);
  console.log(`telegram: ${student.telegramUsername ? `@${student.telegramUsername}` : "null"}`);
  console.log(`telegram_chat_id: ${student.telegramChatId ?? "null"}`);
  console.log(`active: ${student.isActive ? "yes" : "no"}`);
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = getEnvValue("NEXT_PUBLIC_SUPABASE_URL") ?? getEnvValue("SUPABASE_URL");
  const serviceRoleKey = getEnvValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.log(`[${SCRIPT_NAME}] SKIP`);
    console.log("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = supabaseUrl;
  }

  const student = await resolveStudent(args);
  if (!student) {
    return;
  }

  const [observations, signals, activeMoveActions, recentActions, recentCases] = await Promise.all([
    listTrainingPeaksTelegramContextObservationsForStudent(student.id, 8),
    listTrainingPeaksOperationalSignals({
      studentQuery: student.studentName,
      limit: 20,
    }),
    listActiveTrainingPeaksMoveActions(250),
    listRecentTrainingPeaksActions(30),
    listRecentTrainingPeaksCoachCases({
      limit: 10,
      statuses: ["logged", "open", "needs_review", "resolved", "dismissed"],
    }),
  ]);

  const studentSignals = signals.items.filter((signal) => signal.studentId === student.id);
  const studentCases = recentCases.filter((item) => item.studentId === student.id);
  const studentRecentActions = recentActions.filter((action) => action.studentId === student.id);
  const activeSignalSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals: studentSignals.filter((signal) => signal.status === "active"),
    studentNameById: new Map([[student.id, student.studentName]]),
    asOfDate: new Date().toISOString().slice(0, 10),
    limit: 20,
    activeMoveActions,
  });

  printStudentHeader(student);
  console.log("");

  console.log("Latest observations:");
  if (observations.length === 0) {
    console.log("- (no observations)");
  } else {
    for (const observation of observations) {
      console.log(
        `- ${observation.observedAt} source=${observation.sourceType} labels=[${observation.labels.join(",") || "none"}] preview="${redactPreview(observation.textPreview)}"`
      );
    }
  }

  console.log("");
  console.log("Latest operational signals:");
  if (studentSignals.length === 0) {
    console.log("- (no signals)");
  } else {
    for (const signal of studentSignals) {
      const summary =
        readString(signal.structuredPayload, "latest_summary") ??
        readString(signal.metadata, "latest_summary") ??
        readString(signal.metadata, "follow_up_reason") ??
        "null";
      const followUp = readString(signal.metadata, "follow_up_due_at") ?? readString(signal.structuredPayload, "follow_up_due_at");
      console.log(
        `- ${signal.signalType} status=${signal.status} valid_until=${signal.validUntil ?? "null"} created=${signal.createdAt} updated=${signal.updatedAt}`
      );
      console.log(`  payload=${redactPreview(summary, 120)}`);
      console.log(`  metadata_keys=[${formatKeys(signal.metadata)}] follow_up=${followUp ?? "null"}`);
    }
  }

  console.log("");
  console.log("Latest cases:");
  if (studentCases.length === 0) {
    console.log("- (no recent cases)");
  } else {
    for (const item of studentCases) {
      console.log(
        `- ${item.createdAt} ${item.caseKind} status=${item.status} preview="${redactPreview(item.previewText)}"`
      );
    }
  }

  console.log("");
  console.log("Latest actions:");
  if (studentRecentActions.length === 0) {
    console.log("- (no recent actions)");
  } else {
    for (const action of studentRecentActions) {
      const dates = readMoveActionDates(action);
      console.log(
        `- ${action.createdAt} ${action.actionType} status=${action.status} execution=${action.executionStatus} ${dates.sourceDate ?? "null"} -> ${dates.targetDate ?? "null"}`
      );
    }
  }

  console.log("");
  console.log("Active signal visibility:");
  const visibleLines = activeSignalSnapshot.sections.flatMap((section) => section.items);
  const visibleById = new Set(visibleLines.map((item) => item.signalId));
  const activeSignals = studentSignals.filter((signal) => signal.status === "active");
  if (activeSignals.length === 0) {
    console.log("- (no active signals)");
  } else {
    for (const signal of activeSignals) {
      if (signal.signalType === "move_workout_candidate") {
        const decision = isMoveSignalVisible(signal, activeMoveActions.filter((action) => action.studentId === student.id));
        console.log(
          `- ${signal.signalType} ${signal.sourceDate ?? "null"} -> ${signal.targetDate ?? "null"}: ${decision.reason}`
        );
        continue;
      }
      console.log(
        `- ${signal.signalType}: ${visibleById.has(signal.id) ? "visible: included in /tp_signals snapshot" : "hidden: deduped/suppressed"}`
      );
    }
  }
}

void run().catch((error) => {
  console.error(`[${SCRIPT_NAME}] FAIL`);
  console.error(error instanceof Error ? error.message : String(error));
  printUsage();
  process.exit(1);
});
