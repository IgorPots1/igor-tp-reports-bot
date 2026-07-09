import process from "node:process";

import type {
  TrainingPeaksAttentionSignal,
  TrainingPeaksAttentionSnapshot,
} from "@/features/trainingpeaks/service";
import { collectFreshIllnessTodayFromSignals } from "@/features/trainingpeaks/service";
import type { TrainingPeaksStudentOperationalSignal } from "@/features/trainingpeaks/repository";
import { buildCoachDeskTodayView } from "@/features/trainingpeaks/coach-desk-today";
import type { HealthSignalMemoryDoubt } from "@/features/trainingpeaks/health-signal-memory-reconcile";

const LOG_PREFIX = "[check-desk-fresh-illness]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function sig(
  studentName: string | null,
  reason: string,
  opts?: {
    studentId?: string | null;
    signalKind?: string;
    actionId?: string;
    signalId?: string;
    memoryDoubt?: HealthSignalMemoryDoubt | null;
  }
): TrainingPeaksAttentionSignal {
  return {
    level: "today",
    studentName,
    reason,
    studentId: opts?.studentId ?? null,
    signalKind: opts?.signalKind,
    actionId: opts?.actionId ?? null,
    signalId: opts?.signalId ?? null,
    memoryDoubt: opts?.memoryDoubt ?? null,
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
    freshIllnessToday: [],
    planConstraintsToday: [],
    planConstraintsOverflowCount: 0,
    movesToday: [],
    movesOverflowCount: 0,
  };
}

// Minimal-but-complete raw operational-signal fixture for the collector-level test (D). Only the fields
// actually read by collectFreshIllnessTodayFromSignals + shouldSkipOperationalSignalForAttentionHealthFollowUp
// + the reason-building helpers matter at runtime (signalType, studentId, id, createdAt, metadata,
// lifecycleState, structuredPayload, lifecycleMeta); the rest are filled with inert defaults so the
// object satisfies the full row type without a cast.
function opSignal(overrides: {
  id: string;
  studentId: string;
  signalType: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}): TrainingPeaksStudentOperationalSignal {
  return {
    id: overrides.id,
    studentId: overrides.studentId,
    signalType: overrides.signalType as TrainingPeaksStudentOperationalSignal["signalType"],
    status: "active",
    lifecycleState: null,
    lifecycleStateUpdatedAt: null,
    lifecycleAppliedAt: null,
    lifecycleMeta: {},
    resolvedAt: null,
    resolvedReason: null,
    requiresCoachClose: false,
    sourceType: "inline_runtime",
    sourceObservationId: null,
    telegramChatId: null,
    telegramMessageId: null,
    telegramMessageThreadId: null,
    structuredPayload: {},
    confidence: null,
    validFrom: null,
    validUntil: null,
    sourceDate: null,
    targetDate: null,
    sourceDay: null,
    targetDay: null,
    linkedMemoryItemId: null,
    linkedCaseId: null,
    linkedActionId: null,
    dedupeKey: `${overrides.studentId}:${overrides.signalType}:${overrides.id}`,
    consumedAt: null,
    metadata: overrides.metadata ?? {},
    createdAt: overrides.createdAt,
    updatedAt: overrides.createdAt,
  };
}

function run(): void {
  // ═══ A. Desk-view: freshIllnessToday → view.freshCheck; dedup against matured followUpToday ═══
  {
    const snapshot = emptySnapshot();
    snapshot.freshIllnessToday = [
      sig("Student X", "приболела, сообщила сегодня", {
        studentId: "x",
        signalKind: "fresh_illness",
        memoryDoubt: {
          suspected: true,
          pattern: "already_resolved",
          tier: "low",
          reason: "похоже, уже прошло",
          memoryItemId: null,
          memoryConfidence: null,
        },
      }),
    ];
    const view = buildCoachDeskTodayView(snapshot, new Map());
    assert(view.freshCheck.length === 1, `freshCheck should have 1 card, got ${view.freshCheck.length}`);
    assert(view.freshCheck[0].studentId === "x", "freshCheck card is Student X");
    assert(view.freshCheck[0].summary.length > 0, "freshCheck card carries a summary");
    assert(view.freshCheck[0].doubt === "похоже, уже прошло", "freshCheck card carries the memory-doubt badge");
    assert(view.check.length === 0, "no matured follow-up → check stays empty");
    assert(view.counts.freshCheck === 1, "counts.freshCheck mirrors freshCheck.length");

    // Dedup: same student ALSO in matured followUpToday → shown in check, NOT duplicated in freshCheck.
    const snapshotBoth = emptySnapshot();
    snapshotBoth.followUpToday = [
      sig("Student X", "просрочено 1 дн.: приболела", { studentId: "x", signalKind: "operational_follow_up" }),
    ];
    snapshotBoth.freshIllnessToday = snapshot.freshIllnessToday;
    const viewBoth = buildCoachDeskTodayView(snapshotBoth, new Map());
    assert(viewBoth.check.some((c) => c.studentId === "x"), "matured student X is in check");
    assert(!viewBoth.freshCheck.some((c) => c.studentId === "x"), "matured student X is deduped OUT of freshCheck");
  }

  // ═══ B. planDismiss via buildCoachDeskTodayView: operational_schedule / operational_move / move_pending_action ═══
  {
    const snapshot = emptySnapshot();
    snapshot.planConstraintsToday = [
      sig("Sched Student", "доступна: ср 01.07, чт 02.07", {
        studentId: "sched1",
        signalKind: "operational_schedule",
        signalId: "S1",
      }),
      sig("Pending Student", "ждёт решения по переносу тренировки", {
        studentId: "pend1",
        signalKind: "move_pending_action",
        actionId: "A2",
      }),
    ];
    snapshot.movesToday = [
      sig("Move Student", "кандидат переноса", {
        studentId: "move1",
        signalKind: "operational_move",
        signalId: "M1",
      }),
    ];
    const view = buildCoachDeskTodayView(snapshot, new Map());
    const schedCard = view.plan.find((p) => p.studentId === "sched1");
    assert(
      schedCard?.dismiss?.kind === "signal" && schedCard.dismiss.signalId === "S1",
      `operational_schedule → dismiss signal S1, got ${JSON.stringify(schedCard?.dismiss)}`
    );
    const moveCard = view.plan.find((p) => p.studentId === "move1");
    assert(
      moveCard?.dismiss?.kind === "signal" && moveCard.dismiss.signalId === "M1",
      `operational_move → dismiss signal M1, got ${JSON.stringify(moveCard?.dismiss)}`
    );
    const pendCard = view.plan.find((p) => p.studentId === "pend1");
    assert(
      pendCard?.dismiss?.kind === "action" && pendCard.dismiss.actionId === "A2",
      `move_pending_action → dismiss action A2, got ${JSON.stringify(pendCard?.dismiss)}`
    );
  }

  // ═══ C. Error dismiss: move_failed_action → failed_move dismiss; other errors → null ═══
  {
    const snapshot = emptySnapshot();
    snapshot.checkTodaySignals = [
      sig("Failed Move Student", "выполнение переноса завершилось с ошибкой", {
        studentId: "err1",
        signalKind: "move_failed_action",
        actionId: "A1",
      }),
      sig(null, "последний запуск TP завершился с ошибкой", { signalKind: "failed_job" }),
    ];
    const view = buildCoachDeskTodayView(snapshot, new Map());
    const failedMoveCard = view.errors.find((e) => e.studentId === "err1");
    assert(
      failedMoveCard?.dismiss?.kind === "failed_move" && failedMoveCard.dismiss.actionId === "A1",
      `move_failed_action → dismiss failed_move A1, got ${JSON.stringify(failedMoveCard?.dismiss)}`
    );
    const jobFailureCard = view.errors.find((e) => e.name === null);
    assert(jobFailureCard?.dismiss === null, `failed_job (no actionId) → dismiss null, got ${JSON.stringify(jobFailureCard?.dismiss)}`);
  }

  // ═══ D. collectFreshIllnessTodayFromSignals: raw-signal collector, created-today + pending_future gate ═══
  {
    const asOfDate = "2026-07-09";
    const nameById = new Map<string, string | null>([
      ["fresh1", "Fresh Student"],
      ["overdue1", "Overdue Student"],
      ["old1", "Old Student"],
    ]);

    // IN: health_issue_started, created today, follow-up due tomorrow (pending_future).
    const freshInScope = opSignal({
      id: "sig-fresh-1",
      studentId: "fresh1",
      signalType: "health_issue_started",
      createdAt: `${asOfDate}T09:00:00.000Z`,
      metadata: { follow_up_status: "pending", follow_up_due_at: "2026-07-10T00:00:00.000Z" },
    });

    // NOT IN: created today, but follow-up is already due/overdue (matured) — belongs to followUpToday, not fresh.
    const overdueNotFresh = opSignal({
      id: "sig-overdue-1",
      studentId: "overdue1",
      signalType: "health_issue_started",
      createdAt: `${asOfDate}T09:00:00.000Z`,
      metadata: { follow_up_status: "pending", follow_up_due_at: "2026-07-08T00:00:00.000Z" },
    });

    // NOT IN: pending_future follow-up, but signal was created 5 days ago — not "today", must not masquerade as fresh.
    const oldNotToday = opSignal({
      id: "sig-old-1",
      studentId: "old1",
      signalType: "health_issue_started",
      createdAt: "2026-07-04T09:00:00.000Z",
      metadata: { follow_up_status: "pending", follow_up_due_at: "2026-07-10T00:00:00.000Z" },
    });

    const result = collectFreshIllnessTodayFromSignals({
      signals: [freshInScope, overdueNotFresh, oldNotToday],
      activeStudentNameById: nameById,
      asOfDate,
    });

    assert(result.items.length === 1, `exactly 1 fresh-illness item, got ${result.items.length}`);
    assert(result.items[0].studentId === "fresh1", `fresh item is fresh1, got ${result.items[0].studentId}`);
    assert(
      !result.items.some((item) => item.studentId === "overdue1"),
      "matured (pending_overdue) same-day signal excluded from fresh list"
    );
    assert(
      !result.items.some((item) => item.studentId === "old1"),
      "pending_future signal NOT created today excluded from fresh list"
    );
  }

  console.log(`${LOG_PREFIX} PASS`);
}

if (process.argv[1] && process.argv[1].endsWith("check-desk-fresh-illness.ts")) {
  try {
    run();
  } catch (error) {
    console.error(`${LOG_PREFIX} FAIL`, error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
