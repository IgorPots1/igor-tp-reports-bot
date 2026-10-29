/**
 * Free training week, four personas end to end: the page screens they see, then every DM
 * payload ChatPlace would get from GET /api/en-week/today (polled every 2 hours, as in
 * docs/specs/en-week-chatplace.md) and every check-in reply, day by day, in local time.
 *
 * No DB, no network, no ChatPlace: in-memory store, the same service the routes call.
 *
 *   npm run en-week:simulate [-- <path to .md>]
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  GOALS,
  HEALTH_NONE_LABEL,
  LONGEST_RUN,
  POLL_EVERY_MIN,
  QUALITY,
  RACE_DISTANCES,
  RETURN_LAST,
  RETURN_LEVEL,
  START_LONGEST,
  START_NOW,
  WEEKLY_KM,
  addDays,
  localNow,
  monthLabelEn,
  patternLabelEn,
  stepsFor,
  type Answers,
  type CheckinValue,
} from "@/features/en-week/logic";
import { formatDuration } from "@/features/en-week/paces";
import { createPlan, dmCheckin, dmToday, loadPlanPage, pageCheckin } from "@/features/en-week/service";
import * as T from "@/features/en-week/texts";

import { enWeekMemStore } from "./lib/en-week-memstore";

const DEFAULT_OUT = "/tmp/claude-0/-home-claude/2c65c568-7adf-5433-ae1c-d7706e747f99/scratchpad/en-week-sim.md";

type Persona = {
  name: string;
  c: string;
  u: string;
  answers: Answers;
  tz: string;
  country: string;
  /** Local time the plan is made. */
  start: string;
  /** Check-ins in order. "page:" prefix = tapped on the plan page, otherwise in the DM. */
  checkins: Array<CheckinValue | `page:${CheckinValue}` | null>;
};

const PERSONAS: Persona[] = [
  {
    name: "Sarah, never ran, wants to start",
    c: "1001", u: "sarah.k", tz: "Europe/London", country: "GB", start: "2026-11-02T08:40",
    answers: { goal: "start_running", start_now: "never_or_almost_never", start_longest: "less_than_1km", runs: 3, pattern: "m3a" },
    checkins: ["ok", "page:easy", "ok"],
  },
  {
    name: "Mike, coming back after 6+ months, used to run 5K",
    c: "1002", u: "mike_runs", tz: "America/New_York", country: "US", start: "2026-11-02T21:15",
    answers: { goal: "return_to_running", return_last: "6_plus_months_ago", return_level: "around_5km", weekly_km: "0_5", longest_run: "3_5", quality: "easy_only", runs: 3, pattern: "m3b" },
    checkins: ["ok", "hard", "skipped"],
  },
  {
    name: "Ana, runs regularly 15-30 km, 4 days",
    c: "1003", u: "ana.vida", tz: "Europe/Madrid", country: "ES", start: "2026-11-02T13:05",
    answers: { goal: "run_consistently", weekly_km: "15_30", longest_run: "5_10", quality: "sometimes", runs: 4, pattern: "r4b" },
    checkins: ["ok", "pain", "page:ok", "ok"],
  },
  {
    name: "Tom, 10K race in Dec, best 10K 52:00, 4 days",
    c: "1004", u: "tom.10k", tz: "Australia/Sydney", country: "AU", start: "2026-11-02T18:30",
    answers: { goal: "train_for_race", race_distance: "10k", race_month: "2026-12", result_distance: "10k", result_seconds: 52 * 60, weekly_km: "15_30", longest_run: "10_15", quality: "sometimes", runs: 4, pattern: "r4a" },
    checkins: ["easy", "ok", "hard", null],
  },
];

function at(local: string, tz: string): Date {
  let t = Date.parse(`${local}:00Z`);
  for (let i = 0; i < 3; i++) {
    const l = localNow(new Date(t), tz);
    const have = Date.parse(`${l.date}T${String(Math.floor(l.minutes / 60)).padStart(2, "0")}:${String(l.minutes % 60).padStart(2, "0")}:00Z`);
    t += Date.parse(`${local}:00Z`) - have;
  }
  return new Date(t);
}

function hhmm(d: Date, tz: string): string {
  const l = localNow(d, tz);
  return `${l.date} ${String(Math.floor(l.minutes / 60)).padStart(2, "0")}:${String(l.minutes % 60).padStart(2, "0")}`;
}

/** Machine-readable DM log next to the .md (used to draw the Instagram-like mock). */
export type DmLogEntry = { persona: string; at: string; day: number; kind: string; message: string; buttons?: string; image_url?: string | null; tap?: string };
const log: DmLogEntry[] = [];

const quote = (s: string) => s.split("\n").map((l) => `> ${l}`).join("\n");

async function run(p: Persona, out: string[]) {
  const m = enWeekMemStore();
  out.push(`## ${p.name}`, "", `Time zone ${p.tz}, country ${p.country}. Opens igorp.run/en/week?c=${p.c}&u=${p.u} at ${p.start.replace("T", " ")} local.`, "");
  out.push("### Page", "");
  out.push(`**Intro.** ${T.INTRO_TITLE}. ${T.INTRO_LEDE} [Get my free week]`, "");
  const A = p.answers;
  const steps = stepsFor(A.goal);
  const pick = <T extends string>(opts: Array<{ code: T; label: string }>, v: T | null | undefined) => opts.map((o) => (o.code === v ? `[**${o.label}**]` : `[${o.label}]`)).join(" ");
  const screen: Record<string, string> = {
    goal: `${T.Q_GOAL} ${pick(GOALS, A.goal)}`,
    start_now: `${T.Q_START_NOW} ${pick(START_NOW, A.start_now)}`,
    start_longest: `${T.Q_START_LONGEST} ${pick(START_LONGEST, A.start_longest)}`,
    return_last: `${T.Q_RETURN_LAST} ${pick(RETURN_LAST, A.return_last)}`,
    return_level: `${T.Q_RETURN_LEVEL} ${pick(RETURN_LEVEL, A.return_level)}`,
    race: `${T.Q_RACE} ${pick(RACE_DISTANCES, A.race_distance)} · ${T.Q_RACE_MONTH} **${A.race_month ? monthLabelEn(A.race_month) : "-"}**`,
    result: `${T.Q_RESULT} ${A.result_distance ? `${pick(RACE_DISTANCES, A.result_distance)} time **${formatDuration(A.result_seconds ?? 0)}**` : `[**${T.NO_RESULT}**]`}`,
    days: `${T.Q_DAYS} [**${A.runs}**]`,
    pattern: `${T.Q_PATTERN} [**${patternLabelEn(A.pattern)}**]`,
    baseline: `${T.Q_BASELINE}: ${T.Q_WEEKLY_KM} ${pick(WEEKLY_KM, A.weekly_km)} · ${T.Q_LONGEST_RUN} ${pick(LONGEST_RUN, A.longest_run)} · ${T.Q_QUALITY} ${pick(QUALITY, A.quality)}`,
    health: `${T.Q_HEALTH} [**${HEALTH_NONE_LABEL}**]`,
  };
  steps.forEach((st, i) => out.push(`**${i + 1}/${steps.length}** ${screen[st]}`, ""));

  const created = await createPlan(m.store, { clientId: p.c, username: p.u, answers: p.answers, tz: p.tz, health: false, country: p.country }, at(p.start, p.tz));
  if (!created.ok || !("token" in created)) throw new Error("no plan");
  const u = m.users[0];
  const view = (await loadPlanPage(m.store, created.token, at(p.start, p.tz)))!;
  out.push(`**Plan screen** (/en/week/p/${created.token.slice(0, 6)}...): "${view.patternLabel ? `Your week: ${view.patternLabel}` : "Your week"}"`, "");
  out.push(`${view.goalLine}`, "");
  if (view.runnerFacts.length) out.push(...view.runnerFacts.map((f) => `- ${f}`), "");
  for (const s of view.sessions) out.push(`- Workout ${s.idx}, ${s.dateLabel}: **${s.title}** (${s.minutes} min). Steps: ${s.steps.join("; ")}.`);
  out.push("", `Track: ${view.track}, week: ${view.planKind}. Note: ${view.track === "runner" ? T.RUNNER_PLAN_RULE : T.PLAN_RULE} ${T.PLAN_DM_NOTE}`, "");

  out.push("### DMs (ChatPlace polls GET /today every 2 hours)", "");
  const start = at(p.start, p.tz).getTime();
  const end = at(`${addDays(u.week_start!, 10)}T23:00`, p.tz).getTime();
  let ci = 0;
  let lastDay = "";
  for (let t = start; t <= end; t += POLL_EVERY_MIN * 60_000) {
    const now = new Date(t);
    const r = await dmToday(m.store, p.c, now);
    if (!r.send) continue;
    const day = localNow(now, p.tz).date;
    if (day !== lastDay) {
      out.push(`#### ${day} (day ${r.day})`, "");
      lastDay = day;
    }
    const btn = r.buttons === "checkin" ? "[Easy] [OK] [Hard] [Skipped] [Something hurt]" : r.buttons === "offer" ? "[Message Igor] (url) [Got it]" : r.buttons === "ack" ? "[Got it]" : "(no buttons)";
    out.push(`**${hhmm(now, p.tz)}** · ${r.kind} · ${r.message.length} chars · buttons ${btn}`, "");
    if (r.image_url) out.push(`![photo](${r.image_url})`, "");
    out.push(quote(r.message), "");
    log.push({ persona: p.name, at: hhmm(now, p.tz), day: r.day, kind: r.kind, message: r.message, buttons: r.buttons, image_url: r.image_url });

    if (r.kind === "checkin_ask" || (r.kind === "workout" && p.checkins[ci]?.toString().startsWith("page:"))) {
      const c = p.checkins[ci];
      ci++;
      if (c === null || c === undefined) {
        out.push("_(no tap)_", "");
        continue;
      }
      const tap = new Date(t + 25 * 60_000);
      if (c.startsWith("page:")) {
        const value = c.slice(5) as CheckinValue;
        const idx = m.sessions.get(u.id)!.find((s) => s.date === day)!.idx;
        const res = await pageCheckin(m.store, u.token, idx, value, new Date(t + 10 * 60 * 60_000));
        out.push(`_Taps **${T.CHECKIN_LABELS[value]}** on the plan page that evening._ Page shows:`, "", quote(res.reply), "");
        log.push({ persona: p.name, at: "page", day: r.day, kind: "page_checkin", message: res.reply, tap: T.CHECKIN_LABELS[value] });
      } else {
        const res = await dmCheckin(m.store, p.c, c, tap);
        out.push(`_Taps **${T.CHECKIN_LABELS[c]}** at ${hhmm(tap, p.tz)}._ POST /checkin reply:`, "", quote(res.reply), "");
        log.push({ persona: p.name, at: hhmm(tap, p.tz), day: r.day, kind: "reply", message: res.reply, tap: T.CHECKIN_LABELS[c] });
      }
    }
  }
  const final = (await loadPlanPage(m.store, u.token, at(`${addDays(u.week_start!, 6)}T21:30`, p.tz)))!;
  out.push("### Plan page on day 7", "");
  for (const s of final.sessions) out.push(`- Workout ${s.idx}, ${s.dateLabel}: ${s.title}${s.checkin ? `, logged: ${T.CHECKIN_LABELS[s.checkin]}` : ""}`);
  out.push("", `Cases visible: ${final.cases.map((c) => c.name).join(", ") || "-"}. Offer block: ${final.offerVisible ? "yes" : "no"}.`, "");
  out.push("Summary:", "", quote(final.summary ?? "(none)"), "");
  const funnel = m.events.map((e) => (e.kind === "dm" ? `dm:${(e.meta as { kind: string }).kind}` : e.kind));
  out.push(`Events: ${funnel.join(", ")}`, "", "---", "");
}

async function main() {
  const target = process.argv[2] ?? DEFAULT_OUT;
  const out: string[] = ["# en-week simulation", "", `Generated ${new Date().toISOString()}. Polling every ${POLL_EVERY_MIN} min; local times per persona.`, ""];
  for (const p of PERSONAS) await run(p, out);
  writeFileSync(path.resolve(target), out.join("\n"));
  writeFileSync(path.resolve(target).replace(/\.md$/, "") + ".json", JSON.stringify(log, null, 2));
  console.log(`en-week:simulate → ${target}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
