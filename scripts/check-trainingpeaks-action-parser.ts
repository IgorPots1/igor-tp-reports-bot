import {
  parseTrainingPeaksMoveWorkoutRequest,
  passesTrainingPeaksStrictMoveWorkoutIntentGate,
} from "@/features/trainingpeaks/service";

type ParseCase = {
  text: string;
  expectOk: boolean;
};

/**
 * Positive examples: explicit reschedule requests that must parse successfully.
 */
const expectOkCases: ParseCase[] = [
  { text: "перенеси тренировку на завтра", expectOk: true },
  { text: "переставь легкую пробежку на субботу", expectOk: true },
  { text: "перенеси бег с пятницы на воскресенье", expectOk: true },
  { text: "перенеси тренировку с 15 мая на 16 мая", expectOk: true },
  { text: "завтрашнюю интервальную перенеси на воскресенье", expectOk: true },
  { text: "можно перенести сегодняшнюю тренировку на завтра?", expectOk: true },
  { text: "перенеси тренировку на 2026-05-16", expectOk: true },
  { text: "перенеси бег с четверга на пятницу", expectOk: true },
  { text: "переставь легкую на субботу", expectOk: true },
];

/**
 * Casual / ambiguous chat — must NOT yield move_workout parse success (no coach spam).
 */
const expectRejectCases: ParseCase[] = [
  { text: "ок", expectOk: false },
  { text: "спасибо", expectOk: false },
  { text: "завтра сделаю", expectOk: false },
  { text: "сегодня не успеваю", expectOk: false },
  { text: "можно завтра?", expectOk: false },
  { text: "я сегодня не бегу", expectOk: false },
  { text: "отчет отправил", expectOk: false },
  { text: "завтра пробегу", expectOk: false },
  { text: "а можно завтра?", expectOk: false },
  { text: "давай завтра", expectOk: false },
  { text: "сегодня не получится", expectOk: false },
  { text: "у меня болит нога", expectOk: false },
  { text: "сегодня не успеваю, можно завтра?", expectOk: false },
  { text: "перенеси тренировку", expectOk: false },
  { text: "завтра или в пятницу", expectOk: false },
];

/** Gate-only checks: obvious non-actions must fail before deterministic / AI. */
const gateRejectTexts = expectRejectCases.map((c) => c.text);

async function run(): Promise<void> {
  let failed = 0;

  for (const text of gateRejectTexts) {
    if (passesTrainingPeaksStrictMoveWorkoutIntentGate(text)) {
      failed += 1;
      console.log(`FAIL (gate): "${text}" should not pass strict intent gate`);
    }
  }

  const parseCases = [...expectOkCases, ...expectRejectCases];

  for (const testCase of parseCases) {
    const result = await parseTrainingPeaksMoveWorkoutRequest(testCase.text);
    const ok = result.ok === testCase.expectOk;
    if (!ok) {
      failed += 1;
    }

    const badge = ok ? "PASS" : "FAIL";
    const details = result.ok
      ? JSON.stringify(
          {
            source: result.payload.source,
            target: result.payload.target,
            workoutDescriptor: result.payload.workoutDescriptor,
            confidence: result.payload.confidence,
            needsClarification: result.payload.needsClarification,
            parser: result.payload.parser,
          },
          null,
          2
        )
      : JSON.stringify({ reason: result.reason });
    console.log(`${badge}: "${testCase.text}" -> ${details}`);
  }

  /*
   * AI fallback is skipped when the strict gate fails (implementation returns early).
   * Without mocking fetch / OpenAI, we assert:
   * - rejected casual messages yield `not_explicit_move_request`, which only occurs on that early path.
   */
  const casual = await parseTrainingPeaksMoveWorkoutRequest("спасибо");
  const casualReasonOk =
    !casual.ok && casual.reason === "not_explicit_move_request" ? "PASS" : "FAIL";
  if (casualReasonOk === "FAIL") {
    failed += 1;
  }
  console.log(
    `${casualReasonOk}: AI skipped path — casual message reason is "${casual.ok ? "unexpected ok" : casual.reason}"`
  );

  if (failed > 0) {
    process.exitCode = 1;
    console.error(`\n${failed} parser checks failed.`);
    return;
  }

  console.log("\nAll parser checks passed.");
}

void run();
