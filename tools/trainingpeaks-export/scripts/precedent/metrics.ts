/**
 * Оси сравнения — те же, что в tp-week-side-by-side.ts (summarise): сумма, дни, длительная,
 * самая длинная лёгкая, лёгких, минуты работы, доля качества, самая короткая, сессий < 45,
 * число качественных, день длительной, дни качественных.
 */
export type Side = { total: number; days: number; longest: number; longestEasy: number; easies: number; work: number; sharePct: number;
  shortest: number; underMin: number; qCount: number; longDay: number | null; qDays: number[] };
export type MSess = { minutes: number; kind: string; work?: number; dayIdx?: number };
const SHORT_SESSION_MIN = 45;

export function summarise(sessions: MSess[]): Side {
  const total = sessions.reduce((s, x) => s + x.minutes, 0);
  const longs = sessions.filter((x) => x.kind === "long");
  const easies = sessions.filter((x) => x.kind === "easy");
  const work = sessions.reduce((s, x) => s + (x.work ?? 0), 0);
  return {
    total, days: new Set(sessions.map((s) => s.dayIdx)).size,
    longest: longs.reduce((m, x) => Math.max(m, x.minutes), 0),
    longestEasy: easies.reduce((m, x) => Math.max(m, x.minutes), 0),
    easies: easies.length,
    work, sharePct: total > 0 ? Math.round(1000 * work / total) / 10 : 0,
    shortest: sessions.length ? sessions.reduce((m, x) => Math.min(m, x.minutes), Infinity) : 0,
    underMin: sessions.filter((x) => x.minutes < SHORT_SESSION_MIN).length,
    qCount: sessions.filter((x) => x.kind === "quality").length,
    longDay: longs.length ? ([...longs].sort((a, b) => b.minutes - a.minutes)[0].dayIdx ?? null) : null,
    qDays: sessions.filter((x) => x.kind === "quality").map((x) => x.dayIdx ?? -1).filter((d) => d >= 0).sort((a, b) => a - b),
  };
}

export type Err = {
  totalAbs: number; totalApe: number; daysAbs: number; daysExact: boolean; longestAbs: number; longestEasyAbs: number;
  easiesAbs: number; workAbs: number; shortestAbs: number; underAbs: number; qExact: boolean; qAbs: number;
  longDayHit: boolean | null; qDayHit: boolean | null;
};
export function err(actual: Side, pred: Side): Err {
  return {
    totalAbs: Math.abs(pred.total - actual.total), totalApe: Math.abs(pred.total - actual.total) / Math.max(30, actual.total),
    daysAbs: Math.abs(pred.days - actual.days), daysExact: pred.days === actual.days,
    longestAbs: Math.abs(pred.longest - actual.longest), longestEasyAbs: Math.abs(pred.longestEasy - actual.longestEasy),
    easiesAbs: Math.abs(pred.easies - actual.easies), workAbs: Math.abs(pred.work - actual.work),
    shortestAbs: Math.abs(pred.shortest - actual.shortest), underAbs: Math.abs(pred.underMin - actual.underMin),
    qExact: pred.qCount === actual.qCount, qAbs: Math.abs(pred.qCount - actual.qCount),
    longDayHit: actual.longDay == null ? null : pred.longDay === actual.longDay,
    qDayHit: actual.qDays.length === 0 || pred.qDays.length === 0 ? null : pred.qDays.some((d) => actual.qDays.includes(d)),
  };
}

/** Сводный балл для подбора весов: меньше — лучше. Доли, чтобы оси были соизмеримы. */
export function score(e: Err): number {
  return e.totalApe + 0.4 * e.daysAbs + 0.4 * e.qAbs + 0.3 * (e.longDayHit === false ? 1 : 0) + 0.004 * e.longestAbs;
}

export type Agg = { n: number; totalMae: number; totalMape: number; within15: number; daysExact: number; daysMae: number; longestMae: number; longestEasyMae: number;
  easiesMae: number; workMae: number; shortestMae: number; underMae: number; qExact: number; longDayHit: number; longDayN: number; qDayHit: number; qDayN: number; score: number };
export function aggregate(es: Err[]): Agg {
  const n = Math.max(1, es.length);
  const mean = (f: (e: Err) => number): number => Math.round(10 * es.reduce((s, e) => s + f(e), 0) / n) / 10;
  const rate = (f: (e: Err) => boolean): number => Math.round(1000 * es.filter(f).length / n) / 10;
  const ld = es.filter((e) => e.longDayHit != null); const qd = es.filter((e) => e.qDayHit != null);
  return {
    n: es.length, totalMae: mean((e) => e.totalAbs), totalMape: mean((e) => 100 * e.totalApe), within15: rate((e) => e.totalApe <= 0.15),
    daysExact: rate((e) => e.daysExact), daysMae: Math.round(100 * es.reduce((s, e) => s + e.daysAbs, 0) / n) / 100,
    longestMae: mean((e) => e.longestAbs), longestEasyMae: mean((e) => e.longestEasyAbs), easiesMae: Math.round(100 * es.reduce((s, e) => s + e.easiesAbs, 0) / n) / 100,
    workMae: mean((e) => e.workAbs), shortestMae: mean((e) => e.shortestAbs), underMae: Math.round(100 * es.reduce((s, e) => s + e.underAbs, 0) / n) / 100,
    qExact: rate((e) => e.qExact),
    longDayHit: Math.round(1000 * ld.filter((e) => e.longDayHit).length / Math.max(1, ld.length)) / 10, longDayN: ld.length,
    qDayHit: Math.round(1000 * qd.filter((e) => e.qDayHit).length / Math.max(1, qd.length)) / 10, qDayN: qd.length,
    score: Math.round(1000 * es.reduce((s, e) => s + score(e), 0) / n) / 1000,
  };
}
