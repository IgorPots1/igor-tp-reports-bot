import process from "node:process";

import type {
  TrainingPeaksAttentionSignal,
  TrainingPeaksAttentionSnapshot,
} from "@/features/trainingpeaks/service";
import {
  buildCoachDeskTodayView,
  extractOverdueDays,
} from "@/features/trainingpeaks/coach-desk-today";

const LOG_PREFIX = "[check-coach-desk-today]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function sig(
  studentName: string | null,
  reason: string,
  studentId?: string | null
): TrainingPeaksAttentionSignal {
  return { level: "today", studentName, reason, studentId: studentId ?? null };
}

function emptySnapshot(): TrainingPeaksAttentionSnapshot {
  return {
    urgent: [],
    today: [],
    observe: [],
    fyi: [],
    checkTodaySignals: [],
    painDiscomfort: [],
    missedWorkouts: [],
    noContact5Days: [],
    followUpToday: [],
    followUpOverflowCount: 0,
    planConstraintsToday: [],
    planConstraintsOverflowCount: 0,
    movesToday: [],
    movesOverflowCount: 0,
  };
}

function run(): void {
  // Overdue day extraction.
  assert(extractOverdueDays("просрочено 4 дн.: болеет") === 4, "4 days extracted");
  assert(extractOverdueDays("болеет. Срок сегодня") === 0, "срок сегодня → 0");
  assert(extractOverdueDays("болеет, температура") === null, "no due info → null");

  const snapshot = emptySnapshot();
  // ILYA appears 4× (retro dupes) — must collapse to ONE card with merged summaries.
  snapshot.checkTodaySignals = [
    sig("⚠️ Скан TP за вчера не прошёл (1 ученик (olgakogtina))", "данные могут быть неполными. Перелогинься: npm run tp-login (в tools/trainingpeaks-export)"),
    sig("ILYA BOGDANOV", "просрочено 4 дн.: болеет", "ilya"),
    sig("ILYA BOGDANOV", "просрочено 4 дн.: болеет, горло", "ilya"),
    sig("ILYA BOGDANOV", "просрочено 1 дн.: болеет, кашель и горло", "ilya"),
    sig("Koroleva Anna", "просрочено 1 дн.: слабость", "anna"),
    sig("Daria Postolaki", "болеет. Срок сегодня", "daria"),
  ];
  snapshot.painDiscomfort = [sig("Elena Titskaia", "Боль / колено\nуточнить, актуально ли", "elena")];
  snapshot.movesToday = [sig("Nastya Bunyakina", "кандидат переноса\n— → 01.07", "nastya")];
  snapshot.planConstraintsToday = [
    sig("Tatyana Rishko", "перенос тренировки требует проверки (01.07 21:44)", "tatyana"),
    sig("Alena Grill", "доступна: ср 01.07, чт 02.07", "alena"),
  ];
  snapshot.noContact5Days = [sig("Margarita", ""), sig("Olga", "")];
  snapshot.missedWorkouts = [sig("Alexander Ivanov", "вчера была беговая тренировка, выполнения не найдено", "alex")];

  const view = buildCoachDeskTodayView(snapshot);

  // Scan alert → soft banner, no shell command.
  assert(view.scanAlert !== null, "scan alert present");
  assert(!/tp-login|npm/.test(view.scanAlert ?? ""), "scan alert strips shell command");

  // ILYA collapsed to one card; Anna + Daria separate → 3 health cards (scan excluded).
  assert(view.check.length === 3, `illness collapsed to 3 cards, got ${view.check.length}`);
  const ilya = view.check.find((c) => c.studentId === "ilya");
  assert(ilya !== undefined, "ILYA card exists");
  assert(ilya!.summary.includes("горло") && ilya!.summary.includes("кашель"), "ILYA symptoms merged");
  assert(ilya!.days === 4, `ILYA days = most overdue (4), got ${ilya!.days}`);
  const daria = view.check.find((c) => c.studentId === "daria");
  assert(daria!.days === 0, "Daria due today = 0");

  // Moves: timestamp stripped, move-phrased plan constraint folded into moves.
  assert(view.moves.length === 2, `2 move cards, got ${view.moves.length}`);
  assert(view.moves.every((m) => !/\d{2}:\d{2}/.test(m.summary)), "no HH:MM timestamps in moves");

  // Plan availability (non-move) goes to background, not moves. Tatyana (перенос) is NOT in plan.
  assert(view.background.plan.includes("Alena Grill"), "availability → background.plan");
  assert(!view.background.plan.includes("Tatyana Rishko"), "move-phrased constraint NOT in plan");
  assert(view.background.plan.length === 1, "only availability in plan");
  assert(view.background.noContact.length === 2, "noContact names");
  assert(view.background.missed.includes("Alexander Ivanov"), "missed names");

  // Counts.
  assert(view.counts.check === 3 && view.counts.pain === 1 && view.counts.moves === 2, "counts match");
  assert(view.counts.background === 1 + 2 + 1, "background count = plan+noContact+missed");

  console.log(`${LOG_PREFIX} PASS`);
}

if (process.argv[1] && process.argv[1].endsWith("check-coach-desk-today.ts")) {
  try {
    run();
  } catch (error) {
    console.error(`${LOG_PREFIX} FAIL`, error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
