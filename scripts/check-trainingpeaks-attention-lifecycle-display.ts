import process from "node:process";

import { formatTrainingPeaksAttentionSnapshotMessage } from "@/features/trainingpeaks/attention-telegram";
import {
  collectOperationalHealthFollowUpsFromSignals,
  collectOperationalScheduleSignalsForAttentionFromSignals,
} from "@/features/trainingpeaks/service";
import type { TrainingPeaksAttentionSnapshot } from "@/features/trainingpeaks/service";
import type { TrainingPeaksStudentOperationalSignal } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[check-trainingpeaks-attention-lifecycle-display]";
const AS_OF_DATE = "2026-06-05";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function makeSignal(input: {
  signalId: string;
  studentId: string;
  signalType: string;
  structuredPayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  validFrom?: string | null;
  validUntil?: string | null;
  lifecycleState?: TrainingPeaksStudentOperationalSignal["lifecycleState"];
  lifecycleMeta?: TrainingPeaksStudentOperationalSignal["lifecycleMeta"];
  requiresCoachClose?: boolean;
}): TrainingPeaksStudentOperationalSignal {
  return {
    id: input.signalId,
    studentId: input.studentId,
    signalType: input.signalType as TrainingPeaksStudentOperationalSignal["signalType"],
    status: "active",
    lifecycleState: input.lifecycleState ?? null,
    lifecycleStateUpdatedAt: null,
    lifecycleAppliedAt: null,
    lifecycleMeta: input.lifecycleMeta ?? {},
    resolvedAt: null,
    resolvedReason: null,
    requiresCoachClose: input.requiresCoachClose ?? false,
    sourceType: "fixture",
    sourceObservationId: null,
    telegramChatId: null,
    telegramMessageId: null,
    telegramMessageThreadId: null,
    structuredPayload: input.structuredPayload ?? {},
    confidence: null,
    validFrom: input.validFrom ?? null,
    validUntil: input.validUntil ?? null,
    sourceDate: null,
    targetDate: null,
    sourceDay: null,
    targetDay: null,
    linkedMemoryItemId: null,
    linkedCaseId: null,
    linkedActionId: null,
    dedupeKey: `fixture:${input.signalId}`,
    consumedAt: null,
    metadata: input.metadata ?? {},
    createdAt: "2026-06-03T08:00:00.000Z",
    updatedAt: "2026-06-03T08:00:00.000Z",
  };
}

function pendingFollowUpMetadata(reason: string) {
  return {
    follow_up_status: "pending",
    follow_up_due_at: `${AS_OF_DATE}T09:00:00.000+02:00`,
    follow_up_reason: reason,
  };
}

function buildStudentNameMap(entries: Array<[string, string]>): Map<string, string | null> {
  return new Map<string, string | null>(entries);
}

function buildAttentionMessage(input: {
  followUps: ReturnType<typeof collectOperationalHealthFollowUpsFromSignals>;
  planConstraints: ReturnType<typeof collectOperationalScheduleSignalsForAttentionFromSignals>;
}): string {
  const snapshot: TrainingPeaksAttentionSnapshot = {
    urgent: [],
    today: [],
    observe: [],
    fyi: [],
    noContact5Days: [],
    followUpToday: input.followUps.items.map((item) => ({
      level: "today",
      studentName: item.studentName,
      studentId: item.studentId,
      reason: item.reason,
      signalKind: "operational_follow_up",
    })),
    followUpOverflowCount: input.followUps.overflowCount,
    planConstraintsToday: input.planConstraints.items.map((item) => ({
      level: "today",
      studentName: item.studentName,
      studentId: item.studentId,
      reason: item.reason,
      signalKind: "operational_schedule",
    })),
    planConstraintsOverflowCount: input.planConstraints.overflowCount,
    movesToday: [],
    movesOverflowCount: 0,
  };
  return formatTrainingPeaksAttentionSnapshotMessage(snapshot, "Утренний обзор");
}

function run(): void {
  const studentNames = buildStudentNameMap([
    ["active-illness", "Active Illness Athlete"],
    ["monitoring", "Monitoring Athlete"],
    ["ready-close", "Ready Close Athlete"],
    ["stale", "Stale Athlete"],
    ["resolved-hidden", "Resolved Hidden Athlete"],
    ["superseded-hidden", "Superseded Hidden Athlete"],
    ["strength-hidden", "Strength Context Hidden Athlete"],
    ["visible-plan", "Visible Plan Athlete"],
    ["pautov-like", "Alexander Pautov"],
    ["titskaia-like", "Elena Titskaia"],
    ["kasianenko-like", "Aleksandra Kasianenko"],
  ]);

  const lifecycleSignals = [
    makeSignal({
      signalId: "active-illness-row",
      studentId: "active-illness",
      signalType: "health_issue_started",
      metadata: pendingFollowUpMetadata("болеет, температура и слабость"),
      structuredPayload: {
        latest_summary: "болеет, температура и слабость",
        health_state: "sick",
      },
    }),
    makeSignal({
      signalId: "monitoring-row",
      studentId: "monitoring",
      signalType: "health_issue_started",
      lifecycleState: "monitoring_after_return",
      metadata: pendingFollowUpMetadata("болеет, нужно проверить"),
      structuredPayload: {
        latest_summary: "вернулся после паузы, бег лёгкий",
        health_state: "improving",
      },
    }),
    makeSignal({
      signalId: "ready-close-row",
      studentId: "ready-close",
      signalType: "health_issue_started",
      lifecycleState: "monitoring_after_return",
      requiresCoachClose: true,
      metadata: pendingFollowUpMetadata("боль прошла"),
      structuredPayload: {
        signal_type: "pain_injury",
        activity_domain: "injury",
        latest_summary: "без жалоб после возврата",
      },
    }),
    makeSignal({
      signalId: "stale-row",
      studentId: "stale",
      signalType: "health_issue_started",
      metadata: {
        ...pendingFollowUpMetadata("старый эпизод"),
        lifecycle_effective: "stale_needs_review",
      },
      structuredPayload: {
        latest_summary: "нет новых апдейтов по эпизоду",
      },
    }),
    makeSignal({
      signalId: "resolved-hidden-row",
      studentId: "resolved-hidden",
      signalType: "health_issue_started",
      lifecycleState: "resolved",
      metadata: pendingFollowUpMetadata("resolved should be hidden"),
      structuredPayload: {
        latest_summary: "resolved should be hidden",
      },
    }),
    makeSignal({
      signalId: "superseded-hidden-row",
      studentId: "superseded-hidden",
      signalType: "health_issue_started",
      metadata: {
        ...pendingFollowUpMetadata("superseded duplicate should be hidden"),
        superseded_by_signal_id: "active-illness-row",
      },
      structuredPayload: {
        latest_summary: "superseded duplicate should be hidden",
      },
    }),
    makeSignal({
      signalId: "strength-context-hidden-row",
      studentId: "strength-hidden",
      signalType: "plan_generation_constraint",
      validFrom: AS_OF_DATE,
      validUntil: "2026-06-07",
      structuredPayload: {
        signal_type: "external_training_context",
        activity_domain: "strength",
        visible_in_tp_signals: false,
        display_summary: "силовые: hidden context",
      },
    }),
    makeSignal({
      signalId: "visible-plan-row",
      studentId: "visible-plan",
      signalType: "plan_generation_constraint",
      validFrom: AS_OF_DATE,
      validUntil: AS_OF_DATE,
      structuredPayload: {
        resolved_available_dates: [AS_OF_DATE],
        latest_summary: "доступна сегодня",
      },
    }),
    makeSignal({
      signalId: "pautov-recovery-row",
      studentId: "pautov-like",
      signalType: "health_issue_started",
      lifecycleState: "return_planned",
      metadata: pendingFollowUpMetadata("болеет, горло"),
      structuredPayload: {
        display_summary: "после болезни: в строю, возврат к тренировкам; наблюдать",
        latest_summary: "после болезни: в строю, возврат к тренировкам; наблюдать",
      },
      lifecycleMeta: {
        recovery_update: {
          updated_display_summary: "после болезни: в строю, возврат к тренировкам; наблюдать",
        },
      },
    }),
    makeSignal({
      signalId: "titskaia-recovery-row",
      studentId: "titskaia-like",
      signalType: "health_issue_started",
      lifecycleState: "return_planned",
      metadata: pendingFollowUpMetadata("болеет; пауза"),
      structuredPayload: {
        display_summary: "после болезни: лучше, завтра пробежка; наблюдать",
        latest_summary: "после болезни: лучше, завтра пробежка; наблюдать",
      },
      lifecycleMeta: {
        recovery_update: {
          updated_display_summary: "после болезни: лучше, завтра пробежка; наблюдать",
        },
      },
    }),
    makeSignal({
      signalId: "kasianenko-recovery-row",
      studentId: "kasianenko-like",
      signalType: "health_issue_started",
      lifecycleState: "monitoring_after_return",
      metadata: pendingFollowUpMetadata("болеет, горло; не бегает 5 дней"),
      structuredPayload: {
        display_summary: "после болезни: лучше, завтра пробный бег; наблюдать",
        latest_summary: "после болезни: лучше, завтра пробный бег; наблюдать",
      },
      lifecycleMeta: {
        recovery_update: {
          updated_display_summary: "после болезни: лучше, завтра пробный бег; наблюдать",
        },
      },
    }),
  ];

  const followUps = collectOperationalHealthFollowUpsFromSignals({
    signals: lifecycleSignals,
    activeStudentNameById: studentNames,
    asOfDate: AS_OF_DATE,
    maxItems: 10,
  });
  const planConstraints = collectOperationalScheduleSignalsForAttentionFromSignals({
    signals: lifecycleSignals,
    activeStudentNameById: studentNames,
    asOfDate: AS_OF_DATE,
    maxItems: 10,
  });
  const attentionMessage = buildAttentionMessage({ followUps, planConstraints });

  const activeIllness = followUps.items.find((item) => item.studentId === "active-illness");
  assert(Boolean(activeIllness), "1 failed: active illness follow-up should appear.");
  assert(
    activeIllness?.reason.includes("болеет") || activeIllness?.reason.includes("температура"),
    "1 failed: active illness follow-up should keep direct health wording."
  );
  assert(
    attentionMessage.includes("Active Illness Athlete"),
    "1 failed: active illness athlete should appear in /tp_attention message."
  );

  const monitoring = followUps.items.find((item) => item.studentId === "monitoring");
  assert(Boolean(monitoring), "2 failed: monitoring follow-up should appear when due today.");
  assert(
    monitoring?.reason.includes("после паузы:") && monitoring.reason.includes("наблюдать"),
    "2 failed: monitoring_after_return should use calm monitoring wording."
  );
  assert(
    !monitoring?.reason.includes("болеет"),
    "2 failed: monitoring_after_return must not reuse acute illness follow-up wording."
  );

  const readyClose = followUps.items.find((item) => item.studentId === "ready-close");
  assert(Boolean(readyClose), "3 failed: ready-close follow-up should appear when due today.");
  assert(
    readyClose?.reason.includes("можно закрыть после проверки"),
    "3 failed: monitoring_after_return + requiresCoachClose should use coach-close wording."
  );
  assert(
    !readyClose?.reason.includes("болеет") && !readyClose?.reason.includes("боль прошла"),
    "3 failed: ready-close follow-up must not read like unresolved acute pain."
  );

  const stale = followUps.items.find((item) => item.studentId === "stale");
  assert(Boolean(stale), "4 failed: stale follow-up should appear when due today.");
  assert(
    stale?.reason.includes("давно нет новых данных") && stale.reason.includes("проверить вручную"),
    "4 failed: stale_needs_review should use manual-review wording."
  );

  assert(
    !followUps.items.some((item) => item.studentId === "resolved-hidden"),
    "5 failed: resolved lifecycle signal should be hidden from /tp_attention follow-ups."
  );
  assert(
    !attentionMessage.includes("Resolved Hidden Athlete"),
    "5 failed: resolved lifecycle signal should not appear in /tp_attention message."
  );

  assert(
    !followUps.items.some((item) => item.studentId === "superseded-hidden"),
    "6 failed: superseded duplicate should be hidden from /tp_attention follow-ups."
  );
  assert(
    !attentionMessage.includes("Superseded Hidden Athlete"),
    "6 failed: superseded duplicate should not appear in /tp_attention message."
  );

  assert(
    !planConstraints.items.some((item) => item.studentId === "strength-hidden"),
    "7 failed: hidden external strength context should not appear in plan constraints."
  );
  assert(
    !attentionMessage.includes("Strength Context Hidden Athlete") &&
      !attentionMessage.includes("силовые: hidden context"),
    "7 failed: hidden external strength context must not leak into /tp_attention."
  );
  assert(
    planConstraints.items.some((item) => item.studentId === "visible-plan"),
    "7 failed: visible plan constraint control fixture should remain visible."
  );

  const hiddenOnlyOverflow = collectOperationalHealthFollowUpsFromSignals({
    signals: [
      makeSignal({
        signalId: "resolved-overflow",
        studentId: "resolved-hidden",
        signalType: "health_issue_started",
        lifecycleState: "resolved",
        metadata: pendingFollowUpMetadata("resolved overflow hidden"),
      }),
      makeSignal({
        signalId: "superseded-overflow",
        studentId: "superseded-hidden",
        signalType: "health_issue_started",
        metadata: {
          ...pendingFollowUpMetadata("superseded overflow hidden"),
          superseded_by_signal_id: "resolved-overflow",
        },
      }),
    ],
    activeStudentNameById: studentNames,
    asOfDate: AS_OF_DATE,
    maxItems: 2,
  });
  assert(
    hiddenOnlyOverflow.items.length === 0 && hiddenOnlyOverflow.overflowCount === 0,
    "8 failed: resolved/superseded hidden rows must not inflate follow-up overflow."
  );

  const monitoringWithoutFollowUp = collectOperationalHealthFollowUpsFromSignals({
    signals: [
      makeSignal({
        signalId: "monitoring-no-follow-up",
        studentId: "monitoring",
        signalType: "health_issue_started",
        lifecycleState: "monitoring_after_return",
        structuredPayload: {
          latest_summary: "вернулся после паузы, бег лёгкий",
        },
      }),
    ],
    activeStudentNameById: studentNames,
    asOfDate: AS_OF_DATE,
    maxItems: 5,
  });
  assert(
    monitoringWithoutFollowUp.items.length === 0,
    "9 failed: monitoring_after_return without due follow-up should stay out of /tp_attention follow-ups."
  );

  const pautovRecovery = followUps.items.find((item) => item.studentId === "pautov-like");
  assert(Boolean(pautovRecovery), "10 failed: return_planned recovery follow-up should appear when due today.");
  assert(
    pautovRecovery?.reason.includes("после болезни: в строю, возврат к тренировкам"),
    "10 failed: return_planned recovery follow-up should use refreshed display summary."
  );
  assert(
    !pautovRecovery?.reason.includes("болеет, горло"),
    "10 failed: return_planned recovery follow-up must not keep stale acute wording."
  );

  const titskaiaRecovery = followUps.items.find((item) => item.studentId === "titskaia-like");
  assert(Boolean(titskaiaRecovery), "11 failed: return_planned refreshed follow-up should appear when due today.");
  assert(
    titskaiaRecovery?.reason.includes("после болезни: лучше, завтра пробежка"),
    "11 failed: return_planned refreshed follow-up should use refreshed display summary."
  );
  assert(
    !titskaiaRecovery?.reason.includes("болеет; пауза") && !titskaiaRecovery?.reason.includes("простыла"),
    "11 failed: return_planned refreshed follow-up must not keep stale pause wording."
  );

  const kasianenkoRecovery = followUps.items.find((item) => item.studentId === "kasianenko-like");
  assert(Boolean(kasianenkoRecovery), "12 failed: monitoring recovery follow-up should appear when due today.");
  assert(
    kasianenkoRecovery?.reason.includes("после болезни: лучше, завтра пробный бег"),
    "12 failed: monitoring recovery follow-up should use refreshed display summary."
  );
  assert(
    !kasianenkoRecovery?.reason.includes("болеет, горло") &&
      !kasianenkoRecovery?.reason.includes("не бегает 5 дней"),
    "12 failed: monitoring recovery follow-up must not keep stale acute wording."
  );
  assert(
    (kasianenkoRecovery?.reason.match(/наблюдать/gu) ?? []).length <= 1,
    "12 failed: monitoring recovery follow-up must not duplicate наблюдать."
  );

  console.log(`${LOG_PREFIX} PASS`);
}

try {
  run();
} catch (error) {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error((error as Error).message);
  process.exit(1);
}
