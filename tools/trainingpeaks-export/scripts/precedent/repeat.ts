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
import { hasQualityContent, POST_MARATHON_NO_QUALITY_WEEKS } from "./validate.ts";
import { recent } from "./recent-level.ts";

/** Неделя нормальна, если её объём не ниже этой доли медианы 8 недель до неё (выбрано в r2). */
export let NORMAL_MIN_RATIO = 0.8;
/** Пауза от стольких недель (но < MAX_GAP_WEEKS из recent-level.ts) — повторять нечего, нужен прецедент (выбрано в r2). */
export let RETURN_GAP_WEEKS = 2;
/**
 * ВОССТАНОВЛЕНИЕ ПОСЛЕ СТАРТА ПО ДИСТАНЦИИ И НОМЕРУ НЕДЕЛИ (решение Игоря 15.10; замер по неделям корпуса:
 * неделя +k / обычная неделя до старта). Заменяет единый ×0.67, который был усреднением и действовал только на +1.
 *   марафон (≥30 км): 0.39 / 0.75 / 0.81 · половинка (15–30): 0.76 / 0.99 / 0.99 · до 15 км: 0.86 / 1.00 / 1.02.
 * ОГРАНИЧЕНИЕ: таблица измерена на ВСЕХ неделях корпуса, включая проверочный и тестовый отрезки — в бэктесте это
 * слегка оптимистично. Числа заданы решением, не подбирались по баллу.
 */
export const RECOVERY: Record<"marathon" | "half" | "short", [number, number, number]> = { marathon: [0.39, 0.75, 0.81], half: [0.76, 0.99, 0.99], short: [0.86, 1.0, 1.02] };
export let RECOVERY_ON = true;
export function recoveryFactor(lastRaceKm: number | null, weeksSinceRace: number | null): number | null {
  if (!RECOVERY_ON || lastRaceKm == null || weeksSinceRace == null || weeksSinceRace < 1 || weeksSinceRace > 3) return null;
  const row = lastRaceKm >= 30 ? RECOVERY.marathon : lastRaceKm >= 15 ? RECOVERY.half : RECOVERY.short;
  return Math.min(1, row[weeksSinceRace - 1]);
}
/** Неделя восстановления не годится образцом, если тренер сам ставит её ниже этой доли обычной. */
export const RECOVERY_NOT_A_SAMPLE_BELOW = 0.9;
/** ПИК: неделя выше стольких медиан 8 недель образцом не служит (решение Игоря 15.10: Семешина 430 мин через 2 недели после марафона). */
export let PEAK_RATIO = 1.25;
export const DROP_DAY_BELOW = 0.75;
export const DELTA_MIN = 0.5;
export const DELTA_MAX = 1.25;
/** Нижняя граница восстановительного множителя: 0.39 после марафона — это не зажим, а замер. */
export const RECOVERY_DELTA_MIN = 0.35;
/** Сколько недель назад искать образец. Блок «подводка 2 + старт + восстановление 3» сам занимает 6 недель, поэтому 6 не хватает (выбор — r8 по проверке). */
export let LOOKBACK_WEEKS = 10;

/**
 * Какие причины делают неделю непригодной формой. ТОЛЬКО эти пять — ровно то, что проверено бэктестом r8. «Сигнал здоровья» и «мало дней»
 * сюда НЕ входят: замер R4 (498 недель) — неделя с сигналом у Игоря обычная (объём ×1.0). Раньше список в коде был шире проверенного.
 */
export let SKIP_REASONS: Set<Abnormal> = new Set(["старт", "после старта", "подводка", "пик", "провал объёма"]);
export function setRepeatParams(p: { normal?: number; gap?: number; skip?: Abnormal[]; peak?: number; recovery?: boolean; lookback?: number }): void {
  if (p.lookback != null) LOOKBACK_WEEKS = p.lookback;
  if (p.peak != null) PEAK_RATIO = p.peak;
  if (p.skip) SKIP_REASONS = new Set(p.skip);
  if (p.normal != null) NORMAL_MIN_RATIO = p.normal;
  if (p.gap != null) RETURN_GAP_WEEKS = p.gap;
  if (p.recovery != null) RECOVERY_ON = p.recovery;
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

/**
 * Плановая сессия-замена: последняя «чистая» (без качества по содержанию) сессия атлета нужного вида за 12 недель.
 * Нужна, чтобы убрать качество из недели, не выдумывая тренировку: берём его собственную обычную.
 */
function plainTemplate(ix: Index, aid: number, before: string, kinds: Kind[]): CSess | null {
  const own = (ix.byAid.get(aid) ?? []).filter((w) => w.weekStart < before).slice(-12).reverse();
  for (const k of kinds) for (const w of own) for (const s of w.sessions) if (!s.race && s.kind === k && !hasQualityContent({ kind: s.kind, title: s.title, description: s.desc })) return s;
  return null;
}

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
  if (recoveryWeek) {
    delta = Math.max(RECOVERY_DELTA_MIN, rf!);
    deltaWhy = `восстановление: неделя +${t.weeksSinceRace} после старта на ${t.lastRaceKm} км ×${rf} (замер по неделям Игоря)`;
  } else if (cycle && cycle.base > 0 && cycle.target > 0) {
    delta = Math.min(DELTA_MAX, Math.max(DELTA_MIN, cycle.target / cycle.base)); deltaWhy = `цикл «${cycle.role}»: ${cycle.target} / база ${cycle.base}`;
  }

  const round5 = (m: number): number => Math.max(20, Math.round(m / 5) * 5);
  let sessions: PSess[] = base.sessions.filter((s: CSess) => !s.race).map((s) => ({
    dayIdx: s.dayIdx, kind: s.kind as Kind, title: s.title, src: s, work: s.work,
    minutes: s.kind === "quality" ? s.minutes : round5(s.minutes * delta),
  }));
  // ПОСЛЕ МАРАФОНА (недели +1…+3) качество и темп марафона НЕ повторяются (решение Игоря 15.10, Богачёв: «24 км в темпе
  // марафона» на второй неделе после марафона). Заменяется собственной «чистой» сессией атлета того же вида; нет такой — день снят.
  if (t.lastRaceKm != null && t.lastRaceKm >= 30 && t.weeksSinceRace != null && t.weeksSinceRace >= 1 && t.weeksSinceRace <= POST_MARATHON_NO_QUALITY_WEEKS) {
    const changed: string[] = [];
    sessions = sessions.flatMap((s) => {
      if (!hasQualityContent({ kind: s.kind, title: s.title, description: s.src.desc })) return [s];
      const tpl = plainTemplate(ix, t.aid, t.weekStart, s.kind === "long" ? ["long", "easy"] : ["easy"]);
      if (!tpl) { changed.push(`${s.title} ${s.minutes} мин — снята`); return []; }
      changed.push(`${s.title} ${s.minutes} мин → «${tpl.title}»`);
      return [{ dayIdx: s.dayIdx, kind: s.kind === "quality" ? "easy" : s.kind, title: tpl.title, src: tpl, work: 0, minutes: round5(tpl.minutes * delta) } as PSess];
    });
    if (changed.length) deltaWhy += `; качество снято: ${changed.join("; ")}`;
  }
  if (delta < DROP_DAY_BELOW) {
    const easy = sessions.filter((s) => s.kind === "easy").sort((a, b) => a.minutes - b.minutes);
    if (easy.length > 1 || (easy.length === 1 && sessions.length > 2)) sessions = sessions.filter((s) => s !== easy[0]);
  }
  // старт в начале следующей недели (пн/вт) — тот же запрет на последние дни этой
  const removed = enforcePreRace(sessions, t.nextRaceIsMain ? t.raceDayIdx : null);
  if (removed.length) deltaWhy += `; снято перед стартом: ${removed.join(", ")}`;
  return { kind: "repeat", base, skipped, delta: Math.round(100 * delta) / 100, deltaWhy, sessions };
}
