import {
  parseTrainingPeaksMoveWorkoutRequest,
  passesTrainingPeaksStrictMoveWorkoutIntentGate,
} from "@/features/trainingpeaks/service";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type ParseCase = {
  text: string;
  expectOk: boolean;
  messageDateUnix?: number;
  expectedReason?: string;
};

type DeterministicResolveCase = {
  text: string;
  expectedSourceDate: string;
  expectedTargetDate: string;
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
  { text: "Привет, давай Лонг перенесем на завтра", expectOk: true },
  { text: "Лонг давай завтра", expectOk: true },
  { text: "перенеси длительную на завтра", expectOk: true },
  {
    text: "Поставьте интервалы на завтра",
    expectOk: true,
    messageDateUnix: Math.floor(Date.parse("2026-05-25T09:00:00+02:00") / 1000),
  },
  {
    text: "Интервальную завтра сделаю",
    expectOk: true,
    messageDateUnix: Math.floor(Date.parse("2026-05-25T09:00:00+02:00") / 1000),
  },
  {
    text: "Лучше 6х6 завтра",
    expectOk: true,
    messageDateUnix: Math.floor(Date.parse("2026-05-25T09:00:00+02:00") / 1000),
  },
  {
    text: "Можно завтра отработать интервалы?",
    expectOk: true,
    messageDateUnix: Math.floor(Date.parse("2026-05-25T09:00:00+02:00") / 1000),
  },
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
  { text: "лонг был тяжелый", expectOk: false },
  { text: "завтра побегу легко", expectOk: false },
  { text: "сегодня не успеваю, можно завтра?", expectOk: false },
  { text: "перенеси тренировку", expectOk: false },
  { text: "завтра или в пятницу", expectOk: false },
];

const expectNeedsReviewCases: ParseCase[] = [
  {
    text: "Интервалы на завтра поставьте пожалуйста 🙏 Эта неделя у меня какая-то не понятная. Возможно в середине недели уеду в деревню. Лучше отработаю заранее.",
    expectOk: true,
    messageDateUnix: Math.floor(Date.parse("2026-05-25T09:00:00+02:00") / 1000),
  },
];

const targetedTimestampCase: ParseCase = {
  text: "Поставьте интервалы на завтра",
  expectOk: true,
  messageDateUnix: Math.floor(Date.parse("2026-05-25T09:00:00+02:00") / 1000),
};

const deterministicCases: DeterministicResolveCase[] = [
  {
    text: "перенеси тренировку с 17 мая на 19 мая",
    expectedSourceDate: "2026-05-17",
    expectedTargetDate: "2026-05-19",
  },
  {
    text: "перенеси тренировку с 16 мая на 19 мая",
    expectedSourceDate: "2026-05-16",
    expectedTargetDate: "2026-05-19",
  },
  {
    text: "перенеси вчерашнюю тренировку на сегодня",
    expectedSourceDate: "2026-05-16",
    expectedTargetDate: "2026-05-17",
  },
  {
    text: "перенеси тренировку с 28 мая на завтра",
    expectedSourceDate: "2026-05-28",
    expectedTargetDate: "2026-05-26",
  },
  {
    text: "перенеси сегодняшнюю тренировку на завтра",
    expectedSourceDate: "2026-05-17",
    expectedTargetDate: "2026-05-18",
  },
  {
    text: "перенеси тренировку с субботы на понедельник",
    expectedSourceDate: "2026-05-16",
    expectedTargetDate: "2026-05-18",
  },
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

  const parseCases = [...expectOkCases, ...expectRejectCases, ...expectNeedsReviewCases];

  for (const testCase of parseCases) {
    const result = await parseTrainingPeaksMoveWorkoutRequest(testCase.text, {
      messageDateUnix: testCase.messageDateUnix ?? null,
    });
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
            clarificationReason: result.payload.clarificationReason,
            warnings: result.payload.warnings ?? [],
            sourceInference: result.payload.sourceInference ?? null,
            sourceInferencePreview: result.payload.sourceInferencePreview ?? null,
            parser: result.payload.parser,
          },
          null,
          2
        )
      : JSON.stringify({ reason: result.reason });
    console.log(`${badge}: "${testCase.text}" -> ${details}`);
  }

  const targetedResult = await parseTrainingPeaksMoveWorkoutRequest(targetedTimestampCase.text, {
    messageDateUnix: targetedTimestampCase.messageDateUnix,
  });
  if (!targetedResult.ok) {
    failed += 1;
    console.log(`FAIL (timestamp target): "${targetedTimestampCase.text}" -> ${JSON.stringify({ reason: targetedResult.reason })}`);
  } else {
    const targetOk = targetedResult.payload.target.kind === "date" && targetedResult.payload.target.value === "2026-05-26";
    const sourceDate = targetedResult.payload.sourceDate ?? targetedResult.payload.source_date ?? null;
    const sourceOk = sourceDate === null || ISO_DATE_PATTERN.test(sourceDate);
    const diagnosticsOk = targetedResult.payload.parsingDiagnostics?.parserBaseDateSource === "message_timestamp";
    const ok = targetOk && sourceOk && diagnosticsOk;
    if (!ok) {
      failed += 1;
    }
    console.log(
      `${ok ? "PASS" : "FAIL"} (timestamp target): "${targetedTimestampCase.text}" -> ${JSON.stringify(
        {
          target: targetedResult.payload.target,
          sourceDate,
          diagnostics: targetedResult.payload.parsingDiagnostics ?? null,
        },
        null,
        2
      )}`
    );
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

  const previousTimezone = process.env.TZ;
  const previousBaseDate = process.env.TP_MOVE_DATE_BASE_DATE;
  process.env.TZ = "Europe/Belgrade";
  process.env.TP_MOVE_DATE_BASE_DATE = "2026-05-17";

  process.env.TZ = "Europe/Belgrade";
  process.env.TP_MOVE_DATE_BASE_DATE = "2026-05-25";

  for (const testCase of deterministicCases.filter((item) => item.text.includes("28 мая"))) {
    const result = await parseTrainingPeaksMoveWorkoutRequest(testCase.text);
    if (!result.ok) {
      failed += 1;
      console.log(`FAIL (deterministic parse): "${testCase.text}" -> ${JSON.stringify({ reason: result.reason })}`);
      continue;
    }

    const sourceDate = result.payload.sourceDate ?? result.payload.source_date ?? null;
    const target = result.payload.target;
    const sourceOk = sourceDate === testCase.expectedSourceDate;
    const targetOk = target.kind === "date" && target.value === testCase.expectedTargetDate;
    const previewAbsent = !result.payload.sourceInferencePreview;
    const ok = sourceOk && targetOk && previewAbsent;

    if (!ok) {
      failed += 1;
    }
    console.log(
      `${ok ? "PASS" : "FAIL"} (explicit source May 28): "${testCase.text}" -> ${JSON.stringify(
        {
          sourceDate,
          target: target.kind === "date" ? target.value : `${target.kind}:${target.value}`,
          sourceInferencePreview: result.payload.sourceInferencePreview ?? null,
        },
        null,
        2
      )}`
    );
  }

  process.env.TP_MOVE_DATE_BASE_DATE = "2026-05-17";

  for (const testCase of deterministicCases.filter((item) => !item.text.includes("28 мая"))) {
    const result = await parseTrainingPeaksMoveWorkoutRequest(testCase.text);
    if (!result.ok) {
      failed += 1;
      console.log(`FAIL (deterministic parse): "${testCase.text}" -> ${JSON.stringify({ reason: result.reason })}`);
      continue;
    }

    const source = result.payload.source;
    const target = result.payload.target;
    const sourceOk = source?.kind === "date" && source.value === testCase.expectedSourceDate;
    const targetOk = target.kind === "date" && target.value === testCase.expectedTargetDate;
    const ok = sourceOk && targetOk;

    if (!ok) {
      failed += 1;
    }
    console.log(
      `${ok ? "PASS" : "FAIL"} (deterministic): "${testCase.text}" -> ${JSON.stringify(
        {
          gotSource: source?.kind === "date" ? source.value : `${source?.kind ?? "null"}:${source?.value ?? "null"}`,
          gotTarget: target.kind === "date" ? target.value : `${target.kind}:${target.value}`,
          expectedSource: testCase.expectedSourceDate,
          expectedTarget: testCase.expectedTargetDate,
          parser: result.payload.parser,
        },
        null,
        2
      )}`
    );
  }

  if (previousTimezone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = previousTimezone;
  }
  if (previousBaseDate === undefined) {
    delete process.env.TP_MOVE_DATE_BASE_DATE;
  } else {
    process.env.TP_MOVE_DATE_BASE_DATE = previousBaseDate;
  }

  if (failed > 0) {
    process.exitCode = 1;
    console.error(`\n${failed} parser checks failed.`);
    return;
  }

  console.log("\nAll parser checks passed.");
}

void run();
