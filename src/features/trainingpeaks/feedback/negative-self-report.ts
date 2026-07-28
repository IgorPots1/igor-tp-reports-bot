// #4 — "слова бьют цифру на сравнение". When the student's OWN account of THIS run is negative
// («тяжело», «плохо прошла», «еле добежал», «ноги тяжёлые»), the comparison slot must NOT praise them
// for a faster pace / progress — that reads tone-deaf ("ты молодец, на 20 с/км быстрее!" over "я еле
// доползла"). The pace fact is still true and still reaches the COACH (the planner routes the
// comparison to coach-only), but the student-facing «прогресс» is suppressed. This is bare hardship,
// distinct from a NAMED cause (illness/soreness/heat) which resolveStatedCause already honors.
//
// Deliberately narrow: it fires only on explicit hardship words, and a direct negation of the hardship
// («не тяжело», «неплохо») does NOT fire — so a normal, non-complaining report keeps its praise.

import type { ContextPacket, PlannerStudentMessage } from "./types.ts";

// Hardship / "this run went badly" markers. NB: JS \b is ASCII-only and does NOT work on Cyrillic, so
// «плохо» uses a negative lookbehind (not \b) to exclude «неплохо». We match the ADVERB «плохо» («плохо
// прошла») and not the stem «плох», so the adjective «плохая» (навигация/погода — not the run itself,
// «плохая» doesn't even contain «плохо») can't false-fire. «еле» needs a following space/hyphen so
// «Елена» can't match.
const NEGATIVE_RE =
  /тяжел[оаяые]|тяжко|еле[\s-]|через\s+силу|из\s+последних\s+сил|на\s+зубах|(?<!не)плохо|паршив|отвратительн|ужасн|кошмар|умир|сдох|сдул|выжат|вымотан|без\s+сил|сил\s+(?:нет|не\s+было)|нет\s+сил|никак(?:ой|ая|ущий)|развалил|мучени|мучил|страдал|тащил|пл[еёе]лся|плелась|полз|свинцов|не\s+бежал|не\s+побеж|не\s+шл[оа]|не\s+получил|не\s+дал[аои]сь|не\s+задал|колом|ног[аиуе][а-яё]*\s+(?:[а-яё]+\s+){0,2}(?:тяжёл|тяжел|налил|свинц|ватн|деревян|каменн|гуд|не\s+беж|не\s+слуш)|(?:тяжёл|тяжел|каменн|свинц|деревян)[а-яё]*\s+ног/iu;

// Direct NEGATION of the hardship ("не тяжело", "неплохо", "не плохо", "без труда") → NOT a complaint.
// Narrow on purpose: only negations of the hardship itself, so a mixed report ("темп ок, но ноги
// тяжёлые") still counts as a complaint and suppresses the pace praise.
const NEGATION_RE = /не\s+(?:очень\s+|совсем\s+|так\s+уж\s+|прям\s+|особо\s+)?тяжел|нетяжел|не\s+тяжко|не\s+сложно|без\s+труда|неплох|не\s+плох|не\s+так\s+уж\s+(?:и\s+)?(?:тяжел|плох|сложн)/iu;

/** Does any of these words carry a negative self-report about the run? Returns the offending phrase
 *  (for the coach panel) or null. Pure — the planner and the measurement share it. */
export function matchNegativeSelfReport(words: string[]): string | null {
  for (const w of words) {
    const text = (w ?? "").toLowerCase();
    if (!text) continue;
    if (NEGATIVE_RE.test(text) && !NEGATION_RE.test(text)) return w.trim().slice(0, 120);
  }
  return null;
}

// Window the student's messages to THIS run — mirror of context-packet.ts windowStudentWords: the
// trigger + same-day-onward when we know the trigger, else the −1..+2 day window with report_like
// preferred. Kept in sync by design; both windows answer "what did the student say about THIS run".
function windowRunMessages(packet: ContextPacket): string[] {
  const messages: PlannerStudentMessage[] = packet.studentMessages ?? [];
  let chosen: PlannerStudentMessage[];
  if (packet.triggerObservedAt) {
    const triggerMs = Date.parse(packet.triggerObservedAt);
    const triggerDay = packet.triggerObservedAt.slice(0, 10);
    chosen = messages.filter((m) => m.date === triggerDay && (!m.at || Date.parse(m.at) >= triggerMs - 10 * 60_000));
  } else {
    const wd = new Date(`${packet.workout.workoutDate}T00:00:00Z`).getTime();
    const inWindow = messages.filter((m) => {
      if (!m.date) return false;
      const diffDays = (new Date(`${m.date}T00:00:00Z`).getTime() - wd) / 86_400_000;
      return Number.isFinite(diffDays) && diffDays >= -1 && diffDays <= 2;
    });
    const reports = inWindow.filter((m) => m.labels.includes("report_like"));
    chosen = reports.length ? reports : inWindow;
  }
  return chosen.map((m) => m.text.trim()).filter((t) => t.length > 0 && !/^https?:\/\/\S+$/iu.test(t));
}

/** #4 entry point — did the student report THIS run as hard/bad in their own words? */
export function detectNegativeSelfReport(packet: ContextPacket): { negative: boolean; quote: string | null } {
  const quote = matchNegativeSelfReport(windowRunMessages(packet));
  return { negative: quote !== null, quote };
}
