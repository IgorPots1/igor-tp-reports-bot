/**
 * Probe: calendar-aware AI source selection (selectMoveSourceWorkoutWithAi).
 * Feeds Haiku a message + a planned-workout calendar and prints which workout it chose and why.
 * Read-only — no DB, no Telegram, no TrainingPeaks. Validates the "ум у модели" decision shift.
 *
 * Usage:
 *   npx tsx scripts/probe-move-source-ai.ts
 *
 * Env required:
 *   ANTHROPIC_API_KEY — from .env.local (loaded automatically)
 *   MOVE_INTENT_MODEL — optional model override (default claude-haiku-4-5-20251001)
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  selectMoveSourceWorkoutWithAi,
  type MoveSourceCalendarWorkout,
} from "@/features/trainingpeaks/move-workout-parser-ai";

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

const TODAY = "2026-06-25"; // ЧТ
const TZ = "Europe/Moscow";

// Kasianenko's real calendar around the audit case (planned, not completed):
// ЧТ 25 = вел 3×12 (сегодня, не выполнен); ПТ 26 = 2×1000 swim; СБ 27 = длительный вел; ВС 28 = длительный бег.
const KASIANENKO_CALENDAR: MoveSourceCalendarWorkout[] = [
  { workoutId: 3808377112, date: "2026-06-25", type: "Bike", title: "3 х 12 / 2 мин", isToday: true },
  { workoutId: 3808377614, date: "2026-06-26", type: "Swim", title: "2 x 1000", isToday: false },
  { workoutId: 3808270043, date: "2026-06-27", type: "Bike", title: "Длительный вел по мощности", isToday: false },
  { workoutId: 3804245266, date: "2026-06-28", type: "Run", title: "Длительный бег по темпу", isToday: false },
];

type Case = {
  label: string;
  message: string;
  target: string | null;
  calendar: MoveSourceCalendarWorkout[];
  expectWorkoutId?: number; // human-correct pick (for eyeballing)
};

const CASES: Case[] = [
  {
    label: "Kasianenko — «сегодня плохо» → СЕГОДНЯШНИЙ вел (не будущий бег)",
    message: "Здравствуйте, перенесите тренировку на субботу. Сегодня плохо себя чувствую, температура поднялась",
    target: "2026-06-27",
    calendar: KASIANENKO_CALENDAR,
    expectWorkoutId: 3808377112,
  },
  {
    label: "«не могу в пятницу» → пятничная (2×1000)",
    message: "не смогу в пятницу плавать, перенесите пожалуйста",
    target: null,
    calendar: KASIANENKO_CALENDAR,
    expectWorkoutId: 3808377614,
  },
  {
    label: "«уезжаю на выходные» → тренировки выходных (СБ/ВС) — ambiguous ок",
    message: "уезжаю на выходные, давайте перенесём тренировки выходных на будни",
    target: null,
    calendar: KASIANENKO_CALENDAR,
  },
  {
    label: "«перенесите длительную» → длительный бег/вел по типу",
    message: "перенесите длительную на понедельник пожалуйста",
    target: null,
    calendar: KASIANENKO_CALENDAR,
  },
];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error("ANTHROPIC_API_KEY not set (.env.local). Aborting.");
    process.exit(1);
  }
  console.log(`Model: ${process.env.MOVE_INTENT_MODEL?.trim() || "claude-haiku-4-5-20251001"}`);
  console.log(`Today: ${TODAY} (${TZ})\n`);

  const titleById = new Map(KASIANENKO_CALENDAR.map((w) => [w.workoutId, `${w.date} ${w.title}`]));

  for (const testCase of CASES) {
    console.log("─".repeat(78));
    console.log(`CASE: ${testCase.label}`);
    console.log(`MSG : ${testCase.message}`);
    const result = await selectMoveSourceWorkoutWithAi({
      messageText: testCase.message,
      todayIso: TODAY,
      targetDateIso: testCase.target,
      timezone: TZ,
      calendar: testCase.calendar,
    });
    if (!result) {
      console.log("RESULT: null (no key / error / empty calendar)\n");
      continue;
    }
    console.log(`DECISION  : ${result.decision} (confidence ${result.confidence})`);
    if (result.decision === "single") {
      const picked = result.selectedWorkoutId;
      console.log(`PICKED    : ${picked} → ${picked ? titleById.get(picked) ?? "?" : "—"}`);
      if (testCase.expectWorkoutId) {
        const ok = picked === testCase.expectWorkoutId;
        console.log(`EXPECTED  : ${testCase.expectWorkoutId} → ${ok ? "✅ MATCH" : "❌ MISMATCH"}`);
      }
    } else if (result.decision === "ambiguous") {
      console.log(
        `CANDIDATES: ${result.candidateWorkoutIds
          .map((id) => `${id} (${titleById.get(id) ?? "?"})`)
          .join(", ")}`
      );
    }
    console.log(`REASONING : ${result.reasoning}\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
