import {
  parseTrainingPeaksMoveWorkoutRequest,
  passesTrainingPeaksStrictMoveWorkoutIntentGate,
} from "@/features/trainingpeaks/service";
import {
  assembleTrainingPeaksMoveIntentContext,
  triggerHasStrictMoveVerb,
} from "@/features/trainingpeaks/move-multi-message-context";

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

  // ─── Multi-message move-intent context assembly checks ──────────────────
  //
  // Safety contract: a bare verb like "Перенеси пожалуйста" must NEVER parse as
  // a move action on its own. The assembled-text fallback is gated on (a) a
  // strict move verb in the trigger and (b) relevant prior context messages.
  //
  // These checks pin the pure helper behavior; runtime wiring lives in
  // createTrainingPeaksMoveWorkoutActionFromTelegram and reuses the helper.
  const baseUnix = Math.floor(Date.parse("2026-05-25T09:00:00+02:00") / 1000);
  const baseMs = baseUnix * 1000;
  const isoAt = (offsetMs: number): string => new Date(baseMs + offsetMs).toISOString();

  // (A) Single-message rejection: bare verb must fail strict gate + parse.
  const bareTrigger = "Перенеси пожалуйста";
  const bareGate = passesTrainingPeaksStrictMoveWorkoutIntentGate(bareTrigger);
  const bareParse = await parseTrainingPeaksMoveWorkoutRequest(bareTrigger, {
    messageDateUnix: baseUnix,
  });
  const bareHelper = assembleTrainingPeaksMoveIntentContext({
    triggerText: bareTrigger,
    recentMessages: [],
  });
  const bareOk =
    bareGate === false &&
    bareParse.ok === false &&
    bareParse.reason === "not_explicit_move_request" &&
    triggerHasStrictMoveVerb(bareTrigger) === true &&
    bareHelper === null;
  if (!bareOk) {
    failed += 1;
  }
  console.log(
    `${bareOk ? "PASS" : "FAIL"} (multi-msg/A bare trigger): "${bareTrigger}" -> ${JSON.stringify(
      {
        gate: bareGate,
        parse: bareParse.ok ? "unexpected ok" : bareParse.reason,
        helper: bareHelper,
      }
    )}`
  );

  // (B) Yulia useful burst: workout + tomorrow context + bare verb assembles
  // into a valid strict parse anchored on the trigger timestamp.
  const yuliaUsefulRecent = [
    {
      textPreview: "Не смогла я сегодня сделать свои интервалы",
      messageId: 101,
      observedAt: isoAt(-170_000),
      labels: ["report_like", "schedule_context"],
    },
    {
      textPreview: "Завтра постараюсь",
      messageId: 102,
      observedAt: isoAt(-60_000),
      labels: ["schedule_context"],
    },
  ];
  const yuliaUsefulAssembled = assembleTrainingPeaksMoveIntentContext({
    triggerText: bareTrigger,
    triggerMessageId: 103,
    recentMessages: yuliaUsefulRecent,
  });
  let yuliaUsefulOk = false;
  const yuliaUsefulAssembledLower = yuliaUsefulAssembled?.assembledText.toLowerCase() ?? "";
  if (
    yuliaUsefulAssembled &&
    yuliaUsefulAssembledLower.includes("интервалы") &&
    yuliaUsefulAssembledLower.includes("сегодня") &&
    yuliaUsefulAssembledLower.includes("завтра") &&
    yuliaUsefulAssembled.contextMessageIds.length === 2
  ) {
    const yuliaUsefulParse = await parseTrainingPeaksMoveWorkoutRequest(
      yuliaUsefulAssembled.assembledText,
      { messageDateUnix: baseUnix }
    );
    if (yuliaUsefulParse.ok) {
      const sourceDate =
        yuliaUsefulParse.payload.sourceDate ?? yuliaUsefulParse.payload.source_date ?? null;
      const target = yuliaUsefulParse.payload.target;
      const sourceOk = sourceDate === "2026-05-25";
      const targetOk = target.kind === "date" && target.value === "2026-05-26";
      const descriptorOk = yuliaUsefulParse.payload.workoutDescriptor !== null;
      yuliaUsefulOk = sourceOk && targetOk && descriptorOk;
      if (!yuliaUsefulOk) {
        console.log(
          `(multi-msg/B detail) parsed -> ${JSON.stringify({
            sourceDate,
            target,
            workoutDescriptor: yuliaUsefulParse.payload.workoutDescriptor,
          })}`
        );
      }
    } else {
      console.log(`(multi-msg/B detail) parse failed -> ${JSON.stringify({ reason: yuliaUsefulParse.reason })}`);
    }
  } else {
    console.log(
      `(multi-msg/B detail) assembly missing context -> ${JSON.stringify(yuliaUsefulAssembled)}`
    );
  }
  if (!yuliaUsefulOk) {
    failed += 1;
  }
  console.log(
    `${yuliaUsefulOk ? "PASS" : "FAIL"} (multi-msg/B useful burst): assembled "${
      yuliaUsefulAssembled?.assembledText ?? "<null>"
    }"`
  );

  // (C) Noisy full burst: helper must exclude obvious ack/noise messages and
  // must NOT produce an ambiguous unsafe parse.
  const noisyRecent = [
    {
      textPreview: "Привет",
      messageId: 200,
      observedAt: isoAt(-175_000),
      labels: ["ack_or_noise"],
    },
    {
      textPreview: "Не смогла я сегодня сделать свои интервалы",
      messageId: 201,
      observedAt: isoAt(-240_000),
      labels: ["report_like", "schedule_context"],
    },
    {
      textPreview: "Сегодня один из дней сборов был",
      messageId: 202,
      observedAt: isoAt(-180_000),
      labels: ["schedule_context"],
    },
    {
      textPreview: "Активный что-то прям",
      messageId: 203,
      observedAt: isoAt(-120_000),
      labels: ["unknown"],
    },
    {
      textPreview: "Завтра постараюсь",
      messageId: 204,
      observedAt: isoAt(-60_000),
      labels: ["schedule_context"],
    },
  ];
  const noisyAssembled = assembleTrainingPeaksMoveIntentContext({
    triggerText: bareTrigger,
    triggerMessageId: 205,
    recentMessages: noisyRecent,
  });
  const includedIds = new Set(noisyAssembled?.contextMessageIds.map(String) ?? []);
  const excludedNoiseOk =
    noisyAssembled !== null && !includedIds.has("200") && !includedIds.has("203");
  let noisyParseSafeOk = false;
  if (noisyAssembled) {
    const noisyParse = await parseTrainingPeaksMoveWorkoutRequest(noisyAssembled.assembledText, {
      messageDateUnix: baseUnix,
    });
    if (noisyParse.ok) {
      const target = noisyParse.payload.target;
      const sourceDate =
        noisyParse.payload.sourceDate ?? noisyParse.payload.source_date ?? null;
      noisyParseSafeOk =
        target.kind === "date" &&
        target.value === "2026-05-26" &&
        sourceDate === "2026-05-25";
    } else {
      // Reject is acceptable too: the requirement is "no unsafe ambiguous action".
      noisyParseSafeOk = true;
    }
  }
  const noisyOk = excludedNoiseOk && noisyParseSafeOk;
  if (!noisyOk) {
    failed += 1;
  }
  console.log(
    `${noisyOk ? "PASS" : "FAIL"} (multi-msg/C noisy burst): includedIds=${JSON.stringify([
      ...includedIds,
    ])}`
  );

  // (C2) Context previews persisted by runtime are expected to be capped to 3.
  const previewCapAssembled = assembleTrainingPeaksMoveIntentContext({
    triggerText: bareTrigger,
    triggerMessageId: 999,
    recentMessages: [
      {
        textPreview: "Не смогла я сегодня сделать свои интервалы",
        messageId: 401,
        observedAt: isoAt(-170_000),
        labels: ["report_like", "schedule_context"],
      },
      {
        textPreview: "Сегодня один из дней сборов был",
        messageId: 402,
        observedAt: isoAt(-140_000),
        labels: ["schedule_context"],
      },
      {
        textPreview: "Завтра постараюсь",
        messageId: 403,
        observedAt: isoAt(-110_000),
        labels: ["schedule_context"],
      },
      {
        textPreview: "Темповая в ногах осталась",
        messageId: 404,
        observedAt: isoAt(-80_000),
        labels: ["report_like"],
      },
    ],
  });
  const previewCapOk =
    previewCapAssembled !== null && previewCapAssembled.contextPreviews.length >= 3;
  if (!previewCapOk) {
    failed += 1;
  }
  console.log(
    `${previewCapOk ? "PASS" : "FAIL"} (multi-msg/C2 preview source ready): previewCount=${
      previewCapAssembled?.contextPreviews.length ?? 0
    }`
  );

  // (D) Insufficient context: only noise messages → helper must return null.
  const insufficientAssembled = assembleTrainingPeaksMoveIntentContext({
    triggerText: bareTrigger,
    recentMessages: [
      {
        textPreview: "Привет",
        messageId: 300,
        observedAt: isoAt(-60_000),
        labels: ["ack_or_noise"],
      },
    ],
  });
  const insufficientOk = insufficientAssembled === null;
  if (!insufficientOk) {
    failed += 1;
  }
  console.log(
    `${insufficientOk ? "PASS" : "FAIL"} (multi-msg/D insufficient): ${JSON.stringify(
      insufficientAssembled
    )}`
  );

  // (E) Trigger without strict verb must never assemble even if context exists.
  const noVerbAssembled = assembleTrainingPeaksMoveIntentContext({
    triggerText: "Завтра постараюсь",
    recentMessages: yuliaUsefulRecent,
  });
  const noVerbOk = noVerbAssembled === null;
  if (!noVerbOk) {
    failed += 1;
  }
  console.log(
    `${noVerbOk ? "PASS" : "FAIL"} (multi-msg/E no strict verb): ${JSON.stringify(noVerbAssembled)}`
  );

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
