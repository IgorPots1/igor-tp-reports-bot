/**
 * Probe: memory→signal bridge (Слой 2). Shows that a memory fact becomes a signal candidate
 * + the confirmation text the coach would see. DRY-RUN — no Telegram, no DB writes.
 *
 * 1. Mapping unit-checks (pain_or_injury→pain_injury, health_status→health_issue_started, goal→null).
 * 2. On live Haiku: «болит колено» and the INDIRECT «связка побаливает после длинной» (keyword
 *    classifier misses these) → memory extracts → bridge plans a signal → prints confirmation.
 *
 * Usage: npx tsx scripts/probe-memory-signal-bridge.ts
 * Env: ANTHROPIC_API_KEY (.env.local). Forces dry-run guard; nothing is written.
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
process.env.COACH_MEMORY_AI_DRY_RUN_MODE = "1";

import { extractCoachMemoryItemsDryRun } from "@/features/trainingpeaks/coach-memory-extraction";
import {
  planMemorySignalFromInsertedItem,
  mapMemoryTypeToSignalType,
} from "@/features/trainingpeaks/memory-signal-bridge";
import type { TrainingPeaksStudentMemoryType } from "@/features/trainingpeaks/repository";

const NOW = "2026-06-26T09:00:00.000Z";

function checkMapping() {
  console.log("── Mapping unit-checks ──");
  const cases: Array<[TrainingPeaksStudentMemoryType, string | null]> = [
    ["pain_or_injury", "pain_injury"],
    ["health_status", "health_issue_started"],
    ["race_or_goal", null],
    ["availability_preference", null],
  ];
  for (const [memType, expected] of cases) {
    const got = mapMemoryTypeToSignalType(memType);
    console.log(`  ${memType} → ${got ?? "null"} ${got === expected ? "✅" : "❌ expected " + expected}`);
  }
  console.log("");
}

async function probeMessage(label: string, studentName: string, message: string) {
  console.log("─".repeat(78));
  console.log(`CASE: ${label}`);
  console.log(`MSG : «${message}»`);
  const extraction = await extractCoachMemoryItemsDryRun({
    studentName,
    observationPreview: message,
    observationLabels: ["pain_or_health"],
    sourceType: "business_dm",
    observedAt: NOW,
    currentActiveMemoryItems: [],
  });
  if (!extraction.shouldRemember || extraction.memoryItems.length === 0) {
    console.log(`  память: ничего (${extraction.reason})\n`);
    return;
  }
  extraction.memoryItems.forEach((mem, i) => {
    const plan = planMemorySignalFromInsertedItem(
      { id: `probe-${i}`, memoryType: mem.memoryType as TrainingPeaksStudentMemoryType, summaryText: mem.summaryText, validUntil: mem.validUntil },
      "probe-student",
      NOW
    );
    console.log(`  память[${i}]: ${mem.memoryType} «${mem.summaryText}» (conf ${mem.confidence})`);
    if (!plan) {
      console.log("    → НЕ мостится (тип не bridgeable) — это норма для целей/доступности");
      return;
    }
    console.log(`    → СИГНАЛ-кандидат: ${plan.signalType} | valid_until ${plan.validUntil} | requiresCoachClose=${plan.requiresCoachClose}`);
    console.log(`    → ПОДТВЕРЖДЕНИЕ тренеру: «🩺 ${studentName} — ${mem.summaryText} (${plan.signalKindLabel}). Завести сигнал? ✅ Да / ❌ Нет»`);
  });
  console.log("");
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error("ANTHROPIC_API_KEY not set (.env.local). Aborting.");
    process.exit(1);
  }
  checkMapping();
  await probeMessage("Тестовое про колено (память уже ловит)", "Игорь Тест", "болит колено, готовлюсь к марафону");
  await probeMessage(
    "НЕПРЯМАЯ формулировка (keyword-классификатор сигналов мимо)",
    "Игорь Тест",
    "связка побаливает после длинной, ничего страшного но есть"
  );
  console.log("Примечание: дедуп (не слать повтор, если активный сигнал того же типа уже есть) проверяется в рантайме через listActiveTrainingPeaksOperationalSignalsByStudent — здесь не эмулируется (нет БД-записи).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
