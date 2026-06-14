import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  buildOperationalSignalDisplayEvidenceMap,
  collectOperationalSignalDiagnosticItems,
} from "@/features/trainingpeaks/service";
import {
  buildTpSignalExplainRecord,
  formatTpSignalExplainSummaryMarkdown,
  type TpSignalExplainRecord,
} from "@/features/trainingpeaks/tp-signals-explain-helpers";
import {
  listActiveTrainingPeaksMoveActions,
  listTrainingPeaksOperationalSignals,
  listTrainingPeaksStudents,
  type TrainingPeaksStudent,
} from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[diagnose:tp-signals-explain]";
const REPORT_ROOT = "reports/tp-signals-explain";

type CliOptions = {
  asOfDate: string;
  names: string[];
  allActive: boolean;
  noWrite: boolean;
};

function loadLocalEnvFiles(): void {
  const repoRoot = path.resolve(process.cwd());
  for (const envPath of [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")]) {
    if (!fs.existsSync(envPath)) {
      continue;
    }
    const content = fs.readFileSync(envPath, "utf8");
    for (const rawLine of content.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      const key = line.slice(0, separatorIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }
      let value = line.slice(separatorIndex + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function parseIsoDate(raw: string): string {
  const normalized = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid date: ${raw}`);
  }
  return normalized;
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    asOfDate: new Date().toISOString().slice(0, 10),
    names: [],
    allActive: false,
    noWrite: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--no-write") {
      options.noWrite = true;
      continue;
    }
    if (arg === "--all-active") {
      options.allActive = true;
      continue;
    }
    if (arg.startsWith("--date=")) {
      options.asOfDate = parseIsoDate(arg.slice("--date=".length));
      continue;
    }
    if (arg === "--date") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --date`);
      }
      options.asOfDate = parseIsoDate(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--names=")) {
      options.names = arg
        .slice("--names=".length)
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
      continue;
    }
    if (arg === "--names") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --names`);
      }
      options.names = next
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }
  }
  return options;
}

function normalizeMatch(value: string | null | undefined): string {
  return (value ?? "")
    .toLocaleLowerCase("ru")
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ")
    .trim();
}

function compactMatch(value: string | null | undefined): string {
  return normalizeMatch(value).replace(/[^a-zа-я0-9]+/giu, "");
}

function resolveStudentsByNames(students: TrainingPeaksStudent[], names: string[]): TrainingPeaksStudent[] {
  const resolved: TrainingPeaksStudent[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const normalizedQuery = normalizeMatch(name);
    const compactQuery = compactMatch(name);
    const matches = students.filter((student) => {
      const fields = [student.studentName, student.studentId, student.telegramUsername].filter(Boolean);
      return fields.some((field) => {
        const normalizedField = normalizeMatch(field);
        const compactField = compactMatch(field);
        return (
          normalizedField === normalizedQuery ||
          compactField === compactQuery ||
          normalizedField.includes(normalizedQuery) ||
          compactField.includes(compactQuery)
        );
      });
    });
    if (matches.length === 0) {
      missing.push(name);
      continue;
    }
    if (matches.length > 1) {
      console.warn(`${LOG_PREFIX} ambiguous name "${name}" — using first match: ${matches[0]!.studentName}`);
    }
    resolved.push(matches[0]!);
  }
  if (missing.length > 0) {
    console.warn(`${LOG_PREFIX} no student match for: ${missing.join(", ")}`);
  }
  return resolved;
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));
  if (!options.allActive && options.names.length === 0) {
    throw new Error(`${LOG_PREFIX} FAIL: provide at least one --names value or --all-active`);
  }
  if (options.allActive && options.names.length > 0) {
    throw new Error(`${LOG_PREFIX} FAIL: use either --names or --all-active, not both`);
  }

  const [students, signalsResult, actions] = await Promise.all([
    listTrainingPeaksStudents(),
    listTrainingPeaksOperationalSignals({ status: "active", limit: 250 }),
    listActiveTrainingPeaksMoveActions(250),
  ]);
  const matchedStudents = options.allActive ? students : resolveStudentsByNames(students, options.names);
  const matchedStudentIds = new Set(matchedStudents.map((student) => student.id));
  const studentById = new Map(students.map((student) => [student.id, student]));
  const studentNameById = new Map(students.map((student) => [student.id, student.studentName?.trim() || null]));
  const signals = signalsResult.items.filter((signal) => matchedStudentIds.has(signal.studentId));

  console.log(
    `${LOG_PREFIX} as_of=${options.asOfDate} matched_students=${matchedStudents.length} active_signals=${signals.length} no_write=${String(options.noWrite)}`
  );

  const displayEvidenceBySignalId = await buildOperationalSignalDisplayEvidenceMap({
    signals,
    asOfDate: options.asOfDate,
  });
  const visibleItems = collectOperationalSignalDiagnosticItems({
    signals,
    studentNameById,
    asOfDate: options.asOfDate,
    activeMoveActions: actions,
    displayEvidenceBySignalId,
    visibleOnly: true,
  });

  const records: TpSignalExplainRecord[] = [];
  for (const item of visibleItems) {
    const signal = signals.find((candidate) => candidate.id === item.signalId);
    const student = studentById.get(item.studentId);
    if (!signal || !student) {
      continue;
    }
    records.push(
      buildTpSignalExplainRecord({
        studentName: student.studentName,
        signal,
        item,
        evidence: displayEvidenceBySignalId.get(signal.id) ?? null,
        asOfDate: options.asOfDate,
      })
    );
  }

  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const reportDir = path.join(REPORT_ROOT, timestamp);
  const generatedAt = new Date().toISOString();
  const summaryMarkdown = formatTpSignalExplainSummaryMarkdown({
    generatedAt,
    asOfDate: options.asOfDate,
    names: options.allActive ? ["all active students"] : options.names,
    reportDir,
    records,
  });

  if (!options.noWrite) {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, "signals.json"), `${JSON.stringify(records, null, 2)}\n`);
    fs.writeFileSync(path.join(reportDir, "summary.md"), summaryMarkdown);
    fs.writeFileSync(
      path.join(reportDir, "meta.json"),
      `${JSON.stringify(
        {
          generatedAt,
          asOfDate: options.asOfDate,
          names: options.allActive ? ["all active students"] : options.names,
          matchedStudents: matchedStudents.map((student) => ({
            id: student.id,
            name: student.studentName,
            studentId: student.studentId,
          })),
          visibleSignalCount: records.length,
          noWrite: false,
        },
        null,
        2
      )}\n`
    );
  } else {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, "signals.json"), `${JSON.stringify(records, null, 2)}\n`);
    fs.writeFileSync(path.join(reportDir, "summary.md"), summaryMarkdown);
  }

  console.log(`${LOG_PREFIX} report_dir=${reportDir}`);
  console.log(`${LOG_PREFIX} visible_signals=${records.length}`);
  for (const record of records) {
    console.log(
      `- ${record.student}: ${record.signal_type} bug=${record.suspected_bug_class ?? "none"} recommended=${record.recommended_state}`
    );
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
