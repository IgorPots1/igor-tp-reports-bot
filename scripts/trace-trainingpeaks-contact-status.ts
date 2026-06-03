import process from "node:process";

import {
  getTrainingPeaksStudentContactStatus,
  listRecentTrainingPeaksStudentContactEvents,
  type TrainingPeaksStudentContactEvent,
} from "@/features/trainingpeaks/repository";
import {
  getTrainingPeaksStudentCard,
  getTrainingPeaksStudentCardByInternalId,
  type TrainingPeaksRegistryStudentSnapshot,
} from "@/features/trainingpeaks/service";

const SCRIPT_NAME = "trace-trainingpeaks-contact-status";
const MINIMUM_NO_CONTACT_IDLE_DAYS = 3;

type CliArgs = {
  studentQuery: string | null;
  studentId: string | null;
};

function getEnvValue(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function parseArgs(argv: string[]): CliArgs {
  let studentQuery: string | null = null;
  let studentId: string | null = null;

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

    if (token.startsWith("--")) {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (studentQuery && studentId) {
    throw new Error("Use exactly one selector: --student or --student-id.");
  }

  if (!studentQuery && !studentId) {
    throw new Error("Provide one selector: --student \"<name fragment>\" or --student-id \"<uuid>\".");
  }

  return { studentQuery, studentId };
}

function formatIso(value: string | null | undefined): string {
  return value ?? "null";
}

function computeCoachIdleDays(lastCoachTouchAt: string | null): number | null {
  if (!lastCoachTouchAt) {
    return null;
  }

  const lastCoachTouchMs = Date.parse(lastCoachTouchAt);
  if (!Number.isFinite(lastCoachTouchMs)) {
    return null;
  }

  return Math.max(0, Math.floor((Date.now() - lastCoachTouchMs) / (24 * 60 * 60 * 1000)));
}

function getMetadataKeys(event: TrainingPeaksStudentContactEvent): string[] {
  return Object.keys(event.metadata ?? {}).sort((left, right) => left.localeCompare(right));
}

function printUsage(): void {
  console.log(`Usage: npm run ${SCRIPT_NAME} -- --student "<name fragment>"`);
  console.log(`       npm run ${SCRIPT_NAME} -- --student-id "<uuid>"`);
}

function printAmbiguousMatches(matches: Array<{ studentId: string; studentName: string }>): void {
  console.log("Multiple students match the query. Please refine your --student value or use --student-id.");
  for (const candidate of matches) {
    console.log(`- ${candidate.studentName} | student_id=${candidate.studentId}`);
  }
}

function printStudentHeader(student: TrainingPeaksRegistryStudentSnapshot): void {
  console.log(`Student: ${student.studentName}`);
  console.log(`student_id: ${student.studentId}`);
  console.log(`internal_id: ${student.id}`);
  console.log(`active: ${student.isActive ? "yes" : "no"}`);
}

async function resolveStudent(args: CliArgs): Promise<TrainingPeaksRegistryStudentSnapshot | null> {
  if (args.studentId) {
    const student = await getTrainingPeaksStudentCardByInternalId(args.studentId);
    if (!student) {
      console.log(`Student not found by internal id: ${args.studentId}`);
      return null;
    }
    return student;
  }

  const query = args.studentQuery ?? "";
  const card = await getTrainingPeaksStudentCard(query);
  if (card.kind === "not_found") {
    console.log(`No students found for query: ${query}`);
    return null;
  }

  if (card.kind === "ambiguous") {
    printAmbiguousMatches(card.matches);
    return null;
  }

  return card.student;
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

  const [contactStatus, recentEvents] = await Promise.all([
    getTrainingPeaksStudentContactStatus(student.id),
    listRecentTrainingPeaksStudentContactEvents({ studentId: student.id, limit: 20 }),
  ]);

  if (!contactStatus) {
    printStudentHeader(student);
    console.log("");
    console.log("Contact status: not found.");
    return;
  }

  const coachIdleDays = computeCoachIdleDays(contactStatus.lastCoachTouchAt);
  const wouldAppearInNoContact3Days =
    coachIdleDays !== null && coachIdleDays >= MINIMUM_NO_CONTACT_IDLE_DAYS;

  printStudentHeader(student);
  console.log("");
  console.log("Contact status:");
  console.log(`- last athlete message: ${formatIso(contactStatus.lastAthleteMessageAt)}`);
  console.log(`- last coach touch: ${formatIso(contactStatus.lastCoachTouchAt)}`);
  console.log(`- silence days (since athlete message): ${contactStatus.silenceDays ?? "null"}`);
  console.log(`- unanswered since: ${formatIso(contactStatus.unansweredSince)}`);
  console.log(`- unanswered seconds: ${contactStatus.unansweredSeconds ?? "null"}`);
  console.log(`- coach idle days (since coach touch): ${coachIdleDays ?? "null"}`);
  console.log(`- would appear in /tp_attention no-contact: ${wouldAppearInNoContact3Days ? "yes" : "no"}`);
  console.log(
    `- has unanswered student message/question: ${
      typeof contactStatus.unansweredSeconds === "number" && contactStatus.unansweredSeconds > 0 ? "yes" : "no"
    }`
  );
  console.log("");
  console.log("Latest contact events:");

  if (recentEvents.length === 0) {
    console.log("- (no events)");
    return;
  }

  for (const event of recentEvents) {
    console.log(
      `- ${event.occurredAt} ${event.eventType} ${event.source} reference_id=${event.referenceId ?? "null"} keys=[${
        getMetadataKeys(event).join(",")
      }]`
    );
  }
}

void run().catch((error) => {
  console.error(`[${SCRIPT_NAME}] FAIL`);
  console.error(error instanceof Error ? error.message : String(error));
  printUsage();
  process.exit(1);
});
