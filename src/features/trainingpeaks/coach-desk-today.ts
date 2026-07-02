import type {
  TrainingPeaksAttentionSignal,
  TrainingPeaksAttentionSnapshot,
} from "@/features/trainingpeaks/service";

// Coach-desk "Today" view model — a FULL mirror of the bot morning digest (same 5 sections, same order),
// reshaped phone-first: illness collapsed to one card per student, no tech noise (timestamps, ids, shell
// commands), "N дней" instead of "просрочено N дн.". Pure transform, unit-tested. The digest text is
// unchanged; this is a parallel presentation. See ops-log 2026-07-02-1330-digest-vs-desk-sections-audit.
//
// Digest section → desk field:
//   🩺 Проверить сегодня  → check (illness, closable via recovery) + errors (system failures) + scanAlert banner
//   📅 Учесть в плане     → plan (availability/constraints + move candidates/requests)
//   🦵 Травмы / дискомфорт → pain (closable via admin path, manual only)
//   📭 Нет контакта        → noContact (names)
//   🏃 Нет тренировки      → missed (names)

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

// System failures (move execution failed, TP/race scan job failed) — NOT illness, so no "Снять".
export type CoachDeskErrorCard = {
  name: string | null; // may be absent (job-level failures have no student)
  summary: string;
};

export type CoachDeskTodayView = {
  scanAlert: string | null;
  check: CoachDeskHealthCard[]; // 🩺 illness, one per student, recovery-closable
  errors: CoachDeskErrorCard[]; // ⚠️ system failures, informational
  plan: CoachDeskCard[]; // 📅 availability / constraints / move candidates & requests
  pain: CoachDeskCard[]; // 🦵 injuries — admin-closable (manual only)
  noContact: string[]; // 📭 silent 5+ days — names
  missed: string[]; // 🏃 no completion recorded — names
  counts: {
    check: number;
    errors: number;
    plan: number;
    moves: number;
    pain: number;
    noContact: number;
    missed: number;
  };
};

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

// 2026-06-30 → 30.06. Full ISO dates read as tech noise in a morning glance; day.month is enough.
function compactIsoDates(text: string): string {
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/gu, (_m, _y, month, day) => `${day}.${month}`);
}

// Drop parenthetical timestamps "(01.07 21:44)" / "(30.06)" and valid-until clauses "(до 05.07)".
function stripNoiseParens(text: string): string {
  return collapseWhitespace(
    text
      .replace(/\((?:\d{1,2}\.\d{1,2})(?:\s+\d{1,2}:\d{2})?\)/gu, "")
      .replace(/\(до\s+[^)]*\)/giu, "")
  );
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

// The scan-failure signal is injected into checkToday with the alert as the "name" (studentName null,
// signalKind scan_failed). Detect it to render a soft banner and strip the "npm run tp-login" command.
function isScanAlertSignal(signal: TrainingPeaksAttentionSignal): boolean {
  if (signal.signalKind === "scan_failed") {
    return true;
  }
  const hay = `${signal.studentName ?? ""} ${signal.reason}`.toLowerCase();
  return hay.includes("скан tp") || hay.includes("tp-login");
}

function softScanAlert(signal: TrainingPeaksAttentionSignal): string {
  const countMatch = `${signal.studentName ?? ""} ${signal.reason}`.match(/(\d+)\s*учен/iu);
  const who = countMatch ? ` (${countMatch[1]})` : "";
  return `Данные за вчера могут быть неполными${who}.`;
}

// Move candidates / move-needs-review requests inside the plan section (the "переносы" subset).
export function isMoveReason(reason: string): boolean {
  return /перенос|кандидат переноса|ждёт решения/iu.test(reason);
}

function displayName(signal: TrainingPeaksAttentionSignal): string {
  return signal.studentName?.trim() || "—";
}

export function buildCoachDeskTodayView(snapshot: TrainingPeaksAttentionSnapshot): CoachDeskTodayView {
  // 🩺 Проверить: checkTodaySignals carries the scan alert + SYSTEM failures (move exec failed, failed
  // jobs); illness lives in followUpToday. Split them so system failures never look like closable illness.
  const scanSignal = snapshot.checkTodaySignals.find(isScanAlertSignal);
  const scanAlert = scanSignal ? softScanAlert(scanSignal) : null;

  const errors: CoachDeskErrorCard[] = snapshot.checkTodaySignals
    .filter((signal) => !isScanAlertSignal(signal))
    .map((signal) => ({
      name: signal.studentName?.trim() || null,
      summary: stripNoiseParens(signal.reason.split("\n").join(" ")),
    }));

  // Illness (followUpToday) collapsed to one card per student. Merge distinct summaries; days = most overdue.
  const byStudent = new Map<string, CoachDeskHealthCard & { summaries: string[] }>();
  for (const signal of snapshot.followUpToday) {
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

  // 📅 Учесть в плане: full digest section 2 — availability/constraints + move candidates & requests.
  const planSignals = [...snapshot.planConstraintsToday, ...snapshot.movesToday];
  const plan: CoachDeskCard[] = planSignals.map((signal) => ({
    studentId: signal.studentId ?? null,
    name: displayName(signal),
    summary: compactIsoDates(stripNoiseParens(signal.reason.split("\n").join(" "))),
  }));
  const moves = planSignals.filter((signal) => isMoveReason(signal.reason)).length;

  // 🦵 Травмы — admin-closable (manual only).
  const pain: CoachDeskCard[] = snapshot.painDiscomfort.map((signal) => ({
    studentId: signal.studentId ?? null,
    name: displayName(signal),
    summary: collapseWhitespace(signal.reason.split("\n").join(" — ")),
  }));

  const noContact = snapshot.noContact5Days.map(displayName);
  const missed = snapshot.missedWorkouts.map(displayName);

  return {
    scanAlert,
    check,
    errors,
    plan,
    pain,
    noContact,
    missed,
    counts: {
      check: check.length,
      errors: errors.length,
      plan: plan.length,
      moves,
      pain: pain.length,
      noContact: noContact.length,
      missed: missed.length,
    },
  };
}
