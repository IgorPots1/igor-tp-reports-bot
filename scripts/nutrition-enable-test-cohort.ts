import process from "node:process";

import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";
import { matchStudentByIdentity } from "@/features/trainingpeaks/student-identity-match";
import { listTrainingPeaksStudentsIncludingArchived } from "@/features/trainingpeaks/repository";
import { upsertNutritionStudentProfile } from "@/features/nutrition/repository";

const LOG_PREFIX = "[nutrition-enable-test-cohort]";
const APPLY_CONFIRM_TOKEN = "ENABLE NUTRITION TEST COHORT";

const TEST_COHORT_NAMES = [
  "Nadezhda Semeshina",
  "Khadizhat Murtazalieva",
  "Maria Turkina",
  "Tatiana Trofimova",
  "Lyubov Selezneva",
  "Kudryavtseva Liliya",
  "Aleksandr Sorokin",
  "Polyakova Anastasia",
  "Anastasiya Grushevskaya",
  "Natalia Erikenova",
  "Nadezhda Ponomareva",
  "Anna Plotnitskaya",
  "Yulia Krylova",
  "Alexander Pautov",
  "Kristina Pamparaite",
  "Nadya Hoffman",
  "Eseniya Degtyareva",
  "Anna Kukushkina",
  "Anna Chernysheva",
  "Anastasia Utenkova",
] as const;

type CliOptions = {
  apply: boolean;
  confirm: string | null;
};

type MatchResult =
  | {
      status: "matched";
      inputName: string;
      studentId: string;
      studentName: string;
      studentSlug: string;
      matchedBy: string;
    }
  | {
      status: "unresolved";
      inputName: string;
      reason: "unmatched" | "ambiguous";
      details: string;
    };

type Summary = {
  expectedCount: number;
  matchedCount: number;
  wouldEnableCount: number;
  enabledCount: number;
  createdProfilesCount: number;
  alreadyEnabledCount: number;
  unresolved: MatchResult[];
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    confirm: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.apply = false;
      continue;
    }
    if (arg.startsWith("--confirm=")) {
      options.confirm = arg.slice("--confirm=".length).trim();
      continue;
    }
    if (arg === "--confirm") {
      const next = argv[index + 1]?.trim();
      if (!next) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --confirm`);
      }
      options.confirm = next;
      index += 1;
    }
  }

  return options;
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  npm run nutrition:enable-test-cohort -- [--dry-run]");
  console.log(
    `  npm run nutrition:enable-test-cohort -- --apply --confirm "${APPLY_CONFIRM_TOKEN}"`
  );
}

function normalizePersonName(rawName: string): string {
  return rawName
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[.,!?;:'"`«»()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sortedTokenKey(normalizedName: string): string {
  return normalizedName.split(" ").filter(Boolean).sort().join(" ");
}

function matchCohortName(
  inputName: string,
  students: Awaited<ReturnType<typeof listTrainingPeaksStudentsIncludingArchived>>
): MatchResult {
  const normalizedInput = normalizePersonName(inputName);
  const sortedInputKey = sortedTokenKey(normalizedInput);

  const exactMatches = students.filter(
    (student) => normalizePersonName(student.studentName) === normalizedInput
  );
  if (exactMatches.length === 1) {
    const student = exactMatches[0];
    return {
      status: "matched",
      inputName,
      studentId: student.id,
      studentName: student.studentName,
      studentSlug: student.studentId,
      matchedBy: "exact_name",
    };
  }
  if (exactMatches.length > 1) {
    return {
      status: "unresolved",
      inputName,
      reason: "ambiguous",
      details: exactMatches.map((student) => `${student.studentName} (${student.studentId})`).join("; "),
    };
  }

  const tokenMatches = students.filter(
    (student) => sortedTokenKey(normalizePersonName(student.studentName)) === sortedInputKey
  );
  if (tokenMatches.length === 1) {
    const student = tokenMatches[0];
    return {
      status: "matched",
      inputName,
      studentId: student.id,
      studentName: student.studentName,
      studentSlug: student.studentId,
      matchedBy: "sorted_tokens",
    };
  }
  if (tokenMatches.length > 1) {
    return {
      status: "unresolved",
      inputName,
      reason: "ambiguous",
      details: tokenMatches.map((student) => `${student.studentName} (${student.studentId})`).join("; "),
    };
  }

  const identityMatch = matchStudentByIdentity({
    query: inputName,
    students,
    buildIdentities: (student) => [
      { value: student.studentName, kind: "trainingpeaks_name", weight: 1 },
      { value: student.studentId, kind: "trainingpeaks_id", weight: 1 },
    ],
  });

  if (identityMatch.status === "matched") {
    return {
      status: "matched",
      inputName,
      studentId: identityMatch.student.id,
      studentName: identityMatch.student.studentName,
      studentSlug: identityMatch.student.studentId,
      matchedBy: identityMatch.matchedBy,
    };
  }

  if (identityMatch.status === "ambiguous") {
    return {
      status: "unresolved",
      inputName,
      reason: "ambiguous",
      details: identityMatch.candidates
        .map((candidate) => `${candidate.student.studentName} (${candidate.student.studentId}, score=${candidate.score})`)
        .join("; "),
    };
  }

  return {
    status: "unresolved",
    inputName,
    reason: "unmatched",
    details: "no candidate above match threshold",
  };
}

function printSummary(options: CliOptions, summary: Summary): void {
  console.log(LOG_PREFIX);
  console.log(`mode=${options.apply ? "apply" : "dry-run"}`);
  console.log(`expected_names=${summary.expectedCount}`);
  console.log(`matched=${summary.matchedCount}`);
  console.log(`${options.apply ? "enabled" : "would_enable"}=${options.apply ? summary.enabledCount : summary.wouldEnableCount}`);
  console.log(`created_profiles=${summary.createdProfilesCount}`);
  console.log(`already_enabled=${summary.alreadyEnabledCount}`);
  console.log(`unresolved=${summary.unresolved.length}`);

  if (summary.unresolved.length > 0) {
    console.log("unresolved_names:");
    for (const item of summary.unresolved) {
      console.log(`  - ${item.inputName}: ${item.reason} (${item.details})`);
    }
  }

  if (!options.apply && summary.wouldEnableCount > 0) {
    console.log(
      `apply_command=npm run nutrition:enable-test-cohort -- --apply --confirm "${APPLY_CONFIRM_TOKEN}"`
    );
  }
}

async function run(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    return;
  }

  const options = parseArgs(process.argv.slice(2));
  if (options.apply && options.confirm !== APPLY_CONFIRM_TOKEN) {
    throw new Error(
      `${LOG_PREFIX} FAIL: --apply requires --confirm "${APPLY_CONFIRM_TOKEN}"`
    );
  }

  loadScriptEnv();
  resolveSupabaseEnv();

  const students = await listTrainingPeaksStudentsIncludingArchived();
  const matchResults = TEST_COHORT_NAMES.map((name) => matchCohortName(name, students));
  const matched = matchResults.filter((result): result is Extract<MatchResult, { status: "matched" }> => result.status === "matched");
  const unresolved = matchResults.filter((result): result is Extract<MatchResult, { status: "unresolved" }> => result.status === "unresolved");

  const { getNutritionProfilesByStudent } = await import("@/features/nutrition/repository");
  const existingProfiles = await getNutritionProfilesByStudent(matched.map((item) => item.studentId));
  let wouldEnableCount = 0;
  let enabledCount = 0;
  let createdProfilesCount = 0;
  let alreadyEnabledCount = 0;

  for (const item of matched) {
    const profile = existingProfiles.get(item.studentId) ?? null;
    if (profile?.enabled) {
      alreadyEnabledCount += 1;
      console.log(`${LOG_PREFIX} skip_already_enabled name=${item.inputName} student=${item.studentName}`);
      continue;
    }

    wouldEnableCount += 1;
    if (!options.apply) {
      console.log(
        `${LOG_PREFIX} would_enable name=${item.inputName} student=${item.studentName} slug=${item.studentSlug} matched_by=${item.matchedBy} profile_exists=${profile ? "yes" : "no"}`
      );
      continue;
    }

    // Один сбой не должен обрывать включение остальной когорты.
    try {
      await upsertNutritionStudentProfile({
        studentId: item.studentId,
        enabled: true,
        goal: profile?.goal ?? null,
        trackingApp: profile?.trackingApp ?? null,
        currentWeightKg: profile?.currentWeightKg ?? null,
        toleranceNotes: profile?.toleranceNotes ?? null,
        coachNotes: profile?.coachNotes ?? null,
      });
    } catch (error) {
      console.error(
        `${LOG_PREFIX} enable_failed student=${item.studentName} slug=${item.studentSlug}: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }
    enabledCount += 1;
    if (!profile) {
      createdProfilesCount += 1;
    }
    console.log(
      `${LOG_PREFIX} enabled name=${item.inputName} student=${item.studentName} slug=${item.studentSlug} matched_by=${item.matchedBy} created_profile=${profile ? "no" : "yes"}`
    );
  }

  printSummary(options, {
    expectedCount: TEST_COHORT_NAMES.length,
    matchedCount: matched.length,
    wouldEnableCount,
    enabledCount,
    createdProfilesCount,
    alreadyEnabledCount,
    unresolved,
  });
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${LOG_PREFIX} FAIL: ${message}`);
  process.exitCode = 1;
});
