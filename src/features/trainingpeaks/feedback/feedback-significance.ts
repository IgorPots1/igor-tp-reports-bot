// Significance of a not-yet-generated feedback job — "is there anything worth
// discussing here?" PURE, derived only from the frozen context_packet observations
// (no generation, no DB, no network). Drives two things in the on-demand model:
//   1. «Новые» queue ordering — rich-to-discuss on top, clean-and-even at the bottom,
//      so Igor's eye lands on the workouts that actually need a reply.
//   2. the "Сгенерить свежие (до N)" batch pick — take the top-N by significance,
//      NOT merely the newest, so a paid batch spends where it matters.
//
// The stored packet keeps observations as { type, adviceKey, focused, reason } (see
// context-packet.ts) — no numeric priority is persisted, so significance is recomputed
// here from type + adviceKey. That keeps it a pure function of what's already in the row.

import type { FeedbackContextPacket } from "./context-packet.ts";

export type FeedbackSignificanceBadge = "разбор" | "прогресс" | "чисто";

export type FeedbackSignificance = {
  score: number;
  badge: FeedbackSignificanceBadge;
};

type StoredObservation = { type: string; adviceKey: string; focused: boolean; reason: string };

// Weight per observation: a coach signal or a correction/question is something to SAY;
// a comparison-progress praise is worth a mention; plain praise is the floor.
function weightOf(o: StoredObservation): number {
  if (o.type === "coach_signal") return 4;
  if (o.type === "correction" || o.type === "question") return 3;
  if (o.adviceKey === "praise_comparison_progress") return 2;
  return 1; // praise / anything else
}

export function scoreFeedbackSignificance(packet: FeedbackContextPacket | undefined): FeedbackSignificance {
  const obs = Array.isArray(packet?.observations) ? (packet.observations as StoredObservation[]) : [];
  if (obs.length === 0) return { score: 0, badge: "чисто" };

  let score = 0;
  let hasDiscussion = false;
  let hasProgress = false;
  for (const o of obs) {
    // Focused observations are the drivers (full weight); a present-but-unfocused
    // signal still lifts the card above a purely clean one (half weight).
    score += o.focused ? weightOf(o) : weightOf(o) / 2;
    if (o.type === "correction" || o.type === "question" || o.type === "coach_signal") hasDiscussion = true;
    if (o.adviceKey === "praise_comparison_progress") hasProgress = true;
  }

  const badge: FeedbackSignificanceBadge = hasDiscussion ? "разбор" : hasProgress ? "прогресс" : "чисто";
  return { score, badge };
}
