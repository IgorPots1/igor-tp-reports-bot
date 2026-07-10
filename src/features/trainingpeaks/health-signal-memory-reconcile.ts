import type { TrainingPeaksStudentMemoryItem } from "@/features/trainingpeaks/repository";

// Решение A / Шаг 1 (read-only, пометка). The keyword operational-signal classifier
// (coach-operational-signals.ts) rounds health/pain keywords up into health_issue_started at
// conf 0.65, blind to subject, pain-vs-illness, and "already resolved" framing. The Haiku memory
// extraction of the SAME message understood all three correctly (audit 2026-07-06). This module
// lets that memory cast DOUBT on a freshly-born illness signal — it only MARKS ("память сомневается:
// …"), never closes. Step 2 (auto-suppress) is a separate, flagged decision on top of this.
//
// Deliberately conservative on scope:
//  - Only `health_issue_started` is a doubt candidate. `health_issue_improving`,
//    `health_issue_resolved` and `pain_injury` are never flagged (improving = valid monitoring
//    state — protects Sofia Vlasova; resolved/injury already carry the right type).
//  - Memory evidence is keyed to the SAME source message (`sourceObservationId`), the reliable
//    join proven on live data. Cross-message inference is out of scope for Step 1.

export type HealthSignalMemoryDoubtPattern =
  | "already_resolved" // pattern 3 — same-message memory says the episode already passed
  | "pain_not_illness" // pattern 2 — it is pain/injury, mislabelled as illness
  | "self_chosen_pause" // pattern 4 — a voluntary rest / mild "по-женски", not an acute illness
  | "no_health_corroboration" // pattern 1 — no memory supports illness on the source message
  | "returned_to_training"; // pattern 5 — cross-fact: illness in the past, athlete is back training

// weak  → mark only, never eligible for Step-2 auto-suppression.
// medium→ reclassification candidate (pain, not illness) — nothing is lost, only retyped.
// strong→ direct contradiction; eligible for Step-2 auto-suppression once accuracy is validated.
export type HealthSignalMemoryDoubtTier = "weak" | "medium" | "strong";

export type HealthSignalMemoryDoubt = {
  suspected: true;
  pattern: HealthSignalMemoryDoubtPattern;
  tier: HealthSignalMemoryDoubtTier;
  reason: string; // human-readable RU reason, shown as the "Сегодня" doubt badge
  memoryItemId: string | null; // corroborating memory item (null for absence/kind-only tiers)
  memoryConfidence: number | null;
};

export type HealthSignalMemoryReconcileSignal = {
  id: string;
  signalType: string;
  structuredPayload: Record<string, unknown>;
  sourceObservationId: string | null;
};

export type HealthSignalMemoryReconcileMemoryItem = Pick<
  TrainingPeaksStudentMemoryItem,
  "id" | "memoryType" | "summaryText" | "confidence" | "sourceObservationId"
>;

// Confidence gates per audit design (§2 thresholds).
export const RESOLVED_MEMORY_MIN_CONFIDENCE = 0.85;
export const PAIN_MEMORY_MIN_CONFIDENCE = 0.8;
export const PAUSE_MEMORY_MIN_CONFIDENCE = 0.8;

const HEALTH_MEMORY_TYPES = new Set(["pain_or_injury", "health_status"]);

// Resolved = the problem is OVER. Kept narrow so it never fires on an IMPROVING state.
const RESOLVED_CUES = [
  "восстановление успешн",
  "полностью восстанов",
  "выздоровел", // выздоровел/-а/-и — but NOT "выздоравливает" (that is EXCLUDED below)
  "не болит",
  "уже не болит",
  "не беспокоит",
  "боль прошла",
  "прошла боль",
  "разрешил", // разрешилась
  "симптомов нет",
  "всё прошло",
  "все прошло",
];

// If any of these appear, the state is IMPROVING/CONTINUED, not RESOLVED — block pattern 3.
// "выздоравлив" guards against "выздоравливает" matching the "выздоровел" prefix intent;
// "остал"/"кашель"/"температур"/"слабост" guard Sofia's "кашель остался… выздоравливает".
const NOT_YET_RESOLVED_CUES = [
  "выздоравлив",
  "получше",
  "остал",
  "ещё есть",
  "еще есть",
  "слабост",
  "температур",
  "кашель",
  "кашл",
];

// Voluntary rest / mild non-acute framing.
const SELF_PAUSE_CUES = [
  "отдых",
  "взяла неделю",
  "неделю отдыха",
  "по женски",
  "по-женски",
  "всё хорошо",
  "все хорошо",
  "не хотела бегать",
  "менструал",
  "цикл",
];

// Acute-illness markers that veto the "self-chosen pause" reading.
const ACUTE_ILLNESS_CUES = [
  "температур",
  "болею",
  "заболел",
  "горло",
  "тошнит",
  "рвот",
  "отравл",
  "грипп",
  "ковид",
  "covid",
  "ангин",
];

// Pattern 5 — return to training. CONFIRMED = a past/present fact that the athlete is already training or
// functional again (autoclose-eligible when no current symptom lingers).
const RETURN_CONFIRMED_CUES = [
  "вчера бегал", "вчера работал", "уже бега", "уже трениру", "уже работа",
  "сбегал", "побегал", "пробежал", "пробежала", "смог пробежа", "смогла пробежа",
  "вышел на пробежк", "вышла на пробежк", "вернулся к трен", "вернулась к трен",
  "вернулся в строй", "вернулась в строй", "готов трениров", "готова трениров",
  "готов бегать", "готова бегать", "начал бегать", "начала бегать",
];
// INTENT = only a plan to return, no confirmed fact yet → mark-only, never autoclose.
const RETURN_INTENT_CUES = [
  "планирую верну", "планирует верну", "завтра пойду", "завтра побегу",
  "сегодня пойду", "сегодня побегу", "думаю начать", "собираюсь верну",
  "хочу верну", "буду возвращат",
];
// CURRENT symptoms still present → the illness is NOT safely over. Any of these caps the doubt at WEAK
// (mark, never autoclose), even if a return cue is present. Past-tense "заболел/болел" is NOT here.
const CURRENT_SYMPTOM_CUES = [
  "температур", "рвот", "тошнит", "лежу", "слег", "озноб", "задыха",
  "очень плохо", "совсем плохо", "плохо себя", "горло болит", "сильно боли",
  "слабост", "кашель", "кашл",
];

function norm(text: string | null | undefined): string {
  return (text ?? "").toLowerCase().replace(/ё/gu, "е");
}

function hasAny(text: string, cues: readonly string[]): boolean {
  return cues.some((cue) => text.includes(norm(cue)));
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value.trim().toLowerCase() : null;
}

/**
 * Cast memory-based doubt on a single operational health signal. Pure & synchronous.
 * Returns null when the signal is out of scope OR the memory does not contradict it.
 */
export function evaluateHealthSignalMemoryDoubt(input: {
  signal: HealthSignalMemoryReconcileSignal;
  memoryItems: readonly HealthSignalMemoryReconcileMemoryItem[];
}): HealthSignalMemoryDoubt | null {
  const { signal } = input;

  // Only fresh illness onset is a candidate. Improving/resolved/injury are never doubted here.
  if (signal.signalType !== "health_issue_started") {
    return null;
  }

  const obsId = signal.sourceObservationId;
  const sameMessage = obsId
    ? input.memoryItems.filter((item) => item.sourceObservationId === obsId)
    : [];
  const sameMessageHealth = sameMessage.filter((item) => HEALTH_MEMORY_TYPES.has(item.memoryType));

  const kind = readPayloadString(signal.structuredPayload, "health_issue_kind");

  // ── Pattern 3 — already resolved in the same message (STRONG) ──────────────────────────────
  for (const item of sameMessageHealth) {
    const summary = norm(item.summaryText);
    const confidence = item.confidence ?? 0;
    if (
      confidence >= RESOLVED_MEMORY_MIN_CONFIDENCE &&
      hasAny(summary, RESOLVED_CUES) &&
      !hasAny(summary, NOT_YET_RESOLVED_CUES)
    ) {
      return {
        suspected: true,
        pattern: "already_resolved",
        tier: "strong",
        reason: "память: в том же сообщении состояние уже разрешилось — возможно, сигнал устарел",
        memoryItemId: item.id,
        memoryConfidence: item.confidence ?? null,
      };
    }
  }

  // ── Pattern 2 — pain, not illness (MEDIUM, reclassification candidate) ─────────────────────
  const painMemory = sameMessageHealth.find(
    (item) => item.memoryType === "pain_or_injury" && (item.confidence ?? 0) >= PAIN_MEMORY_MIN_CONFIDENCE
  );
  const kindIsPain = kind === "pain_or_injury" || kind === "pain_unspecified";
  if (painMemory || kindIsPain) {
    return {
      suspected: true,
      pattern: "pain_not_illness",
      tier: "medium",
      reason: painMemory
        ? "память: это боль/травма, не болезнь — вероятно, нужна переклассификация в травму"
        : "классификатор пометил это как боль (kind=" + kind + "), не болезнь — вероятно, травма",
      memoryItemId: painMemory?.id ?? null,
      memoryConfidence: painMemory?.confidence ?? null,
    };
  }

  // ── Pattern 4 — voluntary pause / mild non-acute (WEAK) ────────────────────────────────────
  const pauseMemory = sameMessageHealth.find(
    (item) =>
      item.memoryType === "health_status" &&
      (item.confidence ?? 0) >= PAUSE_MEMORY_MIN_CONFIDENCE &&
      hasAny(norm(item.summaryText), SELF_PAUSE_CUES) &&
      !hasAny(norm(item.summaryText), ACUTE_ILLNESS_CUES)
  );
  if (pauseMemory) {
    return {
      suspected: true,
      pattern: "self_chosen_pause",
      tier: "weak",
      reason: "память: самовыбранная пауза / лёгкое недомогание, не острая болезнь",
      memoryItemId: pauseMemory.id,
      memoryConfidence: pauseMemory.confidence ?? null,
    };
  }

  // ── Pattern 5 — returned to training (CROSS-FACT). Reaching here means the signal is illness (not pain
  // — pattern 2 would have returned) and not a self-pause. If the same message ALSO carries a return-to-
  // training fact (in ANY memory type on this obs — e.g. an availability/schedule "готов тренироваться"
  // that the health branch ignores), the illness is likely already behind the athlete.
  //   strong  = confirmed return + NO current symptom  → autoclose-eligible (Step 2)
  //   weak    = intent only, OR return shadowed by a current symptom → mark, human confirms
  const illnessMemory = sameMessageHealth.find((item) => item.memoryType === "health_status");
  if (illnessMemory) {
    const sameMsgText = sameMessage.map((item) => norm(item.summaryText)).join(" · ");
    const hasConfirmedReturn = hasAny(sameMsgText, RETURN_CONFIRMED_CUES);
    const hasIntentReturn = hasAny(sameMsgText, RETURN_INTENT_CUES);
    const hasCurrentSymptom = hasAny(sameMsgText, CURRENT_SYMPTOM_CUES);
    if (hasConfirmedReturn || hasIntentReturn) {
      const strong = hasConfirmedReturn && !hasCurrentSymptom;
      return {
        suspected: true,
        pattern: "returned_to_training",
        tier: strong ? "strong" : "weak",
        reason: strong
          ? "память: болезнь в прошлом, ученик уже вернулся к тренировкам — возможно, сигнал устарел"
          : "память: похоже, ученик возвращается к тренировкам — проверить",
        memoryItemId: illnessMemory.id,
        memoryConfidence: illnessMemory.confidence ?? null,
      };
    }
  }

  // ── Pattern 1 — no health corroboration on the source message (WEAK, absence tier) ─────────
  // Fires only when Haiku recorded NO illness/injury fact for this exact message. Weakest signal:
  // memory can be silent for benign reasons, so this is mark-only and never auto-suppressed.
  if (sameMessageHealth.length === 0) {
    const sawOtherTopic = sameMessage.length > 0;
    return {
      suspected: true,
      pattern: "no_health_corroboration",
      tier: "weak",
      reason: sawOtherTopic
        ? "память: по этому сообщению Haiku зафиксировал не болезнь, а другую тему — проверить субъект/повод"
        : "память: нет подтверждения болезни по этому сообщению — возможно, срабатывание по слову-триггеру (проверить субъект)",
      memoryItemId: null,
      memoryConfidence: null,
    };
  }

  return null;
}
