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
}): TrainingPeaksStudentOperationalSignal {
  return {
    id: input.signalId,
    studentId: input.studentId,
    signalType: input.signalType as TrainingPeaksStudentOperationalSignal["signalType"],
    status: "active",
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
        signalId: "naida-strength-context",
        studentId: "naida",
        signalType: "external_training_context",
        structuredPayload: {
          visible_in_tp_signals: false,
          activity_domain: "strength",
          planning_effect: "strength_schedule_context",
          display_summary: "силовые: пн/чт",
        },
      }),
    ],
    activeMoveActions: [],
  });

  const text = formatTrainingPeaksOperationalSignalsForTelegram(snapshot);

  assert(!text.includes("🩺 Проверить"), "5 failed: follow-up section must be hidden.");
  assert(!text.includes("follow-up"), "5 failed: internal follow-up rows must not be shown.");
  assert(text.includes("🟡 Болезнь / пауза"), "5 failed: health section must be present.");
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
  assert(!text.includes("силовые: пн/чт"), "13 failed: hidden strength context leaked into /tp_signals.");

  console.log(`${LOG_PREFIX} PASS`);
}

try {
  run();
} catch (error) {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error((error as Error).message);
  process.exit(1);
}
