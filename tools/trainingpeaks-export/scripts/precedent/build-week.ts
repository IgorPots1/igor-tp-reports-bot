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
import { mainRaceIds } from "./main-race.ts";
import { DATA_DIR } from "./load.ts";
import { adapt, findPrecedent, type Found, type Index, type Mode, type PSess, type Weights } from "./precedent.ts";
import { parseSnap, plannedHours, scaleToSeconds, totalSeconds, type Snap } from "./structure-copy.ts";
import { adaptText } from "./adapt-text.ts";
import { donorExcluded, planRepeat, setRepeatParams, type Abnormal, type CycleDelta } from "./repeat.ts";
import { recent } from "./recent-level.ts";
import { validateWeek, weightedP90, type VResult, type VSess } from "./validate.ts";

/** structure — снимок шагов, СКОПИРОВАННЫЙ из образца с пересчётом длительности под минуты сессии (structure-copy.ts); null — шагов не будет (причина в flags). */
export type BuiltSession = VSess & { flags: string[]; paceMode: string; srcWorkoutId: number; srcDate: string; structure: Snap | null };
export type BuiltWeek = {
  aid: number; weekStart: string; sessions: BuiltSession[]; source: string; why: string;
  validator: VResult[]; refused: boolean; warnings: string[];
  /** причина отказа, если неделя НЕ выдаётся: нет недавней истории или жёсткое нарушение */
  refusedWhy: string | null;
};

let paramsLoaded = false;
/**
 * Файл repeat-params.json несёт ТОЛЬКО подобранные числа (порог провала, длина паузы). Классы «не образец» (старт, после старта,
 * подводка, пик, провал) — решения Игоря и живут КОДОМ в repeat.ts: раньше файл перезаписывал и их, и устаревший файл молча
 * выключал «пик» (поймано проверкой 15.10).
 */
export function loadRepeatParams(): void {
  if (paramsLoaded) return;
  const p = JSON.parse(readFileSync(path.join(DATA_DIR, "repeat-params.json"), "utf8")) as { normal: number; gap: number; lookback?: number };
  setRepeatParams({ normal: p.normal, gap: p.gap, lookback: p.lookback }); paramsLoaded = true;
}
/** Тесты и бэктест задают параметры сами: файл читать не нужно. */
export function useExplicitParams(): void { paramsLoaded = true; }

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
  const nextRaceIsMain = next ? mainRaceIds(races.map((r) => ({ id: r.event_date, event_date: r.event_date, distance_km: r.distance_km }))).has(next.event_date) : false;
  return {
    aid, weekStart, sessions: [], other: 0, total: 0, aerobic: 0, quality: 0, days: 0, done: 0, qCount: 0, longDay: null, longMin: 0, work: 0, roles: ".......",
    prevTotal: prev && gap === 0 ? prev.total : 0, prevDays: prev && gap === 0 ? prev.days : 0, prevQ: prev && gap === 0 ? prev.qCount : 0,
    avg4: Math.round(last4.reduce((s, w) => s + w.total, 0) / 4), gapWeeks: gap,
    weeksToRace, raceKm: km, lastRaceKm: last?.distance_km ?? null, weeksSinceRace, raceDayIdx: off != null && off <= 13 ? off : null, nextRaceIsMain, ill, illAtStart: ill,
    tier: "T2", phase, distBucket: km == null ? "—" : km <= 6 ? "5к" : km <= 12 ? "10к" : km <= 25 ? "21к" : km <= 43 ? "42к" : "ультра",
    volBand: "", repeatOfPrev: false,
  };
}

/** Донор для боевого пути: ближайшая неделя по состоянию, кроме пиков (donorExcluded). */
export let DONOR_PEAK_FILTER = true;
export function setDonorPeakFilter(on: boolean): void { DONOR_PEAK_FILTER = on; }
export function selectDonor(ix: Index, t: CWeek, W: Weights, mode: Mode = "any"): Found | null {
  return findPrecedent(ix, t, W, mode, DONOR_PEAK_FILTER ? (p) => donorExcluded(ix, p) : undefined);
}

/**
 * descOverride: workoutId образца → ПОДЛИННЫЙ description из TP (с переносами строк). Кэш плановых строк хранит описание схлопнутым в одну строку
 * (tp-workouts-cache-scan.ts toCompactText: \s+ → " "), поэтому текст, скопированный из кэша, теряет «Разминка:» / «Основная часть:» на отдельных строках
 * (Игорь, 18.10, Ярулина). Карта задана, а id в ней нет (TP не ответил) — сессия остаётся со схлопнутым текстом и получает пометку ⚑.
 */
export function buildRepeatWeek(ix: Index, t: CWeek, W: Weights, cycle: CycleDelta, c: AthleteContext | undefined, names: Map<number, string>, descOverride?: Map<number, string>): BuiltWeek | null {
  loadRepeatParams();
  const plan = planRepeat(ix, t, cycle);
  let ps: PSess[]; let source: string; let why: string;
  if (plan.kind === "refuse") {
    return { aid: t.aid, weekStart: t.weekStart, sessions: [], source: "ОТКАЗ", why: plan.why, validator: [], refused: true, warnings: [`⛔ ${plan.why}`], refusedWhy: plan.why };
  }
  if (plan.kind === "repeat") {
    ps = plan.sessions;
    source = `ПОВТОР недели ${plan.base.weekStart} × дельта ${plan.delta}`;
    why = `${plan.deltaWhy}${plan.skipped.length ? `; пропущены как образец: ${plan.skipped.map((s) => `${s.week} (${s.why})`).join(", ")}` : ""}`;
  } else {
    const f = selectDonor(ix, t, W); if (!f) return null;
    const a = adapt(ix, t, f, true);
    ps = a.sessions;
    const pn = f.p.aid === t.aid ? "своя" : `чужая — ${names.get(f.p.aid) ?? f.p.aid}`;
    source = `ПРЕЦЕДЕНТ (${plan.why}): неделя ${f.p.weekStart} (${pn}), масштаб ×${Math.round(100 * a.scale) / 100}, ${a.dayMap}`;
    why = `дистанция ${Math.round(100 * f.why.d) / 100}: ${[...f.why.parts].sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 4).map(([k, v]) => `${k} ${Math.round(100 * v) / 100}`).join(", ")}`;
  }
  const sessions: BuiltSession[] = ps.map((s) => {
    const live = descOverride?.get(s.src.wid);
    const tx = adaptText({ title: s.title, desc: live ?? s.src.desc, struct: s.src.struct, kind: s.kind, srcMinutes: s.src.minutes, minutes: s.minutes, a: c ?? null });
    // СТРУКТУРА (наряд 18.10): шаги берутся из снимка образца, длительность пересчитывается под минуты сессии, рецепт интервалов не трогается.
    // Нет снимка / не пересчитывается / итог расходится с минутами больше чем на минуту — structure=null и пометка (на часах шагов не будет).
    let structure: Snap | null = null; const srcSnap = parseSnap(s.src.struct);
    if (!srcSnap) tx.flags.push("структуры в образце нет: шагов на часах не будет");
    else { const sc = scaleToSeconds(srcSnap, s.minutes * 60);
      // scaleToSeconds отдаёт ok только при точном равенстве секунд (одиночный шаг пересчитан или рецепт уже ровно на эти минуты), иначе — отказ с причиной
      if (!sc.ok) tx.flags.push(`структура не пересчитана (${sc.reason}): шагов на часах не будет`);
      else structure = sc.snap; }
    if (descOverride && live == null) tx.flags.push("переносы строк не восстановлены: подлинный текст из TP не получен, взят схлопнутый из кэша");
    return { dayIdx: s.dayIdx, kind: s.kind, title: tx.title, minutes: s.minutes, work: s.kind === "quality" ? workMinutesFromTitle(tx.title) : 0,
      description: tx.description, written: tx.written, flags: tx.flags, structure, paceMode: tx.paceMode, srcWorkoutId: s.src.wid, srcDate: s.src.date };
  }).sort((a, b) => a.dayIdx - b.dayIdx);
  const hist = (ix.byAid.get(t.aid) ?? []).filter((w) => w.weekStart < t.weekStart);
  const prior = hist.slice(-8).map((w) => w.total);
  const validator = validateWeek(sessions, c?.envelope ?? null, {
    hasActiveIllness: c?.hasActiveIllness ?? t.illAtStart, checkText: true,
    normalLevel: prior.length >= 4 ? med(prior) : undefined, raceDayIdx: t.nextRaceIsMain ? t.raceDayIdx : null,
    recent: recent(ix, t.aid, t.weekStart),
    postMarathonWeek: t.lastRaceKm != null && t.lastRaceKm >= 30 && t.weeksSinceRace != null ? t.weeksSinceRace : null,
    windowCaps: { weekly: weightedP90(hist.map((w) => ({ v: w.total, weekStart: w.weekStart })), t.weekStart), long: weightedP90(hist.map((w) => ({ v: w.longMin, weekStart: w.weekStart })), t.weekStart) },
  });
  const refused = validator.some((v) => v.severity === "hard" && !v.ok);
  const warnings = [...validator.filter((v) => !v.ok).map((v) => `${v.severity === "hard" ? "⛔" : "⚠"} ${v.name}${v.detail ? ` (${v.detail})` : ""}`), ...sessions.flatMap((s) => s.flags.map((f) => `⚑ ${s.title}: ${f}`))];
  const hard = validator.filter((v) => v.severity === "hard" && !v.ok).map((v) => `${v.name}${v.detail ? ` (${v.detail})` : ""}`);
  return { aid: t.aid, weekStart: t.weekStart, sessions, source, why, validator, refused, warnings, refusedWhy: refused ? hard.join("; ") : null };
}
