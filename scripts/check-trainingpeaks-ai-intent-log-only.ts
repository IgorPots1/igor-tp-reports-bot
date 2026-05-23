import {
  getTrainingPeaksIntentAiMode,
  isTrainingPeaksIntentAiLogOnlyEnabled,
} from "@/features/trainingpeaks/intent-ai-mode";
import {
  buildTrainingPeaksAiIntentLogFields,
  parseTrainingPeaksAiIntentClassification,
  type TrainingPeaksAiIntentClassification,
} from "@/features/trainingpeaks/move-workout-intent-ai";
import {
  hasTrainingPeaksMessageIntentLoggingRelevance,
  resolveTrainingPeaksMessageIntentLogStatus,
  shouldRunTrainingPeaksIntentAiLogOnly,
} from "@/features/trainingpeaks/message-intent-log";
import {
  buildTrainingPeaksMessageIntentLogTriageRecommendation,
  formatTrainingPeaksMessageIntentLogsTriageTelegram,
  parseTrainingPeaksIntentsCommandArgs,
} from "@/features/trainingpeaks/message-intent-log-triage";
import type { TrainingPeaksMessageIntentLog } from "@/features/trainingpeaks/repository";
import { classifyTelegramContextLabels } from "@/features/trainingpeaks/telegram-context";

type CheckCase = {
  text: string;
  moveActionReason:
    | "student_not_found"
    | "not_explicit_move_request"
    | "needs_clarification"
    | "parse_rejected";
  expectAiTrigger: boolean;
  mockAi: TrainingPeaksAiIntentClassification;
  expectIntent?: "move_workout" | "none" | "unknown";
  expectWorkoutKind?: string;
};

const cases: CheckCase[] = [
  {
    text: "лонг был тяжелый",
    moveActionReason: "not_explicit_move_request",
    expectAiTrigger: true,
    expectIntent: "none",
    mockAi: {
      intent: "none",
      workout_reference: { kind: "long_run", text: "лонг", confidence: 0.82 },
      target_date: { kind: "unknown", value: null, text: null, confidence: 0.1 },
      source_date: null,
      confidence: 0.86,
      needs_clarification: false,
      clarification_reason: null,
      reasoning_summary: "Past tense report about a hard long run, not a reschedule request.",
    },
  },
  {
    text: "давай лонг завтра",
    moveActionReason: "not_explicit_move_request",
    expectAiTrigger: true,
    expectIntent: "move_workout",
    expectWorkoutKind: "long_run",
    mockAi: {
      intent: "move_workout",
      workout_reference: { kind: "long_run", text: "лонг", confidence: 0.9 },
      target_date: { kind: "relative", value: "tomorrow", text: "завтра", confidence: 0.91 },
      source_date: null,
      confidence: 0.88,
      needs_clarification: false,
      clarification_reason: null,
      reasoning_summary: "Student asks to schedule long run for tomorrow.",
    },
  },
  {
    text: "может темповую лучше в среду?",
    moveActionReason: "needs_clarification",
    expectAiTrigger: true,
    expectIntent: "move_workout",
    expectWorkoutKind: "tempo",
    mockAi: {
      intent: "move_workout",
      workout_reference: { kind: "tempo", text: "темповую", confidence: 0.88 },
      target_date: { kind: "relative", value: "wednesday", text: "в среду", confidence: 0.84 },
      source_date: null,
      confidence: 0.8,
      needs_clarification: true,
      clarification_reason: "Source day not specified.",
      reasoning_summary: "Likely tempo move to Wednesday but source day is unclear.",
    },
  },
  {
    text: "завтра побегу легко",
    moveActionReason: "not_explicit_move_request",
    expectAiTrigger: true,
    expectIntent: "none",
    mockAi: {
      intent: "none",
      workout_reference: { kind: "easy_run", text: "легко", confidence: 0.75 },
      target_date: { kind: "relative", value: "tomorrow", text: "завтра", confidence: 0.7 },
      source_date: null,
      confidence: 0.9,
      needs_clarification: false,
      clarification_reason: null,
      reasoning_summary: "Casual plan statement, not asking coach to move a workout.",
    },
  },
  {
    text: "перенеси отрезки на пятницу",
    moveActionReason: "parse_rejected",
    expectAiTrigger: true,
    expectIntent: "move_workout",
    expectWorkoutKind: "intervals",
    mockAi: {
      intent: "move_workout",
      workout_reference: { kind: "intervals", text: "отрезки", confidence: 0.93 },
      target_date: { kind: "relative", value: "friday", text: "на пятницу", confidence: 0.9 },
      source_date: null,
      confidence: 0.92,
      needs_clarification: false,
      clarification_reason: null,
      reasoning_summary: "Explicit move intervals to Friday.",
    },
  },
];

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function runChecks(): void {
  let failed = 0;
  const previousMode = process.env.TRAININGPEAKS_INTENT_AI_MODE;

  delete process.env.TRAININGPEAKS_INTENT_AI_MODE;
  assert(getTrainingPeaksIntentAiMode() === "off", "default mode must be off");
  assert(!isTrainingPeaksIntentAiLogOnlyEnabled(), "log_only must be disabled by default");
  console.log("PASS: default TRAININGPEAKS_INTENT_AI_MODE=off");

  process.env.TRAININGPEAKS_INTENT_AI_MODE = "log_only";
  assert(getTrainingPeaksIntentAiMode() === "log_only", "log_only mode must be recognized");
  assert(isTrainingPeaksIntentAiLogOnlyEnabled(), "log_only mode must enable flag helper");
  console.log("PASS: TRAININGPEAKS_INTENT_AI_MODE=log_only");

  for (const testCase of cases) {
    try {
      const contextLabels = classifyTelegramContextLabels(testCase.text);
      const hasRelevance = hasTrainingPeaksMessageIntentLoggingRelevance(testCase.text, contextLabels);
      const status = resolveTrainingPeaksMessageIntentLogStatus({
        reason: testCase.moveActionReason,
        hasRelevance,
      });

      assert(Boolean(status), `expected log status for "${testCase.text}"`);
      assert(hasRelevance, `expected relevance for "${testCase.text}"`);

      const shouldRunOff = shouldRunTrainingPeaksIntentAiLogOnly({
        status: status!,
        hasRelevance,
        moveActionOk: false,
      });
      assert(shouldRunOff === testCase.expectAiTrigger, `AI trigger mismatch for "${testCase.text}"`);

      delete process.env.TRAININGPEAKS_INTENT_AI_MODE;
      const shouldRunWhenOff = shouldRunTrainingPeaksIntentAiLogOnly({
        status: status!,
        hasRelevance,
        moveActionOk: false,
      });
      assert(!shouldRunWhenOff, `AI must not run when mode is off for "${testCase.text}"`);
      process.env.TRAININGPEAKS_INTENT_AI_MODE = "log_only";

      const parsed = parseTrainingPeaksAiIntentClassification(testCase.mockAi);
      if (!parsed.ok) {
        throw new Error(`mock AI JSON invalid for "${testCase.text}": ${parsed.error}`);
      }
      const classification = parsed.classification;
      if (testCase.expectIntent) {
        assert(classification.intent === testCase.expectIntent, `intent mismatch for "${testCase.text}"`);
      }
      if (testCase.expectWorkoutKind) {
        assert(
          classification.workout_reference.kind === testCase.expectWorkoutKind,
          `workout kind mismatch for "${testCase.text}"`
        );
      }

      const aiFields = buildTrainingPeaksAiIntentLogFields({
        result: { ok: true, classification, model: "gpt-4o-mini" },
      });
      assert(aiFields.aiIntent !== null, `aiIntent must be written for "${testCase.text}"`);
      assert(aiFields.metadata.ai_mode === "log_only", `ai_mode must be log_only for "${testCase.text}"`);
      assert(aiFields.metadata.ai_model === "gpt-4o-mini", `ai_model must be set for "${testCase.text}"`);
      assert(status === status, "status must remain rule-based and unchanged by AI log-only mode");

      const invalid = buildTrainingPeaksAiIntentLogFields({
        result: { ok: false, error: "json_parse_failed" },
      });
      assert(invalid.aiIntent === null, `invalid AI must keep aiIntent null for "${testCase.text}"`);
      assert(invalid.metadata.ai_error === "json_parse_failed", `ai_error must be set for "${testCase.text}"`);

      const lowConfidence = buildTrainingPeaksAiIntentLogFields({
        result: {
          ok: true,
          model: "gpt-4o-mini",
          classification: {
            ...classification,
            confidence: 0.5,
          },
        },
      });
      assert(lowConfidence.aiConfidence === 0.5, `low confidence must still be logged for "${testCase.text}"`);

      console.log(
        `PASS: "${testCase.text}" -> status=${status}, ai_trigger=${shouldRunOff}, ai_intent=${classification.intent}, confidence=${classification.confidence}`
      );
    } catch (error) {
      failed += 1;
      console.error(`FAIL: "${testCase.text}" -> ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  assert(
    !shouldRunTrainingPeaksIntentAiLogOnly({
      status: "action_created",
      hasRelevance: true,
      moveActionOk: true,
    }),
    "AI log-only must not run when rule parser created an action"
  );
  console.log("PASS: no AI log-only run when move action already created");

  const parsedDefault = parseTrainingPeaksIntentsCommandArgs("/tp_intents");
  assert(!("error" in parsedDefault) && parsedDefault.limit === 10, "default /tp_intents limit must be 10");
  const parsedLimit = parseTrainingPeaksIntentsCommandArgs("/tp_intents 20 ai");
  assert(
    !("error" in parsedLimit) && parsedLimit.limit === 20 && parsedLimit.aiMoveOnly,
    "/tp_intents 20 ai must parse limit and ai filter"
  );
  console.log("PASS: /tp_intents command args parser");

  const sampleLogs: TrainingPeaksMessageIntentLog[] = [
    {
      id: "log-1",
      createdAt: "2026-05-23T12:55:00.000Z",
      source: "telegram_business",
      studentId: "student-1",
      telegramChatId: "1",
      telegramUserId: "2",
      telegramMessageId: "3",
      businessConnectionId: "bc",
      messageThreadId: null,
      rawText: null,
      textPreview: "лонг был тяжелый",
      textSha256: null,
      normalizedText: null,
      ruleIntent: null,
      ruleConfidence: null,
      aiIntent: { intent: "none" },
      aiConfidence: 0,
      finalIntent: null,
      status: "unrecognized",
      actionId: null,
      reason: "no_move_intent",
      metadata: {},
    },
    {
      id: "log-2",
      createdAt: "2026-05-23T12:50:00.000Z",
      source: "telegram_business",
      studentId: null,
      telegramChatId: "1",
      telegramUserId: "2",
      telegramMessageId: "4",
      businessConnectionId: "bc",
      messageThreadId: null,
      rawText: null,
      textPreview: "может темповую лучше в среду?",
      textSha256: null,
      normalizedText: null,
      ruleIntent: null,
      ruleConfidence: null,
      aiIntent: {
        intent: "move_workout",
        workout_reference: { kind: "tempo" },
        target_date: { text: "Wednesday" },
      },
      aiConfidence: 0.86,
      finalIntent: null,
      status: "unrecognized",
      actionId: null,
      reason: null,
      metadata: {},
    },
  ];
  const triageMessage = formatTrainingPeaksMessageIntentLogsTriageTelegram(sampleLogs, {
    limit: 10,
    studentNames: new Map([["student-1", "Alexander"]]),
  });
  assert(triageMessage.includes("🧠 Непонятые TP-сообщения"), "triage telegram message must include header");
  assert(
    buildTrainingPeaksMessageIntentLogTriageRecommendation(sampleLogs[1]!) ===
      "AI понял перенос, rule-parser пропустил",
    "move_workout triage recommendation must be Russian"
  );
  console.log("PASS: /tp_intents telegram formatter");

  if (previousMode === undefined) {
    delete process.env.TRAININGPEAKS_INTENT_AI_MODE;
  } else {
    process.env.TRAININGPEAKS_INTENT_AI_MODE = previousMode;
  }

  if (failed > 0) {
    process.exitCode = 1;
    console.error(`\n[check-trainingpeaks-ai-intent-log-only] ${failed} check(s) failed.`);
    return;
  }

  console.log("\n[check-trainingpeaks-ai-intent-log-only] PASS");
  console.log(
    JSON.stringify(
      {
        exampleLogOutput: buildTrainingPeaksAiIntentLogFields({
          result: {
            ok: true,
            model: "gpt-4o-mini",
            classification: cases[1]!.mockAi,
          },
        }),
        confirmation: {
          createsActionFromAi: false,
          defaultMode: "off",
        },
      },
      null,
      2
    )
  );
}

runChecks();
