/**
 * СБОРКА НЕДЕЛИ «ПОВТОР + ДЕЛЬТА» С ТЕКСТОМ И ПРОВЕРКОЙ — одна точка для трёх колонок и для
 * «раскидать». Чистая сборка: ничего не пишет ни в TP, ни в базу.
 *
 *   planRepeat (repeat.ts) → повтор нормальной недели × дельта, либо прецедент (precedent.ts)
 *   → adaptText (темпы из якорей атлета, минуты в тексте) → validateWeek (hard / warn).
 * Неделя с хоть одним hard-нарушением помечается refused: отдавать её нельзя.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AthleteContext } from "../lib/autoplanner-context.ts";
import { workMinutesFromTitle, type CWeek } from "./corpus.ts";
import { DATA_DIR } from "./load.ts";
import { adapt, findPrecedent, type Index, type PSess, type Weights } from "./precedent.ts";
import { adaptText } from "./adapt-text.ts";
import { planRepeat, setRepeatParams, type Abnormal, type CycleDelta } from "./repeat.ts";
import { validateWeek, weightedP90, type VResult, type VSess } from "./validate.ts";

export type BuiltSession = VSess & { flags: string[]; paceMode: string; srcWorkoutId: number; srcDate: string };
export type BuiltWeek = {
  aid: number; weekStart: string; sessions: BuiltSession[]; source: string; why: string;
  validator: VResult[]; refused: boolean; warnings: string[];
};

let paramsLoaded = false;
export function loadRepeatParams(): void {
  if (paramsLoaded) return;
  const p = JSON.parse(readFileSync(path.join(DATA_DIR, "repeat-params.json"), "utf8")) as { normal: number; gap: number; post: number; skip: Abnormal[]; applyPost: boolean };
  setRepeatParams(p); paramsLoaded = true;
}

const med = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Состояние недели «на понедельник» — для недели, которой ещё нет в корпусе (будущей). */
export function stateFor(ix: Index, aid: number, weekStart: string, races: Array<{ event_date: string; distance_km: number | null }>, ill: boolean): CWeek {
  const own = (ix.byAid.get(aid) ?? []).filter((w) => w.weekStart < weekStart);
  const prev = own[own.length - 1];
  const day = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const next = races.filter((r) => r.event_date >= weekStart).sort((a, b) => a.event_date.localeCompare(b.event_date))[0];
  const last = races.filter((r) => r.event_date < weekStart).sort((a, b) => b.event_date.localeCompare(a.event_date))[0];
  const off = next ? day(weekStart, next.event_date) : null;
  const weeksToRace = off != null ? Math.floor(off / 7) : null;
  const weeksSinceRace = last ? Math.floor(day(last.event_date, weekStart) / 7) + 1 : null;
  const gap = prev ? Math.round(day(prev.weekStart, weekStart) / 7) - 1 : 99;
  const last4 = own.filter((w) => w.weekStart >= new Date(Date.parse(weekStart) - 28 * 86400000).toISOString().slice(0, 10));
  const phase = weeksToRace === 0 ? "race" : weeksToRace != null && weeksToRace <= 2 ? "taper"
    : weeksSinceRace != null && weeksSinceRace <= 1 ? "post" : gap >= 2 || ill ? "return" : weeksToRace != null && weeksToRace <= 12 ? "build" : "base";
  const km = next?.distance_km ?? null;
  return {
    aid, weekStart, sessions: [], other: 0, total: 0, aerobic: 0, quality: 0, days: 0, qCount: 0, longDay: null, longMin: 0, work: 0, roles: ".......",
    prevTotal: prev && gap === 0 ? prev.total : 0, prevDays: prev && gap === 0 ? prev.days : 0, prevQ: prev && gap === 0 ? prev.qCount : 0,
    avg4: Math.round(last4.reduce((s, w) => s + w.total, 0) / 4), gapWeeks: gap,
    weeksToRace, raceKm: km, weeksSinceRace, raceDayIdx: off != null && off <= 13 ? off : null, ill, illAtStart: ill,
    tier: "T2", phase, distBucket: km == null ? "—" : km <= 6 ? "5к" : km <= 12 ? "10к" : km <= 25 ? "21к" : km <= 43 ? "42к" : "ультра",
    volBand: "", repeatOfPrev: false,
  };
}

export function buildRepeatWeek(ix: Index, t: CWeek, W: Weights, cycle: CycleDelta, c: AthleteContext | undefined, names: Map<number, string>): BuiltWeek | null {
  loadRepeatParams();
  const plan = planRepeat(ix, t, cycle);
  let ps: PSess[]; let source: string; let why: string;
  if (plan.kind === "repeat") {
    ps = plan.sessions;
    source = `ПОВТОР недели ${plan.base.weekStart} × дельта ${plan.delta}`;
    why = `${plan.deltaWhy}${plan.skipped.length ? `; пропущены как образец: ${plan.skipped.map((s) => `${s.week} (${s.why})`).join(", ")}` : ""}`;
  } else {
    const f = findPrecedent(ix, t, W, "any"); if (!f) return null;
    const a = adapt(ix, t, f);
    ps = a.sessions;
    const pn = f.p.aid === t.aid ? "своя" : `чужая — ${names.get(f.p.aid) ?? f.p.aid}`;
    source = `ПРЕЦЕДЕНТ (${plan.why}): неделя ${f.p.weekStart} (${pn}), масштаб ×${Math.round(100 * a.scale) / 100}, ${a.dayMap}`;
    why = `дистанция ${Math.round(100 * f.why.d) / 100}: ${[...f.why.parts].sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 4).map(([k, v]) => `${k} ${Math.round(100 * v) / 100}`).join(", ")}`;
  }
  const sessions: BuiltSession[] = ps.map((s) => {
    const tx = adaptText({ title: s.title, desc: s.src.desc, struct: s.src.struct, kind: s.kind, srcMinutes: s.src.minutes, minutes: s.minutes, a: c ?? null });
    return { dayIdx: s.dayIdx, kind: s.kind, title: tx.title, minutes: s.minutes, work: s.kind === "quality" ? workMinutesFromTitle(tx.title) : 0,
      description: tx.description, written: tx.written, flags: tx.flags, paceMode: tx.paceMode, srcWorkoutId: s.src.wid, srcDate: s.src.date };
  }).sort((a, b) => a.dayIdx - b.dayIdx);
  const hist = (ix.byAid.get(t.aid) ?? []).filter((w) => w.weekStart < t.weekStart);
  const prior = hist.slice(-8).map((w) => w.total);
  const validator = validateWeek(sessions, c?.envelope ?? null, {
    hasActiveIllness: c?.hasActiveIllness ?? t.illAtStart, checkText: true,
    normalLevel: prior.length >= 4 ? med(prior) : undefined, raceDayIdx: t.raceDayIdx,
    windowCaps: { weekly: weightedP90(hist.map((w) => ({ v: w.total, weekStart: w.weekStart })), t.weekStart), long: weightedP90(hist.map((w) => ({ v: w.longMin, weekStart: w.weekStart })), t.weekStart) },
  });
  const refused = validator.some((v) => v.severity === "hard" && !v.ok);
  const warnings = [...validator.filter((v) => !v.ok).map((v) => `${v.severity === "hard" ? "⛔" : "⚠"} ${v.name}${v.detail ? ` (${v.detail})` : ""}`), ...sessions.flatMap((s) => s.flags.map((f) => `⚑ ${s.title}: ${f}`))];
  return { aid: t.aid, weekStart: t.weekStart, sessions, source, why, validator, refused, warnings };
}
