/**
 * Probe: greedy-fix (plan-aware situation) + completed-out-of-variants.
 * - Live Haiku: situation analysis on synthetic Bogdanov-like calendars.
 * - Pure unit: filterMovableNotificationCandidates drops completed/past.
 * No Telegram, no DB writes.
 *
 * Usage: npx tsx scripts/probe-move-greedy-completed.ts
 * Env: ANTHROPIC_API_KEY (.env.local).
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

import {
  selectMoveSourceWorkoutWithAi,
  type MoveSourceCalendarWorkout,
} from "@/features/trainingpeaks/move-workout-parser-ai";
import { filterMovableNotificationCandidates } from "@/features/trainingpeaks/action-dry-run-telegram-copy";

const TODAY = "2026-06-26"; // ПТ
const TZ = "Europe/Moscow";

// Bogdanov-like: вел уже стоит в сб (27), длительный бег вс (28), интервалы пт (26).
const CAL: MoveSourceCalendarWorkout[] = [
  { workoutId: 5001, date: "2026-06-26", type: "Run", title: "Интервалы 6x800", isToday: true },
  { workoutId: 5002, date: "2026-06-27", type: "Bike", title: "Вел по мощности 90 мин", isToday: false },
  { workoutId: 5003, date: "2026-06-28", type: "Run", title: "Длительный бег", isToday: false },
];

const titleById = new Map(CAL.map((w) => [w.workoutId, `${w.date} ${w.title}`]));

async function probe(label: string, message: string, target: string | null, expect: string) {
  console.log("─".repeat(76));
  console.log(`CASE: ${label}`);
  console.log(`MSG : «${message}»`);
  const r = await selectMoveSourceWorkoutWithAi({
    messageText: message,
    todayIso: TODAY,
    targetDateIso: target,
    timezone: TZ,
    calendar: CAL,
  });
  if (!r) {
    console.log("RESULT: null\n");
    return;
  }
  const picked = r.selectedWorkoutId ? titleById.get(r.selectedWorkoutId) ?? "?" : "—";
  console.log(`situation=${r.situation} decision=${r.decision} conf=${r.confidence}`);
  console.log(`selected: ${picked} | candidates: ${r.candidateWorkoutIds.map((id) => titleById.get(id)).join(", ") || "—"}`);
  console.log(`reasoning: ${r.reasoning}`);
  console.log(`ОЖИДАНИЕ: ${expect} → ${r.situation === expect ? "✅" : "⚠️ (см. reasoning)"}\n`);
}

function probeCompletedFilter() {
  console.log("─".repeat(76));
  console.log("UNIT: filterMovableNotificationCandidates (completed/past вон)");
  const candidates = [
    { title: "Running", rawTextSnippet: "Running 12 km 271 TSS completed", sourceDate: "2026-06-27", score: 1 },
    { title: "6x6", rawTextSnippet: "6x6 интервалы 201 hrTSS", sourceDate: "2026-06-26", score: 0.9 },
    { title: "Вел планируемый", rawTextSnippet: "Вел по мощности 90 мин", sourceDate: "2026-06-28", score: 0.8 },
    { title: "Прошлый бег", rawTextSnippet: "Длительный бег", sourceDate: "2026-06-20", score: 0.7 },
  ];
  const movable = filterMovableNotificationCandidates(candidates, TODAY);
  console.log(`вход: ${candidates.length} → movable: ${movable.length}`);
  movable.forEach((c) => console.log(`  ✓ ${c.sourceDate} ${c.title}`));
  const onlyPlannedFuture = movable.length === 1 && movable[0]?.title === "Вел планируемый";
  console.log(`ОЖИДАНИЕ: остаётся только планируемый будущий вел → ${onlyPlannedFuture ? "✅" : "❌"}\n`);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error("ANTHROPIC_API_KEY not set. Aborting.");
    process.exit(1);
  }
  probeCompletedFilter();
  await probe(
    "Богданов: «сделаю вел в выходные» — вел УЖЕ стоит в сб",
    "тренировка не была поставлена, сбегал так. давайте сделаю один вел в выходные либо сб вечером либо вс утром",
    null,
    "already_planned"
  );
  await probe(
    "Силовая, которой НЕТ в плане — это добавление, не перенос",
    "давайте сделаю силовую в субботу",
    "2026-06-27",
    "no_such_workout"
  );
  await probe(
    "Явный перенос существующей — должен работать как раньше",
    "перенеси интервалы на пятницу",
    "2026-06-26",
    "move_existing"
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
