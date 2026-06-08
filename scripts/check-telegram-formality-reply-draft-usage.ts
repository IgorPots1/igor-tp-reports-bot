import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  buildResolvedCommunicationProfilePromptLines,
  resolveStudentCommunicationProfile,
  type ResolvedCommunicationProfileSource,
} from "@/features/trainingpeaks/communication-profile";
import {
  listActiveTrainingPeaksStudentMemoryItems,
  type TrainingPeaksStudentMemoryItem,
  type TrainingPeaksTelegramFormality,
} from "@/features/trainingpeaks/repository";
import { getTrainingPeaksReplyDraftFormalityInstruction } from "@/features/trainingpeaks/telegram-context";
import { assertSupabaseEnvOrSkip, loadScriptEnv } from "./lib/load-script-env";
import { createSupabaseServerClient } from "@/features/supabase/server";

const LOG_PREFIX = "[check-telegram-formality-reply-draft-usage]";

type ExpectedFormality = "ty" | "vy";

type TestCase = {
  studentSlug: string;
  studentName: string;
  expectedFormality: ExpectedFormality;
};

type TestStatus = "pass" | "fail" | "needs_review";

type TestResult = {
  student_id: string;
  student_name: string;
  db_telegram_formality: TrainingPeaksTelegramFormality;
  resolved_formality: TrainingPeaksTelegramFormality;
  resolved_source: ResolvedCommunicationProfileSource;
  expected_formality: ExpectedFormality;
  status: TestStatus;
  notes: string;
  prompt_formality_instruction: string;
  memory_communication_style_count: number;
  conflict_flags: string;
};

const TEST_CASES: TestCase[] = [
  { studentSlug: "nadya-hoffman", studentName: "Nadya Hoffman", expectedFormality: "vy" },
  { studentSlug: "alena-kovaldova", studentName: "Alena Kovaldova", expectedFormality: "ty" },
  { studentSlug: "kudryavtseva-liliya", studentName: "Kudryavtseva Liliya", expectedFormality: "ty" },
  { studentSlug: "olga-panina", studentName: "Olga Panina", expectedFormality: "vy" },
  { studentSlug: "Lyubov-Selezneva", studentName: "Любовь Селезнева", expectedFormality: "ty" },
  { studentSlug: "polina-tsalman", studentName: "Polina Tsalman", expectedFormality: "vy" },
];

type DbStudentRow = {
  id: string;
  student_id: string;
  student_name: string;
  telegram_formality: string | null;
};

function timestampForPath(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function normalizeDbFormality(value: string | null | undefined): TrainingPeaksTelegramFormality {
  if (value === "ty" || value === "vy") {
    return value;
  }
  return "unknown";
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsvRow(result: TestResult): string {
  return [
    result.student_id,
    result.student_name,
    result.db_telegram_formality,
    result.resolved_formality,
    result.resolved_source,
    result.expected_formality,
    result.status,
    result.notes,
    result.prompt_formality_instruction,
    String(result.memory_communication_style_count),
    result.conflict_flags,
  ]
    .map((value) => escapeCsv(String(value)))
    .join(",");
}

function evaluateResult(input: {
  student: DbStudentRow | null;
  dbFormality: TrainingPeaksTelegramFormality;
  resolvedFormality: TrainingPeaksTelegramFormality;
  resolvedSource: ResolvedCommunicationProfileSource;
  expectedFormality: ExpectedFormality;
  memoryItems: TrainingPeaksStudentMemoryItem[];
  conflictFlags: string[];
}): Pick<TestResult, "status" | "notes"> {
  if (!input.student) {
    return {
      status: "needs_review",
      notes: "student_not_found_in_db",
    };
  }

  if (input.resolvedFormality !== input.expectedFormality) {
    const notes = [
      `resolved=${input.resolvedFormality}`,
      `expected=${input.expectedFormality}`,
      `db=${input.dbFormality}`,
      `source=${input.resolvedSource}`,
    ];
    if (input.dbFormality === "unknown" && input.resolvedSource === "communication_style_memory") {
      notes.push("db_still_unknown_using_memory_fallback");
    }
    return {
      status: "fail",
      notes: notes.join("; "),
    };
  }

  if (input.dbFormality === "ty" || input.dbFormality === "vy") {
    if (input.resolvedSource !== "manual") {
      return {
        status: "fail",
        notes: `db_has_manual_formality=${input.dbFormality}_but_source=${input.resolvedSource}`,
      };
    }
    if (input.dbFormality !== input.expectedFormality) {
      return {
        status: "needs_review",
        notes: `resolver_passes_but_db_value=${input.dbFormality}_differs_from_expected=${input.expectedFormality}`,
      };
    }
    return {
      status: "pass",
      notes: input.conflictFlags.length > 0 ? `manual_wins; flags=${input.conflictFlags.join(",")}` : "manual_db_authoritative",
    };
  }

  if (input.resolvedSource === "communication_style_memory") {
    return {
      status: "needs_review",
      notes: "db_unknown_resolver_used_communication_style_memory",
    };
  }

  return {
    status: "needs_review",
    notes: "resolved_unknown_no_manual_or_memory_formality",
  };
}

async function fetchStudentBySlug(studentSlug: string): Promise<DbStudentRow | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_id, student_name, telegram_formality")
    .eq("student_id", studentSlug)
    .maybeSingle();

  if (error) {
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_students lookup ${studentSlug}: ${error.message}`);
  }

  return (data as DbStudentRow | null) ?? null;
}

async function run(): Promise<void> {
  loadScriptEnv();
  const reportDir = path.join(
    process.cwd(),
    "reports/telegram-formality-reply-draft-usage",
    timestampForPath(new Date())
  );
  fs.mkdirSync(reportDir, { recursive: true });

  const env = assertSupabaseEnvOrSkip("check-telegram-formality-reply-draft-usage");
  if (!env) {
    const skipSummary = {
      mode: "read-only",
      skipped: true,
      reason: "missing_supabase_env",
      reportDir,
      testCases: TEST_CASES.length,
    };
    fs.writeFileSync(path.join(reportDir, "summary.json"), `${JSON.stringify(skipSummary, null, 2)}\n`, "utf8");
    fs.writeFileSync(
      path.join(reportDir, "SUMMARY.md"),
      [
        "# Telegram Formality Reply Draft Usage — Skipped",
        "",
        "Read-only check skipped because Supabase env is unavailable.",
        "",
        "Required: `NEXT_PUBLIC_SUPABASE_URL` (or `SUPABASE_URL`) and `SUPABASE_SERVICE_ROLE_KEY`.",
        "",
        `Report folder: \`${reportDir}\``,
      ].join("\n"),
      "utf8"
    );
    console.log(`${LOG_PREFIX} SKIP: missing env. Report: ${reportDir}`);
    return;
  }

  const results: TestResult[] = [];

  for (const testCase of TEST_CASES) {
    const student = await fetchStudentBySlug(testCase.studentSlug);
    const dbFormality = normalizeDbFormality(student?.telegram_formality);
    const activeMemoryItems = student ? await listActiveTrainingPeaksStudentMemoryItems(student.id) : [];
    const resolved = resolveStudentCommunicationProfile({
      telegramFormality: dbFormality,
      telegramContextNotes: null,
      activeMemoryItems,
    });
    const promptInstruction = getTrainingPeaksReplyDraftFormalityInstruction(resolved.formality);
    const promptLines = buildResolvedCommunicationProfilePromptLines(resolved);
    const memoryCount = activeMemoryItems.filter((item) => item.memoryType === "communication_style").length;

    const evaluation = evaluateResult({
      student,
      dbFormality,
      resolvedFormality: resolved.formality,
      resolvedSource: resolved.formalitySource,
      expectedFormality: testCase.expectedFormality,
      memoryItems: activeMemoryItems,
      conflictFlags: resolved.conflictFlags,
    });

    const notes = [
      evaluation.notes,
      promptLines.some((line) => line.includes("Manual formality is authoritative")) ? "prompt_has_manual_authority_line" : null,
      promptInstruction.includes("ты") || promptInstruction.includes("вы") || promptInstruction.includes("нейтрально")
        ? "prompt_instruction_present"
        : "prompt_instruction_missing",
    ]
      .filter(Boolean)
      .join("; ");

    results.push({
      student_id: student?.student_id ?? testCase.studentSlug,
      student_name: student?.student_name ?? testCase.studentName,
      db_telegram_formality: dbFormality,
      resolved_formality: resolved.formality,
      resolved_source: resolved.formalitySource,
      expected_formality: testCase.expectedFormality,
      status: evaluation.status,
      notes,
      prompt_formality_instruction: promptInstruction,
      memory_communication_style_count: memoryCount,
      conflict_flags: resolved.conflictFlags.join("|") || "none",
    });
  }

  const passCount = results.filter((row) => row.status === "pass").length;
  const failCount = results.filter((row) => row.status === "fail").length;
  const needsReviewCount = results.filter((row) => row.status === "needs_review").length;

  const csvHeader =
    "student_id,student_name,db_telegram_formality,resolved_formality,resolved_source,expected_formality,status,notes,prompt_formality_instruction,memory_communication_style_count,conflict_flags";
  const csvBody = results.map(toCsvRow).join("\n");
  fs.writeFileSync(path.join(reportDir, "resolver-test-results.csv"), `${csvHeader}\n${csvBody}\n`, "utf8");

  const summary = {
    mode: "read-only",
    skipped: false,
    reportDir,
    resolver: "resolveStudentCommunicationProfile",
    db_field: "trainingpeaks_students.telegram_formality",
    admin_field: "trainingpeaks_students.telegram_formality",
    same_source: true,
    priority_rule: "manual_db > communication_style_memory > unknown",
    tested_students: results.length,
    pass: passCount,
    fail: failCount,
    needs_review: needsReviewCount,
    blockers: [],
    results,
  };
  fs.writeFileSync(path.join(reportDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(`${LOG_PREFIX} tested=${results.length} pass=${passCount} fail=${failCount} needs_review=${needsReviewCount}`);
  console.log(`${LOG_PREFIX} report=${reportDir}`);
  for (const row of results) {
    console.log(
      `${LOG_PREFIX} ${row.student_name}: db=${row.db_telegram_formality} resolved=${row.resolved_formality} source=${row.resolved_source} expected=${row.expected_formality} status=${row.status}`
    );
  }

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

void run();
