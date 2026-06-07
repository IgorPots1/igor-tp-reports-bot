import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { toolRoot } from "./lib/paths.ts";

const MANUAL_COLUMNS = [
  "manual_current_status",
  "manual_training_phase",
  "manual_cycle_note",
  "manual_race_anchor",
  "manual_general_note",
  "coach_action",
] as const;

const RACE_PRIORITY_COLUMNS = Array.from({ length: 5 }, (_, index) => `race_${index + 1}_manual_priority`);

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]!;
    const next = content[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
        continue;
      }
      if (char === '"') {
        inQuotes = false;
        continue;
      }
      cell += char;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char === "\r") {
      continue;
    }
    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function loadExportScriptSource(): string {
  const scriptPath = path.join(toolRoot, "scripts", "tp-athlete-phase-review-table-v0.ts");
  return readFileSync(scriptPath, "utf8");
}

function testExportScriptIsReadOnly(): void {
  const source = loadExportScriptSource();
  assert.doesNotMatch(source, /@supabase\/supabase-js/);
  assert.doesNotMatch(source, /createClient\(/);
  assert.doesNotMatch(source, /from ["'].*telegram/i);
  assert.doesNotMatch(source, /sendTelegram|telegram\.send|bot\.send/i);
  assert.doesNotMatch(source, /trainingpeaks_write|writeToTrainingPeaks/i);
  assert.match(source, /read_only|read-only/i);
  assert.match(source, /no_db_writes|no TrainingPeaks mutations|no Telegram sends/i);
}

function testReportDir(reportDir: string): void {
  const csvPath = path.join(reportDir, "coach-master-review.csv");
  const readmePath = path.join(reportDir, "README.md");
  const mdPath = path.join(reportDir, "coach-master-review.md");
  const summaryPath = path.join(reportDir, "summary.json");

  assert.equal(existsSync(csvPath), true, "coach-master-review.csv missing");
  assert.equal(existsSync(readmePath), true, "README.md missing");
  assert.equal(existsSync(mdPath), true, "coach-master-review.md missing");
  assert.equal(existsSync(summaryPath), true, "summary.json missing");

  const readme = readFileSync(readmePath, "utf8");
  assert.match(readme, /Таблица ручной проверки/);
  assert.match(readme, /Приоритеты стартов/);

  const md = readFileSync(mdPath, "utf8");
  assert.match(md, /Coach Master Review/);

  const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as {
    athlete_count: number;
    safety: { no_db_writes: boolean; no_trainingpeaks_mutations: boolean; no_telegram_sends: boolean };
  };
  assert.equal(summary.safety.no_db_writes, true);
  assert.equal(summary.safety.no_trainingpeaks_mutations, true);
  assert.equal(summary.safety.no_telegram_sends, true);

  const parsed = parseCsv(readFileSync(csvPath, "utf8").trimEnd());
  assert.ok(parsed.length >= 2, "CSV must have header and at least one row");

  const header = parsed[0]!;
  const dataRows = parsed.slice(1);
  assert.equal(dataRows.length, summary.athlete_count, "row count must match summary.athlete_count");

  for (const column of MANUAL_COLUMNS) {
    const columnIndex = header.indexOf(column);
    assert.ok(columnIndex >= 0, `missing manual column ${column}`);
    for (const row of dataRows) {
      assert.equal((row[columnIndex] ?? "").trim(), "", `${column} must be blank`);
    }
  }

  for (const column of RACE_PRIORITY_COLUMNS) {
    const columnIndex = header.indexOf(column);
    assert.ok(columnIndex >= 0, `missing race priority column ${column}`);
    for (const row of dataRows) {
      assert.equal((row[columnIndex] ?? "").trim(), "", `${column} must be blank`);
    }
  }

  const upcomingDetectedIndex = header.indexOf("upcoming_race_detected");
  const race1DateIndex = header.indexOf("race_1_date");
  assert.ok(upcomingDetectedIndex >= 0);
  assert.ok(race1DateIndex >= 0);

  let athletesWithRaces = 0;
  for (const row of dataRows) {
    if (row[upcomingDetectedIndex] === "да") {
      athletesWithRaces += 1;
      assert.notEqual((row[race1DateIndex] ?? "").trim(), "", "athlete with race must have race_1_date");
      assert.notEqual((row[race1DateIndex] ?? "").trim(), "—", "athlete with race must have race_1_date");
    }
  }
  assert.ok(athletesWithRaces > 0, "expected athletes with populated race columns");

  const evidenceIndex = header.indexOf("evidence_short");
  const cleanAthlete = dataRows.find((row) => row[upcomingDetectedIndex] === "—");
  if (cleanAthlete && evidenceIndex >= 0) {
    const evidence = cleanAthlete[evidenceIndex] ?? "";
    if (evidence.trim().length === 0) {
      assert.equal(evidence, "—", "clean evidence fields should use em dash when empty");
    }
  }
}

function parseArgs(argv: string[]): { reportDir: string | null } {
  let reportDir: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg.startsWith("--report-dir=")) {
      reportDir = path.resolve(arg.slice("--report-dir=".length).trim());
      continue;
    }
    if (arg === "--report-dir") {
      reportDir = path.resolve((argv[index + 1] ?? "").trim());
      index += 1;
    }
  }
  return { reportDir };
}

function main(): void {
  testExportScriptIsReadOnly();

  const args = parseArgs(process.argv.slice(2));
  if (args.reportDir) {
    testReportDir(args.reportDir);
  }

  console.log("check-athlete-phase-review-table-v0: all checks passed");
}

main();
