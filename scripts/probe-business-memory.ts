/**
 * Probe: coach memory extraction on the business-DM test message ("болит колено, готовлюсь к марафону").
 * Proves the extractor now reachable on the business path produces a durable fact on Haiku.
 * DRY-RUN ONLY — no DB writes (extractCoachMemoryItemsDryRun + processCoachMemoryForObservation
 * with applyWrites:false). Does NOT touch student_memory_items.
 *
 * Usage:
 *   npx tsx scripts/probe-business-memory.ts
 *
 * Env required (loaded from .env.local automatically):
 *   ANTHROPIC_API_KEY
 *   (probe forces COACH_MEMORY_EXTRACTION_ENABLED=true and COACH_MEMORY_AI_DRY_RUN_MODE=1)
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function loadLocalEnv(): void {
  const root = path.resolve(process.cwd());
  for (const name of [".env.local", ".env"]) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const sep = line.indexOf("=");
      if (sep <= 0) continue;
      const key = line.slice(0, sep).trim();
      if (!key || process.env[key] !== undefined) continue;
      let val = line.slice(sep + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

loadLocalEnv();
// Enable extraction + dry-run guard so the AI runs but nothing is written.
process.env.COACH_MEMORY_EXTRACTION_ENABLED = "true";
process.env.COACH_MEMORY_AI_DRY_RUN_MODE = "1";

import {
  extractCoachMemoryItemsDryRun,
  processCoachMemoryForObservation,
} from "@/features/trainingpeaks/coach-memory-extraction";

const TEST = {
  studentName: "Aleksandra Kasianenko",
  observationId: "probe-business-memory-knee",
  textPreview: "болит колено, готовлюсь к марафону",
  labels: ["pain_or_health", "race_context"],
  sourceType: "business_dm",
  observedAt: "2026-06-26T06:18:22.000Z",
};

async function main() {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error("ANTHROPIC_API_KEY not set (.env.local). Aborting.");
    process.exit(1);
  }
  console.log(`Model: ${process.env.COACH_MEMORY_EXTRACTION_MODEL?.trim() || "claude-haiku-4-5-20251001"}`);
  console.log(`Message: «${TEST.textPreview}» | labels=${TEST.labels.join(",")} | source=${TEST.sourceType}\n`);

  // 1) Raw extraction — what fact Haiku pulls out.
  const extraction = await extractCoachMemoryItemsDryRun({
    studentName: TEST.studentName,
    observationPreview: TEST.textPreview,
    observationLabels: TEST.labels,
    sourceType: TEST.sourceType,
    observedAt: TEST.observedAt,
    currentActiveMemoryItems: [],
  });
  console.log("── Haiku extraction (dry-run) ──");
  console.log(`shouldRemember: ${extraction.shouldRemember}`);
  console.log(`reason: ${extraction.reason}`);
  extraction.memoryItems.forEach((item, i) => {
    console.log(
      `  [${i}] type=${item.memoryType} conf=${item.confidence} | «${item.summaryText}»` +
        ` | affectsPlanning=${item.affectsPlanning} attention=${item.requiresCoachAttention}`
    );
  });

  // 2) Full process path with applyWrites:false — proves the would-be insert without touching DB.
  const result = await processCoachMemoryForObservation({
    observationId: TEST.observationId,
    studentId: "5d85b152-a036-4b4b-a73a-832289930caa",
    studentName: TEST.studentName,
    textPreview: TEST.textPreview,
    labels: TEST.labels,
    sourceType: TEST.sourceType,
    observedAt: TEST.observedAt,
    currentActiveMemoryItems: [],
    applyWrites: false,
  });
  console.log("\n── processCoachMemoryForObservation (applyWrites:false) ──");
  console.log(JSON.stringify(result, null, 2));
  console.log(
    `\nВЕРДИКТ: ${
      result.status === "processed" && result.inserted > 0
        ? `✅ извлёкся бы факт (inserted=${result.inserted}) на business-канале`
        : `⚠️ статус ${result.status}, inserted=${"inserted" in result ? result.inserted : "?"}`
    }`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
