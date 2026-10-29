/* Free training week for @runnigor (English, igorp.run/en/week): pure logic, no network, no DB.
 *
 * What lives here: the flag, the questions, level → plan mapping, the week (dates and sessions),
 * progression by check-ins, the user's local clock, stages, and which DM slot is due.
 * Texts are in texts.ts, workout renderings in workouts.ts, DM composition in dm.ts.
 *
 * REUSED FROM THE RUSSIAN TRIAL BOT (src/features/trial-bot/logic.ts), not copied:
 *   DAY_PATTERNS, buildWeek (incl. the 14:00 same-day rule), planNext (ladder progression with
 *   decideNextStep from the beginner methodology), weekAdvice, startRungFor, date helpers.
 * Only the clock differs: the Russian bot runs on Moscow time, this week runs on the
 * user's browser time zone (captured on submit), so the local "today" is computed here.
 * check:en-week asserts the reuse (same functions, Russian behaviour untouched). */

import { BEGINNER_LADDER, diagnosticSession } from "@/features/methodology/beginner";
import {
  DAY_PATTERNS,
  SAME_DAY_START_BEFORE,
  addDays,
  buildWeek,
  daysBetween,
  isoWeekday,
  planNext,
  weekAdvice,
  type Checkin as RuCheckin,
  type NextStepAdvice,
  type PlannedSession as RuPlanned,
} from "@/features/trial-bot/logic";

export { DAY_PATTERNS, addDays, buildWeek, daysBetween, isoWeekday };

// ── flag ─────────────────────────────────────────────────────────────────────

export function isEnWeekEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.EN_WEEK_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

// ── onboarding: mirrors Igor's "AI running coach" app ───────────────────────
//
// SOURCE: /ai-running-coach src/features/onboarding/types.ts (options, labels translated from
// Russian) and onboarding-form.tsx getStepIds (branching). The goal drives the branch:
//   start_running     → do you run now? + how far without stopping
//   return_to_running → last regular running + level back then
//   run_consistently  → (no branch questions)
//   train_for_race    → race distance + date (month is enough here) + recent result
// then days per week (getDaysPerWeekOptions, runner days capped at 4 for a free week), days,
// the training baseline (weekly km, longest run, quality experience) for every goal except
// start_running (shouldShowBaselineStep), and our own health red-flag screen.
// Dropped for a free week: race name, target result, weekday multi-select (we use day
// patterns), long-run day (always a weekend day here), injury history (the health screen
// covers "pain right now"), tracking / HR / Strava / recording questions.

export type Goal = "start_running" | "return_to_running" | "run_consistently" | "train_for_race";
export type StartNow = "never_or_almost_never" | "tried_without_regularity" | "sometimes_1_2_per_week";
export type StartLongest = "less_than_1km" | "1_to_3km" | "3_to_5km";
export type ReturnLast = "recently" | "3_to_6_months_ago" | "6_plus_months_ago";
export type ReturnLevel = "around_3km" | "around_5km" | "10km_plus";
export type WeeklyKm = "0_5" | "5_15" | "15_30" | "30_50" | "50_plus" | "unknown";
export type LongestRun = "up_to_3" | "3_5" | "5_10" | "10_15" | "15_21" | "21_plus" | "unknown";
export type Quality = "easy_only" | "sometimes" | "regularly" | "unknown";
export type RaceDist = "5k" | "10k" | "half" | "marathon";
export type Runs = 2 | 3 | 4;
export type Track = "beginner" | "runner";

type Opt<T extends string> = { code: T; label: string; sub?: string };

export const GOALS: Opt<Goal>[] = [
  { code: "start_running", label: "Start running" },
  { code: "return_to_running", label: "Come back to running" },
  { code: "run_consistently", label: "Run regularly" },
  { code: "train_for_race", label: "Train for a race" },
];
export const START_NOW: Opt<StartNow>[] = [
  { code: "never_or_almost_never", label: "I almost never run" },
  { code: "tried_without_regularity", label: "I run now and then, not regularly" },
  { code: "sometimes_1_2_per_week", label: "I run 1-2 times a week" },
];
export const START_LONGEST: Opt<StartLongest>[] = [
  { code: "less_than_1km", label: "It's still hard to run without stopping" },
  { code: "1_to_3km", label: "I can run a few kilometres", sub: "1-3 km, about 1-2 miles" },
  { code: "3_to_5km", label: "I can run 5 km or more", sub: "3+ miles" },
];
export const RETURN_LAST: Opt<ReturnLast>[] = [
  { code: "recently", label: "I had some runs in the last two months" },
  { code: "3_to_6_months_ago", label: "About 3-6 months ago" },
  { code: "6_plus_months_ago", label: "A long time ago, over 6 months" },
];
export const RETURN_LEVEL: Opt<ReturnLevel>[] = [
  { code: "around_3km", label: "Run a few kilometres" },
  { code: "around_5km", label: "Run 5 km regularly", sub: "about 3 miles" },
  { code: "10km_plus", label: "Run 10 km and more comfortably", sub: "6+ miles" },
];
export const RACE_DISTANCES: Opt<RaceDist>[] = [
  { code: "5k", label: "5K" },
  { code: "10k", label: "10K" },
  { code: "half", label: "Half marathon" },
  { code: "marathon", label: "Marathon" },
];
export const WEEKLY_KM: Opt<WeeklyKm>[] = [
  { code: "0_5", label: "0-5 km", sub: "0-3 miles" },
  { code: "5_15", label: "5-15 km", sub: "3-9 miles" },
  { code: "15_30", label: "15-30 km", sub: "9-19 miles" },
  { code: "30_50", label: "30-50 km", sub: "19-31 miles" },
  { code: "50_plus", label: "50+ km", sub: "31+ miles" },
  { code: "unknown", label: "Not sure" },
];
export const LONGEST_RUN: Opt<LongestRun>[] = [
  { code: "up_to_3", label: "Up to 3 km", sub: "up to 2 miles" },
  { code: "3_5", label: "3-5 km", sub: "2-3 miles" },
  { code: "5_10", label: "5-10 km", sub: "3-6 miles" },
  { code: "10_15", label: "10-15 km", sub: "6-9 miles" },
  { code: "15_21", label: "15-21 km", sub: "9-13 miles" },
  { code: "21_plus", label: "21+ km", sub: "13+ miles" },
  { code: "unknown", label: "Not sure" },
];
export const QUALITY: Opt<Quality>[] = [
  { code: "easy_only", label: "No, mostly easy running" },
  { code: "sometimes", label: "Sometimes" },
  { code: "regularly", label: "Yes, regularly" },
  { code: "unknown", label: "Not sure" },
];

const isIn = <T extends string>(opts: Opt<T>[], v: unknown): v is T => typeof v === "string" && opts.some((o) => o.code === v);
export const isGoal = (v: unknown): v is Goal => isIn(GOALS, v);

/** Health screen. Only the client sees which item was tapped: the server receives and stores a boolean. */
export const HEALTH_ITEMS = [
  "Heart or blood pressure issues",
  "Chest pain or dizziness during exercise",
  "Injury or pain right now",
  "Pregnancy",
] as const;
export const HEALTH_NONE_LABEL = "None of these";

/** All answers (never the health item: only health true/false travels). */
export type Answers = {
  goal: Goal;
  start_now?: StartNow | null;
  start_longest?: StartLongest | null;
  return_last?: ReturnLast | null;
  return_level?: ReturnLevel | null;
  race_distance?: RaceDist | null;
  /** "YYYY-MM" */
  race_month?: string | null;
  result_distance?: RaceDist | null;
  result_seconds?: number | null;
  weekly_km?: WeeklyKm | null;
  longest_run?: LongestRun | null;
  quality?: Quality | null;
  runs: Runs;
  pattern: string;
};

export type StepId = "goal" | "start_now" | "start_longest" | "return_last" | "return_level" | "race" | "result" | "days" | "pattern" | "baseline" | "health";

/** getStepIds of the app, minus the dropped steps, plus our health screen. */
export function stepsFor(goal: Goal | null): StepId[] {
  const out: StepId[] = ["goal"];
  if (goal === "start_running") out.push("start_now", "start_longest");
  else if (goal === "return_to_running") out.push("return_last", "return_level");
  else if (goal === "train_for_race") out.push("race", "result");
  out.push("days", "pattern");
  if (goal && goal !== "start_running") out.push("baseline");
  out.push("health");
  return out;
}

/** getDaysPerWeekOptions of the app: start 2-3, race 3-6, others 2-4; capped at 4 for a free week. */
export function daysPerWeekOptions(goal: Goal): Runs[] {
  if (goal === "train_for_race") return [3, 4];
  if (goal === "start_running") return [2, 3];
  return [2, 3, 4];
}

/** Validates a full answer set (the API's check). Returns the cleaned answers or an error code. */
export function cleanAnswers(raw: Record<string, unknown>): { ok: true; answers: Answers } | { ok: false; error: string } {
  if (!isGoal(raw.goal)) return { ok: false, error: "goal" };
  const goal = raw.goal;
  const runs = Number(raw.runs) as Runs;
  if (!daysPerWeekOptions(goal).includes(runs)) return { ok: false, error: "runs" };
  const pattern = typeof raw.pattern === "string" ? raw.pattern : "";
  if (!patternsForRuns(runs).includes(pattern)) return { ok: false, error: "pattern" };
  const a: Answers = { goal, runs, pattern };
  if (goal === "start_running") {
    if (!isIn(START_NOW, raw.start_now) || !isIn(START_LONGEST, raw.start_longest)) return { ok: false, error: "start" };
    a.start_now = raw.start_now;
    a.start_longest = raw.start_longest;
  }
  if (goal === "return_to_running") {
    if (!isIn(RETURN_LAST, raw.return_last) || !isIn(RETURN_LEVEL, raw.return_level)) return { ok: false, error: "return" };
    a.return_last = raw.return_last;
    a.return_level = raw.return_level;
  }
  if (goal === "train_for_race") {
    if (!isIn(RACE_DISTANCES, raw.race_distance)) return { ok: false, error: "race" };
    if (typeof raw.race_month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/u.test(raw.race_month)) return { ok: false, error: "race" };
    a.race_distance = raw.race_distance;
    a.race_month = raw.race_month;
    if (raw.result_distance != null && raw.result_distance !== "") {
      const sec = Number(raw.result_seconds);
      if (!isIn(RACE_DISTANCES, raw.result_distance) || !Number.isInteger(sec)) return { ok: false, error: "result" };
      const [lo, hi] = RESULT_RANGE_SEC[raw.result_distance];
      if (sec < lo || sec > hi) return { ok: false, error: "result" };
      a.result_distance = raw.result_distance;
      a.result_seconds = sec;
    }
  }
  if (goal !== "start_running") {
    if (!isIn(WEEKLY_KM, raw.weekly_km) || !isIn(LONGEST_RUN, raw.longest_run) || !isIn(QUALITY, raw.quality)) return { ok: false, error: "baseline" };
    a.weekly_km = raw.weekly_km;
    a.longest_run = raw.longest_run;
    a.quality = raw.quality;
  }
  return { ok: true, answers: a };
}

/** Sane result ranges, seconds [fastest, slowest] (also in paces.ts for the form). */
export const RESULT_RANGE_SEC: Record<RaceDist, [number, number]> = {
  "5k": [12 * 60, 60 * 60],
  "10k": [26 * 60, 2 * 3600],
  half: [58 * 60, 4 * 3600],
  marathon: [2 * 3600, 7 * 3600],
};

// ── level, segment, track ────────────────────────────────────────────────────

export type RunningLevel = "beginner" | "intermediate";
export type PlanKind = "ladder" | "return" | "regular" | "race";

/**
 * inferRunningLevel of the app (onboarding/service.ts), rule for rule:
 *   start_running → beginner;
 *   return → intermediate only when "10 km and more" AND ran recently;
 *   race → intermediate for half / marathon, or 10K with a recent result;
 * and where the app falls back to the stored profile (run_consistently, a 5K race), the
 * baseline answer stands in: 15+ km a week → intermediate.
 */
export function runningLevelFor(a: Pick<Answers, "goal" | "return_level" | "return_last" | "race_distance" | "result_distance" | "weekly_km">): RunningLevel {
  if (a.goal === "start_running") return "beginner";
  if (a.goal === "return_to_running") return a.return_level === "10km_plus" && a.return_last === "recently" ? "intermediate" : "beginner";
  if (a.goal === "train_for_race" && (a.race_distance === "half" || a.race_distance === "marathon" || (a.race_distance === "10k" && !!a.result_distance))) {
    return "intermediate";
  }
  return a.weekly_km === "15_30" || a.weekly_km === "30_50" || a.weekly_km === "50_plus" ? "intermediate" : "beginner";
}

/**
 * resolveMethodologySegment of the app (plans/methodology.ts) → the kind of week:
 *   train_for_race → race week; start_running → true-beginner ladder; return_to_running →
 *   return week; run_consistently → regular week.
 */
export function planKindFor(goal: Goal): PlanKind {
  if (goal === "train_for_race") return "race";
  if (goal === "start_running") return "ladder";
  if (goal === "return_to_running") return "return";
  return "regular";
}

/** Tone of texts: a race goal or an intermediate runner → the runner track; everyone else → gentle. */
export function trackFor(a: Parameters<typeof runningLevelFor>[0]): Track {
  return a.goal === "train_for_race" || runningLevelFor(a) === "intermediate" ? "runner" : "beginner";
}

/**
 * Start rung of the ladder from the app's continuous-run capability
 * (plans/service.ts getMethodologyContinuousRunCapability + methodology getTrueBeginnerDiagnosticWorkout,
 * here: diagnosticSession in src/features/methodology/beginner.ts):
 *   "still hard to run without stopping" → cannot run continuously → run/walk 5 x (4 + 2), rung 1;
 *   "a few km" / "5 km or more"          → can                    → 25 min continuous, rung 6.
 */
export function startRungFor(longest: StartLongest | null | undefined): number {
  return BEGINNER_LADDER.find((s) => s.presetCode === diagnosticSession(longest !== "less_than_1km").presetCode)!.index;
}

const WD_EN = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * DAY PATTERNS. 2 and 3 days: the Russian bot's DAY_PATTERNS as they are. 4 days, in the same
 * spirit: a weekend day for the long run, no three days in a row:
 *   r4a Tue Thu Sat Sun, r4b Mon Wed Fri Sun, r4c Tue Wed Fri Sun.
 */
export const EN_PATTERNS: Record<string, { runs: Runs; days: number[] }> = {
  ...Object.fromEntries(Object.entries(DAY_PATTERNS).map(([k, v]) => [k, { runs: v.runs as Runs, days: v.days }])),
  r4a: { runs: 4, days: [2, 4, 6, 7] },
  r4b: { runs: 4, days: [1, 3, 5, 7] },
  r4c: { runs: 4, days: [2, 3, 5, 7] },
};

/** "Mon, Wed, Sat" */
export function patternLabelEn(code: string): string {
  const p = EN_PATTERNS[code];
  return p ? p.days.map((d) => WD_EN[d]).join(", ") : "";
}

export function patternsForRuns(runs: Runs): string[] {
  return Object.keys(EN_PATTERNS).filter((k) => EN_PATTERNS[k].runs === runs);
}

/** "Tue 3 Nov" */
export function dayLabelEn(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WD_EN[isoWeekday(date)]} ${d.getUTCDate()} ${MONTH_EN[d.getUTCMonth()]}`;
}

/** "Dec 2026" from "2026-12". */
export function monthLabelEn(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_EN[m - 1]} ${y}`;
}

/**
 * THE WEEK'S DATES. For 2 and 3 days exactly the Russian buildWeek (check:en-week compares them
 * on every pattern and start day). One rule added, needed only by the 4-day patterns: the week
 * starts on a pattern day that FOLLOWS A REST DAY. Four days out of seven always contain two in a
 * row, and starting on the second of them would put a workout on day 7, where the summary goes.
 * In 2- and 3-day patterns no two days are adjacent, so the rule never changes their start.
 */
export function buildWeekEn(today: string, code: string, nowMinutes: number = 24 * 60): { weekStart: string; dates: string[]; startsToday: boolean } | null {
  const p = EN_PATTERNS[code];
  if (!p) return null;
  const isDay = (d: string) => p.days.includes(isoWeekday(d));
  const canStart = (d: string) => isDay(d) && !isDay(addDays(d, -1));
  const startsToday = canStart(today) && nowMinutes < SAME_DAY_START_BEFORE;
  let start = startsToday ? today : addDays(today, 1);
  while (!canStart(start)) start = addDays(start, 1);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    if (isDay(d)) dates.push(d);
  }
  return { weekStart: start, dates, startsToday };
}

// ── the runner-type week (return / regular / race) ───────────────────────────

export type IntervalPreset = "int_walk_3x3" | "int_walk_4x3" | "int_walk_5x3";
export type RunnerPreset = "test_run" | "easy_continuous" | "easy_plus_strides" | "long_aerobic" | "recovery_easy" | IntervalPreset;

export type EnPlanned =
  | { kind: "rung"; rung: number }
  | { kind: "walk" }
  | { kind: "runner"; preset: RunnerPreset; minutes: number; range?: [number, number] };

/** Fixed at creation: which preset on which session and how long, plus the test-run band. */
export type RunnerWeek = { base: RunnerPreset[]; minutes: Record<RunnerPreset, number>; band: SelfReportBand };

export type Profile = { planKind: PlanKind; startRung: number | null; runs: Runs; runner?: RunnerWeek };

/**
 * INTERVALS: only the int_walk_* family qualifies for a stranger (not coach_only, no explicit
 * VO2, athlete_level_min L0, coach_review_required = false by Igor's decision 18.09.2026,
 * migration 20260918_short_interval_presets.sql; RPE 6 / cap 7, recovery by WALKING). The
 * library's jog-recovery intervals (thr_*, vo2_*) are all coach-review or coach-only, so they
 * stay out. Which one: by goal, capped by weekly volume:
 *   race 5K / 10K → 5x3; half / marathon and the regular week → 4x3;
 *   weekly 15-30 km → at most 4x3; under 15 km or "not sure" → 3x3.
 */
export const INTERVAL_PRESETS: IntervalPreset[] = ["int_walk_3x3", "int_walk_4x3", "int_walk_5x3"];

export function intervalFor(kind: PlanKind, race: RaceDist | null | undefined, weekly: WeeklyKm | null | undefined): IntervalPreset {
  const byGoal = kind === "race" && (race === "5k" || race === "10k") ? 2 : 1;
  const cap = weekly === "30_50" || weekly === "50_plus" ? 2 : weekly === "15_30" ? 1 : 0;
  return INTERVAL_PRESETS[Math.min(byGoal, cap)];
}

export function isInterval(p: RunnerPreset): p is IntervalPreset {
  return (INTERVAL_PRESETS as string[]).includes(p);
}

/**
 * WHICH SESSION IS WHAT, by the app's segment rules (plans/methodology.ts) and the real dates:
 *   race    → long run on the last weekend day, one int_walk session (never within a day of the
 *             long run), the rest easy; 5K / 10K race → the first easy run gets strides;
 *   regular → RUN_REGULARLY_SEGMENT: 2 runs = easy + longer easy; 3 = max one soft quality;
 *             4 = 1 quality + 1 long easy + easy. Soft quality = int_walk if the person already
 *             does quality "sometimes" / "regularly", else easy + strides;
 *   return  → RETURN_TO_RUNNING_SEGMENT: the first session is the control "test run"
 *             (diagnostic_control_easy_run_first), then easy return runs; no quality at all
 *             ("no hard sessions before feedback on the control run"); with 3+ runs the weekend
 *             one is a short long easy run.
 */
export function runnerBaseFor(kind: Exclude<PlanKind, "ladder">, a: Pick<Answers, "race_distance" | "weekly_km" | "quality">, dates: string[]): RunnerPreset[] {
  const n = dates.length;
  const weekend = dates.map((d, i) => (isoWeekday(d) >= 6 ? i : -1)).filter((i) => i >= 0);
  const longIdx = weekend.length ? weekend[weekend.length - 1] : n - 1;
  if (kind === "return") {
    return dates.map((_, i) => (i === 0 ? "test_run" : n >= 3 && i === longIdx ? "long_aerobic" : "easy_continuous"));
  }
  const order = [1, 0, ...Array.from({ length: n }, (_, i) => i).filter((i) => i > 1)];
  const hasQuality = n >= 3;
  const intIdx = hasQuality
    ? order.find((i) => i < n && i !== longIdx && Math.abs(daysBetween(dates[i], dates[longIdx])) >= 2) ?? order.find((i) => i < n && i !== longIdx)!
    : -1;
  const softIsIntervals = kind === "race" || a.quality === "sometimes" || a.quality === "regularly";
  const quality: RunnerPreset = softIsIntervals ? intervalFor(kind, a.race_distance, a.weekly_km) : "easy_plus_strides";
  const stridesOnEasy = kind === "race" && (a.race_distance === "5k" || a.race_distance === "10k");
  let stridesGiven = false;
  return dates.map((_, i) => {
    if (i === longIdx) return "long_aerobic";
    if (i === intIdx) return quality;
    if (stridesOnEasy && !stridesGiven) {
      stridesGiven = true;
      return "easy_plus_strides";
    }
    return "easy_continuous";
  });
}

/**
 * SELF-REPORT BAND: toSelfReportMinutesRange of the app (plans/training-baseline-gate.ts),
 * ported. How long an easy / test run should be from what the person told us:
 *   quality experience, or 35+ km           → 45-70 min ("45-70 min easy");
 *   15-30 or 30-50 km                       → 35-60 min;
 *   5-15 km, or any longest-run answer      → 20-50 min by feel;
 *   nothing                                 → 20-40 min by feel.
 * Default = the middle rounded to 5 min (getRoundedRangeDefaultDuration).
 * (The app's injury-caution branch is not needed: pain right now stops at the health screen.)
 */
export type SelfReportBand = { min: number; max: number; def: number; byFeel: boolean };

export function selfReportBand(a: Pick<Answers, "weekly_km" | "longest_run" | "quality">): SelfReportBand {
  const band = (min: number, max: number, byFeel: boolean): SelfReportBand => ({ min, max, def: Math.round((min + max) / 2 / 5) * 5, byFeel });
  if (a.quality === "sometimes" || a.quality === "regularly" || a.weekly_km === "50_plus") return band(45, 70, false);
  if (a.weekly_km === "15_30" || a.weekly_km === "30_50") return band(35, 60, false);
  if (a.weekly_km === "5_15" || (a.longest_run && a.longest_run !== "unknown")) return band(20, 50, true);
  return band(20, 40, true);
}

/**
 * DURATIONS: the free week is about the person's current week, not more.
 *   week km      = a value below the middle of the bucket: 0-5 → 4, 5-15 → 10, 15-30 → 22,
 *                  30-50 → 40, 50+ → 55, not sure → 12;
 *   week minutes = km x the middle of the easy pace band (or 6:30/km with no result);
 *   long run     = 28% of the week (the asked 25-30%), rounded to 5, at least an easy run + 5,
 *                  at most 90 min and at most the person's longest run (its upper km at easy
 *                  pace); in the return week at most an easy run + 10 ("short long easy run");
 *   quality      = the library session as it is;
 *   easy runs    = what is left, split evenly, rounded DOWN to 5, at most the self-report band's
 *                  top (selfReportBand: the app sizes ONE diagnostic run with it, so its floor is not
 *                  applied to every easy run of a week), inside 30..70 (easy_continuous advisory
 *                  band); in the return week from 20 (the recovery_easy band, by feel);
 *                  strides at least 30 (its advisory band starts at 30);
 *   test run     = the band's default (the app's diagnostic_prescription.default_duration_minutes);
 *   recovery run = 25 (recovery_easy band 20-35).
 * Floors win over the volume: a very small week can come out a little above the stated km.
 */
export const WEEK_KM: Record<WeeklyKm, number> = { "0_5": 4, "5_15": 10, "15_30": 22, "30_50": 40, "50_plus": 55, unknown: 12 };
export const LONGEST_UPPER_KM: Partial<Record<LongestRun, number>> = { up_to_3: 3, "3_5": 5, "5_10": 10, "10_15": 15, "15_21": 21 };
export const LONG_SHARE = 0.28;
export const LONG_MAX = 90;
export const EASY_FLOOR = 30;
export const EASY_CEIL = 70;
/** Return week: easy return runs may be as short as the recovery_easy band (20-35), by feel. */
export const RETURN_EASY_FLOOR = 20;
export const STRIDES_MIN = 30;
export const STRIDES_MAX = 55;
export const RECOVERY_MINUTES = 25;

const round5 = (x: number) => Math.round(x / 5) * 5;
const floor5 = (x: number) => Math.floor(x / 5) * 5;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export function runnerWeek(
  kind: Exclude<PlanKind, "ladder">,
  a: Pick<Answers, "race_distance" | "weekly_km" | "longest_run" | "quality">,
  dates: string[],
  easySecPerKm: number,
  intervalMinutes: (p: IntervalPreset) => number,
): RunnerWeek {
  const base = runnerBaseFor(kind, a, dates);
  const band = selfReportBand(a);
  const weekMin = (WEEK_KM[a.weekly_km ?? "unknown"] * easySecPerKm) / 60;
  const quality = base.find((p) => isInterval(p));
  const qMin = quality ? intervalMinutes(quality) : 0;
  const testMin = base.includes("test_run") ? band.def : 0;
  const long0 = round5(LONG_SHARE * weekMin);
  const nEasy = base.filter((p) => p === "easy_continuous" || p === "easy_plus_strides").length;
  const easyLo = kind === "return" ? RETURN_EASY_FLOOR : EASY_FLOOR;
  const easyHi = Math.min(EASY_CEIL, band.max);
  let easy = nEasy ? clamp(floor5((weekMin - long0 - qMin - testMin) / nEasy), easyLo, easyHi) : clamp(band.def, easyLo, easyHi);
  // The long run must stay longer than an easy run: when 28% is not enough, the easy runs and
  // the long run share what is left (long = easy + 5), still inside the week.
  if (nEasy && long0 < easy + 5) easy = clamp(floor5((weekMin - qMin - testMin - 5) / (nEasy + 1)), easyLo, easyHi);
  const upper = a.longest_run ? LONGEST_UPPER_KM[a.longest_run] : undefined;
  let longCap = upper ? round5((upper * easySecPerKm) / 60) : LONG_MAX;
  if (kind === "return") longCap = Math.min(longCap, easy + 10);
  // The person's longest run caps the long run, and easy runs stay below it.
  if (longCap < easy + 5) easy = Math.max(easyLo, floor5(longCap - 5));
  const long = Math.max(easy + 5, Math.min(long0, LONG_MAX, longCap));
  const minutes: Record<RunnerPreset, number> = {
    test_run: band.def,
    easy_continuous: easy,
    easy_plus_strides: clamp(easy, STRIDES_MIN, STRIDES_MAX),
    long_aerobic: long,
    recovery_easy: RECOVERY_MINUTES,
    int_walk_3x3: intervalMinutes("int_walk_3x3"),
    int_walk_4x3: intervalMinutes("int_walk_4x3"),
    int_walk_5x3: intervalMinutes("int_walk_5x3"),
  };
  return { base, minutes, band };
}

export function profileFor(a: Pick<Answers, "goal" | "start_longest" | "runs">, runner?: RunnerWeek): Profile {
  const kind = planKindFor(a.goal);
  if (kind === "ladder") return { planKind: "ladder", startRung: startRungFor(a.start_longest), runs: a.runs };
  return { planKind: kind, startRung: null, runs: a.runs, runner };
}

/** Next race within 8 weeks of the week start (by month: any day of that month counts). */
export function raceSoon(weekStart: string, month: string | null | undefined): boolean {
  if (!month || !/^\d{4}-\d{2}$/u.test(month)) return false;
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const last = addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
  return last >= weekStart && first <= addDays(weekStart, 56);
}

// ── check-ins and progression ────────────────────────────────────────────────

export type CheckinValue = "easy" | "ok" | "hard" | "skipped" | "pain";
export const CHECKIN_VALUES: CheckinValue[] = ["easy", "ok", "hard", "skipped", "pain"];

export function isCheckinValue(v: unknown): v is CheckinValue {
  return typeof v === "string" && (CHECKIN_VALUES as string[]).includes(v);
}

/** "Skipped" is the Russian "Не получилось" (miss): changes nothing. */
export function toRuCheckin(v: CheckinValue | null): RuCheckin | null {
  if (v === null) return null;
  return v === "skipped" ? "miss" : v;
}

function toRuPlanned(p: EnPlanned): RuPlanned {
  if (p.kind === "walk") return { kind: "walk" };
  if (p.kind === "rung") return { kind: "rung", rung: p.rung };
  throw new Error("runner session in a ladder history");
}

/**
 * THE WEEK'S SESSIONS from the check-ins so far. Deterministic: session i depends only on
 * the profile and the check-ins of sessions before it (null = not checked in yet).
 *
 * Ladder: the Russian planNext, rule for rule: two Easy/OK in a row on a rung → next rung
 *   (decideNextStep, MIN_SESSIONS_PER_STEP); Hard → one rung down at once; Something hurt →
 *   the next session becomes a 30 min brisk walk, rung unchanged; Skipped / silence → nothing.
 * Runner: no rungs. Something hurt → next is the brisk walk; Hard → next is recovery_easy
 *   (the library's step-down run), also when the next one was the interval session; after
 *   either, back to the planned session. Easy / OK keep the plan as it is: a free week does
 *   not add volume.
 */
export function planSessions(profile: Profile, checkins: Array<CheckinValue | null>, count: number): EnPlanned[] {
  const out: EnPlanned[] = [];
  const rw = profile.runner;
  if (profile.planKind !== "ladder" && !rw) throw new Error("runner-type profile without its week");
  for (let i = 0; i < count; i++) {
    if (profile.planKind === "ladder") {
      const history = out.map((p, j) => ({ planned: toRuPlanned(p), checkin: toRuCheckin(checkins[j] ?? null) }));
      const next = planNext(profile.startRung ?? 1, history);
      out.push(next.kind === "walk" ? { kind: "walk" } : { kind: "rung", rung: next.rung });
      continue;
    }
    const prev = i > 0 ? { planned: out[i - 1], checkin: checkins[i - 1] ?? null } : null;
    const planned = rw!.base[i] ?? rw!.base[rw!.base.length - 1];
    if (prev?.checkin === "pain") out.push({ kind: "walk" });
    else if (prev?.checkin === "hard" && prev.planned.kind !== "walk") out.push({ kind: "runner", preset: "recovery_easy", minutes: rw!.minutes.recovery_easy });
    else if (planned === "test_run") out.push({ kind: "runner", preset: planned, minutes: rw!.minutes.test_run, range: [rw!.band.min, rw!.band.max] });
    else out.push({ kind: "runner", preset: planned, minutes: rw!.minutes[planned] });
  }
  return out;
}

export type SummaryAdvice = NextStepAdvice | { kind: "runner_keep" } | { kind: "runner_careful" };

/** Advice for next week: ladder → the Russian weekAdvice; runner → keep the structure, or careful after pain. */
export function summaryAdvice(profile: Profile, planned: EnPlanned[], checkins: Array<CheckinValue | null>): SummaryAdvice {
  if (profile.planKind !== "ladder") {
    return checkins.some((c) => c === "pain") ? { kind: "runner_careful" } : { kind: "runner_keep" };
  }
  const history = planned.map((p, j) => ({ planned: toRuPlanned(p), checkin: toRuCheckin(checkins[j] ?? null) }));
  return weekAdvice(profile.startRung ?? 1, history);
}

// ── the user's clock ─────────────────────────────────────────────────────────

/** A valid IANA zone or "UTC". Browsers send e.g. "Europe/London"; anything unknown falls back. */
export function safeTz(tz: unknown): string {
  if (typeof tz !== "string" || !tz.trim() || tz.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz.trim() }).format(new Date(0));
    return tz.trim();
  } catch {
    return "UTC";
  }
}

export type LocalNow = { date: string; minutes: number };

export function localNow(now: Date, tz: string): LocalNow {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: safeTz(tz),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** Local date of an ISO timestamp in the user's zone. */
export function localDateOf(iso: string, tz: string): string {
  return localNow(new Date(iso), tz).date;
}

/** Day of the week: 1 = day of the first workout, 7 = last day. */
export function weekDay(weekStart: string, today: string): number {
  return daysBetween(weekStart, today) + 1;
}

// ── stages ───────────────────────────────────────────────────────────────────

export type Stage = "no_plan" | "health_stop" | "before_start" | "week" | "post" | "done";

/** Day 8 brings one follow-up, day 10 the last message; after that the week is done. */
export const FOLLOWUP_DAY = 8;
export const FINAL_DAY = 10;

export function stageOf(user: { health_flag: boolean; week_start: string | null } | null, today: string): Stage {
  if (!user) return "no_plan";
  if (user.health_flag) return "health_stop";
  if (!user.week_start) return "no_plan";
  const day = weekDay(user.week_start, today);
  if (day < 1) return "before_start";
  if (day <= 7) return "week";
  if (day <= FINAL_DAY) return "post";
  return "done";
}

// ── which session a check-in belongs to ──────────────────────────────────────

export type SessionLite = { idx: number; date: string; checkin: CheckinValue | null; checkin_at?: string | null };

/** A session can be checked in once its day has come, and changed only while no later session is checked in. */
export function canCheckin(sessions: SessionLite[], idx: number, today: string): boolean {
  const s = sessions.find((x) => x.idx === idx);
  if (!s || s.date > today) return false;
  return !sessions.some((x) => x.idx > idx && x.checkin !== null);
}

/**
 * DM check-in (no idx from ChatPlace): today's session if there is one, else the most recent
 * past session still without a check-in. null: nothing to check in.
 */
export function checkinTarget(sessions: SessionLite[], today: string): number | null {
  const todays = sessions.find((s) => s.date === today);
  if (todays && canCheckin(sessions, todays.idx, today)) return todays.idx;
  const open = sessions
    .filter((s) => s.date < today && s.checkin === null && canCheckin(sessions, s.idx, today))
    .sort((a, b) => b.idx - a.idx);
  return open[0]?.idx ?? null;
}

// ── offer and cases ──────────────────────────────────────────────────────────

/** Offer after the second check-in (any value), or from day 5 if fewer; not after day 6 (day 7 is the summary). */
export const OFFER_FALLBACK_DAY = 5;
export const OFFER_LAST_DAY = 6;

export function offerDue(weekStart: string, today: string, sessions: SessionLite[]): boolean {
  const day = weekDay(weekStart, today);
  if (day < 1 || day > OFFER_LAST_DAY) return false;
  return sessions.filter((s) => s.checkin !== null).length >= 2 || day >= OFFER_FALLBACK_DAY;
}

/** The plan page shows the offer block from the second check-in, and on day 7 and later. */
export function pageOfferVisible(weekStart: string, today: string, sessions: SessionLite[]): boolean {
  return sessions.filter((s) => s.checkin !== null).length >= 2 || weekDay(weekStart, today) >= 7;
}

/**
 * Case: Marina only (the Russian bot's, translated, same photo) from day 2 (DM: once, riding on
 * a rest-day or "logged" message). Anna, Nadya and Sasha are not used in English [Igor, 28.10.2026].
 * The plan page shows each from the same day.
 */
export const CASE1_DAY = 2;

// ── DM slots ─────────────────────────────────────────────────────────────────

export type Slot = "morning" | "midday" | "evening";
export const SLOTS: Slot[] = ["morning", "midday", "evening"];

/**
 * SLOT WINDOWS, user's local time, [from, to) in minutes. ChatPlace polls GET /today every
 * 2 hours (docs/specs/en-week-chatplace.md), so each 3-hour window is hit at least once.
 */
export const SLOT_WINDOWS: Record<Slot, readonly [number, number]> = {
  morning: [7 * 60, 10 * 60],
  midday: [12 * 60, 15 * 60],
  evening: [18 * 60, 21 * 60],
};
export const POLL_EVERY_MIN = 120;

export function slotAt(minutes: number): Slot | null {
  for (const s of SLOTS) {
    const [a, b] = SLOT_WINDOWS[s];
    if (minutes >= a && minutes < b) return s;
  }
  return null;
}

export function isSlot(v: unknown): v is Slot {
  return typeof v === "string" && (SLOTS as string[]).includes(v);
}

/**
 * WHICH SLOTS SEND, per day. The Instagram 24h window closes 24 hours after the person's last
 * message, so a message that asks for a tap must go out at least every ~20 hours:
 *   workout day: morning (the workout) + evening (check-in, or "logged" + what's next);
 *   any other day of the week (rest, before the start): midday + evening.
 * Worst gap with 2-hour polling: evening 18:00 → next midday by 14:00 = 20 h (check:en-week
 * walks every day pattern and asserts it). Post-week (days 8-10): midday only, on days 8 and 10.
 */
export function slotsForDay(stage: Stage, day: number, isWorkoutDay: boolean): Slot[] {
  if (stage === "before_start") return ["midday", "evening"];
  if (stage === "week") return isWorkoutDay ? ["morning", "evening"] : ["midday", "evening"];
  if (stage === "post") return day === FOLLOWUP_DAY || day === FINAL_DAY ? ["midday"] : [];
  return [];
}
