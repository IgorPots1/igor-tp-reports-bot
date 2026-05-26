import process from "node:process";

import {
  listBillingClientsIncludingInactive,
  updateBillingClientById,
} from "@/features/billing/repository";
import { listTrainingPeaksStudents } from "@/features/trainingpeaks/repository";

type CliOptions = {
  apply: boolean;
};

type MatchCandidate = {
  billingClientId: string;
  billingClientName: string;
  studentId: string;
  studentName: string;
  normalizedName: string;
};

type Summary = {
  billingClientsTotal: number;
  trainingPeaksStudentsTotal: number;
  alreadyLinked: number;
  exactOneToOneMatches: number;
  wouldLink: number;
  linked: number;
  skippedAmbiguous: number;
  skippedOneWord: number;
  skippedFamily: number;
  unmatched: number;
};

const FAMILY_MARKER_REGEX =
  /(\+|\bжена\b|\bсемья\b|\bсемьи\b|\bсемейн\w*\b|\bfamily\b|\bgroup\b|\bгруппа\b|\bродители\b|\bсын\b|\bдочь\b)/i;

function parseArgs(argv: string[]): CliOptions {
  let apply = false;

  for (const arg of argv) {
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      apply = false;
    }
  }

  return { apply };
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  npm run billing:auto-link-tp-students -- [--dry-run|--apply]");
}

function ensureSupabaseEnv(): void {
  if (!process.env.SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }

  if (!process.env.SUPABASE_URL?.trim()) {
    throw new Error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL).");
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }
}

function normalizePersonName(rawName: string): string {
  return rawName
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[.,!?;:'"`«»()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isFamilyLikeName(rawName: string): boolean {
  return FAMILY_MARKER_REGEX.test(rawName.toLocaleLowerCase("ru"));
}

function isOneWordName(normalizedName: string): boolean {
  return normalizedName.split(" ").filter(Boolean).length < 2;
}

function printSummary(options: CliOptions, summary: Summary): void {
  console.log("[billing-auto-link-trainingpeaks-students]");
  console.log(`mode=${options.apply ? "apply" : "dry-run"}`);
  console.log(`billing_clients_total=${summary.billingClientsTotal}`);
  console.log(`trainingpeaks_students_total=${summary.trainingPeaksStudentsTotal}`);
  console.log(`already_linked=${summary.alreadyLinked}`);
  console.log(`exact_one_to_one_matches=${summary.exactOneToOneMatches}`);
  console.log(`${options.apply ? "linked" : "would_link"}=${options.apply ? summary.linked : summary.wouldLink}`);
  console.log(`skipped_ambiguous=${summary.skippedAmbiguous}`);
  console.log(`skipped_one_word=${summary.skippedOneWord}`);
  console.log(`skipped_family=${summary.skippedFamily}`);
  console.log(`unmatched=${summary.unmatched}`);
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    return;
  }

  ensureSupabaseEnv();

  const [billingClients, trainingPeaksStudents] = await Promise.all([
    listBillingClientsIncludingInactive(),
    listTrainingPeaksStudents(),
  ]);

  const billingLinkedStudentIds = new Set(
    billingClients.map((client) => client.studentId).filter((value): value is string => value != null)
  );

  const billingByNormalizedName = new Map<string, string[]>();
  const studentsByNormalizedName = new Map<string, string[]>();
  const studentsById = new Map(trainingPeaksStudents.map((student) => [student.id, student]));

  for (const client of billingClients) {
    const normalized = normalizePersonName(client.clientName);
    if (!normalized) {
      continue;
    }
    const current = billingByNormalizedName.get(normalized) ?? [];
    current.push(client.id);
    billingByNormalizedName.set(normalized, current);
  }

  for (const student of trainingPeaksStudents) {
    const normalized = normalizePersonName(student.studentName);
    if (!normalized) {
      continue;
    }
    const current = studentsByNormalizedName.get(normalized) ?? [];
    current.push(student.id);
    studentsByNormalizedName.set(normalized, current);
  }

  const candidates: MatchCandidate[] = [];
  const summary: Summary = {
    billingClientsTotal: billingClients.length,
    trainingPeaksStudentsTotal: trainingPeaksStudents.length,
    alreadyLinked: 0,
    exactOneToOneMatches: 0,
    wouldLink: 0,
    linked: 0,
    skippedAmbiguous: 0,
    skippedOneWord: 0,
    skippedFamily: 0,
    unmatched: 0,
  };

  for (const client of billingClients) {
    if (client.studentId) {
      summary.alreadyLinked += 1;
      continue;
    }

    if (isFamilyLikeName(client.clientName)) {
      summary.skippedFamily += 1;
      continue;
    }

    const normalizedClientName = normalizePersonName(client.clientName);
    if (!normalizedClientName) {
      summary.unmatched += 1;
      continue;
    }

    if (isOneWordName(normalizedClientName)) {
      summary.skippedOneWord += 1;
      continue;
    }

    const sameNameClients = billingByNormalizedName.get(normalizedClientName) ?? [];
    if (sameNameClients.length !== 1) {
      summary.skippedAmbiguous += 1;
      continue;
    }

    const sameNameStudents = studentsByNormalizedName.get(normalizedClientName) ?? [];
    if (sameNameStudents.length === 0) {
      summary.unmatched += 1;
      continue;
    }
    if (sameNameStudents.length !== 1) {
      summary.skippedAmbiguous += 1;
      continue;
    }

    const studentId = sameNameStudents[0];
    if (billingLinkedStudentIds.has(studentId)) {
      summary.skippedAmbiguous += 1;
      continue;
    }

    const student = studentsById.get(studentId);
    if (!student) {
      summary.unmatched += 1;
      continue;
    }

    candidates.push({
      billingClientId: client.id,
      billingClientName: client.clientName,
      studentId: student.id,
      studentName: student.studentName,
      normalizedName: normalizedClientName,
    });
  }

  summary.exactOneToOneMatches = candidates.length;
  summary.wouldLink = candidates.length;

  if (!options.apply) {
    printSummary(options, summary);
    for (const candidate of candidates) {
      console.log(
        `would_link_pair=${candidate.billingClientName} -> ${candidate.studentName} (${candidate.billingClientId} -> ${candidate.studentId})`
      );
    }
    return;
  }

  for (const candidate of candidates) {
    const updated = await updateBillingClientById(candidate.billingClientId, {
      studentId: candidate.studentId,
      updatedBy: "script:billing-auto-link-trainingpeaks-students",
    });

    if (!updated || updated.studentId !== candidate.studentId) {
      throw new Error(
        `Failed to link billing client ${candidate.billingClientId} to TrainingPeaks student ${candidate.studentId}.`
      );
    }

    summary.linked += 1;
  }

  printSummary(options, summary);
}

void run().catch((error) => {
  console.error("[billing-auto-link-trainingpeaks-students] FAIL");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
