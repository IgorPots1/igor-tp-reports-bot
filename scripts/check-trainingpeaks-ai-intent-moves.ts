/**
 * Shadow-mode measurement: the AI classifier must report EVERY move it sees in a message, so we can
 * count how often the single-move rule engine silently halves a request.
 *
 * Offline only — parses canned model responses. No Anthropic call, no DB, no network.
 */
import {
  buildTrainingPeaksAiIntentLogFields,
  parseTrainingPeaksAiIntentClassification,
} from "@/features/trainingpeaks/move-workout-intent-ai";
import {
  hasTrainingPeaksMessageIntentLoggingRelevance,
  isLowRelevanceTrainingPeaksIntentLog,
  resolveTrainingPeaksMessageIntentLogStatus,
} from "@/features/trainingpeaks/message-intent-log";

let failed = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`ok: ${name}`);
    return;
  }
  failed += 1;
  console.log(`FAIL: ${name}${detail ? `\n  ${detail}` : ""}`);
}

// ── Nadezhda 2026-07-14: two moves in one message. The rule engine created ONE action. ───────────
const twoMoveResponse = {
  intent: "move_workout",
  workout_reference: { kind: "easy_run", text: "легкую тренировку", confidence: 0.9 },
  target_date: { kind: "relative", value: "tomorrow", text: "завтра", confidence: 0.9 },
  source_date: { kind: "relative", value: "today", text: "сегодня", confidence: 0.9 },
  moves: [
    {
      workout_reference: { kind: "easy_run", text: "легкую тренировку", confidence: 0.9 },
      target_date: { kind: "relative", value: "tomorrow", text: "завтра", confidence: 0.9 },
      source_date: { kind: "relative", value: "today", text: "сегодня", confidence: 0.9 },
    },
    {
      workout_reference: { kind: "intervals", text: "интервальную", confidence: 0.9 },
      target_date: { kind: "relative", value: "thursday", text: "четверг", confidence: 0.85 },
      source_date: null,
    },
  ],
  confidence: 0.9,
  needs_clarification: false,
  clarification_reason: null,
  reasoning_summary: "Два переноса: лёгкая сегодня→завтра, интервальная→четверг.",
};

const twoMove = parseTrainingPeaksAiIntentClassification(twoMoveResponse);
check("two-move response parses", twoMove.ok);
if (twoMove.ok) {
  check(
    "two-move response reports move_count = 2",
    twoMove.classification.move_count === 2,
    `got ${twoMove.classification.move_count}`
  );
  check(
    "second move is the intervals → thursday one",
    twoMove.classification.moves[1]?.workout_reference.kind === "intervals" &&
      twoMove.classification.moves[1]?.target_date.text === "четверг"
  );

  const fields = buildTrainingPeaksAiIntentLogFields({
    result: { ok: true, classification: twoMove.classification, model: "claude-haiku-4-5-20251001" },
  });
  check(
    "ai_move_count reaches intent-log metadata (the column the shadow report filters on)",
    fields.metadata.ai_move_count === 2,
    `got ${String(fields.metadata.ai_move_count)}`
  );
}

// ── Back-compat: a response with no `moves` array at all must still count as one move. ───────────
const flatOnlyResponse = {
  intent: "move_workout",
  workout_reference: { kind: "intervals", text: "интервальную", confidence: 0.9 },
  target_date: { kind: "relative", value: "tomorrow", text: "завтра", confidence: 0.9 },
  source_date: null,
  confidence: 0.85,
  needs_clarification: false,
  clarification_reason: null,
  reasoning_summary: "Один перенос.",
};

const flatOnly = parseTrainingPeaksAiIntentClassification(flatOnlyResponse);
check("response without `moves` still parses", flatOnly.ok);
if (flatOnly.ok) {
  check(
    "response without `moves` falls back to move_count = 1",
    flatOnly.classification.move_count === 1,
    `got ${flatOnly.classification.move_count}`
  );
}

// ── A non-move must not be inflated into a move. ─────────────────────────────────────────────────
const noneResponse = {
  intent: "none",
  workout_reference: { kind: "unknown", text: null, confidence: 0 },
  target_date: { kind: "unknown", value: null, text: null, confidence: 0 },
  source_date: null,
  confidence: 0.9,
  needs_clarification: false,
  clarification_reason: null,
  reasoning_summary: "Отчёт о тренировке, не просьба перенести.",
};

const none = parseTrainingPeaksAiIntentClassification(noneResponse);
check("intent=none parses", none.ok);
if (none.ok) {
  check(
    "intent=none reports move_count = 0",
    none.classification.move_count === 0,
    `got ${none.classification.move_count}`
  );
}

// ── Junk entries inside `moves` are dropped, not counted. ────────────────────────────────────────
const junkMoves = parseTrainingPeaksAiIntentClassification({
  ...flatOnlyResponse,
  moves: [
    {
      workout_reference: { kind: "intervals", text: "интервальную", confidence: 0.9 },
      target_date: { kind: "relative", value: "tomorrow", text: "завтра", confidence: 0.9 },
      source_date: null,
    },
    { workout_reference: { kind: "intervals", text: "x", confidence: 0.1 } }, // no target → not a move
    null,
  ],
});
check("moves with junk entries parses", junkMoves.ok);
if (junkMoves.ok) {
  check(
    "a move without a target_date is not counted",
    junkMoves.classification.move_count === 1,
    `got ${junkMoves.classification.move_count}`
  );
}

// ── Chatter is now logged (it used to vanish) but must NOT reach the coach's triage queue. ──────
// The business handler falls back to the intent-log row's status when it cannot derive one locally.
// Since low-relevance rejections now DO write a row, that fallback would open an
// `unrecognized_intent` coach case for every "Спасибо" unless the row is marked and skipped.
console.log("\n── low-relevance chatter: logged, but never a coach case ──");
for (const chatter of ["Спасибо", "Хорошо", "🫶🏼", "Ура, получилось"]) {
  const hasRelevance = hasTrainingPeaksMessageIntentLoggingRelevance(chatter, []);
  const resolved = resolveTrainingPeaksMessageIntentLogStatus({
    reason: "not_explicit_move_request",
    hasRelevance,
  });
  // resolved === null is precisely what makes the row "low relevance" and keeps it out of triage.
  if (hasRelevance || resolved !== null) {
    failed += 1;
    console.log(
      `FAIL: «${chatter}» must stay low-relevance (hasRelevance=${hasRelevance}, resolved=${String(resolved)})`
    );
    continue;
  }
  console.log(`ok: «${chatter}» → logged as low-relevance, no coach case`);
}

check(
  "a lowRelevance-marked row is recognised and skipped by the coach-case fallback",
  isLowRelevanceTrainingPeaksIntentLog({ metadata: { lowRelevance: true } })
);
check(
  "an ordinary row is NOT treated as low-relevance",
  !isLowRelevanceTrainingPeaksIntentLog({ metadata: { contextLabels: ["schedule_context"] } }) &&
    !isLowRelevanceTrainingPeaksIntentLog(null)
);

if (failed > 0) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}

console.log("\nAll TrainingPeaks AI intent multi-move checks passed.");
