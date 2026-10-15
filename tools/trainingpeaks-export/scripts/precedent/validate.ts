/**
 * ПРАВИЛА КАК ВАЛИДАТОР. Инварианты НЕДЕЛИ, перенесённые из tp-cycle-forecast-check.ts.
 *
 * ДВА УРОВНЯ (решение Игоря 15.10):
 *  - "hard" — защита от абсурда: неделя с таким нарушением НЕ отдаётся. Пороги стоят ЗА краем
 *    практики тренера (замер r1-caps.ts по 26 неделям), чтобы его собственные недели их не задевали:
 *      доля работы > 0.85 (его p99 0.83) · лёгкая < 20 мин (его минимум 24) ·
 *      объём > 2.3 × медиана 8 прошлых недель (его p99 2.31) · тяжёлое за 1–2 дня до старта.
 *  - "warn" — всё остальное, включая ВСЕ потолки: неделя собирается, пометка уходит тренеру.
 *    Потолки-предупреждения считаются по взвешенному p90 его недель (полураспад 4 нед): из
 *    шести окон оно ближе всего к нынешней практике (покрытие 86% против 70% у baseline).
 *
 * Имя каждой проверки — как в исходной, чтобы было видно, откуда она.
 */
import { ranges } from "../lib/tp-recompute.ts";
import type { Envelope } from "../lib/autoplanner-context.ts";
import { DUR } from "./adapt-text.ts";

export type VSess = { dayIdx: number; kind: "quality" | "long" | "easy"; title: string; minutes: number; work: number; description: string; written?: Array<{ fast: number; slow: number }> };
export type Severity = "hard" | "warn";
export type VResult = { name: string; ok: boolean; detail: string; severity: Severity };

export const HARD_WORK_SHARE = 0.85;
export const HARD_EASY_MIN = 20;
export const HARD_GROWTH_VS_NORMAL = 2.3;
/** Короткая активация: не качественная, не длительная, не длиннее этого. За 1 день до старта у тренера p90 = 40. */
export const PRE_RACE_ACTIVATION_MAX_MIN = 40;
export const PRE_RACE_DAYS = 2;

export type VOpts = {
  hasActiveIllness: boolean; checkText: boolean;
  /** медиана объёма 8 прошлых недель — база для жёсткой защиты от скачка */
  normalLevel?: number;
  /** день старта относительно понедельника недели (0..6; 7 = понедельник следующей); null — старта рядом нет */
  raceDayIdx?: number | null;
  /** потолки-предупреждения по окну практики */
  windowCaps?: { weekly: number | null; long: number | null } | null;
};

const adj = (a: number, b: number): boolean => Math.abs(a - b) === 1;

/**
 * Тяжёлое ли это для дней перед стартом: работа или дольше короткой активации. Только по ФАКТУ —
 * качество или минуты, — НЕ по ярлыку «длительная». Ярлык означает «самая длинная в неделе»: перед
 * главным стартом 27 из 31 таких сессий — ровно 40 мин, то есть сама активация (замер 15.10).
 * С ярлыком запрет «отклонял» 46 из 160 собственных недель Игоря перед главными стартами, по факту — 19.
 */
export function heavyBeforeRace(s: { kind: string; minutes: number }): boolean {
  return s.kind === "quality" || s.minutes > PRE_RACE_ACTIVATION_MAX_MIN;
}

export function validateWeek(ss: VSess[], env: Envelope | null, o: VOpts): VResult[] {
  const out: VResult[] = [];
  const add = (name: string, ok: boolean, detail = "", severity: Severity = "warn"): void => { out.push({ name, ok, detail, severity }); };
  const q = ss.filter((s) => s.kind === "quality"); const l = ss.filter((s) => s.kind === "long"); const e = ss.filter((s) => s.kind === "easy");
  const total = ss.reduce((s, x) => s + x.minutes, 0);
  const work = q.reduce((s, x) => s + x.work, 0);

  // ── жёсткие ──
  if (total > 0 && q.length) add("ЖЁСТКО: доля работы не выше 0.85 недели", work / total <= HARD_WORK_SHARE, `${work} из ${total}`, "hard");
  add("ЖЁСТКО: ни одна лёгкая не короче 20 мин", e.every((x) => x.minutes >= HARD_EASY_MIN), `лёгкие ${e.map((x) => x.minutes)}`, "hard");
  if (o.normalLevel && o.normalLevel > 0) add("ЖЁСТКО: объём не выше 2.3 × обычного", total <= HARD_GROWTH_VS_NORMAL * o.normalLevel, `${total} при обычном ${o.normalLevel}`, "hard");
  if (o.raceDayIdx != null) {
    const bad = ss.filter((s) => { const off = o.raceDayIdx! - s.dayIdx; return off >= 1 && off <= PRE_RACE_DAYS && heavyBeforeRace(s); });
    add("ЖЁСТКО: за 1–2 дня до старта ничего тяжелее короткой активации", bad.length === 0, bad.map((s) => `${s.title} ${s.minutes} мин`).join("; "), "hard");
  }

  // ── предупреждения ──
  add("дни: качество не смежно с длительной", !q.some((x) => l.some((y) => adj(x.dayIdx, y.dayIdx))));
  add("дни: две качественные не в смежные дни", !q.some((x) => q.some((y) => x !== y && adj(x.dayIdx, y.dayIdx))));
  add("дни: день после длительной — лёгкий, а не качественный", !l.some((y) => q.some((x) => x.dayIdx === y.dayIdx + 1)));
  add("дни: не больше одной беговой сессии в день", new Set(ss.map((s) => s.dayIdx)).size === ss.length);
  if (l.length && e.length) add("длительная длиннее любой лёгкой", l.every((y) => e.every((x) => y.minutes >= x.minutes)), `длит ${l.map((x) => x.minutes)} / лёгкие ${e.map((x) => x.minutes)}`);
  if (q.length >= 2) add("две качественные: суммарная работа не выше 20% недели", work <= 0.2 * total, `${work} из ${total}`);
  if (env) {
    if (env.easyFloorPersonalMin > 0) add("личный пол лёгкой: ни одна лёгкая не короче собственного минимума атлета", e.every((x) => x.minutes >= env.easyFloorPersonalMin), `пол ${env.easyFloorPersonalMin}, лёгкие ${e.map((x) => x.minutes)}`);
    if (env.lastWeekPlannedMinutes > 0) add("прирост к прошлой плановой неделе не выше ×1.22", total <= Math.round(env.lastWeekPlannedMinutes * 1.22), `${total} против ${env.lastWeekPlannedMinutes}`);
    if (env.capQuality != null) add("качественных не больше потолка baseline", q.length <= env.capQuality, `${q.length} / ${env.capQuality}`);
    if (env.capFrequency != null) add("беговых дней не больше потолка baseline", ss.length <= env.capFrequency, `${ss.length} / ${env.capFrequency}`);
    if (!o.windowCaps) {
      if (env.capWeeklyMin) add("объём не выше потолка baseline", total <= env.capWeeklyMin, `${total} / ${env.capWeeklyMin}`);
      if (env.capLongRunMin) add("длительная не выше потолка baseline", l.every((x) => x.minutes <= env.capLongRunMin!), `потолок ${env.capLongRunMin}`);
    }
  }
  if (o.windowCaps?.weekly) add("объём не выше потолка практики (взвешенный p90)", total <= o.windowCaps.weekly, `${total} / ${o.windowCaps.weekly}`);
  if (o.windowCaps?.long) add("длительная не выше потолка практики (взвешенный p90)", l.every((x) => x.minutes <= o.windowCaps!.long!), `потолок ${o.windowCaps.long}`);
  if (o.hasActiveIllness) add("сигнал здоровья активен — проверь самочувствие перед отдачей", false, "у тренера в такие недели объём медиана 1.0 от обычного, качество сохраняется в 63%");

  if (o.checkText) {
    const bad = ss.filter((s) => s.written && s.written.length > 0).filter((s) => {
      const got = ranges(s.description);
      return got.length !== s.written!.length || got.some((g, i) => g.fast !== s.written![i].fast || g.slow !== s.written![i].slow);
    });
    add("описание: каждый записанный темп читается обратно тем же парсером (обратная сверка)", bad.length === 0, bad.map((s) => s.title).join("; "), "hard");
    const minBad = ss.filter((s) => s.kind !== "quality").filter((s) => {
      const d = [...s.description.matchAll(DUR)].map((m) => Number(m[1]));
      return d.length > 0 && !d.includes(s.minutes) && d.reduce((a, b) => a + b, 0) !== s.minutes;
    });
    add("описание: минуты в тексте совпадают с минутами сессии", minBad.length === 0, minBad.map((s) => `${s.title} ${s.minutes}`).join("; "));
    add("описание: у каждой сессии есть текст", ss.every((s) => s.description.trim().length > 0));
  }
  return out;
}

/** Взвешенный p90 (полураспад в неделях) — потолок-предупреждение по практике. */
export function weightedP90(items: Array<{ v: number; weekStart: string }>, asOf: string, halfLifeWeeks = 4): number | null {
  const xs = items.filter((x) => x.v > 0 && x.weekStart < asOf).map((x) => ({ v: x.v, w: Math.pow(0.5, (Date.parse(asOf) - Date.parse(x.weekStart)) / 86400000 / 7 / halfLifeWeeks) }));
  if (xs.length < 4) return null;
  xs.sort((a, b) => a.v - b.v);
  const tot = xs.reduce((s, x) => s + x.w, 0); let acc = 0;
  for (const x of xs) { acc += x.w; if (acc >= 0.9 * tot) return x.v; }
  return xs[xs.length - 1].v;
}
