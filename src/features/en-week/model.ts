/* Rows of the free week and pure operations on them: building the week, re-planning after a
 * check-in, the plan page view. No network, no DB: service.ts loads and saves, this decides. */

import { SITE_URL } from "@/lib/site";

import {
  CASE1_DAY,
  addDays,
  buildWeekEn,
  canCheckin,
  dayLabelEn,
  localNow,
  pageOfferVisible,
  patternLabelEn,
  planSessions,
  profileFor,
  raceSoon,
  runnerWeek,
  stageOf,
  summaryAdvice,
  weekDay,
  type CheckinValue,
  type EnPlanned,
  type Answers,
  type Goal,
  type LongestRun,
  type PlanKind,
  type Profile,
  type Quality,
  type ReturnLast,
  type ReturnLevel,
  type RunnerPreset,
  type RunningLevel,
  type Runs,
  type Stage,
  type StartLongest,
  type StartNow,
  type Track,
  type WeeklyKm,
  WEEKLY_KM,
  monthLabelEn,
  planKindFor,
} from "./logic";
import { RACE_LABELS, easyMidSecPerKm, formatDuration, paceRangeText, pacesFromResult, type Paces, type RaceDistance } from "./paces";
import { CASE_MARINA, GOAL_LINES, runnerGoalLine, summaryText, type CaseStory, type RaceNote } from "./texts";
import type { ScreenshotView } from "./screenshots";
import { intervalMinutes, workoutFor, type WorkoutEn } from "./workouts";

export type EnWeekUser = {
  id: string;
  token: string;
  chatplace_client_id: string | null;
  ig_username: string | null;
  goal: Goal;
  runs: Runs;
  /** Branch answers (null where the branch was not asked). */
  start_now: StartNow | null;
  start_longest: StartLongest | null;
  return_last: ReturnLast | null;
  return_level: ReturnLevel | null;
  /** Training baseline (all goals except start_running). */
  weekly_volume: WeeklyKm | null;
  longest_run: LongestRun | null;
  quality_experience: Quality | null;
  /** Race goal: best recent result and the next race. */
  best_distance: RaceDistance | null;
  best_seconds: number | null;
  next_race_distance: RaceDistance | null;
  /** "YYYY-MM" */
  next_race_month: string | null;
  running_level: RunningLevel;
  track: Track;
  days_pattern: string | null;
  tz: string;
  country: string | null;
  health_flag: boolean;
  plan_kind: PlanKind | null;
  start_rung: number | null;
  week_start: string | null;
  stage: Stage;
  created_at: string;
  offer_shown_at: string | null;
  offer_dm_at: string | null;
  case1_dm_at: string | null;
  summary_dm_at: string | null;
  summary_viewed_at: string | null;
  followup_dm_at: string | null;
  final_dm_at: string | null;
  cta_clicked_at: string | null;
  last_checkin_at: string | null;
};

/** The stored row back as answers (same shape the form sends). */
export function answersOf(u: EnWeekUser): Answers {
  return {
    goal: u.goal,
    runs: u.runs,
    pattern: u.days_pattern ?? "",
    start_now: u.start_now,
    start_longest: u.start_longest,
    return_last: u.return_last,
    return_level: u.return_level,
    race_distance: u.next_race_distance,
    race_month: u.next_race_month,
    result_distance: u.best_distance,
    result_seconds: u.best_seconds,
    weekly_km: u.weekly_volume,
    longest_run: u.longest_run,
    quality: u.quality_experience,
  };
}

/** Next race for texts: null when none was given. */
export function raceNote(u: Pick<EnWeekUser, "next_race_distance" | "next_race_month" | "week_start">): RaceNote | null {
  if (!u.next_race_distance || !u.next_race_month) return null;
  return {
    label: RACE_LABELS[u.next_race_distance],
    month: monthLabelEn(u.next_race_month),
    soon: !!u.week_start && raceSoon(u.week_start, u.next_race_month),
  };
}

export function runnerFacts(u: EnWeekUser, paces: Paces | null): string[] {
  const out: string[] = [];
  if (u.weekly_volume) out.push(`Your week now: ${WEEKLY_KM.find((w) => w.code === u.weekly_volume)?.label ?? ""}`);
  if (u.best_distance && u.best_seconds) out.push(`Best recent ${RACE_LABELS[u.best_distance]}: ${formatDuration(u.best_seconds)}`);
  if (paces) {
    out.push(`Easy pace: ${paceRangeText(paces.easy)}`);
    out.push(`Interval pace (effort 6): ${paceRangeText(paces.tempo)}`);
  } else if (u.goal === "train_for_race") {
    out.push("No race result yet, so this week runs on effort, not pace.");
  }
  const race = raceNote(u);
  if (race) out.push(`Next race: ${race.label}, ${race.month}`);
  return out;
}

export type SessionKind = "rung" | "walk" | "runner";

export type EnWeekSession = {
  idx: number;
  date: string;
  kind: SessionKind;
  preset_code: string;
  rung: number | null;
  title: string;
  body_en: string;
  minutes: number;
  checkin: CheckinValue | null;
  checkin_at: string | null;
};

/** Paces from the best result, or null (effort only). */
export function pacesOf(a: Pick<Answers, "result_distance" | "result_seconds">): Paces | null {
  return a.result_distance && a.result_seconds ? pacesFromResult(a.result_distance, a.result_seconds) : null;
}

/** Everything a session needs to be rendered: the profile (incl. the runner-type week) and the paces. */
export type WeekCtx = { profile: Profile; paces: Paces | null };

/**
 * Deterministic from what is stored: runner-type weeks are rebuilt from the stored answers and
 * the session dates, so a re-plan after a check-in gives the same presets and minutes.
 */
export function ctxOf(a: Answers, dates: string[]): WeekCtx {
  const kind = planKindFor(a.goal);
  if (kind === "ladder") return { profile: profileFor(a), paces: null };
  const paces = pacesOf(a);
  const rw = runnerWeek(kind, a, dates, easyMidSecPerKm(paces), intervalMinutes);
  return { profile: profileFor(a, rw), paces };
}

function plannedOf(s: EnWeekSession, ctx: WeekCtx | null = null): EnPlanned {
  if (s.kind === "walk") return { kind: "walk" };
  if (s.kind === "rung") return { kind: "rung", rung: s.rung ?? 1 };
  const band = ctx?.profile.runner?.band;
  return { kind: "runner", preset: s.preset_code as RunnerPreset, minutes: s.minutes, range: band ? [band.min, band.max] : undefined };
}

export function sessionRow(
  idx: number,
  date: string,
  p: EnPlanned,
  paces: Paces | null = null,
  keep?: Pick<EnWeekSession, "checkin" | "checkin_at">,
): EnWeekSession {
  const w = workoutFor(p, paces);
  return {
    idx,
    date,
    kind: p.kind,
    preset_code: w.presetCode,
    rung: p.kind === "rung" ? p.rung : null,
    title: w.title,
    body_en: w.body,
    minutes: w.minutes,
    checkin: keep?.checkin ?? null,
    checkin_at: keep?.checkin_at ?? null,
  };
}

export function workoutOf(s: EnWeekSession, ctx: WeekCtx | null = null): WorkoutEn {
  return workoutFor(plannedOf(s, ctx), ctx?.paces ?? null);
}

/** The context of a stored user and their sessions. */
export function userCtx(u: EnWeekUser, sessions: EnWeekSession[]): WeekCtx {
  return ctxOf(answersOf(u), datesOf(sessions));
}

/** The week at creation: dates from buildWeekEn in the user's local clock, sessions from planSessions. */
export function newWeek(
  input: Answers,
  pattern: string,
  now: Date,
  tz: string,
): { weekStart: string; sessions: EnWeekSession[]; startsToday: boolean; ctx: WeekCtx } | null {
  const local = localNow(now, tz);
  const wk = buildWeekEn(local.date, pattern, local.minutes);
  if (!wk) return null;
  const ctx = ctxOf(input, wk.dates);
  const planned = planSessions(ctx.profile, wk.dates.map(() => null), wk.dates.length);
  return { weekStart: wk.weekStart, startsToday: wk.startsToday, ctx, sessions: wk.dates.map((d, i) => sessionRow(i + 1, d, planned[i], ctx.paces)) };
}

/**
 * Re-plan after check-ins: sessions with a check-in stay as they were (they were done as
 * planned), sessions without one get what planSessions says now.
 */
export function replan(ctx: WeekCtx, sessions: EnWeekSession[]): EnWeekSession[] {
  const sorted = [...sessions].sort((a, b) => a.idx - b.idx);
  const planned = planSessions(ctx.profile, sorted.map((s) => s.checkin), sorted.length);
  return sorted.map((s, i) => (s.checkin !== null ? s : sessionRow(s.idx, s.date, planned[i], ctx.paces)));
}

/** Records a check-in and re-plans. null when this session can't take a check-in now. */
export function withCheckin(
  ctx: WeekCtx,
  sessions: EnWeekSession[],
  idx: number,
  value: CheckinValue,
  nowIso: string,
  today: string,
): EnWeekSession[] | null {
  if (!canCheckin(sessions, idx, today)) return null;
  const marked = sessions.map((s) => (s.idx === idx ? { ...s, checkin: value, checkin_at: s.checkin === value && s.checkin_at ? s.checkin_at : nowIso } : s));
  return replan(ctx, marked);
}

export function datesOf(sessions: EnWeekSession[]): string[] {
  return [...sessions].sort((a, b) => a.idx - b.idx).map((s) => s.date);
}

export function nextSessionAfter(sessions: EnWeekSession[], idx: number): EnWeekSession | null {
  return [...sessions].sort((a, b) => a.idx - b.idx).find((s) => s.idx > idx) ?? null;
}

/** First session on or after this date without a check-in. */
export function upcoming(sessions: EnWeekSession[], fromDate: string): EnWeekSession | null {
  return [...sessions].sort((a, b) => a.idx - b.idx).find((s) => s.date >= fromDate && s.checkin === null) ?? null;
}

/** "on Sun 8 Nov": when the day-7 summary comes. */
export function summaryDayLabel(weekStart: string): string {
  return `on ${dayLabelEn(addDays(weekStart, 6))}`;
}

export function planUrl(token: string): string {
  return `${SITE_URL}/en/week/p/${token}`;
}

export function entryUrl(clientId: string | null): string {
  return `${SITE_URL}/en/week${clientId ? `?c=${encodeURIComponent(clientId)}` : ""}`;
}

/** CTA through our own route: marks cta_clicked_at for this user, then /go/consult (tool en-week). */
export function ctaUrl(token: string, place: "offer" | "summary" | "followup", track: Track = "beginner"): string {
  return `${SITE_URL}/en/week/go?t=${token}&p=${place}${track === "runner" ? "&k=r" : ""}`;
}

export function weekSummary(u: EnWeekUser, sessions: EnWeekSession[]): string {
  const { profile } = ctxOf(answersOf(u), datesOf(sessions));
  const sorted = [...sessions].sort((a, b) => a.idx - b.idx);
  const done = sorted.filter((s) => s.checkin !== null && s.checkin !== "skipped");
  const walks = done.filter((s) => s.kind === "walk").length;
  const runs = done.length - walks;
  const counts: Partial<Record<"easy" | "ok" | "hard" | "pain", number>> = {};
  for (const s of done) {
    const c = s.checkin as "easy" | "ok" | "hard" | "pain";
    counts[c] = (counts[c] ?? 0) + 1;
  }
  const planned = sorted.map((s) => plannedOf(s));
  const advice = summaryAdvice(profile, planned, sorted.map((s) => s.checkin));
  // The title the advice talks about: the ladder rung from weekAdvice; with nothing done, the first session again.
  let nextTitle = workoutFor(planSessions(profile, [], 1)[0]).title;
  if (done.length > 0 && (advice.kind === "up" || advice.kind === "same" || advice.kind === "careful")) {
    nextTitle = workoutFor({ kind: "rung", rung: advice.rung }).title;
  }
  return summaryText(runs, walks, counts, advice, nextTitle, u.track, raceNote(u));
}

// ── plan page ────────────────────────────────────────────────────────────────

const CASE_SCHEDULE: Array<[number, CaseStory]> = [
  [CASE1_DAY, CASE_MARINA],
];

export type PlanSessionView = {
  idx: number;
  date: string;
  dateLabel: string;
  title: string;
  minutes: number;
  steps: string[];
  body: string;
  checkin: CheckinValue | null;
  canCheckin: boolean;
  isToday: boolean;
  isWalk: boolean;
  isInterval: boolean;
  /** Its day has come: check-in and screenshots are possible. */
  isDue: boolean;
  /** Signed URLs of the person's own screenshots (filled by service.ts). */
  screenshots: ScreenshotView[];
};

export type PlanView = {
  token: string;
  stage: Stage;
  day: number;
  today: string;
  goalLine: string;
  patternLabel: string;
  sessions: PlanSessionView[];
  offerVisible: boolean;
  track: Track;
  planKind: PlanKind;
  /** Best result and next race lines for the runner track, null for beginners. */
  runnerFacts: string[];
  /** Cases visible today: Marina only, from day 2. */
  cases: CaseStory[];
  summary: string | null;
  linked: boolean;
};

export function planView(u: EnWeekUser, sessions: EnWeekSession[], now: Date): PlanView {
  const today = localNow(now, u.tz).date;
  const stage = stageOf(u, today);
  const day = u.week_start ? weekDay(u.week_start, today) : 0;
  const sorted = [...sessions].sort((a, b) => a.idx - b.idx);
  const ctx = userCtx(u, sorted);
  const paces = ctx.paces;
  const track = u.track;
  return {
    token: u.token,
    stage,
    day,
    today,
    goalLine: track === "runner" ? runnerGoalLine(u.goal, raceNote(u)) : GOAL_LINES[u.goal],
    planKind: planKindFor(u.goal) as PlanKind,
    track,
    runnerFacts: track === "runner" ? runnerFacts(u, paces) : [],
    patternLabel: u.days_pattern ? patternLabelEn(u.days_pattern) : "",
    sessions: sorted.map((s) => {
      const w = workoutOf(s, ctx);
      return {
        idx: s.idx,
        date: s.date,
        dateLabel: dayLabelEn(s.date),
        title: s.title,
        minutes: s.minutes,
        steps: w.steps,
        body: s.body_en,
        checkin: s.checkin,
        canCheckin: canCheckin(sorted, s.idx, today),
        isToday: s.date === today,
        isWalk: s.kind === "walk",
        isInterval: s.preset_code.startsWith("int_walk_"),
        isDue: s.date <= today,
        screenshots: [],
      };
    }),
    offerVisible: !!u.week_start && pageOfferVisible(u.week_start, today, sorted),
    cases: CASE_SCHEDULE.filter(([d]) => day >= d).map(([, c]) => c),
    summary: u.week_start && day >= 7 ? weekSummary(u, sorted) : null,
    linked: !!u.chatplace_client_id,
  };
}
