/**
 * ПОВТОР + ДЕЛЬТА ЦИКЛА (решение Игоря 15.10): генератор перестаёт быть умным.
 *
 * СЛОИ, сверху вниз — каждый отвечает за одно и не лезет в чужое:
 *   1. ФОРМА — последняя НОРМАЛЬНАЯ плановая неделя атлета: его дни, его названия, его тексты.
 *      Разгрузочная, стартовая, послестартовая, больная или провальная неделя формой не служит
 *      (Столова получила 78 мин ровно так: повторили провальную неделю как норму).
 *   2. ДЕЛЬТА — только МАСШТАБ, без новых сессий:
 *        неделя после старта → измеренный множитель тренера (POST_RACE_FACTOR);
 *        есть цель цикла    → цель недели / база цикла (рост > 1, разгрузка и подводка < 1);
 *        иначе              → 1 (удержание).
 *      Масштабируются лёгкие и длительная; качественная — рецепт («6 х 4 мин»), её минуты
 *      следуют из заголовка и не трогаются. При дельте ниже DROP_DAY_BELOW убирается самая
 *      короткая лёгкая — состав меняется, рисунок (дни качества и длительной) остаётся.
 *   3. ПРЕЦЕДЕНТ — только когда повторять нечего: неделя старта; возврат после паузы длиннее
 *      RETURN_GAP_WEEKS; нормальной недели нет (новый ученик).
 *   4. ТЕМПЫ И ТЕКСТ — adapt-text.ts (resolvePace + % структуры), проверка — validate.ts.
 * Сигнал здоровья дельту НЕ меняет (замер R4: медиана объёма 1.0 от обычного) — только пометка.
 *
 * Пороги нормальности и паузы выбираются на обучающем отрезке (r2-backtest.ts), не здесь.
 */
import type { CSess, CWeek, Kind } from "./corpus.ts";
import { weeksBetween } from "./corpus.ts";
import { enforcePreRace, type Index, type PSess } from "./precedent.ts";

/** Неделя нормальна, если её объём не ниже этой доли медианы 8 недель до неё (выбрано в r2). */
export let NORMAL_MIN_RATIO = 0.8;
/** Пауза длиннее стольких недель — повторять нечего, нужен прецедент (выбрано в r2). */
export let RETURN_GAP_WEEKS = 3;
/** Насколько тренер снижает неделю после старта относительно обычной (замер r2). */
export let POST_RACE_FACTOR = 0.8;
export const DROP_DAY_BELOW = 0.75;
export const DELTA_MIN = 0.5;
export const DELTA_MAX = 1.25;
export const LOOKBACK_WEEKS = 6;

/** Какие причины делают неделю непригодной формой — выбирается на обучающем отрезке (r2). */
export let SKIP_REASONS: Set<Abnormal> = new Set(["старт", "после старта", "сигнал здоровья", "провал объёма", "мало дней"]);
/** Применять ли множитель «после старта» к неделе сразу после гонки (r2). */
export let APPLY_POST_FACTOR = true;
export function setRepeatParams(p: { normal?: number; gap?: number; post?: number; skip?: Abnormal[]; applyPost?: boolean }): void {
  if (p.skip) SKIP_REASONS = new Set(p.skip);
  if (p.applyPost != null) APPLY_POST_FACTOR = p.applyPost;
  if (p.normal != null) NORMAL_MIN_RATIO = p.normal;
  if (p.gap != null) RETURN_GAP_WEEKS = p.gap;
  if (p.post != null) POST_RACE_FACTOR = p.post;
}

const med = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export type Abnormal = "старт" | "после старта" | "сигнал здоровья" | "провал объёма" | "мало дней";

/** Почему неделя не годится формой; null — нормальная. Только по данным ДО неё и её самой. */
export function abnormalReason(ix: Index, w: CWeek): Abnormal | null {
  if (w.phase === "race") return "старт";
  if (w.weeksSinceRace != null && w.weeksSinceRace <= 1 && w.phase === "post") return "после старта";
  if (w.ill) return "сигнал здоровья";
  const prior = (ix.byAid.get(w.aid) ?? []).filter((x) => x.weekStart < w.weekStart).slice(-8);
  if (prior.length >= 3) {
    if (w.total < NORMAL_MIN_RATIO * med(prior.map((x) => x.total))) return "провал объёма";
    if (w.days < med(prior.map((x) => x.days)) - 1) return "мало дней";
  }
  return null;
}

export type CycleDelta = { role: string; target: number; base: number } | null;

export type RepeatPlan =
  | { kind: "repeat"; base: CWeek; skipped: Array<{ week: string; why: Abnormal }>; delta: number; deltaWhy: string; sessions: PSess[] }
  | { kind: "precedent"; why: string };

export function planRepeat(ix: Index, t: CWeek, cycle: CycleDelta): RepeatPlan {
  if (t.phase === "race") return { kind: "precedent", why: "неделя старта" };
  const own = (ix.byAid.get(t.aid) ?? []).filter((w) => w.weekStart < t.weekStart);
  const last = own[own.length - 1];
  if (!last) return { kind: "precedent", why: "новый ученик: своих недель нет" };
  const gap = weeksBetween(last.weekStart, t.weekStart) - 1;
  if (gap >= RETURN_GAP_WEEKS) return { kind: "precedent", why: `возврат после паузы ${gap} нед` };
  const skipped: Array<{ week: string; why: Abnormal }> = [];
  let base: CWeek | null = null;
  for (let i = own.length - 1; i >= 0 && weeksBetween(own[i].weekStart, t.weekStart) <= LOOKBACK_WEEKS; i--) {
    const why = abnormalReason(ix, own[i]);
    if (!why || !SKIP_REASONS.has(why)) { base = own[i]; break; }
    skipped.push({ week: own[i].weekStart, why });
  }
  if (!base) return { kind: "precedent", why: `нормальной недели за ${LOOKBACK_WEEKS} нед нет (${skipped.map((s) => `${s.week} ${s.why}`).join(", ")})` };

  let delta = 1; let deltaWhy = "удержание (цели цикла нет)";
  const postRace = t.weeksSinceRace != null && t.weeksSinceRace <= 1 && t.phase === "post";
  if (postRace && APPLY_POST_FACTOR) { delta = POST_RACE_FACTOR; deltaWhy = `неделя после старта ×${POST_RACE_FACTOR} (практика тренера)`; }
  else if (cycle && cycle.base > 0 && cycle.target > 0) { delta = cycle.target / cycle.base; deltaWhy = `цикл «${cycle.role}»: ${cycle.target} / база ${cycle.base}`; }
  delta = Math.min(DELTA_MAX, Math.max(DELTA_MIN, delta));

  const round5 = (m: number): number => Math.max(20, Math.round(m / 5) * 5);
  let sessions: PSess[] = base.sessions.filter((s: CSess) => !s.race).map((s) => ({
    dayIdx: s.dayIdx, kind: s.kind as Kind, title: s.title, src: s, work: s.work,
    minutes: s.kind === "quality" ? s.minutes : round5(s.minutes * delta),
  }));
  if (delta < DROP_DAY_BELOW) {
    const easy = sessions.filter((s) => s.kind === "easy").sort((a, b) => a.minutes - b.minutes);
    if (easy.length > 1 || (easy.length === 1 && sessions.length > 2)) sessions = sessions.filter((s) => s !== easy[0]);
  }
  // старт в начале следующей недели (пн/вт) — тот же запрет на последние дни этой
  const removed = enforcePreRace(sessions, t.raceDayIdx);
  if (removed.length) deltaWhy += `; снято перед стартом: ${removed.join(", ")}`;
  return { kind: "repeat", base, skipped, delta: Math.round(100 * delta) / 100, deltaWhy, sessions };
}
