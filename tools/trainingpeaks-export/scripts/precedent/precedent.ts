/**
 * ПРЕЦЕДЕНТ: найти среди рукописных недель тренера ближайшую к состоянию атлета и подогнать.
 *
 * СОСТОЯНИЕ — только то, что известно В ПОНЕДЕЛЬНИК недели (без подглядывания в саму неделю):
 * недели до старта и дистанция, прошлая неделя (объём, дни, качественные), средний объём
 * за 4 недели, зазор в плане, открытый на понедельник health-сигнал, недавний старт.
 *
 * ПРЕЦЕДЕНТ ДАЁТ СОСТАВ И ОТНОСИТЕЛЬНЫЙ ШАГ, а не абсолютные минуты: неделя переносится
 * масштабом «уровень атлета / уровень прецедента», где уровень = средний объём 4 недель до неё.
 * Так прецедент «после старта сбросил 30%» переносится как сброс 30%, на любом объёме.
 *
 * СВОИ НЕДЕЛИ ВПЕРЁД ЧУЖИХ: своя неделя несёт его дни, его названия и его привычный рисунок.
 * Это вес own (бонус к близости) — на сколько чужая неделя должна быть ближе по состоянию,
 * чтобы обойти свою. Подбирается бэктестом, а не назначается.
 */
import type { CSess, CWeek, Kind } from "./corpus.ts";
import { weeksBetween } from "./corpus.ts";

/** Выбрано по обучающему отрезку, см. step3-backtest.ts «база перехода». */
export type TransitionBase = "prev" | "level" | "none";
export let TRANSITION_BASE: TransitionBase = "none";
export function setTransitionBase(b: TransitionBase): void { TRANSITION_BASE = b; }

export type Weights = {
  phase: number; dist: number; vol: number; prev: number; prevDays: number; prevQ: number;
  ill: number; post: number; gap: number; own: number; recency: number;
};
/** Подобраны бэктестом на неделях ДО 2026-03-02 (см. step3-backtest.ts, раздел «подбор весов»). */
export const DEFAULT_WEIGHTS: Weights = { phase: 1.0, dist: 0.5, vol: 1.0, prev: 1.0, prevDays: 0.3, prevQ: 0.3, ill: 0.5, post: 0.5, gap: 0.5, own: 0.6, recency: 0.3 };

const lr = (a: number, b: number): number => Math.abs(Math.log((a + 30) / (b + 30)));
const racePos = (w: CWeek): number => (w.weeksToRace == null ? 30 : Math.min(26, w.weeksToRace));
const recentRace = (w: CWeek): boolean => w.weeksSinceRace != null && w.weeksSinceRace <= 1 && (w.weeksToRace == null || w.weeksToRace > 2);

export type Why = { d: number; parts: Array<[string, number]> };

export function distance(t: CWeek, p: CWeek, W: Weights): Why {
  const parts: Array<[string, number]> = [];
  const add = (k: string, v: number): void => { if (v !== 0) parts.push([k, v]); };
  add("до старта", W.phase * Math.abs(Math.log((racePos(t) + 1) / (racePos(p) + 1))));
  if (t.weeksToRace != null && p.weeksToRace != null && t.weeksToRace <= 12 && p.weeksToRace <= 12 && t.distBucket !== p.distBucket) add("дистанция", W.dist);
  add("уровень 4 нед", W.vol * lr(t.avg4, p.avg4));
  add("прошлая неделя", W.prev * lr(t.prevTotal, p.prevTotal));
  add("дней прошлой", W.prevDays * Math.abs(t.prevDays - p.prevDays));
  add("качеств. прошлой", W.prevQ * Math.abs(t.prevQ - p.prevQ));
  if (t.illAtStart !== p.illAtStart) add("сигнал здоровья", W.ill);
  if (recentRace(t) !== recentRace(p)) add("после старта", W.post);
  if ((t.gapWeeks >= 2) !== (p.gapWeeks >= 2)) add("перерыв", W.gap);
  if (p.aid === t.aid) { add("своя неделя", -W.own); add("давность", W.recency * Math.max(0, weeksBetween(p.weekStart, t.weekStart)) / 52); }
  return { d: parts.reduce((s, [, v]) => s + v, 0), parts };
}

export type Index = { all: CWeek[]; byAid: Map<number, CWeek[]> };
export function indexCorpus(c: CWeek[]): Index {
  const all = [...c].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const byAid = new Map<number, CWeek[]>();
  for (const w of all) (byAid.get(w.aid) ?? byAid.set(w.aid, []).get(w.aid)!).push(w);
  return { all, byAid };
}

export type Mode = "any" | "own" | "others";
export type Found = { p: CWeek; why: Why; ownAvailable: number };

/** Ближайший прецедент среди недель СТРОГО раньше целевой (честное время). */
export function findPrecedent(ix: Index, t: CWeek, W: Weights, mode: Mode = "any"): Found | null {
  let best: Found | null = null;
  const ownAvailable = (ix.byAid.get(t.aid) ?? []).filter((w) => w.weekStart < t.weekStart).length;
  for (const p of ix.all) {
    if (p.weekStart >= t.weekStart) break;
    if (mode === "own" && p.aid !== t.aid) continue;
    if (mode === "others" && p.aid === t.aid) continue;
    const why = distance(t, p, W);
    if (!best || why.d < best.why.d) best = { p, why, ownAvailable };
  }
  return best;
}

// ── подгонка ──

export type PSess = { dayIdx: number; kind: Kind; title: string; minutes: number; work: number; src: CSess };
export type Adapted = { sessions: PSess[]; scale: number; dayMap: string };

const round5 = (m: number): number => Math.max(15, Math.round(m / 5) * 5);

/** Привычка атлета по дням для каждой роли — по его неделям ДО целевой (последние 16). */
export function dayHabit(ix: Index, aid: number, before: string): Record<Kind, number[]> {
  const ws = (ix.byAid.get(aid) ?? []).filter((w) => w.weekStart < before).slice(-16);
  const h: Record<Kind, number[]> = { quality: Array(7).fill(0), long: Array(7).fill(0), easy: Array(7).fill(0) };
  for (const w of ws) for (const s of w.sessions) h[s.kind][s.dayIdx]++;
  return h;
}

/**
 * Перенос прецедента на атлета: масштаб объёма + его дни.
 * Своя неделя — дни как есть. Чужая — роли раскладываются по привычке целевого атлета:
 * длительная в его самый частый день длительной, качественные в его дни качества, лёгкие в
 * оставшиеся его беговые дни; нет истории — дни прецедента.
 * Качественная НЕ масштабируется: её заголовок — рецепт работы («6 х 4 мин»), и минуты сессии
 * следуют из него. Масштабируются лёгкие и длительная.
 */
export function adapt(ix: Index, t: CWeek, f: Found): Adapted {
  const p = f.p;
  const lvlT = t.avg4 > 0 ? t.avg4 : t.prevTotal;
  const lvlP = p.avg4 > 0 ? p.avg4 : p.prevTotal > 0 ? p.prevTotal : p.total;
  const scale = lvlT > 0 && lvlP > 0 ? Math.min(2, Math.max(0.5, lvlT / lvlP)) : 1;
  const sessions: PSess[] = p.sessions.filter((s) => !s.race).map((s) => ({
    dayIdx: s.dayIdx, kind: s.kind, title: s.title, src: s, work: s.work,
    minutes: s.kind === "quality" ? s.minutes : round5(s.minutes * scale),
  }));
  let dayMap = "дни прецедента";
  if (p.aid !== t.aid) {
    const h = dayHabit(ix, t.aid, t.weekStart);
    const total = h.easy.reduce((a, b) => a + b, 0) + h.long.reduce((a, b) => a + b, 0) + h.quality.reduce((a, b) => a + b, 0);
    if (total >= 6) {
      const used = new Set<number>();
      const pick = (hist: number[], fallback: number): number => {
        const order = hist.map((v, d) => [v, d] as const).filter(([, d]) => !used.has(d)).sort((a, b) => b[0] - a[0]);
        const d = order.length && order[0][0] > 0 ? order[0][1] : (!used.has(fallback) ? fallback : [0, 1, 2, 3, 4, 5, 6].find((x) => !used.has(x))!);
        used.add(d); return d;
      };
      const any = h.easy.map((v, d) => v + h.long[d] + h.quality[d]);
      for (const s of sessions.filter((x) => x.kind === "long")) s.dayIdx = pick(h.long, s.dayIdx);
      for (const s of sessions.filter((x) => x.kind === "quality")) s.dayIdx = pick(h.quality, s.dayIdx);
      for (const s of sessions.filter((x) => x.kind === "easy")) s.dayIdx = pick(any, s.dayIdx);
      sessions.sort((a, b) => a.dayIdx - b.dayIdx);
      dayMap = "дни по привычке атлета";
    }
  }
  return { sessions, scale, dayMap };
}

/**
 * ПРЕЦЕДЕНТ ПЕРЕХОДА. Бэктест первого прохода показал: «повтор прошлой недели» бьёт перенос
 * целой чужой/старой недели — недели тренера сильно сцеплены с предыдущей. Поэтому из
 * прецедента берётся не неделя, а ШАГ, который тренер сделал от своей прошлой недели к этой
 * (объём ×r, число качественных), и применяется к СОБСТВЕННОЙ прошлой неделе атлета: его дни,
 * его названия, его рисунок. Ни одна сессия не выдумывается — все из его прошлой недели.
 */
/**
 * base="prev": цель = прошлая неделя атлета × (прецедент / его прошлая).
 * base="level": цель = средний объём атлета за 4 нед × (прецедент / его средний за 4 нед).
 * Второй вариант появился из разбора: «prev» накапливает пики — если прошлая неделя атлета
 * сама была пиком, шаг прецедента «+15%» ставит ещё выше (Пономарева: 419 → 560 при среднем 338).
 * base="none": шаг прецедента НЕ применяется — собственная прошлая неделя как есть (повтор).
 * Какой брать — решает балл на обучающем отрезке (step3-backtest.ts), а не тест. На отрезке
 * 2025-06…2026-03 повтор обошёл оба варианта перехода во ВСЕХ фазах, кроме недели старта.
 */
export function adaptTransition(ix: Index, t: CWeek, f: Found, base: TransitionBase = TRANSITION_BASE): Adapted | null {
  const own = (ix.byAid.get(t.aid) ?? []).filter((w) => w.weekStart < t.weekStart).pop();
  if (!own) return null;
  const p = f.p;
  const ownRun = own.sessions.filter((s) => !s.race);
  const ownTotal = ownRun.reduce((a, s) => a + s.minutes, 0);
  const pTotal = p.sessions.filter((s) => !s.race).reduce((a, s) => a + s.minutes, 0);
  let r = 1;
  if (base === "prev" && p.prevTotal > 0) r = pTotal / p.prevTotal;
  if (base === "level" && p.avg4 > 0 && t.avg4 > 0 && ownTotal > 0) r = (t.avg4 * pTotal / p.avg4) / ownTotal;
  r = Math.min(1.6, Math.max(0.3, r));
  let sessions: PSess[] = ownRun.map((s) => ({ dayIdx: s.dayIdx, kind: s.kind, title: s.title, src: s, work: s.work,
    minutes: s.kind === "quality" ? s.minutes : round5(s.minutes * r) }));
  if (base === "none") return { sessions, scale: 1, dayMap: "собственная прошлая неделя атлета (повтор)" };
  // качественные: прецедент убрал качество (разгрузка/старт) — убираем, превращая в лёгкую его же длины
  if (p.qCount < p.prevQ || (p.qCount === 0 && sessions.some((s) => s.kind === "quality"))) {
    const drop = Math.max(0, sessions.filter((s) => s.kind === "quality").length - p.qCount);
    let k = 0;
    sessions = sessions.map((s) => {
      if (s.kind !== "quality" || k >= drop) return s;
      k++;
      const easy = ownRun.filter((x) => x.kind === "easy").sort((a, b) => b.minutes - a.minutes)[0];
      return easy ? { dayIdx: s.dayIdx, kind: "easy", title: easy.title, src: easy, work: 0, minutes: round5(easy.minutes * r) } : s;
    });
  }
  // прецедент сократил число дней сильнее, чем на день, — убираем самые короткие лёгкие
  const dropDays = Math.max(0, p.prevDays - p.days);
  if (dropDays > 0 && r < 0.9) {
    const victims = sessions.filter((s) => s.kind === "easy").sort((a, b) => a.minutes - b.minutes).slice(0, dropDays);
    sessions = sessions.filter((s) => !victims.includes(s));
  }
  return { sessions, scale: r, dayMap: "прошлая неделя атлета × шаг прецедента" };
}

/**
 * Где повтор прошлой недели заведомо не работает — там нужна сама неделя прецедента.
 * ВЫБРАНО НА ОБУЧАЮЩЕМ ОТРЕЗКЕ (2025-06…2026-03), балл↓ повтор / целая неделя прецедента:
 *   неделя старта 1.835 / 1.197 — прецедент; после старта 1.116 / 1.312 — ПОВТОР;
 *   база, рост, подводка — повтор лучше везде; возврат 1.728 / 1.523, но n=29 — не берём.
 * Первая версия включала и «после старта» — это было подобрано по ТЕСТОВОЙ таблице
 * и на обучающем отрезке не подтвердилось; снято.
 */
export function needsWholePrecedent(t: CWeek): boolean {
  return t.phase === "race";
}
