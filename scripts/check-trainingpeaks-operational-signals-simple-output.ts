import process from "node:process";

import {
  classifyCoachOperationalSignal,
  classifyCoachOperationalSignals,
} from "@/features/trainingpeaks/coach-operational-signals";
import {
  buildTrainingPeaksOperationalSignalsSnapshotFromSignals,
  formatTrainingPeaksOperationalSignalsForTelegram,
} from "@/features/trainingpeaks/service";
import type { TrainingPeaksStudentOperationalSignal } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[check-trainingpeaks-operational-signals-simple-output]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function makeObservation(textPreview: string) {
  return {
    sourceType: "business_dm" as const,
    textPreview,
    labels: ["pain_or_health"],
    metadata: {},
    observedAt: "2026-06-03T10:00:00.000Z",
    studentId: "student-fixture",
  };
}

function makeSignal(input: {
  signalId: string;
  studentId: string;
  signalType: string;
  structuredPayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  validFrom?: string | null;
  validUntil?: string | null;
  sourceDate?: string | null;
  targetDate?: string | null;
  lifecycleState?: TrainingPeaksStudentOperationalSignal["lifecycleState"];
  requiresCoachClose?: boolean;
  lifecycleMeta?: Record<string, unknown>;
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
    sourceDate: input.sourceDate ?? null,
    targetDate: input.targetDate ?? null,
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

function run(): void {
  const anna = classifyCoachOperationalSignal(
    makeObservation("Нет, заболела. Температура с понедельника. Лечусь.")
  );
  assert(anna.signal_type === "health_issue_started", "1 failed: Anna should be health_issue_started.");
  assert(
    !String(anna.structured_payload.latest_summary ?? "").includes("самочувствие улучшается"),
    "1 failed: Anna should not be marked as improving by weak cues."
  );

  const elena = classifyCoachOperationalSignal(
    makeObservation("Еще плюс минус болею, уже более менее. Думаю пару дней отлежусь.")
  );
  assert(elena.signal_type === "health_issue_improving", "2 failed: Elena should be improving.");
  assert(
    String(elena.structured_payload.latest_summary ?? "").includes("планирует отлежаться пару дней"),
    "2 failed: Elena rest plan must be preserved."
  );

  const viktoria = classifyCoachOperationalSignal(
    makeObservation("Сегодня получше. Кашель еще есть, голос вернулся. Если завтра кашля не будет, хочу вечером пробежку.")
  );
  assert(viktoria.signal_type === "health_issue_improving", "3 failed: Viktoria should be improving.");
  assert(
    String(viktoria.structured_payload.latest_summary ?? "").includes("кашель ещё есть"),
    "3 failed: Viktoria health summary should keep cough context."
  );
  const viktoriaPlanCandidates = classifyCoachOperationalSignals(
    makeObservation("Если завтра кашля не будет, хочу вечером выйти на пробежку")
  );
  assert(
    viktoriaPlanCandidates.some(
      (candidate) =>
        candidate.signal_type === "plan_generation_constraint" &&
        String(candidate.structured_payload.latest_summary ?? "").includes("лёгкая пробежка вечером")
    ),
    "3 failed: Viktoria conditional run should produce planning constraint candidate."
  );

  const alex = classifyCoachOperationalSignal(
    makeObservation("Болит горло, бегать не смогу пять дней точно")
  );
  assert(
    alex.signal_type === "health_issue_started",
    "4 failed: Aleksandra illness should remain health_issue_started."
  );
  assert(alex.structured_payload.duration_days === 5, "4 failed: Aleksandra pause_days should be 5.");
  assert(alex.structured_payload.valid_from === "2026-06-03", "4 failed: Aleksandra valid_from should be observed date.");
  assert(alex.structured_payload.valid_until === "2026-06-08", "4 failed: Aleksandra valid_until should be +5 days.");

  const snapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    asOfDate: "2026-06-03",
    limit: 20,
    studentNameById: new Map<string, string | null>([
      ["anna", "Anna Lobodina"],
      ["viktoria", "Viktoria Sergeeva"],
      ["ilya", "Ilya Bogdanov"],
      ["alex", "Aleksandra Kasianenko"],
      ["elena", "Elena Vasileva"],
      ["lyubov", "Lyubov Selezneva"],
      ["olga", "Olga Slastnaia"],
      ["stepan", "Stepan Trofimov"],
    ]),
    signals: [
      makeSignal({
        signalId: "anna-started",
        studentId: "anna",
        signalType: "health_issue_started",
        structuredPayload: {
          latest_summary: "health_context: сил нет, голова болит; пауза / наблюдать",
          health_state: "sick",
          symptoms: ["fatigue", "headache"],
        },
        metadata: {
          follow_up_status: "pending",
          follow_up_due_at: "2026-06-05T10:00:00.000Z",
          follow_up_reason: "illness onset follow-up",
        },
      }),
      makeSignal({
        signalId: "lyubov-improving",
        studentId: "lyubov",
        signalType: "health_issue_improving",
        structuredPayload: {
          latest_summary: "вчера была температура, сегодня лучше, но слабость",
          health_state: "improving",
          symptoms: ["fever", "weakness"],
        },
        metadata: {
          follow_up_status: "pending",
          follow_up_due_at: "2026-06-06T09:00:00.000Z",
          follow_up_reason: "illness-related pause follow-up",
        },
      }),
      makeSignal({
        signalId: "v-improving-rich",
        studentId: "viktoria",
        signalType: "health_issue_improving",
        structuredPayload: {
          latest_summary: "восстанавливается, кашель ещё есть",
          health_state: "improving",
        },
      }),
      makeSignal({
        signalId: "v-improving-vague",
        studentId: "viktoria",
        signalType: "health_issue_improving",
        structuredPayload: {
          latest_summary: "восстановление",
          health_state: "improving",
        },
      }),
      makeSignal({
        signalId: "v-plan",
        studentId: "viktoria",
        signalType: "plan_generation_constraint",
        structuredPayload: {
          latest_summary: "04.06: если кашля не будет — лёгкая пробежка вечером",
          resolved_available_dates: ["2026-06-04"],
        },
        validFrom: "2026-06-04",
        validUntil: "2026-06-04",
      }),
      makeSignal({
        signalId: "ilya-pause",
        studentId: "ilya",
        signalType: "pause_training",
        validFrom: "2026-06-03",
        validUntil: "2026-06-03",
      }),
      makeSignal({
        signalId: "alex-sick",
        studentId: "alex",
        signalType: "health_issue_started",
        structuredPayload: {
          latest_summary: "health_context: болеет, горло; не бегает 5 дней; пауза / наблюдать",
          health_state: "sick",
        },
        validFrom: "2026-06-03",
        validUntil: "2026-06-08",
      }),
      makeSignal({
        signalId: "alex-unavailable",
        studentId: "alex",
        signalType: "schedule_unavailability_window",
        validFrom: "2026-06-03",
        validUntil: "2026-06-08",
        structuredPayload: {
          duration_days: 5,
        },
      }),
      makeSignal({
        signalId: "alex-resolved-vague",
        studentId: "alex",
        signalType: "health_issue_resolved",
        validUntil: "2026-06-04",
        structuredPayload: {
          latest_summary: "самочувствие (до 04.06)",
          health_state: "resolved",
        },
      }),
      makeSignal({
        signalId: "elena-improving",
        studentId: "elena",
        signalType: "health_issue_improving",
        structuredPayload: {
          latest_summary: "самочувствие улучшается; планирует отлежаться пару дней",
          health_state: "improving",
        },
      }),
      makeSignal({
        signalId: "olga-plan",
        studentId: "olga",
        signalType: "plan_generation_constraint",
        structuredPayload: {
          unavailable_dates: ["2026-06-04"],
          planned_training_dates: ["2026-06-05", "2026-06-07"],
          resolved_available_dates: ["2026-06-05", "2026-06-07"],
          planning_status: "athlete_intends_to_train",
        },
        validFrom: "2026-06-04",
        validUntil: "2026-06-04",
      }),
      makeSignal({
        signalId: "naida-strength-context-hidden",
        studentId: "naida",
        signalType: "plan_generation_constraint",
        structuredPayload: {
          signal_type: "external_training_context",
          visible_in_tp_signals: false,
          activity_domain: "strength",
          planning_effect: "strength_schedule_context",
          planned_training_dates: [],
          display_summary: "силовые: вт/чт",
        },
      }),
      makeSignal({
        signalId: "stepan-legacy-health-row-v2-pain",
        studentId: "stepan",
        signalType: "health_issue_started",
        structuredPayload: {
          signal_type: "pain_injury",
          activity_domain: "injury",
          planning_effect: "safety_review",
          requires_coach_review: true,
          display_summary: "боль / надкостница (уточнить, актуально ли)",
        },
      }),
      makeSignal({
        signalId: "stepan-monitoring-display",
        studentId: "stepan",
        signalType: "health_issue_started",
        lifecycleState: "monitoring_after_return",
        structuredPayload: {
          signal_type: "pain_injury",
          activity_domain: "injury",
          latest_summary: "вернулся к бегу после боли",
        },
      }),
      makeSignal({
        signalId: "stepan-ready-close-display",
        studentId: "stepan",
        signalType: "health_issue_started",
        lifecycleState: "monitoring_after_return",
        requiresCoachClose: true,
        structuredPayload: {
          latest_summary: "без жалоб после возврата",
        },
      }),
      makeSignal({
        signalId: "viktoria-stale-display",
        studentId: "viktoria",
        signalType: "health_issue_started",
        metadata: {
          lifecycle_effective: "stale_needs_review",
        },
        structuredPayload: {
          latest_summary: "старый сигнал без обновлений",
        },
      }),
      makeSignal({
        signalId: "viktoria-superseded-duplicate",
        studentId: "viktoria",
        signalType: "health_issue_started",
        metadata: {
          superseded_by_signal_id: "v-improving-rich",
        },
        structuredPayload: {
          latest_summary: "дубликат эпизода",
        },
      }),
    ],
    activeMoveActions: [],
  });

  const text = formatTrainingPeaksOperationalSignalsForTelegram(snapshot);

  assert(!text.includes("🩺 Проверить"), "5 failed: follow-up section must be hidden.");
  assert(!text.includes("follow-up"), "5 failed: internal follow-up rows must not be shown.");
  assert(text.includes("🟡 Болезнь / самочувствие"), "5 failed: health section must be present.");
  assert(
    text.includes("Lyubov Selezneva") && text.includes("вчера была температура, сегодня лучше, но слабость"),
    "5 failed: Lyubov active illness context should stay visible in normal /tp_signals."
  );
  assert(
    text.includes("Anna Lobodina") &&
      (text.includes("сил нет") || text.includes("голова болит") || text.includes("плохое самочувствие")),
    "5 failed: ambiguous health wording should stay cautious and specific."
  );
  assert(!text.includes("health_context:"), "5 failed: health_context prefix must be removed from normal output.");
  assert(!text.includes("пауза / наблюдать"), "5 failed: pause/observe label must be hidden in normal output.");
  assert(!text.includes("illness onset follow-up"), "5 failed: internal follow-up labels must be hidden.");
  assert(!text.includes("illness-related pause follow-up"), "5 failed: internal follow-up labels must be hidden.");
  assert(!text.includes("Anna Lobodina\n  болеет"), "5 failed: ambiguous symptom-only case must not overclaim 'болеет'.");
  assert(text.includes("📅 Учесть в плане"), "5 failed: plan section must be present.");
  assert(text.includes("🦵 Травмы / боль / дискомфорт"), "5 failed: pain/injury section must be present.");
  // Moves section remains part of normal layout, but appears only with active move actions.

  const viktoriaRows = text.split("\n").filter((line) => line.includes("Viktoria Sergeeva"));
  assert(viktoriaRows.length <= 2, "6 failed: Viktoria should appear at most once per relevant section.");
  assert(
    text.includes("восстанавливается, кашель ещё есть"),
    "6 failed: Viktoria useful health text should remain."
  );
  assert(!text.includes("восстановление"), "6 failed: generic Viktoria recovery duplicate should be hidden.");
  assert(
    text.includes("доступна: 04.06") || text.includes("04.06: если кашля не будет — лёгкая пробежка вечером"),
    "7 failed: Viktoria conditional run should be shown in planning."
  );

  assert(text.includes("пауза: 03.06"), "8 failed: one-day pause should be single-date.");
  assert(!text.includes("03.06—03.06"), "8 failed: one-day pause must not use range.");
  assert(text.includes("недоступна: 03.06—08.06"), "9 failed: multi-day pause should be shown as range.");
  assert(!text.includes("самочувствие (до 04.06)"), "10 failed: vague resolved health leftovers must be hidden.");
  assert(text.includes("болеет"), "11 failed: useful health content 'болеет' must stay visible.");
  assert(text.includes("кашель"), "11 failed: useful health content 'кашель' must stay visible.");
  assert(text.includes("горло"), "11 failed: useful health content 'горло' must stay visible.");
  assert(text.includes("температура"), "11 failed: useful health content 'температура' must stay visible.");
  assert(text.includes("слабость"), "11 failed: useful health content 'слабость' must stay visible.");
  assert(text.includes("не бегает 5 дней"), "11 failed: useful health duration details must stay visible.");
  assert(text.includes("Olga Slastnaia"), "12 failed: Olga fixture must be present.");
  assert(text.includes("недоступна: 04.06"), "12 failed: Olga unavailability must be shown.");
  assert(text.includes("планирует: 05.06"), "12 failed: Olga planned dates should use 'планирует'.");
  assert(text.includes("07.06"), "12 failed: Olga planned Sunday date must be shown.");
  assert(!text.includes("Naida"), "13 failed: external strength context must stay hidden in /tp_signals.");
  assert(!text.includes("силовые: вт/чт"), "13 failed: hidden strength context leaked into /tp_signals.");
  assert(
    text.includes("после паузы:") && text.includes("вернулся к бегу после боли"),
    "13 failed: monitoring_after_return should use calm monitoring wording."
  );
  assert(
    text.includes("можно закрыть после проверки"),
    "13 failed: monitoring_after_return + requiresCoachClose should show coach-close wording."
  );
  assert(!text.includes("дубликат эпизода"), "13 failed: superseded duplicate should be hidden in projection.");
  assert(!text.includes("Stepan Trofimov\n  болеет"), "13 failed: Stepan pain/injury must not be shown as illness.");
  assert(
    text.includes("Stepan Trofimov") && text.includes("боль / надкостница (уточнить, актуально ли)"),
    "13 failed: Stepan pain/injury summary should be shown."
  );
  const painSection = text.split("🦵 Травмы / боль / дискомфорт")[1]?.split("📅 Учесть в плане")[0] ?? "";
  assert(painSection.includes("Stepan Trofimov"), "13 failed: Stepan should be grouped under pain/injury section.");

  const lifecycleDisplayFixtureSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    asOfDate: "2026-06-05",
    limit: 10,
    studentNameById: new Map<string, string | null>([
      ["active-illness", "Active Illness Athlete"],
      ["monitoring", "Monitoring Athlete"],
      ["ready-close", "Ready Close Athlete"],
      ["stale", "Stale Athlete"],
      ["resolved-hidden", "Resolved Hidden Athlete"],
      ["superseded-hidden", "Superseded Hidden Athlete"],
      ["strength-hidden", "Strength Context Hidden Athlete"],
    ]),
    signals: [
      makeSignal({
        signalId: "active-illness-row",
        studentId: "active-illness",
        signalType: "health_issue_started",
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
        structuredPayload: {
          latest_summary: "resolved should be hidden",
        },
      }),
      makeSignal({
        signalId: "superseded-hidden-row",
        studentId: "superseded-hidden",
        signalType: "health_issue_started",
        metadata: {
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
        structuredPayload: {
          signal_type: "external_training_context",
          activity_domain: "strength",
          visible_in_tp_signals: false,
          display_summary: "силовые: hidden context",
        },
      }),
    ],
    activeMoveActions: [],
  });
  const lifecycleDisplayFixtureText = formatTrainingPeaksOperationalSignalsForTelegram(
    lifecycleDisplayFixtureSnapshot
  );
  assert(
    lifecycleDisplayFixtureText.includes("🟡 Болезнь / самочувствие"),
    "13f failed: lifecycle fixture should render illness section."
  );
  assert(
    lifecycleDisplayFixtureText.includes("🦵 Травмы / боль / дискомфорт"),
    "13f failed: lifecycle fixture should render pain/injury section."
  );
  assert(
    lifecycleDisplayFixtureText.includes("Active Illness Athlete") && lifecycleDisplayFixtureText.includes("болеет"),
    "13f failed: active illness fixture row should be visible with direct wording."
  );
  assert(
    lifecycleDisplayFixtureText.includes("Monitoring Athlete") &&
      lifecycleDisplayFixtureText.includes("после паузы:") &&
      lifecycleDisplayFixtureText.includes("наблюдать"),
    "13f failed: monitoring_after_return fixture should use calm monitoring wording."
  );
  assert(
    lifecycleDisplayFixtureText.includes("Ready Close Athlete") &&
      lifecycleDisplayFixtureText.includes("можно закрыть после проверки"),
    "13f failed: monitoring_after_return + requiresCoachClose fixture should use coach-close wording."
  );
  assert(
    lifecycleDisplayFixtureText.includes("Stale Athlete") &&
      lifecycleDisplayFixtureText.includes("давно нет новых данных, проверить вручную"),
    "13f failed: stale_needs_review fixture should use stale-review wording."
  );
  assert(
    !lifecycleDisplayFixtureText.includes("Resolved Hidden Athlete"),
    "13f failed: resolved lifecycle fixture row should be hidden."
  );
  assert(
    !lifecycleDisplayFixtureText.includes("Superseded Hidden Athlete"),
    "13f failed: superseded fixture row should be hidden."
  );
  assert(
    !lifecycleDisplayFixtureText.includes("Strength Context Hidden Athlete") &&
      !lifecycleDisplayFixtureText.includes("силовые: hidden context"),
    "13f failed: external strength context fixture row should stay hidden."
  );
  assert(
    lifecycleDisplayFixtureSnapshot.overflowCount === 0 &&
      !lifecycleDisplayFixtureText.includes("ещё сигналов"),
    "13f failed: resolved/superseded/hidden rows must not inflate overflow."
  );
  assert(
    lifecycleDisplayFixtureText.includes("Stale Athlete\n  давно нет новых данных, проверить вручную"),
    "13f failed: stale fixture full block changed unexpectedly."
  );

  const recoveryDisplayFixtureSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    asOfDate: "2026-06-07",
    limit: 10,
    studentNameById: new Map<string, string | null>([
      ["pautov-like", "Pautov Recovery Athlete"],
      ["titskaia-like", "Titskaia Recovery Athlete"],
      ["kasianenko-like", "Kasianenko Recovery Athlete"],
    ]),
    signals: [
      makeSignal({
        signalId: "pautov-recovery-row",
        studentId: "pautov-like",
        signalType: "health_issue_started",
        lifecycleState: "return_planned",
        metadata: {
          follow_up_status: "pending",
          follow_up_due_at: "2026-06-07T09:00:00.000+02:00",
          follow_up_reason: "болеет, горло",
        },
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
        metadata: {
          follow_up_status: "pending",
          follow_up_due_at: "2026-06-07T09:00:00.000+02:00",
          follow_up_reason: "болеет; пауза",
        },
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
        metadata: {
          follow_up_status: "pending",
          follow_up_due_at: "2026-06-07T09:00:00.000+02:00",
          follow_up_reason: "болеет, горло; не бегает 5 дней",
        },
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
    ],
    activeMoveActions: [],
  });
  const recoveryDisplayFixtureText = formatTrainingPeaksOperationalSignalsForTelegram(recoveryDisplayFixtureSnapshot);
  assert(
    recoveryDisplayFixtureText.includes("Pautov Recovery Athlete") &&
      recoveryDisplayFixtureText.includes("после болезни: в строю, возврат к тренировкам"),
    "13g failed: return_planned recovery row should use refreshed display summary."
  );
  assert(
    !recoveryDisplayFixtureText.includes("болеет, горло"),
    "13g failed: return_planned recovery row must not keep stale acute wording."
  );
  assert(
    recoveryDisplayFixtureText.includes("Titskaia Recovery Athlete") &&
      recoveryDisplayFixtureText.includes("после болезни: лучше, завтра пробежка"),
    "13h failed: return_planned refreshed row should use recovery display summary."
  );
  assert(
    recoveryDisplayFixtureText.includes("Kasianenko Recovery Athlete") &&
      recoveryDisplayFixtureText.includes("после болезни: лучше, завтра пробный бег"),
    "13i failed: monitoring recovery row should use refreshed display summary."
  );
  assert(
    !recoveryDisplayFixtureText.includes("болеет, горло; не бегает 5 дней"),
    "13i failed: monitoring recovery row must not keep stale acute wording."
  );
  assert(
    (recoveryDisplayFixtureText.match(/наблюдать/gu) ?? []).length <= 3,
    "13i failed: recovery rows must not duplicate наблюдать."
  );
  assert(
    !recoveryDisplayFixtureText.includes("после паузы: после болезни:"),
    "13i failed: monitoring recovery row must not double-prefix recovery summary."
  );

  const episodeRoleFixtureSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    asOfDate: "2026-06-05",
    limit: 10,
    studentNameById: new Map<string, string | null>([["viktoria", "Viktoria Sergeeva"]]),
    signals: [
      makeSignal({
        signalId: "viktoria-episode-role-health-context",
        studentId: "viktoria",
        signalType: "health_issue_started",
        structuredPayload: {
          display_summary: "болеет, кашель, голос",
          health_state: "sick",
          symptoms: ["cough", "voice"],
        },
        metadata: {
          episode_role: "health_context",
        },
      }),
    ],
    activeMoveActions: [],
  });
  const episodeRoleFixtureText = formatTrainingPeaksOperationalSignalsForTelegram(episodeRoleFixtureSnapshot);
  assert(
    episodeRoleFixtureText.includes("Viktoria Sergeeva") && episodeRoleFixtureText.includes("болеет, кашель, голос"),
    "13b failed: Viktoria illness summary should stay visible."
  );
  assert(!episodeRoleFixtureText.includes("health_context:"), "13b failed: internal episode_role health_context prefix must not leak.");

  const stepanInjuryDomainSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    asOfDate: "2026-06-05",
    limit: 10,
    studentNameById: new Map<string, string | null>([["stepan", "Stepan Trofimov"]]),
    signals: [
      makeSignal({
        signalId: "stepan-legacy-injury-domain-only",
        studentId: "stepan",
        signalType: "health_issue_started",
        structuredPayload: {
          activity_domain: "injury",
          planning_effect: "safety_review",
          requires_coach_review: true,
          display_summary: "боль / надкостница (уточнить, актуально ли)",
        },
      }),
    ],
    activeMoveActions: [],
  });
  const stepanInjuryDomainText = formatTrainingPeaksOperationalSignalsForTelegram(stepanInjuryDomainSnapshot);
  assert(
    stepanInjuryDomainText.includes("🦵 Травмы / боль / дискомфорт"),
    "13e failed: injury-domain legacy row must use pain section."
  );
  assert(
    stepanInjuryDomainText.includes("Stepan Trofimov") &&
      stepanInjuryDomainText.includes("боль / надкостница (уточнить, актуально ли)"),
    "13e failed: injury-domain legacy row must preserve pain summary."
  );
  assert(
    !stepanInjuryDomainText.includes("🟡 Болезнь / самочувствие"),
    "13e failed: injury-domain legacy row must not use illness section."
  );

  const healthContextFixtureSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    asOfDate: "2026-06-05",
    limit: 10,
    studentNameById: new Map<string, string | null>([["viktoria", "Viktoria Sergeeva"]]),
    signals: [
      makeSignal({
        signalId: "viktoria-display-summary-prefix",
        studentId: "viktoria",
        signalType: "health_issue_started",
        structuredPayload: {
          display_summary: "health_context: болеет, кашель, голос",
          health_state: "sick",
        },
      }),
    ],
    activeMoveActions: [],
  });
  const healthContextFixtureText = formatTrainingPeaksOperationalSignalsForTelegram(healthContextFixtureSnapshot);
  assert(
    healthContextFixtureText.includes("болеет, кашель, голос"),
    "13d failed: health_context display_summary prefix must be stripped."
  );
  assert(!healthContextFixtureText.includes("health_context:"), "13d failed: health_context prefix must not leak.");

  const expiredScheduleSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    asOfDate: "2026-06-05",
    limit: 20,
    studentNameById: new Map<string, string | null>([
      ["olga", "Olga Slastnaia"],
      ["anna", "Anna Lobodina"],
      ["alex", "Aleksandra Kasianenko"],
      ["viktoria", "Viktoria Sergeeva"],
      ["future", "Future Schedule Athlete"],
      ["same-day", "Same Day Schedule Athlete"],
      ["pain", "Pain Athlete"],
    ]),
    signals: [
      makeSignal({
        signalId: "olga-expired-unavailable",
        studentId: "olga",
        signalType: "schedule_unavailability_window",
        validFrom: "2026-06-04",
        validUntil: "2026-06-04",
        structuredPayload: {
          unavailable_dates: ["2026-06-04"],
        },
      }),
      makeSignal({
        signalId: "future-schedule",
        studentId: "future",
        signalType: "schedule_unavailability_window",
        validFrom: "2026-06-06",
        validUntil: "2026-06-06",
      }),
      makeSignal({
        signalId: "same-day-schedule",
        studentId: "same-day",
        signalType: "plan_generation_constraint",
        validFrom: "2026-06-05",
        validUntil: "2026-06-05",
        structuredPayload: {
          unavailable_dates: ["2026-06-05"],
        },
      }),
      makeSignal({
        signalId: "anna-old-health",
        studentId: "anna",
        signalType: "health_issue_started",
        validFrom: "2026-05-28",
        validUntil: "2026-05-30",
        structuredPayload: {
          latest_summary: "температура, слабость",
          health_state: "sick",
        },
      }),
      makeSignal({
        signalId: "pain-old",
        studentId: "pain",
        signalType: "health_issue_started",
        validFrom: "2026-05-20",
        validUntil: "2026-05-22",
        structuredPayload: {
          signal_type: "pain_injury",
          latest_summary: "боль в голени",
        },
      }),
      makeSignal({
        signalId: "viktoria-same-day-plan",
        studentId: "viktoria",
        signalType: "plan_generation_constraint",
        validFrom: "2026-06-05",
        validUntil: "2026-06-05",
        structuredPayload: {
          resolved_available_dates: ["2026-06-05"],
        },
      }),
    ],
    activeMoveActions: [],
  });
  const expiredScheduleText = formatTrainingPeaksOperationalSignalsForTelegram(expiredScheduleSnapshot);

  assert(!expiredScheduleText.includes("Olga Slastnaia"), "14 failed: expired Olga schedule must be hidden.");
  assert(!expiredScheduleText.includes("недоступна: 04.06"), "14 failed: expired Olga unavailability must be hidden.");
  assert(expiredScheduleText.includes("Future Schedule Athlete"), "15 failed: future schedule must stay visible.");
  assert(expiredScheduleText.includes("Same Day Schedule Athlete"), "16 failed: same-day schedule must stay visible.");
  assert(expiredScheduleText.includes("Anna Lobodina"), "17 failed: old health signal must not be hidden by date guard.");
  assert(expiredScheduleText.includes("Pain Athlete"), "18 failed: old pain/injury signal must not be hidden by date guard.");

  const overflowSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    asOfDate: "2026-06-05",
    limit: 2,
    studentNameById: new Map<string, string | null>([
      ["visible-1", "Visible One"],
      ["visible-2", "Visible Two"],
      ["expired-1", "Expired One"],
      ["expired-2", "Expired Two"],
    ]),
    signals: [
      makeSignal({
        signalId: "visible-1",
        studentId: "visible-1",
        signalType: "plan_generation_constraint",
        validUntil: "2026-06-06",
      }),
      makeSignal({
        signalId: "visible-2",
        studentId: "visible-2",
        signalType: "schedule_unavailability_window",
        validUntil: "2026-06-05",
      }),
      makeSignal({
        signalId: "expired-1",
        studentId: "expired-1",
        signalType: "schedule_unavailability_window",
        validUntil: "2026-06-04",
      }),
      makeSignal({
        signalId: "expired-2",
        studentId: "expired-2",
        signalType: "plan_generation_constraint",
        validUntil: "2026-06-03",
      }),
    ],
    activeMoveActions: [],
  });
  const overflowText = formatTrainingPeaksOperationalSignalsForTelegram(overflowSnapshot);
  assert(overflowSnapshot.overflowCount === 0, "19 failed: expired schedule signals must not count in overflow.");
  assert(!overflowText.includes("ещё сигналов"), "19 failed: expired schedule signals must not inflate +N count.");
  assert(!overflowText.includes("Expired One"), "19 failed: expired schedule athlete must be hidden.");
  assert(!overflowText.includes("Expired Two"), "19 failed: expired schedule athlete must be hidden.");

  const elizavetaExpiredPlannedSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    asOfDate: "2026-06-05",
    limit: 10,
    studentNameById: new Map<string, string | null>([["elizaveta", "Elizaveta Kolodkina"]]),
    signals: [
      makeSignal({
        signalId: "elizaveta-expired-planned",
        studentId: "elizaveta",
        signalType: "plan_generation_constraint",
        structuredPayload: {
          planned_training_dates: ["2026-06-04"],
          planning_effect: "planned_run",
          valid_until: "2026-06-07",
        },
      }),
    ],
    activeMoveActions: [],
  });
  const elizavetaExpiredPlannedText = formatTrainingPeaksOperationalSignalsForTelegram(elizavetaExpiredPlannedSnapshot);
  assert(!elizavetaExpiredPlannedText.includes("Elizaveta Kolodkina"), "20 failed: expired planned date must be hidden.");
  assert(!elizavetaExpiredPlannedText.includes("планирует: 04.06"), "20 failed: expired planned date text must be hidden.");
  assert(elizavetaExpiredPlannedSnapshot.overflowCount === 0, "20 failed: expired planned date must not count in overflow.");

  const stepanAmbiguousIllnessPrioritySnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    asOfDate: "2026-06-05",
    limit: 10,
    studentNameById: new Map<string, string | null>([["stepan", "Stepan Trofimov"]]),
    signals: [
      makeSignal({
        signalId: "stepan-pain-priority",
        studentId: "stepan",
        signalType: "health_issue_started",
        metadata: {
          episode_key: "stepan-episode-priority",
        },
        structuredPayload: {
          signal_type: "pain_injury",
          activity_domain: "injury",
          planning_effect: "safety_review",
          display_summary: "боль / надкостница (уточнить, актуально ли)",
          requires_coach_review: true,
        },
      }),
      makeSignal({
        signalId: "stepan-ambiguous-illness-priority",
        studentId: "stepan",
        signalType: "health_issue_started",
        metadata: {
          episode_key: "stepan-episode-priority",
        },
        structuredPayload: {
          display_summary: "может заболеваю",
          requires_coach_review: true,
        },
      }),
    ],
    activeMoveActions: [],
  });
  const stepanAmbiguousIllnessPriorityText = formatTrainingPeaksOperationalSignalsForTelegram(
    stepanAmbiguousIllnessPrioritySnapshot
  );
  assert(
    stepanAmbiguousIllnessPriorityText.includes("🦵 Травмы / боль / дискомфорт"),
    "20b failed: pain/injury section should be visible for Stepan mixed episode."
  );
  assert(
    stepanAmbiguousIllnessPriorityText.includes("Stepan Trofimov") &&
      stepanAmbiguousIllnessPriorityText.includes("боль / надкостница (уточнить, актуально ли)"),
    "20b failed: Stepan pain/injury should win over ambiguous illness in same episode."
  );
  assert(
    !stepanAmbiguousIllnessPriorityText.includes("Stepan Trofimov\n  болеет"),
    "20b failed: Stepan ambiguous illness must not overtake pain/injury."
  );

  const ambiguousIllnessSummarySnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    asOfDate: "2026-06-05",
    limit: 10,
    studentNameById: new Map<string, string | null>([["ambiguous", "Ambiguous Illness Athlete"]]),
    signals: [
      makeSignal({
        signalId: "ambiguous-illness-wording",
        studentId: "ambiguous",
        signalType: "health_issue_started",
        structuredPayload: {
          display_summary: "может заболеваю",
          requires_coach_review: true,
        },
      }),
    ],
    activeMoveActions: [],
  });
  const ambiguousIllnessSummaryText = formatTrainingPeaksOperationalSignalsForTelegram(ambiguousIllnessSummarySnapshot);
  assert(
    ambiguousIllnessSummaryText.includes("возможно заболевает"),
    "20c failed: ambiguous illness wording must stay non-assertive."
  );
  assert(
    !ambiguousIllnessSummaryText.includes("Ambiguous Illness Athlete\n  болеет"),
    "20c failed: ambiguous illness wording must not be assertive."
  );

  const sameDayPlannedSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    asOfDate: "2026-06-05",
    limit: 10,
    studentNameById: new Map<string, string | null>([["same-day-planned", "Same Day Planned Athlete"]]),
    signals: [
      makeSignal({
        signalId: "same-day-planned",
        studentId: "same-day-planned",
        signalType: "plan_generation_constraint",
        structuredPayload: {
          planned_training_dates: ["2026-06-05"],
          planning_effect: "planned_run",
        },
      }),
    ],
    activeMoveActions: [],
  });
  const sameDayPlannedText = formatTrainingPeaksOperationalSignalsForTelegram(sameDayPlannedSnapshot);
  assert(sameDayPlannedText.includes("Same Day Planned Athlete"), "21 failed: same-day planned date must stay visible.");
  assert(sameDayPlannedText.includes("планирует: 05.06"), "21 failed: same-day planned date text must stay visible.");

  const futurePlannedSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    asOfDate: "2026-06-05",
    limit: 10,
    studentNameById: new Map<string, string | null>([["future-planned", "Future Planned Athlete"]]),
    signals: [
      makeSignal({
        signalId: "future-planned",
        studentId: "future-planned",
        signalType: "plan_generation_constraint",
        structuredPayload: {
          planned_training_dates: ["2026-06-06"],
          planning_effect: "planned_run",
        },
      }),
    ],
    activeMoveActions: [],
  });
  const futurePlannedText = formatTrainingPeaksOperationalSignalsForTelegram(futurePlannedSnapshot);
  assert(futurePlannedText.includes("Future Planned Athlete"), "22 failed: future planned date must stay visible.");
  assert(futurePlannedText.includes("планирует: 06.06"), "22 failed: future planned date text must stay visible.");

  const defaultLimitSignals = Array.from({ length: 21 }, (_, index) =>
    makeSignal({
      signalId: `default-limit-${index + 1}`,
      studentId: `default-limit-student-${index + 1}`,
      signalType: "race_load_context",
      metadata: { summary: `race context ${index + 1}` },
    })
  );
  const defaultLimitSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    asOfDate: "2026-06-06",
    studentNameById: new Map(
      defaultLimitSignals.map((signal) => [signal.studentId, `Default Limit Athlete ${signal.signalId}`])
    ),
    signals: defaultLimitSignals,
    activeMoveActions: [],
  });
  const defaultLimitVisibleCount = defaultLimitSnapshot.sections.reduce(
    (count, section) => count + section.items.length,
    0
  );
  assert(defaultLimitVisibleCount === 20, "23 failed: default /tp_signals limit should show 20 items.");
  assert(defaultLimitSnapshot.overflowCount === 1, "23 failed: default /tp_signals overflow should count hidden rows only.");

  const nastyaRestrictionSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    asOfDate: "2026-06-06",
    limit: 10,
    studentNameById: new Map<string, string | null>([["nastya", "Nastya Holodnaya"]]),
    signals: [
      makeSignal({
        signalId: "nastya-headache-restriction",
        studentId: "nastya",
        signalType: "schedule_availability_window",
        validUntil: "2026-06-07",
        structuredPayload: {
          display_summary: "Голова просто раскалывается, не могу сегодня",
          valid_until: "2026-06-07",
        },
      }),
    ],
    activeMoveActions: [],
  });
  const nastyaRestrictionText = formatTrainingPeaksOperationalSignalsForTelegram(nastyaRestrictionSnapshot);
  assert(
    nastyaRestrictionText.includes("ограничение: головная боль (до 07.06)"),
    "24 failed: generic schedule restriction should preserve short reason."
  );

  const genericRestrictionNoReasonSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    asOfDate: "2026-06-06",
    limit: 10,
    studentNameById: new Map<string, string | null>([["no-reason", "No Reason Athlete"]]),
    signals: [
      makeSignal({
        signalId: "generic-restriction-no-reason",
        studentId: "no-reason",
        signalType: "schedule_availability_window",
        validUntil: "2026-06-07",
        structuredPayload: {
          valid_until: "2026-06-07",
        },
      }),
    ],
    activeMoveActions: [],
  });
  const genericRestrictionNoReasonText = formatTrainingPeaksOperationalSignalsForTelegram(
    genericRestrictionNoReasonSnapshot
  );
  assert(
    genericRestrictionNoReasonText.includes("ограничение (до 07.06)"),
    "24b failed: generic schedule restriction without reason should keep old wording."
  );
  assert(
    !genericRestrictionNoReasonText.includes("ограничение:"),
    "24b failed: generic schedule restriction without reason must not add empty reason label."
  );

  const stepanMonitoringCrossEpisodeSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    asOfDate: "2026-06-06",
    limit: 10,
    studentNameById: new Map<string, string | null>([["stepan", "Stepan Trofimov"]]),
    signals: [
      makeSignal({
        signalId: "stepan-pain-monitoring-cross-episode",
        studentId: "stepan",
        signalType: "health_issue_started",
        lifecycleState: "monitoring_after_return",
        requiresCoachClose: true,
        metadata: {
          episode_key: "stepan-pain-monitoring-episode",
          follow_up_status: "pending_due",
          follow_up_due_at: "2026-06-06T10:00:00.000+02:00",
        },
        structuredPayload: {
          signal_type: "pain_injury",
          activity_domain: "injury",
          planning_effect: "safety_review",
          display_summary: "боль / надкостница (уточнить, актуально ли)",
        },
      }),
      makeSignal({
        signalId: "stepan-ambiguous-illness-cross-episode",
        studentId: "stepan",
        signalType: "health_issue_started",
        metadata: {
          episode_key: "stepan-ambiguous-illness-episode",
        },
        structuredPayload: {
          display_summary: "может заболеваю",
          requires_coach_review: true,
        },
      }),
    ],
    activeMoveActions: [],
  });
  const stepanMonitoringCrossEpisodeText = formatTrainingPeaksOperationalSignalsForTelegram(
    stepanMonitoringCrossEpisodeSnapshot
  );
  assert(
    stepanMonitoringCrossEpisodeText.includes("🦵 Травмы / боль / дискомфорт"),
    "25 failed: pain/injury monitoring should surface in pain section."
  );
  assert(
    stepanMonitoringCrossEpisodeText.includes("можно закрыть после проверки: боль / надкостница (уточнить, актуально ли)"),
    "25 failed: pain/injury monitoring with requiresCoachClose should use coach-close wording."
  );
  assert(
    !stepanMonitoringCrossEpisodeText.includes("возможно заболевает"),
    "25 failed: ambiguous illness should be suppressed when concrete pain monitoring is visible."
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
