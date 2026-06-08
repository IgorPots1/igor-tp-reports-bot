import process from "node:process";

import type {
  TrainingPeaksOperationalSignalType,
  UpsertTrainingPeaksOperationalSignalFromCandidateInput,
  UpsertTrainingPeaksOperationalSignalFromCandidateResult,
} from "@/features/trainingpeaks/repository";
import { persistOperationalSignalsForObservation } from "@/features/trainingpeaks/operational-signals-inline";

const LOG_PREFIX = "[check-trainingpeaks-operational-signals-inline]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type ConsumeInput = {
  studentId: string;
  signalTypes: TrainingPeaksOperationalSignalType[];
  excludeSignalId?: string | null;
  metadataPatch?: Record<string, unknown>;
};

function makeTestObservation(input: {
  observationId: string;
  studentId: string | null;
  sourceType?: string;
  textPreview: string;
  labels?: string[];
}): Parameters<typeof persistOperationalSignalsForObservation>[0] {
  return {
    observationId: input.observationId,
    studentId: input.studentId,
    sourceType: input.sourceType ?? "business_dm",
    textPreview: input.textPreview,
    labels: input.labels ?? ["pain_or_health"],
    metadata: {},
    observedAt: "2026-06-03T10:00:00.000Z",
    telegramChatId: "10001",
    telegramMessageId: "20001",
    telegramMessageThreadId: null,
  };
}

async function run(): Promise<void> {
  const upsertCalls: UpsertTrainingPeaksOperationalSignalFromCandidateInput[] = [];
  const consumeCalls: ConsumeInput[] = [];
  let nextSignalId = 1;

  const upsertMock = async (
    input: UpsertTrainingPeaksOperationalSignalFromCandidateInput
  ): Promise<UpsertTrainingPeaksOperationalSignalFromCandidateResult> => {
    upsertCalls.push(input);
    return {
      writeStatus: "inserted",
      signal: {
        id: `sig-${nextSignalId++}`,
        studentId: input.studentId,
        signalType: input.signalType,
        status: "active",
        sourceType: input.sourceType,
        sourceObservationId: input.sourceObservationId ?? null,
        telegramChatId: input.telegramChatId ?? null,
        telegramMessageId: input.telegramMessageId ?? null,
        telegramMessageThreadId: input.telegramMessageThreadId ?? null,
        structuredPayload: input.structuredPayload ?? {},
        confidence: input.confidence ?? null,
        validFrom: input.validFrom ?? null,
        validUntil: input.validUntil ?? null,
        sourceDate: input.sourceDate ?? null,
        targetDate: input.targetDate ?? null,
        sourceDay: input.sourceDay ?? null,
        targetDay: input.targetDay ?? null,
        linkedMemoryItemId: input.linkedMemoryItemId ?? null,
        linkedCaseId: input.linkedCaseId ?? null,
        linkedActionId: input.linkedActionId ?? null,
        dedupeKey: input.dedupeKey,
        consumedAt: null,
        metadata: input.metadata ?? {},
        createdAt: "2026-06-03T10:00:00.000Z",
        updatedAt: "2026-06-03T10:00:00.000Z",
      },
    };
  };

  const consumeMock = async (input: ConsumeInput): Promise<number> => {
    consumeCalls.push(input);
    return 1;
  };

  const deps = {
    upsert: upsertMock,
    consume: consumeMock,
  };

  const improvingResult = await persistOperationalSignalsForObservation(
    makeTestObservation({
      observationId: "obs-1",
      studentId: "student-v",
      textPreview: "Сегодня получше, но кашель всё ещё есть",
    }),
    deps
  );
  assert(improvingResult.status === "processed", "A failed: improving observation should be processed.");
  const improvingSignalCall = upsertCalls.find((call) => call.sourceObservationId === "obs-1");
  assert(Boolean(improvingSignalCall), "A failed: missing upsert call for improving observation.");
  assert(
    improvingSignalCall?.signalType === "health_issue_improving",
    `A failed: expected health_issue_improving, got ${improvingSignalCall?.signalType ?? "null"}.`
  );
  assert(
    (improvingSignalCall?.structuredPayload?.health_state as string | undefined) === "improving",
    "A failed: improving signal should persist health_state=improving."
  );
  assert(
    typeof improvingSignalCall?.structuredPayload?.latest_summary === "string" &&
      improvingSignalCall.structuredPayload.latest_summary.includes("кашель ещё есть"),
    "A failed: improving signal should persist useful health summary."
  );
  assert(
    improvingSignalCall?.metadata?.follow_up_reason === improvingSignalCall?.structuredPayload?.latest_summary,
    "A failed: improving signal should copy summary into follow_up_reason metadata."
  );
  assert(
    typeof improvingSignalCall?.validUntil === "string" && improvingSignalCall.validUntil.length > 0,
    "E failed: improving signal should have default valid_until."
  );
  const improvingConsumeCall = consumeCalls.find((call) => call.studentId === "student-v");
  assert(Boolean(improvingConsumeCall), "B failed: improving should supersede active started signal.");
  assert(
    improvingConsumeCall?.signalTypes.includes("health_issue_started") ?? false,
    "B failed: improving supersession must target health_issue_started."
  );

  const beforeResolveConsumeCalls = consumeCalls.length;
  const resolvedResult = await persistOperationalSignalsForObservation(
    makeTestObservation({
      observationId: "obs-2",
      studentId: "student-v",
      textPreview: "Кашель прошел, выздоровела, без боли",
    }),
    deps
  );
  assert(resolvedResult.status === "processed", "C failed: resolved observation should be processed.");
  const resolvedConsumeCall = consumeCalls[beforeResolveConsumeCalls];
  assert(Boolean(resolvedConsumeCall), "C failed: resolved should trigger health supersession.");
  assert(
    resolvedConsumeCall?.signalTypes.includes("health_issue_started") &&
      resolvedConsumeCall.signalTypes.includes("health_issue_improving"),
    "C failed: resolved supersession must target started+improving."
  );

  const moveResult = await persistOperationalSignalsForObservation(
    makeTestObservation({
      observationId: "obs-3",
      studentId: "student-m",
      textPreview: "Перенеси тренировку с вторника на четверг",
      labels: ["move_workout_candidate"],
    }),
    deps
  );
  assert(moveResult.status === "processed", "F failed: move observation should be processed.");
  const moveSignalCall = upsertCalls.find((call) => call.sourceObservationId === "obs-3");
  assert(Boolean(moveSignalCall), "F failed: missing move upsert call.");
  assert(
    moveSignalCall?.signalType === "move_workout_candidate",
    `F failed: expected move_workout_candidate, got ${moveSignalCall?.signalType ?? "null"}.`
  );
  assert(
    typeof moveSignalCall?.validUntil === "string" && moveSignalCall.validUntil.length > 0,
    "F failed: move signal should get default valid_until."
  );

  const feverResult = await persistOperationalSignalsForObservation(
    makeTestObservation({
      observationId: "obs-6",
      studentId: "student-fever",
      textPreview: "Нет, заболела. Температура с понедельника.",
    }),
    deps
  );
  assert(feverResult.status === "processed", "H failed: fever observation should be processed.");
  const feverSignalCall = upsertCalls.find((call) => call.sourceObservationId === "obs-6");
  assert(feverSignalCall?.signalType === "health_issue_started", "H failed: fever observation should create health_issue_started.");
  assert(
    feverSignalCall?.structuredPayload?.training_recommendation === "pause",
    "H failed: fever observation should persist pause recommendation."
  );

  const restObservationResult = await persistOperationalSignalsForObservation(
    makeTestObservation({
      observationId: "obs-7",
      studentId: "student-rest",
      textPreview: "Еще плюс-минус болею, но уже более менее. Думаю пару дней может отлежусь.",
    }),
    deps
  );
  assert(restObservationResult.status === "processed", "I failed: rest observation should be processed.");
  const restSignalCall = upsertCalls.find((call) => call.sourceObservationId === "obs-7");
  assert(
    restSignalCall?.signalType === "health_issue_improving",
    "I failed: rest observation should create health_issue_improving."
  );
  assert(
    typeof restSignalCall?.structuredPayload?.latest_summary === "string" &&
      restSignalCall.structuredPayload.latest_summary.includes("отлежаться пару дней"),
    "I failed: rest observation should preserve rest note in summary."
  );

  const noStudentResult = await persistOperationalSignalsForObservation(
    makeTestObservation({
      observationId: "obs-4",
      studentId: null,
      textPreview: "Сегодня получше, но кашель всё ещё есть",
    }),
    deps
  );
  assert(noStudentResult.status === "skipped", "D failed: missing student should skip processing.");

  const throwingDeps = {
    upsert: async (): Promise<UpsertTrainingPeaksOperationalSignalFromCandidateResult> => {
      throw new Error("synthetic-upsert-failure");
    },
    consume: consumeMock,
  };
  let didThrow = false;
  try {
    await persistOperationalSignalsForObservation(
      makeTestObservation({
        observationId: "obs-5",
        studentId: "student-fail",
        textPreview: "Сегодня получше, но кашель всё ещё есть",
      }),
      throwingDeps
    );
  } catch {
    didThrow = true;
  }
  assert(didThrow, "G failed: inline wrapper should allow caller-level catch on persistence failures.");

  const otherStudentTouches = consumeCalls.filter((call) => call.studentId === "student-other").length;
  assert(otherStudentTouches === 0, "D failed: no supersession should touch other students.");

  // Recovery / return-intent regression fixtures (real athlete phrases).
  const pautovResult = await persistOperationalSignalsForObservation(
    makeTestObservation({
      observationId: "obs-pautov",
      studentId: "student-pautov",
      textPreview: "Игорь, привет, с понедельника начинаем тренировки, я в строю",
    }),
    deps
  );
  assert(pautovResult.status === "processed", "Pautov failed: recovery message should not skip.");
  assert(pautovResult.considered > 0, "Pautov failed: expected at least one candidate.");
  const pautovSignalCall = upsertCalls.find((call) => call.sourceObservationId === "obs-pautov");
  assert(Boolean(pautovSignalCall), "Pautov failed: missing upsert call.");
  assert(
    pautovSignalCall?.signalType === "health_issue_resolved" ||
      pautovSignalCall?.signalType === "resume_training",
    `Pautov failed: expected health_issue_resolved or resume_training, got ${pautovSignalCall?.signalType ?? "null"}.`
  );
  assert(
    typeof pautovSignalCall?.structuredPayload?.latest_summary === "string" &&
      (pautovSignalCall.structuredPayload.latest_summary.includes("в строю") ||
        pautovSignalCall.structuredPayload.latest_summary.includes("возобновить") ||
        pautovSignalCall.structuredPayload.latest_summary.includes("возвращ")),
    "Pautov failed: summary should include recovery/return meaning."
  );

  const titskaiaResult = await persistOperationalSignalsForObservation(
    makeTestObservation({
      observationId: "obs-titskaia",
      studentId: "student-titskaia",
      textPreview: "Привет, вроде лучше намного, завтра побегу",
    }),
    deps
  );
  assert(titskaiaResult.status === "processed", "Titskaia failed: improving/return message should not skip.");
  const titskaiaSignalCall = upsertCalls.find((call) => call.sourceObservationId === "obs-titskaia");
  assert(Boolean(titskaiaSignalCall), "Titskaia failed: missing upsert call.");
  assert(
    titskaiaSignalCall?.signalType === "health_issue_improving",
    `Titskaia failed: expected health_issue_improving, got ${titskaiaSignalCall?.signalType ?? "null"}.`
  );
  assert(
    typeof titskaiaSignalCall?.structuredPayload?.latest_summary === "string" &&
      (titskaiaSignalCall.structuredPayload.latest_summary.includes("улучшается") ||
        titskaiaSignalCall.structuredPayload.latest_summary.includes("пробежку")),
    "Titskaia failed: summary should indicate improvement or planned return."
  );

  const seleznevaResult = await persistOperationalSignalsForObservation(
    makeTestObservation({
      observationId: "obs-selezneva",
      studentId: "student-selezneva",
      textPreview: "Привет, ну я вроде ок, чуть ещё закладывает нос, можно побегу",
    }),
    deps
  );
  assert(seleznevaResult.status === "processed", "Selezneva failed: improving/return request should not skip.");
  const seleznevaSignalCall = upsertCalls.find((call) => call.sourceObservationId === "obs-selezneva");
  assert(Boolean(seleznevaSignalCall), "Selezneva failed: missing upsert call.");
  assert(
    seleznevaSignalCall?.signalType === "health_issue_improving",
    `Selezneva failed: expected health_issue_improving, got ${seleznevaSignalCall?.signalType ?? "null"}.`
  );
  assert(
    seleznevaSignalCall?.signalType !== "health_issue_resolved",
    "Selezneva failed: partial recovery with return request should not be terminal resolved."
  );
  assert(
    typeof seleznevaSignalCall?.structuredPayload?.latest_summary === "string" &&
      (seleznevaSignalCall.structuredPayload.latest_summary.includes("насморк") ||
        seleznevaSignalCall.structuredPayload.latest_summary.includes("пробежку")),
    "Selezneva failed: summary should preserve residual symptom or return request."
  );

  const kasianenkoResult = await persistOperationalSignalsForObservation(
    makeTestObservation({
      observationId: "obs-kasianenko",
      studentId: "student-kasianenko",
      textPreview: "Привет, чувствую себя лучше, завтра попробую побегать",
    }),
    deps
  );
  assert(kasianenkoResult.status === "processed", "Kasianenko failed: improving/trial-run message should not skip.");
  const kasianenkoSignalCall = upsertCalls.find((call) => call.sourceObservationId === "obs-kasianenko");
  assert(Boolean(kasianenkoSignalCall), "Kasianenko failed: missing upsert call.");
  assert(
    kasianenkoSignalCall?.signalType === "health_issue_improving",
    `Kasianenko failed: expected health_issue_improving, got ${kasianenkoSignalCall?.signalType ?? "null"}.`
  );
  assert(
    typeof kasianenkoSignalCall?.structuredPayload?.latest_summary === "string" &&
      (kasianenkoSignalCall.structuredPayload.latest_summary.includes("улучшается") ||
        kasianenkoSignalCall.structuredPayload.latest_summary.includes("пробежку")),
    "Kasianenko failed: summary should indicate improvement or trial run."
  );

  // False-positive suppression: negated pain and figurative health idioms.
  const lavrentyevNegationResult = await persistOperationalSignalsForObservation(
    makeTestObservation({
      observationId: "obs-lavrentyev-negation",
      studentId: "student-lavrentyev",
      textPreview: "Все четко, нога не болела",
    }),
    deps
  );
  assert(
    lavrentyevNegationResult.status === "skipped",
    `Lavrentyev negation failed: expected skipped, got ${lavrentyevNegationResult.status}.`
  );
  assert(
    !upsertCalls.some((call) => call.sourceObservationId === "obs-lavrentyev-negation"),
    "Lavrentyev negation failed: should not create operational signal."
  );

  const nothingHurtResult = await persistOperationalSignalsForObservation(
    makeTestObservation({
      observationId: "obs-nothing-hurt",
      studentId: "student-nothing-hurt",
      textPreview: "ничего не болело",
    }),
    deps
  );
  assert(
    nothingHurtResult.status === "skipped",
    `Nothing hurt failed: expected skipped, got ${nothingHurtResult.status}.`
  );
  assert(
    !upsertCalls.some((call) => call.sourceObservationId === "obs-nothing-hurt"),
    "Nothing hurt failed: should not create operational signal."
  );

  const kruglovaIdiomResult = await persistOperationalSignalsForObservation(
    makeTestObservation({
      observationId: "obs-kruglova-idiom",
      studentId: "student-kruglova",
      textPreview: "мне так не хватает побегать побыстрее, прям душа болит",
    }),
    deps
  );
  assert(
    kruglovaIdiomResult.status === "skipped",
    `Kruglova idiom failed: expected skipped, got ${kruglovaIdiomResult.status}.`
  );
  assert(
    !upsertCalls.some((call) => call.sourceObservationId === "obs-kruglova-idiom"),
    "Kruglova idiom failed: should not create operational signal."
  );

  const denisovaIdiomResult = await persistOperationalSignalsForObservation(
    makeTestObservation({
      observationId: "obs-denisova-idiom",
      studentId: "student-denisova",
      textPreview: 'это была "минутка слабости"',
    }),
    deps
  );
  assert(
    denisovaIdiomResult.status === "skipped",
    `Denisova idiom failed: expected skipped, got ${denisovaIdiomResult.status}.`
  );
  assert(
    !upsertCalls.some((call) => call.sourceObservationId === "obs-denisova-idiom"),
    "Denisova idiom failed: should not create operational signal."
  );

  const throatPainPositiveResult = await persistOperationalSignalsForObservation(
    makeTestObservation({
      observationId: "obs-throat-pain-positive",
      studentId: "student-throat-pain-positive",
      textPreview: "болит горло, сил нет",
    }),
    deps
  );
  assert(throatPainPositiveResult.status === "processed", "Throat pain positive failed: should be processed.");
  const throatPainSignalCall = upsertCalls.find((call) => call.sourceObservationId === "obs-throat-pain-positive");
  assert(Boolean(throatPainSignalCall), "Throat pain positive failed: missing upsert call.");
  assert(
    throatPainSignalCall?.signalType === "health_issue_started",
    `Throat pain positive failed: expected health_issue_started, got ${throatPainSignalCall?.signalType ?? "null"}.`
  );

  const legPainPositiveResult = await persistOperationalSignalsForObservation(
    makeTestObservation({
      observationId: "obs-leg-pain-positive",
      studentId: "student-leg-pain-positive",
      textPreview: "нога болела после бега",
    }),
    deps
  );
  assert(legPainPositiveResult.status === "processed", "Leg pain positive failed: should be processed.");
  const legPainSignalCall = upsertCalls.find((call) => call.sourceObservationId === "obs-leg-pain-positive");
  assert(Boolean(legPainSignalCall), "Leg pain positive failed: missing upsert call.");
  assert(
    legPainSignalCall?.signalType === "health_issue_started" || legPainSignalCall?.signalType === "pain_injury",
    `Leg pain positive failed: expected health_issue_started or pain_injury, got ${legPainSignalCall?.signalType ?? "null"}.`
  );

  const weaknessFeverPositiveResult = await persistOperationalSignalsForObservation(
    makeTestObservation({
      observationId: "obs-weakness-fever-positive",
      studentId: "student-weakness-fever-positive",
      textPreview: "слабость, температура",
    }),
    deps
  );
  assert(weaknessFeverPositiveResult.status === "processed", "Weakness fever positive failed: should be processed.");
  const weaknessFeverSignalCall = upsertCalls.find((call) => call.sourceObservationId === "obs-weakness-fever-positive");
  assert(Boolean(weaknessFeverSignalCall), "Weakness fever positive failed: missing upsert call.");
  assert(
    weaknessFeverSignalCall?.signalType === "health_issue_started",
    `Weakness fever positive failed: expected health_issue_started, got ${weaknessFeverSignalCall?.signalType ?? "null"}.`
  );

  // TODO(coach-approval): coach reply "давай" after athlete "можно побегу" is not linked in this task.
  // TODO(viktoria-tp-evidence): TP-only return evidence (completed runs) needs lifecycle diagnostic, not phrase classifier.

  console.log(`${LOG_PREFIX} PASS`);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${LOG_PREFIX} FAIL`);
  console.error(message);
  process.exit(1);
});
