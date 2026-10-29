/* What goes to the Instagram DM now: pure composition for GET /api/en-week/today.
 *
 * The slot (morning / midday / evening) comes from the user's local clock, or from ?slot= when
 * ChatPlace runs on fixed times. Which slots send on which day: slotsForDay (logic.ts).
 * Dedupe (one message per slot per day) is NOT here: service.ts claims the key
 * "<local date>:<slot>" in en_week_events, so repeated calls return send:false. */

import {
  CASE1_DAY,
  FINAL_DAY,
  FOLLOWUP_DAY,
  addDays,
  dayLabelEn,
  localDateOf,
  localNow,
  offerDue,
  slotAt,
  slotsForDay,
  stageOf,
  weekDay,
  type Slot,
  type Stage,
  type Track,
} from "./logic";
import { summaryDayLabel, upcoming, userCtx, weekSummary, workoutOf, type EnWeekSession, type EnWeekUser } from "./model";
import * as T from "./texts";

export const DM_MAX = 900;

/** Which buttons ChatPlace puts under the message (it branches on this field). */
export type DmButtons = "checkin" | "ack" | "offer" | "none";

export type DmKind =
  | "workout"
  | "checkin_ask"
  | "logged"
  | "rest"
  | "preview"
  | "before_start"
  | "summary"
  | "followup"
  | "final"
  | "no_plan"
  | "health_stop"
  | "quiet"
  | "done";

export type Extra = "case1" | "offer";

export type Dm = {
  /** true: this slot sends today (before dedupe). */
  due: boolean;
  slot: Slot | null;
  kind: DmKind;
  message: string;
  buttons: DmButtons;
  extra: Extra | null;
  /** Case photo to send with this message (ChatPlace: image first, then the text). */
  imageUrl: string | null;
  stage: Stage;
  day: number;
  hasWorkoutToday: boolean;
};

function sameLocalDay(iso: string | null, tz: string, today: string): boolean {
  return !!iso && localDateOf(iso, tz) === today;
}

/**
 * EXTRAS (cases and the offer) ride on rest-day and "logged" messages, one per local day at
 * most [same rule as the Russian bot: no more than one selling message a day]. Order:
 * Marina from day 2 → the offer (after the 2nd check-in or from day 5). English version: Marina
 * is the only case [Igor, 28.10.2026].
 * Never on day 7 (the summary carries the offer). All countries [Igor, 28.10.2026: the earlier
 * no-offer country list is dropped].
 */
export function extraDue(u: EnWeekUser, sessions: EnWeekSession[], today: string): Extra | null {
  if (!u.week_start) return null;
  const day = weekDay(u.week_start, today);
  if (day < 1 || day >= 7) return null;
  if ([u.case1_dm_at, u.offer_dm_at].some((t) => sameLocalDay(t, u.tz, today))) return null;
  if (!u.case1_dm_at && day >= CASE1_DAY) return "case1";
  if (!u.offer_dm_at && offerDue(u.week_start, today, sessions)) return "offer";
  return null;
}

function withExtra(base: string, extra: Extra | null, track: Track = "beginner"): string {
  if (extra === "case1") return `${base}\n\n${T.CASE_MARINA.text}`;
  if (extra === "offer") return `${base}\n\n${T.offerDm(track)}`;
  return base;
}

function imageFor(extra: Extra | null): string | null {
  if (extra === "case1") return T.CASE_MARINA.imageUrl;
  return null;
}

function buttonsFor(extra: Extra | null): DmButtons {
  return extra === "offer" ? "offer" : "ack";
}

export function composeDm(u: EnWeekUser | null, sessions: EnWeekSession[], now: Date, slotOverride?: Slot | null): Dm {
  const local = localNow(now, u?.tz ?? "UTC");
  const today = local.date;
  const slot = slotOverride ?? slotAt(local.minutes);
  const stage = stageOf(u, today);
  const day = u?.week_start ? weekDay(u.week_start, today) : 0;
  const todays = sessions.find((s) => s.date === today) ?? null;
  const hasWorkoutToday = stage === "week" && todays !== null;
  const base = { slot, stage, day, hasWorkoutToday, extra: null as Extra | null, imageUrl: null as string | null };
  const quiet = (kind: DmKind = "quiet"): Dm => ({ ...base, due: false, kind, message: "", buttons: "none" });

  if (!u || stage === "no_plan") return { ...base, due: false, kind: "no_plan", message: T.NO_PLAN_DM, buttons: "none" };
  if (stage === "health_stop") return { ...base, due: false, kind: "health_stop", message: T.HEALTH_STOP_DM, buttons: "none" };
  if (stage === "done") return quiet("done");
  if (!slot || !slotsForDay(stage, day, hasWorkoutToday).includes(slot)) return quiet();

  const weekStart = u.week_start!;
  const summaryDay = summaryDayLabel(weekStart);
  const nextOf = (from: string) => {
    const s = upcoming(sessions, from);
    return s ? { title: s.title, date: dayLabelEn(s.date) } : null;
  };

  if (stage === "before_start") {
    const first = [...sessions].sort((a, b) => a.idx - b.idx)[0];
    if (slot === "evening" && first && first.date === addDays(today, 1)) {
      return { ...base, due: true, kind: "preview", message: T.previewDm(day, { title: first.title }, null, null), buttons: "ack" };
    }
    return { ...base, due: true, kind: "before_start", message: T.beforeStartDm({ title: first.title, date: dayLabelEn(first.date) }, day), buttons: "ack" };
  }

  if (stage === "post") {
    if (day === FOLLOWUP_DAY) {
      return { ...base, due: true, kind: "followup", message: u.track === "runner" ? T.RUNNER_FOLLOWUP_DM : T.FOLLOWUP_DM, buttons: "offer" };
    }
    if (day === FINAL_DAY) {
      return { ...base, due: true, kind: "final", message: u.track === "runner" ? T.RUNNER_FINAL_DM : T.FINAL_DM, buttons: "offer" };
    }
    return quiet();
  }

  // stage === "week"
  if (day === 7 && slot === "evening") {
    return { ...base, due: true, kind: "summary", message: weekSummary(u, sessions), buttons: "offer" };
  }

  if (todays) {
    const w = workoutOf(todays, userCtx(u, sessions));
    if (slot === "morning") {
      return { ...base, due: true, kind: "workout", message: T.workoutDm(w, todays.kind === "walk", todays.preset_code.startsWith("int_walk_"), u.track === "runner"), buttons: "checkin" };
    }
    if (todays.checkin === null) {
      return { ...base, due: true, kind: "checkin_ask", message: T.checkinAskDm(w), buttons: "checkin" };
    }
    const extra = extraDue(u, sessions, today);
    const msg = withExtra(T.loggedDm(nextOf(addDays(today, 1)), summaryDay), extra, u.track);
    return { ...base, extra, imageUrl: imageFor(extra), due: true, kind: "logged", message: msg, buttons: buttonsFor(extra) };
  }

  // rest day of the week
  const extra = extraDue(u, sessions, today);
  const tomorrow = sessions.find((s) => s.date === addDays(today, 1)) ?? null;
  if (slot === "evening") {
    const msg = withExtra(T.previewDm(day, tomorrow ? { title: tomorrow.title } : null, nextOf(addDays(today, 1)), day < 7 ? summaryDay : "this evening"), extra, u.track);
    return { ...base, extra, imageUrl: imageFor(extra), due: true, kind: "preview", message: msg, buttons: buttonsFor(extra) };
  }
  const msg = withExtra(T.restDm(day, nextOf(addDays(today, 1)), day < 7 ? summaryDay : "this evening"), extra, u.track);
  return { ...base, extra, imageUrl: imageFor(extra), due: true, kind: "rest", message: msg, buttons: buttonsFor(extra) };
}
