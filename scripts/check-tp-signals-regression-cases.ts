import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { evaluateTpSignalsRegressionCases, type TpSignalsRegressionCaseResult } from "@/features/trainingpeaks/tp-signals-regression-fixtures";

const LOG_PREFIX = "[check:tp-signals-regression-cases]";
const REPORT_ROOT = "reports/tp-signals-regression-cases";

function parseStrict(argv: string[]): boolean {
  return argv.includes("--strict");
}

function formatCaseMarkdown(result: TpSignalsRegressionCaseResult): string[] {
  const lines = [
    `### Case ${result.caseId} — ${result.name}`,
    "",
    `- student: ${result.studentHint}`,
    `- bug_class: ${result.bugClass}`,
    `- pass: **${result.pass ? "PASS" : "FAIL"}**`,
    "",
    "Current:",
    "",
    "```json",
    JSON.stringify(result.current, null, 2),
    "```",
    "",
    "Expected:",
    "",
    "```json",
    JSON.stringify(result.expected, null, 2),
    "```",
    "",
  ];
  if (result.notes.length > 0) {
    lines.push("Notes:");
    for (const note of result.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }
  return lines;
}

function run(): void {
  const strict = parseStrict(process.argv.slice(2));
  const results = evaluateTpSignalsRegressionCases();
  const passCount = results.filter((result) => result.pass).length;
  const failCount = results.length - passCount;

  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const reportDir = path.join(REPORT_ROOT, timestamp);
  fs.mkdirSync(reportDir, { recursive: true });

  const summary = {
    generatedAt: new Date().toISOString(),
    strict,
    total: results.length,
    passCount,
    failCount,
    cases: results.map((result) => ({
      caseId: result.caseId,
      name: result.name,
      studentHint: result.studentHint,
      bugClass: result.bugClass,
      pass: result.pass,
    })),
    reportDir,
  };

  const markdownLines = [
    "# TP Signals Regression Cases",
    "",
    `- generated_at: ${summary.generatedAt}`,
    `- strict_mode: ${String(strict)}`,
    `- pass: ${passCount}/${results.length}`,
    `- report_dir: ${reportDir}`,
    "",
    "## Summary",
    "",
    "| Case | Student | Bug class | Result |",
    "| --- | --- | --- | --- |",
  ];
  for (const result of results) {
    markdownLines.push(
      `| ${result.caseId} | ${result.studentHint} | ${result.bugClass} | ${result.pass ? "PASS" : "FAIL"} |`
    );
  }
  markdownLines.push("");
  markdownLines.push("## Details");
  markdownLines.push("");
  for (const result of results) {
    markdownLines.push(...formatCaseMarkdown(result));
  }

  fs.writeFileSync(path.join(reportDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(path.join(reportDir, "cases.json"), `${JSON.stringify(results, null, 2)}\n`);
  fs.writeFileSync(path.join(reportDir, "summary.md"), `${markdownLines.join("\n")}\n`);

  console.log(`${LOG_PREFIX} report_dir=${reportDir}`);
  console.log(`${LOG_PREFIX} pass=${passCount}/${results.length} strict=${String(strict)}`);
  for (const result of results) {
    console.log(`- case ${result.caseId} (${result.studentHint}): ${result.pass ? "PASS" : "FAIL"} [${result.bugClass}]`);
  }

  if (strict && failCount > 0) {
    console.error(`${LOG_PREFIX} FAIL: ${failCount} regression case(s) mismatched expected target behavior.`);
    process.exit(1);
  }
}

run();
