import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { listMoveShadowComparisons } from "../../../src/features/trainingpeaks/repository.ts";
import { computeMoveShadowReport, formatMoveShadowReportText } from "../../../src/features/trainingpeaks/move-shadow-report.ts";

/**
 * M3 (move-http-shadow plan) -- read-only shadow-report CLI. Fetches every
 * trainingpeaks_move_shadow_comparisons row, aggregates via
 * move-shadow-report.ts's pure computeMoveShadowReport, and prints Igor's
 * switch-decision report (Russian, per his own naryad's language).
 *
 * READ-ONLY. No mutation of any kind, no TrainingPeaks calls at all (the
 * comparisons table already holds everything this needs). Safe to run at any
 * time, as often as desired.
 *
 * Usage: npx tsx scripts/tp-move-shadow-report.ts [--json]
 */

function loadDotEnvFile(dotEnvPath: string): void {
  if (!existsSync(dotEnvPath)) return;
  const content = readFileSync(dotEnvPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function loadLocalEnv(): void {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const toolRoot = path.resolve(scriptDir, "..");
  const repoRoot = path.resolve(toolRoot, "..", "..");
  for (const envPath of [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env"), path.join(toolRoot, ".env")]) {
    loadDotEnvFile(envPath);
  }
}

async function main(): Promise<void> {
  loadLocalEnv();
  const asJson = process.argv.slice(2).includes("--json");

  let rows;
  try {
    rows = await listMoveShadowComparisons();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/could not find the table/i.test(message) || /schema cache/i.test(message)) {
      console.log("Таблица trainingpeaks_move_shadow_comparisons ещё не существует -- миграция 20260713000000 не применена.");
      console.log("Примени миграцию через Supabase SQL Editor, затем прогони этот отчёт снова.");
      return;
    }
    throw error;
  }

  const report = computeMoveShadowReport(rows);

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(formatMoveShadowReportText(report));
}

main().catch((error: unknown) => {
  console.error("tp-move-shadow-report failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
