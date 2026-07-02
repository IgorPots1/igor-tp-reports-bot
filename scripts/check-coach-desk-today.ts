import process from "node:process";

import type {
  TrainingPeaksAttentionSignal,
  TrainingPeaksAttentionSnapshot,
} from "@/features/trainingpeaks/service";
import {
  buildCoachDeskTodayView,
  extractOverdueDays,
  isMoveReason,
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
  opts?: { studentId?: string | null; signalKind?: string }
): TrainingPeaksAttentionSignal {
  return {
    level: "today",
    studentName,
    reason,
    studentId: opts?.studentId ?? null,
    signalKind: opts?.signalKind,
  };
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
  // Helper exports.
  assert(extractOverdueDays("просрочено 4 дн.: болеет") === 4, "4 days extracted");
  assert(extractOverdueDays("болеет. Срок сегодня") === 0, "срок сегодня → 0");
  assert(isMoveReason("кандидат переноса") && isMoveReason("перенос требует проверки"), "move reasons");
  assert(!isMoveReason("доступна: ср, чт"), "availability is not a move");

  const snapshot = emptySnapshot();
  // checkTodaySignals = SYSTEM stuff: scan alert + move-exec-failed + failed job (name null).
  snapshot.checkTodaySignals = [
    sig("⚠️ Скан TP за вчера не прошёл (1 ученик (olgakogtina))", "npm run tp-login (в tools/trainingpeaks-export)", { signalKind: "scan_failed" }),
    sig("Tatyana Rishko", "выполнение переноса завершилось с ошибкой", { studentId: "tat", signalKind: "move_failed_action" }),
    sig(null, "последний запуск TP завершился с ошибкой", { signalKind: "failed_job" }),
  ];
  // followUpToday = illness. ILYA ×3 (retro dupes) must collapse to ONE card.
  snapshot.followUpToday = [
    sig("ILYA BOGDANOV", "просрочено 4 дн.: болеет", { studentId: "ilya", signalKind: "operational_follow_up" }),
    sig("ILYA BOGDANOV", "просрочено 4 дн.: болеет, горло", { studentId: "ilya", signalKind: "operational_follow_up" }),
    sig("ILYA BOGDANOV", "просрочено 1 дн.: болеет, кашель и горло", { studentId: "ilya", signalKind: "operational_follow_up" }),
    sig("Koroleva Anna", "просрочено 1 дн.: слабость", { studentId: "anna", signalKind: "operational_follow_up" }),
    sig("Daria Postolaki", "болеет. Срок сегодня", { studentId: "daria", signalKind: "operational_follow_up" }),
  ];
  snapshot.painDiscomfort = [sig("Elena Titskaia", "боль / колено\nуточнить, актуально ли", { studentId: "elena" })];
  snapshot.movesToday = [sig("Nastya Bunyakina", "кандидат переноса\n— → 2026-07-01", { studentId: "nastya" })];
  snapshot.planConstraintsToday = [
    sig("Alena Grill", "доступна: ср 01.07, чт 02.07", { studentId: "alena" }),
    sig("Tatyana Rishko", "перенос тренировки требует проверки (01.07 21:44)", { studentId: "tat2" }),
  ];
  snapshot.noContact5Days = [sig("Margarita", ""), sig("Olga", "")];
  snapshot.missedWorkouts = [sig("Alexander Ivanov", "вчера была беговая тренировка, выполнения не найдено", { studentId: "alex" })];

  const view = buildCoachDeskTodayView(snapshot);

  // Scan alert → soft banner, no shell command.
  assert(view.scanAlert !== null && !/tp-login|npm/.test(view.scanAlert ?? ""), "scan alert soft, no shell");

  // ERRORS: move-exec-failed + failed-job → errors, NOT illness. One has a null name.
  assert(view.errors.length === 2, `2 error cards, got ${view.errors.length}`);
  assert(view.errors.some((e) => e.name === "Tatyana Rishko"), "move-failed is an error with name");
  assert(view.errors.some((e) => e.name === null), "job failure shown with null name");
  assert(!view.check.some((c) => /ошибк/i.test(c.summary)), "no system error leaked into illness cards");

  // ILYA collapsed to one illness card; Anna + Daria separate → 3.
  assert(view.check.length === 3, `illness collapsed to 3, got ${view.check.length}`);
  const ilya = view.check.find((c) => c.studentId === "ilya");
  assert(ilya!.summary.includes("горло") && ilya!.summary.includes("кашель"), "ILYA symptoms merged");
  assert(ilya!.days === 4, `ILYA days = max overdue (4), got ${ilya!.days}`);

  // PLAN: availability + move-needs-review + move candidate = 3 cards; moves count = 2 (the two move ones).
  assert(view.plan.length === 3, `3 plan cards, got ${view.plan.length}`);
  assert(view.counts.moves === 2, `moves count 2, got ${view.counts.moves}`);
  assert(view.plan.every((p) => !/\d{2}:\d{2}/.test(p.summary)), "no HH:MM in plan");
  assert(view.plan.every((p) => !/\d{4}-\d{2}-\d{2}/.test(p.summary)), "ISO dates compacted in plan");

  // PAIN present (admin-closable).
  assert(view.pain.length === 1 && view.pain[0].studentId === "elena", "pain card present with studentId");

  // Tails as names.
  assert(view.noContact.length === 2 && view.missed.includes("Alexander Ivanov"), "tails as names");

  // Counts mirror sections.
  assert(
    view.counts.check === 3 &&
      view.counts.errors === 2 &&
      view.counts.plan === 3 &&
      view.counts.pain === 1 &&
      view.counts.noContact === 2 &&
      view.counts.missed === 1,
    "counts mirror sections"
  );

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
