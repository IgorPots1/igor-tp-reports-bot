/**
 * Free training week for @runnigor (igorp.run/en/week): logic, texts and the API service on test
 * dates, without network, without a DB and without ChatPlace. Store in memory.
 *
 * WHAT IT GUARDS:
 *   - flag: off by default; every /api/en-week/* route and both pages check it first;
 *     ChatPlace routes also check x-en-week-key in constant time;
 *   - onboarding = Igor's "AI running coach" app: goal-driven branching (stepsFor), the app's
 *     option codes, days per week by goal (capped at 4), level by inferRunningLevel, the kind of
 *     week by resolveMethodologySegment, easy/test-run sizing by toSelfReportMinutesRange;
 *   - reuse: the ladder follows the Russian planNext rule for rule; 2/3-day weeks are the
 *     Russian buildWeek;
 *   - methodology: English workouts carry BEGINNER_LADDER's numbers; runner-type sessions are
 *     library presets inside the advisory bands; the only intervals are int_walk_* (never thr_*
 *     or vo2_*); the return week has no quality at all;
 *   - paces: the same math as Igor's calculator (/tools/plan), no result → no paces;
 *   - health: only a boolean leaves the page and lands in the DB;
 *   - the 24h window: with 2-hour polling, no gap between DM messages asking for a tap is over
 *     20 hours, for every day pattern (incl. 4 days) and time zone;
 *   - idempotency; offer and cases for every country; one coach ping per new plan;
 *   - texts: no em or en dash anywhere, every DM at most 900 characters, cases = the Russian ones.
 *
 *   npm run check:en-week
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { keyMatches, isAuthorizedEnWeek } from "@/features/en-week/auth";
import { DM_MAX, composeDm } from "@/features/en-week/dm";
import {
  DAY_PATTERNS,
  EASY_CEIL,
  EASY_FLOOR,
  EN_PATTERNS,
  GOALS,
  HEALTH_ITEMS,
  INTERVAL_PRESETS,
  LONGEST_RUN,
  LONG_MAX,
  POLL_EVERY_MIN,
  QUALITY,
  RACE_DISTANCES,
  RECOVERY_MINUTES,
  RETURN_LAST,
  RETURN_LEVEL,
  STRIDES_MAX,
  STRIDES_MIN,
  START_LONGEST,
  START_NOW,
  WEEKLY_KM,
  WEEK_KM,
  addDays,
  buildWeek,
  buildWeekEn,
  canCheckin,
  checkinTarget,
  cleanAnswers,
  daysPerWeekOptions,
  intervalFor,
  isEnWeekEnabled,
  isInterval,
  isoWeekday,
  localNow,
  patternLabelEn,
  patternsForRuns,
  planKindFor,
  planSessions,
  profileFor,
  raceSoon,
  runnerBaseFor,
  runnerWeek,
  runningLevelFor,
  safeTz,
  selfReportBand,
  startRungFor,
  stepsFor,
  trackFor,
  type Answers,
  type CheckinValue,
  type EnPlanned,
  type RaceDist,
  type Runs,
  type WeeklyKm,
} from "@/features/en-week/logic";
import { answersOf, ctxOf, newWeek, planView, replan, type EnWeekSession } from "@/features/en-week/model";
import { planStartedText } from "@/features/en-week/notify";
import { checkResult, easyMidSecPerKm, paceRangeText, parseResultTime, pacesFromResult } from "@/features/en-week/paces";
import { DATA_URL_RE, MAX_FILE_BYTES, MAX_SCREENSHOTS_PER_SESSION, SIGNED_URL_TTL_SECONDS, parseImageDataUrl } from "@/features/en-week/screenshots";
import { createPlan, dmCheckin, dmStatus, dmToday, loadPlanPage, pageAddScreenshot, pageCheckin, pageDeleteScreenshot } from "@/features/en-week/service";
import * as T from "@/features/en-week/texts";
import { INTERVALS, INTERVAL_COOLDOWN_MIN, INTERVAL_WARMUP_MIN, STRIDES, intervalMinutes, ladderWorkout, runnerWorkout, workoutFor } from "@/features/en-week/workouts";
import * as RU from "@/features/trial-bot/texts";
import { CONSULT_TOOLS, consultTarget, normalizeConsultTool } from "@/features/consult-clicks/record";
import { BEGINNER_LADDER, diagnosticSession } from "@/features/methodology/beginner";
import { buildWorkoutCards } from "@/app/tools/plan/vdot";
import { planNext, type PlannedSession } from "@/features/trial-bot/logic";

import { enWeekMemStore } from "./lib/en-week-memstore";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

let passed = 0;
function ok(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
    })
    .catch((e) => {
      console.error(`FAIL ${name}`);
      throw e;
    });
}

const DASHES = /[\u2014\u2013]/u;
const seenTexts: Array<[string, string]> = [];
function text(where: string, s: string) {
  seenTexts.push([where, s]);
  return s;
}

function at(local: string, tz: string): Date {
  // local "2026-11-02T08:30" in tz → the instant. Iterates the offset (DST-safe for tests).
  let t = new Date(`${local}:00Z`).getTime();
  for (let i = 0; i < 3; i++) {
    const l = localNow(new Date(t), tz);
    const want = Date.parse(`${local}:00Z`);
    const have = Date.parse(`${l.date}T${String(Math.floor(l.minutes / 60)).padStart(2, "0")}:${String(l.minutes % 60).padStart(2, "0")}:00Z`);
    t += want - have;
  }
  return new Date(t);
}

const VALUES: CheckinValue[] = ["easy", "ok", "hard", "skipped", "pain"];

const BASE = { weekly_km: "15_30", longest_run: "5_10", quality: "sometimes" } as const;
const A = {
  start: (longest: Answers["start_longest"] = "less_than_1km", runs: Runs = 3, pattern = "m3a"): Answers => ({
    goal: "start_running", start_now: "never_or_almost_never", start_longest: longest, runs, pattern,
  }),
  ret: (runs: Runs = 3, pattern = "m3b", base: Partial<Answers> = {}): Answers => ({
    goal: "return_to_running", return_last: "3_to_6_months_ago", return_level: "around_5km", runs, pattern, ...BASE, ...base,
  }),
  reg: (runs: Runs = 3, pattern = "m3a", base: Partial<Answers> = {}): Answers => ({ goal: "run_consistently", runs, pattern, ...BASE, ...base }),
  race: (runs: Runs = 4, pattern = "r4a", extra: Partial<Answers> = {}): Answers => ({
    goal: "train_for_race", race_distance: "10k", race_month: "2026-12", result_distance: "10k", result_seconds: 52 * 60, runs, pattern, ...BASE, ...extra,
  }),
};

type Mem = ReturnType<typeof enWeekMemStore>;
const mk = (m: Mem, c: string, answers: Answers, tz: string, now: Date, extra: { country?: string | null; health?: boolean; username?: string | null } = {}) =>
  createPlan(m.store, { clientId: c, username: extra.username ?? null, answers, tz, health: extra.health ?? false, country: extra.country ?? "GB" }, now);

async function main() {
  // ── flag and auth ──────────────────────────────────────────────────────────
  await ok("flag off by default", () => {
    assert.equal(isEnWeekEnabled({}), false);
    assert.equal(isEnWeekEnabled({ EN_WEEK_ENABLED: "" }), false);
    assert.equal(isEnWeekEnabled({ EN_WEEK_ENABLED: "0" }), false);
    for (const v of ["1", "true", "on", "YES"]) assert.equal(isEnWeekEnabled({ EN_WEEK_ENABLED: v }), true);
  });

  await ok("key: constant-time compare, nothing passes without a configured key", () => {
    assert.equal(keyMatches("abc", "abc"), true);
    assert.equal(keyMatches("abd", "abc"), false);
    assert.equal(keyMatches("abc", ""), false);
    assert.equal(keyMatches("", ""), false);
    assert.equal(keyMatches("abc", undefined), false);
    const req = (k?: string) => new Request("https://x/api/en-week/today?c=1", { headers: k ? { "x-en-week-key": k } : {} });
    assert.equal(isAuthorizedEnWeek(req("s3cret"), { EN_WEEK_API_KEY: "s3cret" }), true);
    assert.equal(isAuthorizedEnWeek(req("wrong"), { EN_WEEK_API_KEY: "s3cret" }), false);
    assert.equal(isAuthorizedEnWeek(req(), { EN_WEEK_API_KEY: "s3cret" }), false);
    assert.equal(isAuthorizedEnWeek(req("x"), {}), false);
    assert.match(read("src/features/en-week/auth.ts"), /timingSafeEqual/);
  });

  await ok("routes: flag first, ChatPlace routes behind the key", () => {
    for (const r of ["today", "checkin", "status"]) {
      const src = read(`src/app/api/en-week/${r}/route.ts`);
      assert.match(src, /guardChatPlace\(request\)/, `${r}: guardChatPlace`);
      assert.ok(src.indexOf("guardChatPlace(request)") < src.indexOf("readParams(request)"), `${r}: guard before reading`);
    }
    const http = read("src/features/en-week/http.ts");
    assert.ok(http.indexOf("isEnWeekEnabled()") < http.indexOf("isAuthorizedEnWeek(request)"), "flag before key");
    for (const r of ["start", "page-checkin", "event"]) {
      const src = read(`src/app/api/en-week/${r}/route.ts`);
      assert.match(src, /if \(!isEnWeekEnabled\(\)\) return json\(FLAG_OFF, 404\)/, `${r}: flag`);
    }
    assert.match(read("src/app/en/week/page.tsx"), /if \(!isEnWeekEnabled\(\)\) return <ComingSoon \/>/);
    assert.match(read("src/app/en/week/p/[token]/page.tsx"), /if \(!isEnWeekEnabled\(\)\) return <ComingSoon \/>/);
  });

  // ── onboarding = the AI running coach app ─────────────────────────────────
  // REWRITTEN 28.10.2026: this block used to hold "one flow: goal (5 own options), how long you
  // can run without stopping, 2-3 days; under 5 min → rung 1, 5-15 → rung 3, 15-30 → rung 6,
  // 30+ → runner week". Igor replaced it with the onboarding of his app. The new assertions are
  // stronger: the app's own option codes (frozen copy below, from ai-running-coach
  // src/features/onboarding/types.ts), its branching (getStepIds), its days-per-week rule and its
  // level / segment rules, each pinned case by case.
  await ok("onboarding: the app's options, branching and days per week", () => {
    const APP = {
      GOAL_OPTIONS: ["start_running", "return_to_running", "run_consistently", "train_for_race"],
      START_CURRENTLY_RUN_OPTIONS: ["never_or_almost_never", "tried_without_regularity", "sometimes_1_2_per_week"],
      START_LONGEST_DISTANCE_OPTIONS: ["less_than_1km", "1_to_3km", "3_to_5km"],
      RETURN_LAST_RUN_OPTIONS: ["recently", "3_to_6_months_ago", "6_plus_months_ago"],
      RETURN_PREVIOUS_LEVEL_OPTIONS: ["around_3km", "around_5km", "10km_plus"],
      BASELINE_WEEKLY_KM_RANGE_OPTIONS: ["0_5", "5_15", "15_30", "30_50", "50_plus", "unknown"],
      BASELINE_LONGEST_RUN_RANGE_OPTIONS: ["up_to_3", "3_5", "5_10", "10_15", "15_21", "21_plus", "unknown"],
      BASELINE_QUALITY_WORKOUTS_EXPERIENCE_OPTIONS: ["easy_only", "sometimes", "regularly", "unknown"],
    };
    const codes = (o: Array<{ code: string }>) => o.map((x) => x.code);
    assert.deepEqual(codes(GOALS), APP.GOAL_OPTIONS);
    assert.deepEqual(codes(START_NOW), APP.START_CURRENTLY_RUN_OPTIONS);
    assert.deepEqual(codes(START_LONGEST), APP.START_LONGEST_DISTANCE_OPTIONS);
    assert.deepEqual(codes(RETURN_LAST), APP.RETURN_LAST_RUN_OPTIONS);
    assert.deepEqual(codes(RETURN_LEVEL), APP.RETURN_PREVIOUS_LEVEL_OPTIONS);
    assert.deepEqual(codes(WEEKLY_KM), APP.BASELINE_WEEKLY_KM_RANGE_OPTIONS);
    assert.deepEqual(codes(LONGEST_RUN), APP.BASELINE_LONGEST_RUN_RANGE_OPTIONS);
    assert.deepEqual(codes(QUALITY), APP.BASELINE_QUALITY_WORKOUTS_EXPERIENCE_OPTIONS);
    assert.deepEqual(codes(RACE_DISTANCES), ["5k", "10k", "half", "marathon"]);
    for (const o of [...WEEKLY_KM, ...LONGEST_RUN]) if (o.code !== "unknown") assert.ok(o.sub && /mi/u.test(o.sub), `${o.code}: miles shown`);

    assert.deepEqual(stepsFor("start_running"), ["goal", "start_now", "start_longest", "days", "pattern", "health"]);
    assert.deepEqual(stepsFor("return_to_running"), ["goal", "return_last", "return_level", "days", "pattern", "baseline", "health"]);
    assert.deepEqual(stepsFor("run_consistently"), ["goal", "days", "pattern", "baseline", "health"]);
    assert.deepEqual(stepsFor("train_for_race"), ["goal", "race", "result", "days", "pattern", "baseline", "health"]);
    // getDaysPerWeekOptions: start 2-3, race 3-6 (capped at 4 for a free week), others 2-4.
    assert.deepEqual(daysPerWeekOptions("start_running"), [2, 3]);
    assert.deepEqual(daysPerWeekOptions("train_for_race"), [3, 4]);
    assert.deepEqual(daysPerWeekOptions("run_consistently"), [2, 3, 4]);
    assert.deepEqual(daysPerWeekOptions("return_to_running"), [2, 3, 4]);
    assert.deepEqual(patternsForRuns(4), ["r4a", "r4b", "r4c"]);
    assert.equal(patternLabelEn("r4a"), "Tue, Thu, Sat, Sun");

    // cleanAnswers: options only, branch answers required, nothing from another branch.
    assert.ok(cleanAnswers({ ...A.start(), runs: 3 }).ok);
    assert.equal((cleanAnswers({ ...A.start(), runs: 4, pattern: "r4a" }) as { error: string }).error, "runs", "start: max 3 days");
    assert.equal((cleanAnswers({ ...A.race(), runs: 2, pattern: "m2a" }) as { error: string }).error, "runs", "race: min 3 days");
    assert.equal((cleanAnswers({ goal: "start_running", runs: 3, pattern: "m3a" }) as { error: string }).error, "start");
    assert.equal((cleanAnswers({ ...A.reg(), weekly_km: "100" }) as { error: string }).error, "baseline");
    assert.equal((cleanAnswers({ ...A.race(), result_seconds: 5 * 60 }) as { error: string }).error, "result", "10K in 5 min");
    assert.equal((cleanAnswers({ ...A.race(), race_month: "2026-13" }) as { error: string }).error, "race");
    const c = cleanAnswers({ ...A.start(), weekly_km: "50_plus", race_distance: "5k" });
    assert.ok(c.ok && c.answers.weekly_km === undefined && c.answers.race_distance === undefined, "no cross-branch answers");
    const nr = cleanAnswers({ ...A.race(), result_distance: null, result_seconds: null });
    assert.ok(nr.ok && !nr.answers.result_distance, "no result is fine");
  });

  await ok("level, track and kind of week = the app's inferRunningLevel and resolveMethodologySegment", () => {
    assert.equal(runningLevelFor(A.start("3_to_5km")), "beginner");
    assert.equal(runningLevelFor({ ...A.ret(), return_level: "10km_plus", return_last: "recently" }), "intermediate");
    assert.equal(runningLevelFor({ ...A.ret(), return_level: "10km_plus", return_last: "6_plus_months_ago" }), "beginner");
    assert.equal(runningLevelFor(A.race(4, "r4a", { race_distance: "half", result_distance: null })), "intermediate");
    assert.equal(runningLevelFor(A.race(4, "r4a", { race_distance: "10k" })), "intermediate", "10K with a result");
    assert.equal(runningLevelFor(A.race(4, "r4a", { race_distance: "10k", result_distance: null, weekly_km: "5_15" })), "beginner", "10K without one");
    assert.equal(runningLevelFor(A.reg(3, "m3a", { weekly_km: "15_30" })), "intermediate");
    assert.equal(runningLevelFor(A.reg(3, "m3a", { weekly_km: "5_15" })), "beginner");
    assert.equal(trackFor(A.race(4, "r4a", { race_distance: "5k", result_distance: null, weekly_km: "0_5" })), "runner", "a race goal → runner tone");
    assert.equal(trackFor(A.ret()), "beginner");
    assert.deepEqual(GOALS.map((g) => planKindFor(g.code)), ["ladder", "return", "regular", "race"]);
    // Ladder start = the app's continuous-run capability → diagnosticSession of the methodology.
    assert.equal(startRungFor("less_than_1km"), 1);
    assert.equal(BEGINNER_LADDER[startRungFor("less_than_1km") - 1].presetCode, diagnosticSession(false).presetCode);
    assert.equal(startRungFor("1_to_3km"), 6);
    assert.equal(startRungFor("3_to_5km"), 6);
    assert.equal(BEGINNER_LADDER[startRungFor("3_to_5km") - 1].presetCode, diagnosticSession(true).presetCode);
  });

  // ── reuse of the Russian logic ─────────────────────────────────────────────
  await ok("ladder sessions = the Russian planNext, for every check-in sequence", () => {
    const toRu = (v: CheckinValue | null) => (v === "skipped" ? "miss" : v);
    for (const start of [1, 3, 6]) {
      const opts: Array<CheckinValue | null> = [...VALUES, null];
      for (const x of opts) {
        for (const y of opts) {
          const seq = [x, y, null];
          const ours = planSessions({ planKind: "ladder", startRung: start, runs: 3 }, seq, 3);
          const history: Array<{ planned: PlannedSession; checkin: ReturnType<typeof toRu> }> = [];
          for (let i = 0; i < 3; i++) {
            const ru = planNext(start, history);
            if (ru.kind === "walk") assert.equal(ours[i].kind, "walk");
            else assert.deepEqual(ours[i], { kind: "rung", rung: ru.rung });
            history.push({ planned: ru, checkin: toRu(seq[i]) });
          }
        }
      }
    }
    const P = profileFor(A.start());
    assert.deepEqual(planSessions(P, ["easy", "ok", null], 3)[2], { kind: "rung", rung: 2 }, "two Easy/OK → up");
    assert.deepEqual(planSessions(P, ["pain", null, null], 3)[1], { kind: "walk" }, "pain → walk");
    assert.deepEqual(planSessions(P, ["skipped", "skipped", null], 3)[2], { kind: "rung", rung: 1 }, "Skipped changes nothing");
  });

  // ── runner-type weeks ──────────────────────────────────────────────────────
  // REWRITTEN 28.10.2026: was "runner week = by goal (5x3 for first5k/faster, 3x3 for comeback),
  // one int_walk in every runner week". Now the kind of week comes from the app's segments, so
  // the assertion is stronger and per segment: race → exactly one int_walk; regular → one soft
  // quality only from 3 runs (int_walk only with quality experience); return → NO quality at all
  // and a test run first (the app: no hard sessions before feedback on the control run).
  await ok("weeks by segment: race / regular / return, long run on the weekend, never thr_ or vo2_", () => {
    const dates = (code: string, from = "2026-11-02") => buildWeekEn(from, code, 9 * 60)!.dates;
    for (const code of ["m3a", "m3b", "m3c", "r4a", "r4b", "r4c"]) {
      for (let d = 0; d < 7; d++) {
        const ds = buildWeekEn(addDays("2026-11-02", d), code, 9 * 60)!.dates;
        const race = runnerBaseFor("race", A.race(), ds);
        assert.equal(race.filter((p) => isInterval(p)).length, 1, `${code}: one interval session`);
        const li = race.indexOf("long_aerobic");
        assert.ok(isoWeekday(ds[li]) >= 6, `${code}: long run on a weekend day`);
        const ii = race.findIndex((p) => isInterval(p));
        assert.ok(Math.abs((Date.parse(ds[ii]) - Date.parse(ds[li])) / 86_400_000) >= 2, `${code}: no interval right next to the long run`);
        for (const p of race) assert.ok(!/^(thr_|vo2_|race_)/u.test(p));
        const ret = runnerBaseFor("return", A.ret(), ds);
        assert.equal(ret[0], "test_run");
        assert.ok(!ret.some((p) => isInterval(p) || p === "easy_plus_strides"), "return: no quality, no strides");
      }
    }
    assert.ok(runnerBaseFor("race", A.race(), dates("r4a")).includes("easy_plus_strides"), "10K race → strides");
    assert.ok(!runnerBaseFor("race", A.race(4, "r4a", { race_distance: "marathon" }), dates("r4a")).includes("easy_plus_strides"));
    assert.deepEqual(runnerBaseFor("regular", A.reg(2, "m2a"), dates("m2a")), ["easy_continuous", "long_aerobic"], "2 runs: easy + longer easy");
    const r3 = runnerBaseFor("regular", A.reg(3, "m3a"), dates("m3a"));
    assert.deepEqual(r3, ["easy_continuous", "int_walk_4x3", "long_aerobic"], "3 runs, quality 'sometimes' → one int_walk");
    assert.deepEqual(runnerBaseFor("regular", A.reg(3, "m3a", { quality: "easy_only" }), dates("m3a")), ["easy_continuous", "easy_plus_strides", "long_aerobic"], "no quality experience → strides");
    const r4 = runnerBaseFor("regular", A.reg(4, "r4a"), dates("r4a"));
    assert.equal(r4.filter((p) => isInterval(p)).length, 1);
    assert.equal(r4.filter((p) => p === "long_aerobic").length, 1);
    // Interval preset by goal, capped by volume.
    assert.equal(intervalFor("race", "5k", "30_50"), "int_walk_5x3");
    assert.equal(intervalFor("race", "5k", "15_30"), "int_walk_4x3");
    assert.equal(intervalFor("race", "marathon", "50_plus"), "int_walk_4x3");
    assert.equal(intervalFor("regular", null, "5_15"), "int_walk_3x3");
    assert.equal(intervalFor("regular", null, "unknown"), "int_walk_3x3");
    // Progression in runner-type weeks.
    const ctx = ctxOf(A.reg(3, "m3a"), dates("m3a"));
    assert.equal(planSessions(ctx.profile, ["hard", null, null], 3)[1].kind === "runner" && (planSessions(ctx.profile, ["hard", null, null], 3)[1] as { preset: string }).preset, "recovery_easy", "Hard → the interval becomes recovery");
    assert.deepEqual(planSessions(ctx.profile, ["pain", null, null], 3)[1], { kind: "walk" });
  });

  await ok("sizing: the app's toSelfReportMinutesRange, week not more than now, long 28% capped by the longest run", () => {
    // The app's bands, case by case (training-baseline-gate.ts).
    assert.deepEqual(selfReportBand({ weekly_km: "5_15", longest_run: "3_5", quality: "regularly" }), { min: 45, max: 70, def: 60, byFeel: false });
    assert.deepEqual(selfReportBand({ weekly_km: "50_plus", longest_run: "unknown", quality: "unknown" }), { min: 45, max: 70, def: 60, byFeel: false });
    assert.deepEqual(selfReportBand({ weekly_km: "30_50", longest_run: "10_15", quality: "easy_only" }), { min: 35, max: 60, def: 50, byFeel: false });
    assert.deepEqual(selfReportBand({ weekly_km: "5_15", longest_run: "unknown", quality: "easy_only" }), { min: 20, max: 50, def: 35, byFeel: true });
    assert.deepEqual(selfReportBand({ weekly_km: "0_5", longest_run: "up_to_3", quality: "easy_only" }), { min: 20, max: 50, def: 35, byFeel: true });
    assert.deepEqual(selfReportBand({ weekly_km: "unknown", longest_run: "unknown", quality: "unknown" }), { min: 20, max: 40, def: 30, byFeel: true });
    for (const wk of ["15_30", "30_50", "50_plus"] as WeeklyKm[]) {
      for (const runs of [3, 4] as Runs[]) {
        for (const quality of ["easy_only", "regularly"] as const) {
        const a = A.race(runs, runs === 4 ? "r4a" : "m3a", { weekly_km: wk, longest_run: "21_plus", quality });
        const ds = buildWeekEn("2026-11-02", a.pattern, 9 * 60)!.dates;
        const pace = easyMidSecPerKm(pacesFromResult("10k", 52 * 60));
        const w = runnerWeek("race", a, ds, pace, intervalMinutes);
        const total = w.base.reduce((s, p) => s + w.minutes[p], 0);
        const weekMin = (WEEK_KM[wk] * pace) / 60;
        // Not more than the current week, unless the shortest library sessions already exceed it
        // (then every easy run sits at its floor: the documented "floors win").
        const easyFloor = EASY_FLOOR;
        assert.ok(total <= weekMin + 1 || w.minutes.easy_continuous === easyFloor, `${wk}/${runs}: ${total} min vs ${Math.round(weekMin)}`);
        if (wk !== "15_30") assert.ok(total <= weekMin + 1, `${wk}/${runs}: ${total} min is not more than the current week`);
        assert.ok(w.minutes.long_aerobic <= LONG_MAX && w.minutes.long_aerobic > w.minutes.easy_continuous);
        assert.ok(w.minutes.easy_continuous >= EASY_FLOOR && w.minutes.easy_continuous <= Math.min(EASY_CEIL, w.band.max));
        }
      }
    }
    const capped = runnerWeek("race", A.race(3, "m3a", { weekly_km: "50_plus", longest_run: "5_10" }), buildWeekEn("2026-11-02", "m3a", 540)!.dates, 360, intervalMinutes);
    assert.ok(capped.minutes.long_aerobic <= 60, `long capped by a 10 km longest run at 6:00/km: ${capped.minutes.long_aerobic}`);
    const ret = runnerWeek("return", A.ret(3, "m3b"), buildWeekEn("2026-11-02", "m3b", 540)!.dates, 390, intervalMinutes);
    assert.equal(ret.minutes.test_run, ret.band.def, "test run = the band's default");
    assert.ok(ret.minutes.long_aerobic <= ret.minutes.easy_continuous + 10, "return: short long easy run");
  });

  await ok("int_walk presets: library flags allow them and texts match the parameters", () => {
    const sql = read("supabase/migrations/20260918_short_interval_presets.sql");
    assert.match(sql, /select v\.id, x\.code, 'manual', 'core', true, false,\s*false, false,\s*'L0'/, "enabled, not coach_only, no coach review, no explicit VO2, L0");
    assert.match(sql, /select ins\.id, p\.reps, 3, 'min', 1, 'min',\s*'walk', p\.reps \* 3, 6, 7, true/, "3 min work, 1 min walk, RPE 6/7");
    for (const code of INTERVAL_PRESETS) {
      const reps = Number(sql.match(new RegExp(`\\('${code}', (\\d+)\\)`))![1]);
      const i = INTERVALS[code];
      assert.deepEqual([i.reps, i.workMin, i.walkMin, i.rpeTarget, i.rpeCap], [reps, 3, 1, 6, 7], code);
      const w = runnerWorkout(code, 0, pacesFromResult("10k", 52 * 60));
      text(`interval ${code}`, `${w.title} ${w.body} ${w.steps.join(" ")}`);
      assert.equal(w.title, `${reps} x 3 min with 1 min walking`);
      assert.equal(w.minutes, 10 + reps * 3 + (reps - 1) + 10);
      assert.match(w.body, /effort 6 out of 10/);
      assert.match(w.body, /never above 7 out of 10/);
      assert.match(w.steps[1], /\/km \(\d+:\d{2}-\d+:\d{2} \/mi\)/, "work pace in km and miles");
    }
    const cat = read("src/features/trainingpeaks/workout-template-catalog.ts");
    assert.match(cat, /warmupRefCode: "warmup_standard_easy_10_15",\s*cooldownRefCode: "cooldown_easy_10_15",\s*descriptionRefCode: "desc_placeholder_threshold"/);
    assert.ok(INTERVAL_WARMUP_MIN >= 10 && INTERVAL_WARMUP_MIN <= 15 && INTERVAL_COOLDOWN_MIN >= 10 && INTERVAL_COOLDOWN_MIN <= 15);
  });

  await ok("paces: Igor's calculator math (/tools/plan), TP method-2 bands, result parsing", () => {
    // Same numbers as the calculator for its own reference example (10K in 40:00).
    const card = buildWorkoutCards(10000, 40 * 60);
    const p = pacesFromResult("10k", 40 * 60);
    const mmss = (s: number) => `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;
    assert.equal(card[0].paceRange.replace("–", "-").replace(" /км", ""), `${mmss(p.easy[0])}-${mmss(p.easy[1])}`);
    assert.equal(card[1].paceRange.replace("–", "-").replace(" /км", ""), `${mmss(p.tempo[0])}-${mmss(p.tempo[1])}`);
    // Friel multipliers = TP speed method-2 fractions (tools/trainingpeaks-export/scripts/lib/tp-zone-formulas.ts).
    const zones = read("tools/trainingpeaks-export/scripts/lib/tp-zone-formulas.ts");
    assert.match(zones, /ratios: \[0\.775, 0\.878, 0\.944, 1\.0, 1\.033, 1\.114\]/);
    const ftpa = p.easy[0] / 1.142;
    assert.ok(Math.abs(p.easy[1] / ftpa - 1 / 0.775) < 0.005 && Math.abs(p.easy[0] / ftpa - 1 / 0.878) < 0.005 && Math.abs(p.tempo[0] / ftpa - 1 / 0.944) < 0.005);
    const p52 = pacesFromResult("10k", 52 * 60);
    assert.ok(p52.easy[0] > p.easy[0] && p52.easy[0] > p52.tempo[1] - 1, "slower result → slower paces; easy slower than tempo");
    assert.match(paceRangeText(p52.easy), /^\d:\d{2}-\d:\d{2} \/km \(\d{1,2}:\d{2}-\d{1,2}:\d{2} \/mi\)$/);
    assert.equal(parseResultTime("52:00"), 3120);
    assert.equal(parseResultTime("1:52:30"), 6750);
    assert.equal(parseResultTime("52"), null);
    assert.equal(parseResultTime("52:75"), null);
    assert.deepEqual(checkResult("10k", "5:00"), { ok: false, error: "range" });
    assert.deepEqual(checkResult("10k", "abc"), { ok: false, error: "format" });
    assert.deepEqual(checkResult("half", "1:52:30"), { ok: true, seconds: 6750 });
    // No result → no paces anywhere in the week.
    const noRes = ctxOf(A.race(3, "m3a", { result_distance: null, result_seconds: null }), buildWeekEn("2026-11-02", "m3a", 540)!.dates);
    assert.equal(noRes.paces, null);
    for (const pl of planSessions(noRes.profile, [null, null, null], 3)) assert.ok(!/\/km/u.test(workoutFor(pl, null).body));
  });

  await ok("workouts: ladder numbers from BEGINNER_LADDER; runner durations inside the library bands", () => {
    for (const step of BEGINNER_LADDER) {
      const w = ladderWorkout(step.index);
      text(`ladder ${step.index}`, `${w.title} ${w.body} ${w.steps.join(" ")}`);
      assert.equal(w.presetCode, step.presetCode);
      assert.equal(w.minutes, step.totalMinutes);
      assert.match(w.body, /effort 2-4 out of 10/);
    }
    const sql = read("supabase/migrations/20260911000000_seed_parametric_easy_long_steady_presets.sql");
    const band = (code: string) => JSON.parse(sql.match(new RegExp(`\\('${code}',[\\s\\S]*?'(\\{[^']*\\})'\\)`))![1]) as { advisory_min_minutes: number; advisory_max_minutes: number };
    assert.equal(EASY_FLOOR, band("easy_continuous").advisory_min_minutes);
    assert.equal(EASY_CEIL, band("easy_continuous").advisory_max_minutes);
    assert.equal(STRIDES_MIN, band("easy_plus_strides").advisory_min_minutes);
    assert.equal(STRIDES_MAX, band("easy_plus_strides").advisory_max_minutes);
    assert.ok(RECOVERY_MINUTES >= band("recovery_easy").advisory_min_minutes && RECOVERY_MINUTES <= band("recovery_easy").advisory_max_minutes);
    const sr = sql.match(/\('easy_plus_strides',\s*(\d+),\s*(\d+),\s*'sec'/)!;
    assert.deepEqual([STRIDES.reps, STRIDES.seconds], [Number(sr[1]), Number(sr[2])]);
    const p = pacesFromResult("10k", 52 * 60);
    for (const pr of ["easy_continuous", "easy_plus_strides", "long_aerobic", "recovery_easy", "test_run"] as const) {
      const w = runnerWorkout(pr, 40, pr === "test_run" ? null : p, [20, 50]);
      text(`runner ${pr}`, `${w.title} ${w.body} ${w.steps.join(" ")}`);
      assert.ok(!/interval|tempo|threshold/i.test(w.body), "easy sessions stay easy");
    }
    assert.match(runnerWorkout("test_run", 35, null, [20, 50]).title, /^Test run, 20-50 min by feel$/);
  });

  // ── dates and clock ────────────────────────────────────────────────────────
  await ok("local clock: same instant, different dates by time zone; bad zones fall back to UTC", () => {
    const t = new Date("2026-11-02T23:30:00Z");
    assert.equal(localNow(t, "Europe/London").date, "2026-11-02");
    assert.equal(localNow(t, "Asia/Tokyo").date, "2026-11-03");
    assert.equal(safeTz("Mars/Olympus"), "UTC");
    assert.equal(safeTz("Europe/Belgrade"), "Europe/Belgrade");
  });

  // REWRITTEN 28.10.2026: was "2 or 3 sessions" only. 4-day patterns came with the runner track;
  // the stronger rule: for 2/3 days buildWeekEn is EXACTLY the Russian buildWeek, and for every
  // pattern incl. 4 days, day 7 is never a workout day (the summary goes there).
  await ok("weeks: Russian buildWeek for 2/3 days, 4-day patterns, day 7 never a workout day", () => {
    for (const code of Object.keys(EN_PATTERNS)) {
      for (let d = 0; d < 14; d++) {
        const today = addDays("2026-11-02", d);
        for (const minutes of [9 * 60, 15 * 60]) {
          const wk = buildWeekEn(today, code, minutes)!;
          assert.equal(wk.dates.length, EN_PATTERNS[code].runs, `${code} from ${today}`);
          assert.ok(!wk.dates.includes(addDays(wk.weekStart, 6)), `${code} day 7 is a workout day`);
          if (DAY_PATTERNS[code]) assert.deepEqual(wk, buildWeek(today, code, minutes), `${code}: same as the Russian bot`);
        }
      }
    }
    assert.equal(raceSoon("2026-11-02", "2026-12"), true);
    assert.equal(raceSoon("2026-11-02", "2027-03"), false);
    assert.equal(raceSoon("2026-11-02", "2026-10"), false);
  });

  await ok("check-in target and window: today first, else the last open past one, never the future", () => {
    const s = (idx: number, date: string, checkin: CheckinValue | null = null) => ({ idx, date, checkin });
    const ss = [s(1, "2026-11-02"), s(2, "2026-11-04"), s(3, "2026-11-07")];
    assert.equal(checkinTarget(ss, "2026-11-01"), null);
    assert.equal(checkinTarget(ss, "2026-11-03"), 1);
    assert.equal(checkinTarget(ss, "2026-11-04"), 2);
    assert.equal(canCheckin(ss, 3, "2026-11-04"), false, "future");
  });

  // ── service: plan, health, idempotency ─────────────────────────────────────
  await ok("health: only a boolean is sent and stored, no plan, no sessions", async () => {
    const form = read("src/app/en/week/WeekForm.tsx");
    const body = form.slice(form.indexOf("const body = {"), form.indexOf("};", form.indexOf("const body = {")));
    assert.match(body, /\bhealth,/);
    for (const item of HEALTH_ITEMS) assert.ok(!body.includes(item));
    assert.match(form, /onClick=\{\(\) => submit\(true\)\}/);
    assert.match(read("src/app/api/en-week/start/route.ts"), /typeof body\.health !== "boolean"/);
    const sql = read("supabase/migrations/20261115000000_en_week.sql").replace(/--.*$/gm, "");
    assert.ok(!/heart|pregnan|chest|injury_/i.test(sql), "no column for the health item");
    const m = enWeekMemStore();
    const r = await mk(m, "c-h", A.start(), "UTC", new Date("2026-11-02T09:00:00Z"), { health: true });
    assert.deepEqual(r, { ok: true, healthStop: true });
    assert.equal(m.users[0].health_flag, true);
    assert.equal(m.sessions.size, 0);
    assert.equal((await dmToday(m.store, "c-h", new Date("2026-11-03T08:00:00Z"))).kind, "health_stop");
  });

  await ok("plan creation, stored answers round-trip, re-open by the same chat, idempotent /today and check-ins", async () => {
    const m = enWeekMemStore();
    const tz = "Europe/London";
    const created = await mk(m, "c1", A.start(), tz, at("2026-11-02T09:00", tz), { username: "anna.runs" });
    assert.ok(created.ok && "token" in created && !created.existing);
    const u = m.users[0];
    assert.equal(u.week_start, "2026-11-02");
    assert.deepEqual(answersOf(u), { ...A.start(), return_last: null, return_level: null, race_distance: null, race_month: null, result_distance: null, result_seconds: null, weekly_km: null, longest_run: null, quality: null });
    const again = await mk(m, "c1", A.race(), tz, at("2026-11-03T09:00", tz));
    assert.ok(again.ok && "token" in again && again.existing && again.token === u.token);
    const t1 = await dmToday(m.store, "c1", at("2026-11-02T08:10", tz));
    assert.equal(t1.send, true);
    assert.equal(t1.kind, "workout");
    assert.equal((await dmToday(m.store, "c1", at("2026-11-02T09:50", tz))).send, false);
    const c1 = await dmCheckin(m.store, "c1", "ok", at("2026-11-02T19:30", tz));
    assert.match(c1.reply, /Next: 5 x \(4 min run \+ 2 min walk\), Wed 4 Nov\./);
    const n = m.events.filter((e) => e.kind === "checkin").length;
    await dmCheckin(m.store, "c1", "ok", at("2026-11-02T19:31", tz));
    assert.equal(m.events.filter((e) => e.kind === "checkin").length, n);
    const v2 = await pageCheckin(m.store, u.token, 2, "easy", at("2026-11-04T18:00", tz));
    assert.equal(v2.view!.sessions[2].title, "5 x (5 min run + 2 min walk)");
    assert.equal(v2.view!.offerVisible, true);
    const st = await dmStatus(m.store, "c1", at("2026-11-05T12:00", tz));
    assert.equal(st.next_workout_date, "2026-11-07");
  });

  await ok("runner track end to end: paces on the page, runner tone, race mention, replan keeps minutes", async () => {
    const m = enWeekMemStore();
    const tz = "Europe/London";
    await mk(m, "r1", A.race(4, "r4a", { race_month: "2026-12" }), tz, at("2026-11-02T09:00", tz));
    const u = m.users[0];
    assert.equal(u.track, "runner");
    assert.equal(u.plan_kind, "race");
    const v = (await loadPlanPage(m.store, u.token, at("2026-11-03T09:00", tz)))!;
    assert.equal(v.sessions.length, 4);
    assert.ok(v.runnerFacts.some((f) => /Easy pace: \d:\d{2}-\d:\d{2} \/km/.test(f)));
    assert.ok(v.runnerFacts.some((f) => f === "Best recent 10K: 52:00"));
    assert.match(v.goalLine, /Your 10K is in Dec 2026/);
    assert.ok(v.sessions.some((s) => s.isInterval));
    const before = m.sessions.get(u.id)!.map((s) => [s.preset_code, s.minutes]);
    const r = await dmCheckin(m.store, "r1", "ok", at("2026-11-03T19:00", tz));
    assert.equal(r.reply.startsWith(T.RUNNER_CHECKIN_REPLIES.ok), true, "runner tone");
    const after = m.sessions.get(u.id)!.map((s) => [s.preset_code, s.minutes]);
    assert.deepEqual(after, before, "replan with OK changes nothing");
    const sum = planView(m.users[0], m.sessions.get(u.id)!, at("2026-11-09T19:00", tz)).summary!;
    assert.match(sum, /toward your 10K in Dec 2026/);
  });

  await ok("replan keeps checked sessions and rewrites only open ones", () => {
    const a = A.reg(3, "m3a");
    const wk = newWeek(a, "m3a", new Date("2026-11-02T08:00:00Z"), "UTC")!;
    const marked: EnWeekSession[] = wk.sessions.map((s) => (s.idx === 1 ? { ...s, checkin: "hard", checkin_at: "x" } : s));
    const r = replan(wk.ctx, marked);
    assert.equal(r[0].checkin, "hard");
    assert.equal(r[1].preset_code, "recovery_easy");
    assert.equal(r[2].preset_code, "long_aerobic");
  });

  // ── the 24h window ─────────────────────────────────────────────────────────
  await ok(`24h window: polling every ${POLL_EVERY_MIN} min, no gap over 20 h from day 1 to the summary, 2-4 days`, async () => {
    const zones = ["Europe/London", "America/New_York", "Australia/Sydney"];
    for (const code of Object.keys(EN_PATTERNS)) {
      const runs = EN_PATTERNS[code].runs;
      const answers = runs === 4 ? A.race(4, code) : runs === 3 ? A.reg(3, code) : A.start("1_to_3km", 2, code);
      for (const tz of zones) {
        for (const phase of [0, 60]) {
          const m = enWeekMemStore();
          await mk(m, "w", answers, tz, at("2026-11-02T16:00", tz));
          const u = m.users[0];
          const start = at(`${addDays(u.week_start!, -1)}T00:00`, tz).getTime() + phase * 60_000;
          const end = at(`${addDays(u.week_start!, 6)}T23:59`, tz).getTime();
          const sends: number[] = [];
          for (let t = start; t <= end; t += POLL_EVERY_MIN * 60_000) {
            const r = await dmToday(m.store, "w", new Date(t));
            if (r.send) {
              assert.notEqual(r.buttons, "none");
              assert.ok(r.message.length <= DM_MAX, `${r.kind}: ${r.message.length}`);
              text(`dm ${code} ${r.kind}`, r.message);
              sends.push(t);
              if (r.kind === "checkin_ask") await dmCheckin(m.store, "w", "ok", new Date(t + 30 * 60_000));
            }
          }
          const first = sends.find((t) => localNow(new Date(t), tz).date === u.week_start)!;
          const inWeek = sends.filter((t) => t >= first);
          for (let i = 1; i < inWeek.length; i++) assert.ok((inWeek[i] - inWeek[i - 1]) / 3_600_000 <= 20, `${code} ${tz}: gap`);
        }
      }
    }
  });

  // ── offer, cases ───────────────────────────────────────────────────────────
  await ok("every country gets Marina's case (with photo) and the offer; no other case; one extra a DM day at most", async () => {
    for (const [country, tz] of [["GB", "Europe/London"], ["IN", "Asia/Kolkata"]] as const) {
      const m = enWeekMemStore();
      await mk(m, "o", A.start("3_to_5km"), tz, at("2026-11-02T09:00", tz), { country });
      const perDay = new Map<string, number>();
      const images: string[] = [];
      const kinds: string[] = [];
      const dmTexts: string[] = [];
      for (let t = at("2026-11-02T00:00", tz).getTime(); t <= at("2026-11-12T23:00", tz).getTime(); t += 60 * 60_000) {
        const r = await dmToday(m.store, "o", new Date(t));
        if (!r.send) continue;
        kinds.push(r.kind);
        dmTexts.push(`${r.message} ${r.image_url ?? ""}`);
        text(`dm ${r.kind}`, r.message);
        assert.ok(r.message.length <= DM_MAX);
        const extras = [T.CASE_MARINA.text, T.OFFER_DM, T.RUNNER_OFFER_DM].filter((x) => r.message.includes(x)).length;
        const d = localNow(new Date(t), tz).date;
        perDay.set(d, (perDay.get(d) ?? 0) + extras);
        for (const c of T.CASES) assert.equal(r.message.includes(c.text), r.image_url === c.imageUrl);
        if (r.image_url) images.push(r.image_url);
        if (r.kind === "checkin_ask") await dmCheckin(m.store, "o", "ok", new Date(t + 10 * 60_000));
      }
      for (const [, n] of perDay) assert.ok(n <= 1);
      // REWRITTEN 28.10.2026: was "Marina, Anna, Nadya, Sasha in order, with photos". Igor kept
      // only Marina in the English version: exactly one case photo in the whole DM schedule, and
      // no other Russian case text or photo anywhere in a DM (follow-ups day 8/10 go without one).
      assert.deepEqual(images, [T.CASE_MARINA.imageUrl], "only Marina, once");
      for (const ru of [RU.CASE_ANNA, RU.CASE_NADYA, RU.CASE_SASHA]) {
        assert.ok(!dmTexts.some((t) => t.includes(ru.photoUrl!)), "no other case photo");
      }
      assert.ok(!dmTexts.some((t) => /\b(Anna|Nadya|Sasha)\b/u.test(t)), "no other case in any DM");
      assert.ok(kinds.includes("summary") && kinds.includes("followup") && kinds.includes("final"));
      assert.equal((await dmToday(m.store, "o", at("2026-11-14T12:30", tz))).kind, "done");
    }
  });

  await ok("page: offer from the 2nd check-in or day 7, Marina only from day 2, sightings logged", async () => {
    const m = enWeekMemStore();
    const tz = "America/New_York";
    await mk(m, "p", A.ret(2, "m2a"), tz, at("2026-11-02T10:00", tz), { country: "US" });
    const u = m.users[0];
    assert.equal(u.week_start, "2026-11-03");
    const names = (v: { cases: Array<{ name: string }> }) => v.cases.map((c) => c.name);
    let v = (await loadPlanPage(m.store, u.token, at("2026-11-03T10:00", tz)))!;
    assert.equal(v.sessions[0].title.startsWith("Test run"), true, "return week starts with the test run");
    assert.deepEqual(names(v), []);
    v = (await loadPlanPage(m.store, u.token, at("2026-11-09T10:00", tz)))!;
    assert.deepEqual(names(v), ["Marina"]);
    assert.equal(v.offerVisible, true);
    v = (await loadPlanPage(m.store, u.token, at("2026-11-12T10:00", tz)))!;
    // REWRITTEN 28.10.2026: was Marina, Anna, Nadya, Sasha by day 10. English keeps Marina only.
    assert.deepEqual(names(v), ["Marina"], "the page shows only Marina, also after the week");
    assert.ok(m.events.some((e) => e.kind === "offer_shown"));
  });

  await ok("coach ping: exactly one per NEW plan, with the runner fields; none on health stop, reopen or check-ins", async () => {
    const m = enWeekMemStore();
    const sent: string[] = [];
    const notify = (t: string) => void sent.push(t);
    const a = A.race(4, "r4a");
    const input = { clientId: "n1", username: "tom.10k", answers: a, tz: "Australia/Sydney", health: false, country: "AU" };
    await createPlan(m.store, { ...input, clientId: "n0", health: true }, at("2026-11-02T09:00", input.tz), { notify });
    assert.equal(sent.length, 0);
    await createPlan(m.store, input, at("2026-11-02T09:00", input.tz), { notify });
    assert.equal(sent.length, 1);
    for (const re of [/@tom\.10k/, /Train for a race/, /Старт: 10K, Dec 2026/, /Результат: 10K 52:00/, /Объём: 15-30 km/, /Tue, Thu, Sat, Sun \(4\)/, /AU/, /Трек: бегун/]) assert.match(sent[0], re);
    await createPlan(m.store, input, at("2026-11-02T10:00", input.tz), { notify });
    await dmCheckin(m.store, "n1", "pain", at("2026-11-03T19:00", input.tz));
    assert.equal(sent.length, 1);
    for (const f of ["today", "checkin", "status", "page-checkin", "event"]) assert.ok(!read(`src/app/api/en-week/${f}/route.ts`).includes("notifyCoach"));
    assert.match(read("src/app/api/en-week/start/route.ts"), /notify: \(text\) => after\(\(\) => notifyCoach\(text\)\)/);
    assert.match(planStartedText({ username: null, clientId: null, country: null, answers: A.start(), track: "beginner" }), /Сейчас: I almost never run/);
  });

  // ── screenshots ────────────────────────────────────────────────────────────
  await ok("screenshots: the Intervals page's bucket and limits, token-scoped, 3 per workout, signed URLs, no ping", async () => {
    const actions = read("src/features/intervals/plan-page/actions.ts");
    assert.ok(actions.includes(`const DATA_URL_RE = ${DATA_URL_RE.toString()};`), "same data URL rule as the Intervals page");
    assert.ok(actions.includes(`const MAX_FILE_BYTES = ${MAX_FILE_BYTES === 4 * 1024 * 1024 ? "4 * 1024 * 1024" : MAX_FILE_BYTES};`));
    assert.match(read("src/features/intervals/plan-page/view.ts"), new RegExp(`SIGNED_URL_TTL_SECONDS = 60 \\* 60 \\* ${SIGNED_URL_TTL_SECONDS / 3600}`));
    assert.match(read("supabase/migrations/20261111000000_intervals_plan_page.sql"), /values \('intervals-checkin-files', 'intervals-checkin-files', false, 5242880, array\['image\/jpeg', 'image\/png', 'image\/webp'\]\)/, "the reused bucket is private, 5 MB, images only");
    assert.match(read("src/features/en-week/store.ts"), /from\(CHECKIN_FILE_BUCKET\)\.createSignedUrls/);
    assert.ok(!read("src/features/en-week/store.ts").includes("getPublicUrl"), "never public URLs");
    assert.match(read("supabase/migrations/20261115000000_en_week.sql"), /create table if not exists public\.en_week_screenshots/);
    assert.ok(!read("src/app/api/en-week/page-screenshot/route.ts").includes("notify"), "no coach ping for uploads");
    const png = `data:image/png;base64,${Buffer.from("fakepng").toString("base64")}`;
    assert.equal(parseImageDataUrl(png).ok, true);
    assert.deepEqual(parseImageDataUrl("data:image/gif;base64,R0lG"), { ok: false, error: "type" });
    assert.deepEqual(parseImageDataUrl("data:text/html;base64,PGI+"), { ok: false, error: "type" });
    assert.deepEqual(parseImageDataUrl(`data:image/jpeg;base64,${Buffer.alloc(MAX_FILE_BYTES + 1).toString("base64")}`), { ok: false, error: "size" });

    const m = enWeekMemStore();
    const tz = "Europe/London";
    await mk(m, "s1", A.start(), tz, at("2026-11-02T09:00", tz));
    await mk(m, "s2", A.start(), tz, at("2026-11-02T09:00", tz));
    const [u1, u2] = m.users;
    const now = at("2026-11-02T19:00", tz);
    assert.deepEqual(await pageAddScreenshot(m.store, u1.token, 2, png, now), { ok: false, error: "not_yet" }, "not before the workout day");
    assert.deepEqual(await pageAddScreenshot(m.store, u1.token, 9, png, now), { ok: false, error: "not_found" });
    for (let i = 0; i < MAX_SCREENSHOTS_PER_SESSION; i++) assert.equal((await pageAddScreenshot(m.store, u1.token, 1, png, now)).ok, true);
    assert.deepEqual(await pageAddScreenshot(m.store, u1.token, 1, png, now), { ok: false, error: "limit" });
    assert.ok(m.shots.every((x) => x.path.startsWith(`en-week/${u1.id}/1/`)), "paths under the owner");
    const v = (await loadPlanPage(m.store, u1.token, now))!;
    assert.equal(v.sessions[0].screenshots.length, 3);
    assert.ok(v.sessions[0].screenshots.every((x) => x.url.startsWith("https://signed.example/")), "signed URLs");
    assert.equal((await loadPlanPage(m.store, u2.token, now))!.sessions[0].screenshots.length, 0, "the other person sees none");
    const id = m.shots[0].id;
    assert.deepEqual(await pageDeleteScreenshot(m.store, u2.token, id, now), { ok: false, error: "not_found" }, "cannot delete someone else's");
    assert.equal((await pageDeleteScreenshot(m.store, u1.token, id, now)).ok, true);
    assert.equal(m.shots.length, 2);
    const ask = await dmToday(m.store, "s1", at("2026-11-02T19:30", tz));
    assert.equal(ask.kind, "checkin_ask");
    assert.ok(ask.message.includes(T.SCREENSHOT_DM_LINE), "evening check-in invites the screenshot");
  });

  // ── texts ──────────────────────────────────────────────────────────────────
  await ok("cases: Marina only, = the Russian case, same numbers and photo", () => {
    // REWRITTEN 28.10.2026: was all four Russian cases translated. English keeps Marina only:
    // she must match the Russian case number for number and photo for photo, and the English
    // texts module must not carry any other case at all.
    assert.deepEqual(T.CASES.map((c) => c.name), ["Marina"]);
    for (const k of ["CASE_ANNA", "CASE_NADYA", "CASE_SASHA"]) assert.ok(!(k in T), `${k} is gone from the English texts`);
    const pairs: Array<[RU.CaseStory, T.CaseStory]> = [[RU.CASE_MARINA, T.CASE_MARINA]];
    for (const [ru, en] of pairs) {
      assert.equal(en.imageUrl, ru.photoUrl);
      for (const n of ru.text.match(/\d+(?:[:,.]\d+)*/g) ?? []) assert.ok(en.text.includes(n.replace(",", ".")), `${en.name}: ${n}`);
    }
  });

  await ok("consult tool en-week → WhatsApp; runner CTA has its own prefill", () => {
    assert.ok((CONSULT_TOOLS as readonly string[]).includes("en-week"));
    assert.equal(normalizeConsultTool("en-week"), "en-week");
    assert.match(consultTarget("x", "en-week"), /^https:\/\/wa\.me\//);
    assert.equal(T.prefillFor("summary", "runner"), T.PREFILL_RUNNER);
    assert.equal(T.prefillFor("health", "runner"), T.PREFILL_HEALTH);
    assert.match(read("src/app/en/week/go/route.ts"), /consultUrl\(prefillFor\(place, track\)\)/);
  });

  await ok("no em or en dash in any text", () => {
    for (const [k, v] of Object.entries(T)) {
      if (typeof v === "string") text(`texts.${k}`, v);
      if (Array.isArray(v)) v.forEach((s, i) => { if (typeof s === "string") text(`texts.${k}[${i}]`, s); else if (s && typeof s === "object") text(`texts.${k}[${i}]`, JSON.stringify(s)); });
      if (v && typeof v === "object" && !Array.isArray(v)) text(`texts.${k}`, JSON.stringify(v));
    }
    for (const opts of [GOALS, START_NOW, START_LONGEST, RETURN_LAST, RETURN_LEVEL, WEEKLY_KM, LONGEST_RUN, QUALITY, RACE_DISTANCES]) text("options", JSON.stringify(opts));
    for (const v of VALUES) {
      text(`reply ${v}`, T.checkinReply(v, { title: "x", date: "Tue 3 Nov" }, "on Sun 8 Nov"));
      text(`runner reply ${v}`, T.checkinReply(v, { title: "x", date: "Tue 3 Nov" }, "on Sun 8 Nov", true));
    }
    text("walk", workoutFor({ kind: "walk" } as EnPlanned).body);
    for (const d of ["5k", "10k", "half", "marathon"] as RaceDist[]) text(`range ${d}`, T.resultErrorRange(d));
    for (const src of ["src/app/en/week/WeekForm.tsx", "src/app/en/week/p/[token]/PlanClient.tsx", "src/app/en/week/Shell.tsx", "src/app/en/week/page.tsx"]) {
      text(src, read(src).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
    }
    for (const [where, s] of seenTexts) assert.ok(!DASHES.test(s), `dash in ${where}: ${s.slice(0, 120)}`);
    assert.ok(seenTexts.length > 60);
  });

  await ok("composeDm without a user: no plan, nothing sent", () => {
    const d = composeDm(null, [], new Date("2026-11-02T09:00:00Z"));
    assert.equal(d.due, false);
    assert.equal(d.kind, "no_plan");
  });

  console.log(`check:en-week OK (${passed} checks)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
