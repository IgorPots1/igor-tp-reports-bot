import process from "node:process";

import { buildMultiMessageObservationPlan } from "./lib/coach-operational-multi-message-episodes";

const LOG_PREFIX = "[check-operational-multi-message-episodes]";

type ObservationFixture = {
  id: string;
  student_id: string | null;
  source_type: string | null;
  chat_id: string | null;
  message_thread_id: number | null;
  text_preview: string | null;
  labels: unknown;
  metadata: unknown;
  observed_at: string | null;
  created_at: string;
};

function mkRow(input: {
  id: string;
  studentId: string;
  observedAt: string;
  text: string;
  chatId?: string;
  threadId?: number | null;
}): ObservationFixture {
  return {
    id: input.id,
    student_id: input.studentId,
    source_type: "business_dm",
    chat_id: input.chatId ?? "chat-1",
    message_thread_id: input.threadId ?? null,
    text_preview: input.text,
    labels: [],
    metadata: { senderRole: "known_student" },
    observed_at: input.observedAt,
    created_at: input.observedAt,
  };
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function getCandidatesCount(plan: Map<string, { additionalCandidates: Array<{ signal_type: string }> }>, id: string): number {
  return plan.get(id)?.additionalCandidates.length ?? 0;
}

function run(): void {
  const base = "2026-05-31T12:00:00.000Z";
  const plus30 = "2026-05-31T12:00:30.000Z";
  const plus60 = "2026-05-31T12:01:00.000Z";
  const plus90 = "2026-05-31T12:01:30.000Z";
  const plus240 = "2026-05-31T12:04:00.000Z";

  // A: 2-message Sofia pair
  const caseA = buildMultiMessageObservationPlan([
    mkRow({ id: "a1", studentId: "sofia", observedAt: base, text: "Вторник и четверг" }),
    mkRow({
      id: "a2",
      studentId: "sofia",
      observedAt: plus30,
      text: "Потом на 4 дня на винный фестиваль улетаю, точно бегать не смогу.",
    }),
  ]);
  assert(getCandidatesCount(caseA, "a1") > 0, "A: bare weekdays must be promoted inside safe episode.");
  assert(getCandidatesCount(caseA, "a2") > 0, "A: unavailability message should be in episode plan.");
  const a1Signals = caseA.get("a1")?.additionalCandidates.map((item) => item.signal_type) ?? [];
  const a2Signals = caseA.get("a2")?.additionalCandidates.map((item) => item.signal_type) ?? [];
  assert(
    a1Signals.includes("plan_generation_constraint") || a1Signals.includes("schedule_availability_window"),
    "A: promoted availability signal missing."
  );
  assert(a2Signals.includes("schedule_unavailability_window"), "A: unavailability signal missing.");
  const aEpisode = caseA.get("a1")?.scheduleEpisodeMeta?.episodeKey;
  assert(Boolean(aEpisode), "A: episode_key expected.");
  assert(aEpisode === caseA.get("a2")?.scheduleEpisodeMeta?.episodeKey, "A: episode_key should match.");

  // B: bare weekdays alone still skip
  const caseB = buildMultiMessageObservationPlan([mkRow({ id: "b1", studentId: "sofia", observedAt: base, text: "Вторник и четверг" })]);
  assert(getCandidatesCount(caseB, "b1") === 0, "B: bare weekdays alone must not be promoted.");

  // C: bare weekdays next to unrelated message still skip
  const caseC = buildMultiMessageObservationPlan([
    mkRow({ id: "c1", studentId: "sofia", observedAt: base, text: "Вторник и четверг" }),
    mkRow({ id: "c2", studentId: "sofia", observedAt: plus30, text: "Спасибо!" }),
  ]);
  assert(getCandidatesCount(caseC, "c1") === 0, "C: unrelated neighbor must block promotion.");

  // D: 3-message split unavailability
  const caseD = buildMultiMessageObservationPlan([
    mkRow({ id: "d1", studentId: "sofia", observedAt: base, text: "Вторник и четверг" }),
    mkRow({ id: "d2", studentId: "sofia", observedAt: plus30, text: "Потом на 4 дня улетаю" }),
    mkRow({ id: "d3", studentId: "sofia", observedAt: plus60, text: "точно бегать не смогу" }),
  ]);
  assert(getCandidatesCount(caseD, "d1") > 0, "D: availability should be promoted.");
  const d3Signals = caseD.get("d3")?.additionalCandidates.map((item) => item.signal_type) ?? [];
  assert(d3Signals.includes("schedule_unavailability_window"), "D: split unavailability should be inferred.");

  // E: 4-message split duration
  const caseE = buildMultiMessageObservationPlan([
    mkRow({ id: "e1", studentId: "sofia", observedAt: base, text: "На этой смогу во вторник и четверг" }),
    mkRow({ id: "e2", studentId: "sofia", observedAt: plus30, text: "Потом улетаю" }),
    mkRow({ id: "e3", studentId: "sofia", observedAt: plus60, text: "на 4 дня" }),
    mkRow({ id: "e4", studentId: "sofia", observedAt: plus90, text: "бегать точно не смогу" }),
  ]);
  assert(getCandidatesCount(caseE, "e1") > 0, "E: availability from explicit phrase should stay.");
  const e4Signals = caseE.get("e4")?.additionalCandidates.map((item) => item.signal_type) ?? [];
  assert(e4Signals.includes("schedule_unavailability_window"), "E: split duration unavailability should be inferred.");

  // F: 6-message chain capped
  const caseF = buildMultiMessageObservationPlan([
    mkRow({ id: "f1", studentId: "sofia", observedAt: base, text: "Вторник и четверг" }),
    mkRow({ id: "f2", studentId: "sofia", observedAt: plus30, text: "Потом улетаю" }),
    mkRow({ id: "f3", studentId: "sofia", observedAt: plus60, text: "на 4 дня" }),
    mkRow({ id: "f4", studentId: "sofia", observedAt: plus90, text: "бегать точно не смогу" }),
    mkRow({ id: "f5", studentId: "sofia", observedAt: "2026-05-31T12:02:00.000Z", text: "и еще в дороге" }),
    mkRow({ id: "f6", studentId: "sofia", observedAt: "2026-05-31T12:02:30.000Z", text: "спасибо" }),
  ]);
  assert(caseF.has("f1"), "F: chain should produce plan for first 5 messages.");
  assert(!caseF.has("f6"), "F: sixth message must be outside episode plan due to hard cap.");

  // G: unrelated strong intent in middle prevents unsafe merge
  const caseG = buildMultiMessageObservationPlan([
    mkRow({ id: "g1", studentId: "sofia", observedAt: base, text: "Вторник и четверг" }),
    mkRow({ id: "g2", studentId: "sofia", observedAt: plus30, text: "Перенеси пятничную тренировку на воскресенье" }),
    mkRow({
      id: "g3",
      studentId: "sofia",
      observedAt: plus60,
      text: "Потом на 4 дня на винный фестиваль улетаю, точно бегать не смогу.",
    }),
  ]);
  assert(getCandidatesCount(caseG, "g1") === 0, "G: strong unrelated intent should break schedule promotion chain.");

  // H: boundary window too far
  const caseH = buildMultiMessageObservationPlan([
    mkRow({ id: "h1", studentId: "sofia", observedAt: base, text: "Вторник и четверг" }),
    mkRow({
      id: "h2",
      studentId: "sofia",
      observedAt: plus240,
      text: "Потом на 4 дня на винный фестиваль улетаю, точно бегать не смогу.",
    }),
  ]);
  assert(getCandidatesCount(caseH, "h1") === 0, "H: >3 minute distance must not link.");
  assert(getCandidatesCount(caseH, "h2") === 0, "H: >3 minute distance should produce no episode plan.");

  // I: different students never merge
  const caseI = buildMultiMessageObservationPlan([
    mkRow({ id: "i1", studentId: "sofia", observedAt: base, text: "Вторник и четверг" }),
    mkRow({
      id: "i2",
      studentId: "other-student",
      observedAt: plus30,
      text: "Потом на 4 дня на винный фестиваль улетаю, точно бегать не смогу.",
    }),
  ]);
  assert(getCandidatesCount(caseI, "i1") === 0, "I: different students must not merge.");
  assert(getCandidatesCount(caseI, "i2") === 0, "I: different students must not create merged episode.");

  console.log(`${LOG_PREFIX} PASS`);
}

try {
  run();
} catch (error) {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error((error as Error).message);
  process.exit(1);
}
