import type {
  TrainingPeaksAttentionSignal,
  TrainingPeaksAttentionSnapshot,
} from "@/features/trainingpeaks/service";

// Coach-desk "Today" view model. Turns the same attention snapshot the bot digest uses into a clean,
// phone-first shape: illness collapsed to ONE card per student, no tech noise (timestamps, ids, shell
// commands), "N дней" instead of "просрочено N дн.", background lists foldable. Pure transform — no I/O,
// unit-tested. The bot digest text stays as-is; this is a parallel presentation for the Mini App.

export type CoachDeskHealthCard = {
  studentId: string | null;
  name: string;
  summary: string;
  days: number | null; // days overdue; 0 = due today; null = no due info
};

export type CoachDeskCard = {
  studentId: string | null;
  name: string;
  summary: string;
};

export type CoachDeskTodayView = {
  scanAlert: string | null;
  check: CoachDeskHealthCard[]; // 🩺 illness, one per student
  pain: CoachDeskCard[]; // 🦵 injuries / discomfort
  moves: CoachDeskCard[]; // 🔁 workout-move candidates / needs-check
  background: {
    plan: string[]; // availability / constraints — names only
    noContact: string[]; // silent 5+ days
    missed: string[]; // no completion recorded
  };
  counts: { check: number; pain: number; moves: number; background: number };
};

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

// 2026-06-30 → 30.06. Full ISO dates read as tech noise in a morning glance; day.month is enough.
function compactIsoDates(text: string): string {
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/gu, (_m, _y, month, day) => `${day}.${month}`);
}

// "перенос требует проверки (01.07 21:44)" → drop the parenthetical timestamp. Also strips a bare
// trailing "(DD.MM)" or "(DD.MM HH:MM)". Morning glance doesn't need the minute a request arrived.
function stripTimestamps(text: string): string {
  return collapseWhitespace(text.replace(/\((?:\d{1,2}\.\d{1,2})(?:\s+\d{1,2}:\d{2})?\)/gu, ""));
}

// Pull "N" out of "просрочено 4 дн.:" / "Просрочено 4 дн." → 4. "Срок сегодня" / "срок сегодня" → 0.
export function extractOverdueDays(reason: string): number | null {
  const overdue = reason.match(/просрочено\s+(\d+)\s*дн/iu);
  if (overdue) {
    return Number.parseInt(overdue[1], 10);
  }
  if (/срок\s+сегодня/iu.test(reason)) {
    return 0;
  }
  return null;
}

// Reason → coach-facing summary: drop the "просрочено N дн.:" / "Срок сегодня" scaffolding and the
// first newline's trailing recommendation, keep the clinical gist ("болеет, температура").
function cleanHealthSummary(reason: string): string {
  let text = reason.split("\n")[0] ?? reason;
  text = text.replace(/^\s*просрочено\s+\d+\s*дн\.?:?\s*/iu, "");
  text = text.replace(/\.?\s*срок\s+сегодня\.?\s*$/iu, "");
  return collapseWhitespace(text);
}

// The scan-failure signal is injected into checkToday with the alert as the "name". Detect it so we can
// render a soft banner instead of a student card, and strip the "npm run tp-login …" shell command.
function isScanAlertSignal(signal: TrainingPeaksAttentionSignal): boolean {
  const hay = `${signal.studentName ?? ""} ${signal.reason}`.toLowerCase();
  return hay.includes("скан tp") || hay.includes("tp-login");
}

function softScanAlert(signal: TrainingPeaksAttentionSignal): string {
  const countMatch = `${signal.studentName ?? ""} ${signal.reason}`.match(/(\d+)\s*учен/iu);
  const who = countMatch ? ` (${countMatch[1]})` : "";
  return `Данные за вчера могут быть неполными${who}.`;
}

function isMoveReason(reason: string): boolean {
  return /перенос|кандидат переноса/iu.test(reason);
}

function displayName(signal: TrainingPeaksAttentionSignal): string {
  return signal.studentName?.trim() || "—";
}

export function buildCoachDeskTodayView(snapshot: TrainingPeaksAttentionSnapshot): CoachDeskTodayView {
  const healthSignals = [...snapshot.checkTodaySignals, ...snapshot.followUpToday];

  // Scan alert (banner, once).
  const scanSignal = healthSignals.find(isScanAlertSignal);
  const scanAlert = scanSignal ? softScanAlert(scanSignal) : null;

  // Illness collapsed to one card per student. Merge distinct summaries; days = most overdue.
  const byStudent = new Map<string, CoachDeskHealthCard & { summaries: string[] }>();
  for (const signal of healthSignals) {
    if (isScanAlertSignal(signal)) {
      continue;
    }
    const key = signal.studentId?.trim() || signal.studentName?.trim() || "";
    if (!key) {
      continue;
    }
    const summary = cleanHealthSummary(signal.reason);
    const days = extractOverdueDays(signal.reason);
    const existing = byStudent.get(key);
    if (!existing) {
      byStudent.set(key, {
        studentId: signal.studentId ?? null,
        name: displayName(signal),
        summary: "",
        days,
        summaries: summary ? [summary] : [],
      });
      continue;
    }
    if (summary && !existing.summaries.includes(summary)) {
      existing.summaries.push(summary);
    }
    if (days !== null && (existing.days === null || days > existing.days)) {
      existing.days = days;
    }
  }
  const check: CoachDeskHealthCard[] = [...byStudent.values()].map((card) => ({
    studentId: card.studentId,
    name: card.name,
    summary: card.summaries.join(" · "),
    days: card.days,
  }));

  const pain: CoachDeskCard[] = snapshot.painDiscomfort.map((signal) => ({
    studentId: signal.studentId ?? null,
    name: displayName(signal),
    summary: collapseWhitespace(signal.reason.split("\n").join(" — ")),
  }));

  // Moves = explicit move candidates + any plan constraint phrased as a move-needs-check.
  const moveSignals = [
    ...snapshot.movesToday,
    ...snapshot.planConstraintsToday.filter((signal) => isMoveReason(signal.reason)),
  ];
  const moves: CoachDeskCard[] = moveSignals.map((signal) => ({
    studentId: signal.studentId ?? null,
    name: displayName(signal),
    summary: compactIsoDates(stripTimestamps(signal.reason.split("\n").join(" "))),
  }));

  // Background — names only, folded in the UI.
  const plan = snapshot.planConstraintsToday
    .filter((signal) => !isMoveReason(signal.reason))
    .map(displayName);
  const noContact = snapshot.noContact5Days.map(displayName);
  const missed = snapshot.missedWorkouts.map(displayName);

  return {
    scanAlert,
    check,
    pain,
    moves,
    background: { plan, noContact, missed },
    counts: {
      check: check.length,
      pain: pain.length,
      moves: moves.length,
      background: plan.length + noContact.length + missed.length,
    },
  };
}
