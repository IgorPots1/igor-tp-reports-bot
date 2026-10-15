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
import { DROP_DAY_BELOW, postRaceAdjust, recoveryFactor, setRecovery } from "./post-race.ts";
import { recent } from "./recent-level.ts";

/** Неделя нормальна, если её объём не ниже этой доли медианы 8 недель до неё (выбрано в r2). */
export let NORMAL_MIN_RATIO = 0.8;
/** Пауза от стольких недель (но < MAX_GAP_WEEKS из recent-level.ts) — повторять нечего, нужен прецедент (выбрано в r2). */
export let RETURN_GAP_WEEKS = 2;
/** ТАБЛИЦА ВОССТАНОВЛЕНИЯ и снятие качества после марафона — post-race.ts (одна реализация для повтора и прецедента). */
export { RECOVERY, RECOVERY_ON, recoveryFactor, setRecovery } from "./post-race.ts";
/** Неделя восстановления не годится образцом, если тренер сам ставит её ниже этой доли обычной. */
export const RECOVERY_NOT_A_SAMPLE_BELOW = 0.9;
/** ПИК: неделя выше стольких медиан 8 недель образцом не служит (решение Игоря 15.10: Семешина 430 мин через 2 недели после марафона). */
export let PEAK_RATIO = 1.25;
export const DELTA_MIN = 0.5;
export const DELTA_MAX = 1.25;
/** Сколько недель назад искать образец. Блок «подводка 2 + старт + восстановление 3» сам занимает 6 недель, поэтому 6 не хватает (выбор — r8 по проверке). */
export let LOOKBACK_WEEKS = 10;

/**
 * Какие причины делают неделю непригодной формой. ТОЛЬКО эти пять — ровно то, что проверено бэктестом r8. «Сигнал здоровья» и «мало дней»
 * сюда НЕ входят: замер R4 (498 недель) — неделя с сигналом у Игоря обычная (объём ×1.0). Раньше список в коде был шире проверенного.
 */
export let SKIP_REASONS: Set<Abnormal> = new Set(["старт", "после старта", "подводка", "пик", "провал объёма"]);
export function setRepeatParams(p: { normal?: number; gap?: number; skip?: Abnormal[]; peak?: number; recovery?: boolean; recoveryTable?: "train" | "all"; lookback?: number }): void {
  if (p.lookback != null) LOOKBACK_WEEKS = p.lookback;
  if (p.peak != null) PEAK_RATIO = p.peak;
  if (p.skip) SKIP_REASONS = new Set(p.skip);
  if (p.normal != null) NORMAL_MIN_RATIO = p.normal;
  if (p.gap != null) RETURN_GAP_WEEKS = p.gap;
  if (p.recovery != null) setRecovery({ on: p.recovery });
  if (p.recoveryTable) setRecovery({ table: p.recoveryTable });
}

const med = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export type Abnormal = "старт" | "после старта" | "подводка" | "пик" | "сигнал здоровья" | "провал объёма" | "мало дней";

/** Почему неделя не годится формой; null — нормальная. Только по данным ДО неё и её самой. */
export function abnormalReason(ix: Index, w: CWeek): Abnormal | null {
  if (w.phase === "race") return "старт";
  const rf = recoveryFactor(w.lastRaceKm, w.weeksSinceRace);
  if (rf != null && rf < RECOVERY_NOT_A_SAMPLE_BELOW) return "после старта";
  // ПРЕДСТАРТОВАЯ НЕДЕЛЯ — тот же класс, что разгрузка, старт и после старта (решение Игоря 15.10): это
  // неделя подводки, а не обычная. Семешина получила 345 мин, потому что через две недели после старта
  // повтор взял предстартовую. Только перед ГЛАВНЫМ стартом: к проходным он не подводит, там неделя обычная.
  if (w.phase === "taper" && w.nextRaceIsMain) return "подводка";
  if (w.ill) return "сигнал здоровья";
  const prior = (ix.byAid.get(w.aid) ?? []).filter((x) => x.weekStart < w.weekStart).slice(-8);
  if (prior.length >= 3) {
    if (w.total < NORMAL_MIN_RATIO * med(prior.map((x) => x.total))) return "провал объёма";
    if (PEAK_RATIO > 0 && w.total > PEAK_RATIO * med(prior.map((x) => x.total))) return "пик";
    if (w.days < med(prior.map((x) => x.days)) - 1) return "мало дней";
  }
  return null;
}

export type CycleDelta = { role: string; target: number; base: number } | null;

export type RepeatPlan =
  | { kind: "repeat"; base: CWeek; skipped: Array<{ week: string; why: Abnormal }>; delta: number; deltaWhy: string; sessions: PSess[] }
  | { kind: "precedent"; why: string }
  | { kind: "refuse"; why: string };

export function planRepeat(ix: Index, t: CWeek, cycle: CycleDelta): RepeatPlan {
  // ЖЁСТКО: нет недавней истории → ОТКАЗ без попытки масштабировать чужую неделю (решение Игоря 15.10, Расницова).
  // Касается и нового ученика, и возврата после паузы ≥ MAX_GAP_WEEKS, и недели старта без истории.
  const rec = recent(ix, t.aid, t.weekStart);
  if (!rec.ok) return { kind: "refuse", why: `нет недавней истории: ${rec.why}` };
  if (t.phase === "race") return { kind: "precedent", why: "неделя старта" };
  const own = (ix.byAid.get(t.aid) ?? []).filter((w) => w.weekStart < t.weekStart);
  const last = own[own.length - 1]!;
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
  const rf = recoveryFactor(t.lastRaceKm, t.weeksSinceRace);
  const recoveryWeek = rf != null && rf < 1;
  // Неделя восстановления: цикл не участвует, нагрузку задаёт ТАБЛИЦА (post-race.ts, общая с прецедентом).
  if (!recoveryWeek && cycle && cycle.base > 0 && cycle.target > 0) {
    delta = Math.min(DELTA_MAX, Math.max(DELTA_MIN, cycle.target / cycle.base)); deltaWhy = `цикл «${cycle.role}»: ${cycle.target} / база ${cycle.base}`;
  }

  const round5 = (m: number): number => Math.max(20, Math.round(m / 5) * 5);
  let sessions: PSess[] = base.sessions.filter((s: CSess) => !s.race).map((s) => ({
    dayIdx: s.dayIdx, kind: s.kind as Kind, title: s.title, src: s, work: s.work,
    minutes: s.kind === "quality" ? s.minutes : round5(s.minutes * delta),
  }));
  if (recoveryWeek) {
    const adj = postRaceAdjust(ix, t, sessions, 1);
    sessions = adj.sessions; delta = adj.rel ?? 1; deltaWhy = adj.notes.join("; ");
  } else if (delta < DROP_DAY_BELOW) {
    const easy = sessions.filter((s) => s.kind === "easy").sort((a, b) => a.minutes - b.minutes);
    if (easy.length > 1 || (easy.length === 1 && sessions.length > 2)) sessions = sessions.filter((s) => s !== easy[0]);
  }
  // старт в начале следующей недели (пн/вт) — тот же запрет на последние дни этой
  const removed = enforcePreRace(sessions, t.nextRaceIsMain ? t.raceDayIdx : null);
  if (removed.length) deltaWhy += `; снято перед стартом: ${removed.join(", ")}`;
  return { kind: "repeat", base, skipped, delta: Math.round(100 * delta) / 100, deltaWhy, sessions };
}
