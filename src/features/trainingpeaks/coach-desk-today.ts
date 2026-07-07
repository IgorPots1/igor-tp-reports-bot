import type {
  TrainingPeaksAttentionSignal,
  TrainingPeaksAttentionSnapshot,
} from "@/features/trainingpeaks/service";

// Coach-desk "Today" view model — a FULL mirror of the bot morning digest (same 5 sections, same order),
// reshaped phone-first: illness collapsed to one card per student, no tech noise, "N дней" phrasing.
// Every per-student card carries telegramUsername so the desk can tap through to the 1:1 chat. Plan cards
// carry a dismiss handle for hanging move candidates / requests. Pure transform, unit-tested.
// See ops-log 2026-07-02-1330-digest-vs-desk-sections-audit + 2026-07-03-1300-...-recon.

type WithChat = { studentId: string | null; name: string; telegramUsername: string | null };

export type CoachDeskHealthCard = WithChat & {
  summary: string;
  days: number | null; // days overdue; 0 = due today; null = no due info
};

export type CoachDeskCard = WithChat & { summary: string };

// Dismiss handle for a hanging plan row (Supabase-only, no TP): reject the pending action, or expire the
// orphan move-candidate signal. null → not dismissible (availability/constraint, expires by TTL).
export type CoachDeskDismiss =
  | { kind: "action"; actionId: string }
  | { kind: "signal"; signalId: string }
  | null;

export type CoachDeskPlanCard = CoachDeskCard & { dismiss: CoachDeskDismiss };

// System failures (move execution failed, TP/race scan job failed) — NOT illness, so no "Снять".
export type CoachDeskErrorCard = { name: string | null; summary: string };

export type CoachDeskNameRow = WithChat;

export type CoachDeskTodayView = {
  scanAlert: string | null;
  check: CoachDeskHealthCard[]; // 🩺 illness, one per student, recovery-closable
  errors: CoachDeskErrorCard[]; // ⚠️ system failures, informational
  plan: CoachDeskPlanCard[]; // 📅 availability / constraints / move candidates & requests
  pain: CoachDeskCard[]; // 🦵 injuries — admin-closable (manual only)
  noContact: CoachDeskNameRow[]; // 📭 silent 5+ days
  missed: CoachDeskNameRow[]; // 🏃 no completion recorded (from workout_cache — nightly)
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

function compactIsoDates(text: string): string {
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/gu, (_m, _y, month, day) => `${day}.${month}`);
}

function stripNoiseParens(text: string): string {
  return collapseWhitespace(
    text
      .replace(/\((?:\d{1,2}\.\d{1,2})(?:\s+\d{1,2}:\d{2})?\)/gu, "")
      .replace(/\(до\s+[^)]*\)/giu, "")
  );
}

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

function cleanHealthSummary(reason: string): string {
  let text = reason.split("\n")[0] ?? reason;
  text = text.replace(/^\s*просрочено\s+\d+\s*дн\.?:?\s*/iu, "");
  text = text.replace(/\.?\s*срок\s+сегодня\.?\s*$/iu, "");
  return collapseWhitespace(text);
}

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

export function isMoveReason(reason: string): boolean {
  return /перенос|кандидат переноса|ждёт решения/iu.test(reason);
}

function displayName(signal: TrainingPeaksAttentionSignal): string {
  return signal.studentName?.trim() || "—";
}

// Resolve the dismiss handle for a plan signal. Only two hanging kinds are dismissible from the desk:
// a pending move request (reject the action) and an orphan move candidate (expire the signal).
function planDismiss(signal: TrainingPeaksAttentionSignal): CoachDeskDismiss {
  if (signal.signalKind === "move_pending_action" && signal.actionId) {
    return { kind: "action", actionId: signal.actionId };
  }
  if (signal.actionId && /ждёт решения/iu.test(signal.reason)) {
    return { kind: "action", actionId: signal.actionId };
  }
  if (signal.signalKind === "operational_move" && signal.signalId) {
    return { kind: "signal", signalId: signal.signalId };
  }
  return null;
}

export function buildCoachDeskTodayView(
  snapshot: TrainingPeaksAttentionSnapshot,
  usernameByStudentId?: ReadonlyMap<string, string | null>
): CoachDeskTodayView {
  const username = (studentId: string | null): string | null =>
    (studentId ? usernameByStudentId?.get(studentId) ?? null : null);

  // 🩺 checkTodaySignals carries the scan alert + SYSTEM failures; illness lives in followUpToday.
  const scanSignal = snapshot.checkTodaySignals.find(isScanAlertSignal);
  const scanAlert = scanSignal ? softScanAlert(scanSignal) : null;

  const errors: CoachDeskErrorCard[] = snapshot.checkTodaySignals
    .filter((signal) => !isScanAlertSignal(signal))
    .map((signal) => ({
      name: signal.studentName?.trim() || null,
      summary: stripNoiseParens(signal.reason.split("\n").join(" ")),
    }));

  // Illness collapsed to one card per student. Merge distinct summaries; days = most overdue.
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
        telegramUsername: username(signal.studentId ?? null),
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
    telegramUsername: card.telegramUsername,
    summary: card.summaries.join(" · "),
    days: card.days,
  }));

  // 📅 Учесть в плане — availability/constraints + move candidates & requests, with dismiss handles.
  const planSignals = [...snapshot.planConstraintsToday, ...snapshot.movesToday];
  const plan: CoachDeskPlanCard[] = planSignals.map((signal) => ({
    studentId: signal.studentId ?? null,
    name: displayName(signal),
    telegramUsername: username(signal.studentId ?? null),
    summary: compactIsoDates(stripNoiseParens(signal.reason.split("\n").join(" "))),
    dismiss: planDismiss(signal),
  }));
  const moves = planSignals.filter((signal) => isMoveReason(signal.reason)).length;

  // 🦵 Травмы — admin-closable, manual only.
  const pain: CoachDeskCard[] = snapshot.painDiscomfort.map((signal) => ({
    studentId: signal.studentId ?? null,
    name: displayName(signal),
    telegramUsername: username(signal.studentId ?? null),
    summary: collapseWhitespace(signal.reason.split("\n").join(" — ")),
  }));

  const toRow = (signal: TrainingPeaksAttentionSignal): CoachDeskNameRow => ({
    studentId: signal.studentId ?? null,
    name: displayName(signal),
    telegramUsername: username(signal.studentId ?? null),
  });
  const noContact = snapshot.noContact5Days.map(toRow);
  const missed = snapshot.missedWorkouts.map(toRow);

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
