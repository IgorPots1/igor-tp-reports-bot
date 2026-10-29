/* The free week's operations, over a Store (Supabase in prod, memory in check/simulate).
 * Routes in src/app/api/en-week/* only parse input, check the flag and the key, and call these. */

import { randomBytes } from "node:crypto";

import { composeDm, type Dm } from "./dm";
import {
  dayLabelEn,
  isCheckinValue,
  localNow,
  checkinTarget,
  offerDue,
  stageOf,
  weekDay,
  CASE1_DAY,
  planKindFor,
  runningLevelFor,
  trackFor,
  type Answers,
  type CheckinValue,
  type Slot,
  type Stage,
} from "./logic";
import {
  ctaUrl,
  entryUrl,
  newWeek,
  nextSessionAfter,
  planUrl,
  planView,
  summaryDayLabel,
  userCtx,
  withCheckin,
  type EnWeekSession,
  type EnWeekUser,
  type PlanView,
} from "./model";
import { planStartedText } from "./notify";
import { MAX_SCREENSHOTS_PER_SESSION, parseImageDataUrl, type ParsedImage, type Screenshot } from "./screenshots";
import * as T from "./texts";

export type NewUser = Omit<EnWeekUser, "id" | "created_at">;

export type EnWeekEventKind =
  | "open"
  | "plan_created"
  | "plan_reopened"
  | "health_stop"
  | "checkin"
  | "pain"
  | "offer_shown"
  | "summary_viewed"
  | "cta_click"
  | "screenshot"
  | "dm";

export interface EnWeekStore {
  findByClient(clientId: string): Promise<EnWeekUser | null>;
  findByToken(token: string): Promise<EnWeekUser | null>;
  insertUser(row: NewUser): Promise<EnWeekUser>;
  updateUser(id: string, patch: Partial<EnWeekUser>): Promise<void>;
  getSessions(userId: string): Promise<EnWeekSession[]>;
  saveSessions(userId: string, rows: EnWeekSession[]): Promise<void>;
  /** true the first time this key is seen for this user (unique in en_week_events). */
  claimKey(userId: string, key: string, kind: EnWeekEventKind, meta?: Record<string, unknown>): Promise<boolean>;
  logEvent(userId: string | null, kind: EnWeekEventKind, meta?: Record<string, unknown>): Promise<void>;
  /** Screenshots: storage + rows (en_week_screenshots), always scoped to the owner's id. */
  addScreenshot(userId: string, idx: number, image: ParsedImage): Promise<Screenshot>;
  listScreenshots(userId: string): Promise<Screenshot[]>;
  deleteScreenshot(userId: string, id: string): Promise<boolean>;
  signScreenshotUrls(paths: string[]): Promise<Record<string, string>>;
}

export function newToken(): string {
  return randomBytes(16).toString("base64url");
}

export function isToken(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{16,64}$/u.test(v);
}

/** ChatPlace client id from ?c= / body: letters, digits, _ and - (same cleaning as /breakdown). */
export function cleanClientId(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).replace(/[^\w-]/gu, "").slice(0, 64);
  return s || null;
}

async function syncStage(store: EnWeekStore, u: EnWeekUser, stage: Stage): Promise<void> {
  if (stage !== "no_plan" && u.stage !== stage) {
    await store.updateUser(u.id, { stage });
    u.stage = stage;
  }
}

// ── plan creation ────────────────────────────────────────────────────────────

export type CreateInput = {
  clientId: string | null;
  username: string | null;
  answers: Answers;
  tz: string;
  health: boolean;
  country: string | null;
};

export type CreateResult =
  | { ok: true; token: string; existing: boolean }
  | { ok: true; healthStop: true }
  | { ok: false; error: string };

export async function createPlan(
  store: EnWeekStore,
  input: CreateInput,
  now: Date,
  deps: { notify?: (text: string) => void } = {},
): Promise<CreateResult> {
  // One live week per DM chat: the same person opening the link again gets their week back.
  if (input.clientId) {
    const existing = await store.findByClient(input.clientId);
    if (existing && !existing.health_flag) {
      const stage = stageOf(existing, localNow(now, existing.tz).date);
      if (stage === "before_start" || stage === "week") {
        await store.logEvent(existing.id, "plan_reopened");
        return { ok: true, token: existing.token, existing: true };
      }
    }
  }

  const a = input.answers;
  const common: NewUser = {
    token: newToken(),
    chatplace_client_id: input.clientId,
    ig_username: input.username,
    goal: a.goal,
    runs: a.runs,
    start_now: a.start_now ?? null,
    start_longest: a.start_longest ?? null,
    return_last: a.return_last ?? null,
    return_level: a.return_level ?? null,
    weekly_volume: a.weekly_km ?? null,
    longest_run: a.longest_run ?? null,
    quality_experience: a.quality ?? null,
    best_distance: a.result_distance ?? null,
    best_seconds: a.result_seconds ?? null,
    next_race_distance: a.race_distance ?? null,
    next_race_month: a.race_month ?? null,
    running_level: runningLevelFor(a),
    track: trackFor(a),
    days_pattern: null,
    tz: input.tz,
    country: input.country,
    health_flag: input.health,
    plan_kind: null,
    start_rung: null,
    week_start: null,
    stage: "health_stop",
    offer_shown_at: null,
    offer_dm_at: null,
    case1_dm_at: null,
    summary_dm_at: null,
    summary_viewed_at: null,
    followup_dm_at: null,
    final_dm_at: null,
    cta_clicked_at: null,
    last_checkin_at: null,
  };

  if (input.health) {
    const u = await store.insertUser(common);
    await store.logEvent(u.id, "health_stop");
    return { ok: true, healthStop: true };
  }

  const week = newWeek(a, a.pattern, now, input.tz);
  if (!week) return { ok: false, error: "pattern" };
  const profile = week.ctx.profile;
  const u = await store.insertUser({
    ...common,
    days_pattern: a.pattern,
    plan_kind: profile.planKind,
    start_rung: profile.startRung,
    week_start: week.weekStart,
    stage: stageOf({ health_flag: false, week_start: week.weekStart }, localNow(now, input.tz).date),
  });
  await store.saveSessions(u.id, week.sessions);
  await store.logEvent(u.id, "plan_created", {
    plan_kind: profile.planKind,
    start_rung: profile.startRung,
    goal: a.goal,
    runs: a.runs,
    track: common.track,
    paces: !!week.ctx.paces,
    linked: !!input.clientId,
  });
  // The ONLY coach ping of the free week: a new plan.
  deps.notify?.(
    planStartedText({ username: input.username, clientId: input.clientId, country: input.country, answers: a, track: common.track }),
  );
  return { ok: true, token: u.token, existing: false };
}

// ── check-ins ────────────────────────────────────────────────────────────────

type CheckinOutcome = { ok: true; reply: string; idx: number; sessions: EnWeekSession[] } | { ok: false; reply: string };

async function checkin(
  store: EnWeekStore,
  u: EnWeekUser,
  idx: number | null,
  value: CheckinValue,
  now: Date,
  via: "dm" | "page",
): Promise<CheckinOutcome> {
  if (!u.week_start || u.health_flag) return { ok: false, reply: T.NOTHING_TO_CHECKIN };
  const today = localNow(now, u.tz).date;
  const sessions = await store.getSessions(u.id);
  const target = idx ?? checkinTarget(sessions, today);
  if (target === null) return { ok: false, reply: T.NOTHING_TO_CHECKIN };
  const before = sessions.find((s) => s.idx === target);
  const updated = withCheckin(userCtx(u, sessions), sessions, target, value, now.toISOString(), today);
  if (!updated) return { ok: false, reply: T.NOTHING_TO_CHECKIN };

  if (before?.checkin !== value) {
    await store.saveSessions(u.id, updated);
    await store.updateUser(u.id, { last_checkin_at: now.toISOString() });
    await store.logEvent(u.id, "checkin", { idx: target, value, via, day: weekDay(u.week_start, today) });
    if (value === "pain") await store.logEvent(u.id, "pain", { idx: target, via });
  }
  const next = nextSessionAfter(updated, target);
  const reply = T.checkinReply(value, next ? { title: next.title, date: dayLabelEn(next.date) } : null, summaryDayLabel(u.week_start), u.track === "runner", planKindFor(u.goal) !== "ladder");
  return { ok: true, reply, idx: target, sessions: updated };
}

// ── ChatPlace API ────────────────────────────────────────────────────────────

export type TodayResponse = {
  ok: true;
  send: boolean;
  repeat: boolean;
  has_workout_today: boolean;
  message: string;
  url: string;
  cta_url: string | null;
  /** Case photo to send before `message`, or null. */
  image_url: string | null;
  kind: Dm["kind"];
  buttons: Dm["buttons"];
  stage: Stage;
  day: number;
  slot: Slot | null;
};

/**
 * GET /today. Idempotent per (local date, slot): the first call in a due slot returns
 * send:true and marks it; later calls in the same slot return the same kind with send:false.
 * peek=true never marks (for testing from ChatPlace or by hand).
 */
export async function dmToday(store: EnWeekStore, clientId: string, now: Date, opts: { slot?: Slot | null; peek?: boolean } = {}): Promise<TodayResponse> {
  const u = await store.findByClient(clientId);
  const sessions = u ? await store.getSessions(u.id) : [];
  const dm = composeDm(u, sessions, now, opts.slot ?? null);
  if (u) await syncStage(store, u, dm.stage);
  const url = u && u.week_start ? planUrl(u.token) : entryUrl(clientId);
  const ctaPlace = dm.kind === "summary" ? "summary" : dm.kind === "followup" || dm.kind === "final" ? "followup" : "offer";
  const out: TodayResponse = {
    ok: true,
    send: false,
    repeat: false,
    has_workout_today: dm.hasWorkoutToday,
    message: dm.message,
    url,
    cta_url: u && dm.buttons === "offer" ? ctaUrl(u.token, ctaPlace, u.track) : null,
    image_url: dm.imageUrl,
    kind: dm.kind,
    buttons: dm.buttons,
    stage: dm.stage,
    day: dm.day,
    slot: dm.slot,
  };
  if (!u || !dm.due || opts.peek) return out;

  const today = localNow(now, u.tz).date;
  const claimed = await store.claimKey(u.id, `dm:${today}:${dm.slot}`, "dm", { kind: dm.kind, extra: dm.extra, day: dm.day });
  if (!claimed) return { ...out, repeat: true };

  const at = now.toISOString();
  const patch: Partial<EnWeekUser> = {};
  if (dm.extra === "case1") patch.case1_dm_at = at;
  if (dm.extra === "offer") patch.offer_dm_at = at;
  if (dm.kind === "summary") patch.summary_dm_at = at;
  if (dm.kind === "followup") patch.followup_dm_at = at;
  if (dm.kind === "final") patch.final_dm_at = at;
  if (Object.keys(patch).length) await store.updateUser(u.id, patch);
  return { ...out, send: true };
}

export async function dmCheckin(store: EnWeekStore, clientId: string, value: unknown, now: Date): Promise<{ ok: boolean; reply: string; idx?: number }> {
  if (!isCheckinValue(value)) return { ok: false, reply: "" };
  const u = await store.findByClient(clientId);
  if (!u) return { ok: false, reply: T.NO_PLAN_DM };
  const r = await checkin(store, u, null, value, now, "dm");
  return r.ok ? { ok: true, reply: r.reply, idx: r.idx } : { ok: false, reply: r.reply };
}

export type StatusResponse = {
  ok: true;
  stage: Stage;
  day: number;
  next_workout_date: string | null;
  offer_due: boolean;
  case_due: "case1" | null;
  checkins: number;
  url: string;
};

export async function dmStatus(store: EnWeekStore, clientId: string, now: Date): Promise<StatusResponse> {
  const u = await store.findByClient(clientId);
  if (!u) return { ok: true, stage: "no_plan", day: 0, next_workout_date: null, offer_due: false, case_due: null, checkins: 0, url: entryUrl(clientId) };
  const today = localNow(now, u.tz).date;
  const stage = stageOf(u, today);
  await syncStage(store, u, stage);
  const sessions = await store.getSessions(u.id);
  const day = u.week_start ? weekDay(u.week_start, today) : 0;
  const allowed = stage === "week";
  const next = [...sessions].sort((a, b) => a.idx - b.idx).find((s) => s.date >= today && s.checkin === null) ?? null;
  let caseDue: "case1" | null = null;
  if (allowed && day < 7 && !u.case1_dm_at && day >= CASE1_DAY) caseDue = "case1";
  return {
    ok: true,
    stage,
    day,
    next_workout_date: next?.date ?? null,
    offer_due: allowed && !u.offer_dm_at && !!u.week_start && offerDue(u.week_start, today, sessions),
    case_due: caseDue,
    checkins: sessions.filter((s) => s.checkin !== null).length,
    url: u.week_start ? planUrl(u.token) : entryUrl(clientId),
  };
}

// ── plan page ────────────────────────────────────────────────────────────────

/** Loads the page view and records first sightings of the offer and the summary. */
export async function loadPlanPage(store: EnWeekStore, token: string, now: Date): Promise<PlanView | null> {
  const u = await store.findByToken(token);
  if (!u || !u.week_start) return null;
  const sessions = await store.getSessions(u.id);
  const view = planView(u, sessions, now);
  await syncStage(store, u, view.stage);
  await markSightings(store, u, view, now);
  return withScreenshots(store, u, view);
}

/** Signed URLs for the person's own screenshots, per session. */
async function withScreenshots(store: EnWeekStore, u: EnWeekUser, view: PlanView): Promise<PlanView> {
  const shots = await store.listScreenshots(u.id);
  if (!shots.length) return view;
  const urls = await store.signScreenshotUrls(shots.map((x) => x.path));
  return {
    ...view,
    sessions: view.sessions.map((s) => ({
      ...s,
      screenshots: shots.filter((x) => x.idx === s.idx && urls[x.path]).map((x) => ({ id: x.id, url: urls[x.path] })),
    })),
  };
}

export type ScreenshotResult = { ok: true; view: PlanView } | { ok: false; error: "not_found" | "not_yet" | "limit" | "type" | "size" };

/**
 * Screenshot upload from the plan page. Token-scoped: the session must be one of THIS person's
 * sessions and its day must have come; at most MAX_SCREENSHOTS_PER_SESSION per session; image
 * types and the size cap are checked here, on the server, whatever the browser sent.
 */
export async function pageAddScreenshot(store: EnWeekStore, token: string, idx: unknown, dataUrl: unknown, now: Date): Promise<ScreenshotResult> {
  const u = await store.findByToken(token);
  if (!u || !u.week_start || typeof idx !== "number" || !Number.isInteger(idx)) return { ok: false, error: "not_found" };
  const sessions = await store.getSessions(u.id);
  const s = sessions.find((x) => x.idx === idx);
  if (!s) return { ok: false, error: "not_found" };
  if (s.date > localNow(now, u.tz).date) return { ok: false, error: "not_yet" };
  const existing = (await store.listScreenshots(u.id)).filter((x) => x.idx === idx);
  if (existing.length >= MAX_SCREENSHOTS_PER_SESSION) return { ok: false, error: "limit" };
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  await store.addScreenshot(u.id, idx, parsed.image);
  await store.logEvent(u.id, "screenshot", { idx, bytes: parsed.image.bytes.length });
  return { ok: true, view: await withScreenshots(store, u, planView(u, sessions, now)) };
}

export async function pageDeleteScreenshot(store: EnWeekStore, token: string, id: unknown, now: Date): Promise<ScreenshotResult> {
  const u = await store.findByToken(token);
  if (!u || typeof id !== "string") return { ok: false, error: "not_found" };
  if (!(await store.deleteScreenshot(u.id, id))) return { ok: false, error: "not_found" };
  const sessions = await store.getSessions(u.id);
  return { ok: true, view: await withScreenshots(store, u, planView(u, sessions, now)) };
}

async function markSightings(store: EnWeekStore, u: EnWeekUser, view: PlanView, now: Date) {
  const patch: Partial<EnWeekUser> = {};
  if (view.offerVisible && !u.offer_shown_at) {
    patch.offer_shown_at = now.toISOString();
    await store.logEvent(u.id, "offer_shown", { day: view.day });
  }
  if (view.summary && !u.summary_viewed_at) {
    patch.summary_viewed_at = now.toISOString();
    await store.logEvent(u.id, "summary_viewed", { day: view.day });
  }
  if (Object.keys(patch).length) await store.updateUser(u.id, patch);
}

export async function pageCheckin(
  store: EnWeekStore,
  token: string,
  idx: unknown,
  value: unknown,
  now: Date,
): Promise<{ ok: boolean; reply: string; view?: PlanView }> {
  if (!isCheckinValue(value) || typeof idx !== "number" || !Number.isInteger(idx) || idx < 1 || idx > 4) return { ok: false, reply: "" };
  const u = await store.findByToken(token);
  if (!u) return { ok: false, reply: "" };
  const r = await checkin(store, u, idx, value, now, "page");
  if (!r.ok) return { ok: false, reply: r.reply };
  const view = planView(u, r.sessions, now);
  await markSightings(store, u, view, now);
  return { ok: true, reply: r.reply, view: await withScreenshots(store, u, view) };
}

/** CTA click (page or DM): one event per click, cta_clicked_at on the first. */
export async function recordCta(store: EnWeekStore, token: string, place: string, now: Date): Promise<void> {
  const u = await store.findByToken(token);
  if (!u) return;
  await store.logEvent(u.id, "cta_click", { place });
  if (!u.cta_clicked_at) await store.updateUser(u.id, { cta_clicked_at: now.toISOString() });
}
