// Questions are a coach TECHNIQUE, not a schedule — so the same question must not fire to the same
// student day after day while a slow-moving condition (rising volume, an elevated-pulse pattern)
// holds. Two gates, both bounded to a 14-day window so a genuinely new period still gets asked:
//   (1) PAUSE — don't repeat the SAME question to the SAME student within 14 days;
//   (2) ALREADY ANSWERED — once the coach has engaged the student (contact_status.last_coach_touch_at)
//       AFTER the last time this question was asked, the topic is being handled live; stay quiet.
//
// "Asked" is read from draft_text — every time the planner produced this question for the coach,
// whether the card was sent or dismissed. Either way, re-proposing the same question days later is
// the churn (the coach reported it firing to one student twice in a row).

import { daysBetween } from "../comparison/resolve-window.ts";

export const QUESTION_PAUSE_DAYS = 14;

// Robust per-question phrases. Matched against sent text to detect that the question went out.
const QUESTION_PHRASES: Array<{ adviceKey: string; re: RegExp }> = [
  { adviceKey: "question_accumulated_load", re: /восстанавл/iu },
  { adviceKey: "question_high_pulse_unknown", re: /выше обычного|как самочувствие|как (?:оно|всё)?\s*дал[оа]сь|тяжело (?:ли|далось)/iu },
  { adviceKey: "question_contradiction", re: /как ощущени|как (?:оно |всё )?прошл|уточни/iu },
  { adviceKey: "question_hr_sensor", re: /данные с часов|часы (?:нормально|верно|правильно|не сбой)/iu },
];

/** Which question adviceKeys does this sent draft contain? (a question the coach kept and sent). */
export function extractAskedQuestionKeys(sentText: string | null | undefined): string[] {
  if (!sentText) return [];
  return QUESTION_PHRASES.filter((q) => q.re.test(sentText)).map((q) => q.adviceKey);
}

export type AskedQuestion = { adviceKey: string; date: string };

/**
 * Should this question be held back for this student on this workout? True when the same question was
 * asked within QUESTION_PAUSE_DAYS (pause), OR the coach has touched the student since the last ask
 * and within the same window (already engaged / answered).
 */
export function isQuestionOnPause(input: {
  adviceKey: string;
  recentlyAsked: AskedQuestion[] | undefined;
  coachTouchAt: string | null | undefined;
  workoutDate: string;
}): boolean {
  const asks = (input.recentlyAsked ?? []).filter((q) => q.adviceKey === input.adviceKey && q.date.slice(0, 10) <= input.workoutDate.slice(0, 10));
  if (asks.length === 0) return false;
  const lastAsk = asks.reduce((a, b) => (a.date > b.date ? a : b)).date.slice(0, 10);

  if (daysBetween(lastAsk, input.workoutDate) < QUESTION_PAUSE_DAYS) return true; // (1) mechanical repeat

  const touch = input.coachTouchAt ? input.coachTouchAt.slice(0, 10) : null;
  if (touch && touch >= lastAsk && daysBetween(touch, input.workoutDate) < QUESTION_PAUSE_DAYS) return true; // (2) answered/engaged

  return false;
}
