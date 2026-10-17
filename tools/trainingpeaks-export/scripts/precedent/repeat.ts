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
import { addDays, weeksBetween } from "./corpus.ts";
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
/**
 * ПИК: неделя выше стольких медиан 8 недель образцом не служит.
 * 1.25 → 1.5 (17.10, r13, решение Игоря: порог там, где его показывают данные, а не под один случай). 1.25 резало тело распределения
 * (8% всех недель лежат в полосе 1.20–1.30) и отсекло обычную неделю Ярулиной 12.10 (239 мин при пороге 237.5, запас 0.8%).
 * Граница по данным: после недели ×1.2–1.5 объём держится в 56–63% случаев (как после обычных), после ×1.5+ — в 45–48%, следующая
 * неделя 0.85. ВАЖНО: неделя Семешиной 31.08 (430 мин, ×1.39) прежним порогом 15.10 отсекалась; теперь НЕ отсекается ничем — она
 * +4 после половинки (таблица половинки кончается на +3), не марафон и не +2. Это известное следствие, не дыра таблицы.
 */
export let PEAK_RATIO = 1.5;
/** Правило пика как функция (объёмы 8 недель до неё, объём недели). По умолчанию — множитель от медианы; r13 подставляет кандидатов. */
export type PeakRule = (prior: number[], total: number) => boolean;
export let PEAK_RULE: PeakRule | null = null;
/**
 * КАЧЕСТВО ПО ПРАКТИКЕ (17.10, r14): если образец качества не содержит, а атлет «обычно» его делает — добавляем по его практике, а не копируем пустоту.
 * «Обычно» = качество было не меньше чем в этой доле его последних QUALITY_WINDOW своих недель (без недели старта и после старта). Порог 0.875 (7 из 8)
 * измерен r14 по правилу «вероятность качества в настоящей неделе > 50% и на обучении, и на проверке»: корзина 0.63–0.75 даёт 53%/49%, 0.75–0.88 — 49%/57%
 * (монетка), 0.88–1.00 — 71%/59%. Ниже порога качество НЕ добавляется: система не угадывает, а копирует образец. null — выключено.
 */
export let QUALITY_SHARE_MIN: number | null = 0.875;
export const QUALITY_WINDOW = 8;
/** Откуда берём недели для оценки практики: последние 12 своих, из них подходящих (не старт, не после старта, не болезнь) — до 8. Неделя с сигналом здоровья в счёт идёт (замер R4: она у тренера обычная; у Ярулиной качество стояло именно в них). */
export const QUALITY_LOOKBACK = 12;
export const DELTA_MIN = 0.5;
export const DELTA_MAX = 1.25;
/** Сколько недель назад искать образец. Блок «подводка 2 + старт + восстановление 3» сам занимает 6 недель, поэтому 6 не хватает (выбор — r8 по проверке). */
export let LOOKBACK_WEEKS = 10;

/**
 * Какие причины делают неделю непригодной формой. ТОЛЬКО эти пять — ровно то, что проверено бэктестом r8. «Сигнал здоровья» и «мало дней»
 * сюда НЕ входят: замер R4 (498 недель) — неделя с сигналом у Игоря обычная (объём ×1.0). Раньше список в коде был шире проверенного.
 */
export let SKIP_REASONS: Set<Abnormal> = new Set(["старт", "после старта", "подводка", "пик", "провал объёма"]);
export function setRepeatParams(p: { qualityShare?: number | null; peakRule?: PeakRule | null; normal?: number; gap?: number; skip?: Abnormal[]; peak?: number; recovery?: boolean; recoveryTable?: "train" | "all"; lookback?: number }): void {
  if (p.lookback != null) LOOKBACK_WEEKS = p.lookback;
  if (p.qualityShare !== undefined) QUALITY_SHARE_MIN = p.qualityShare;
  if (p.peakRule !== undefined) PEAK_RULE = p.peakRule;
  if (p.peak != null) PEAK_RATIO = p.peak;
  if (p.skip) SKIP_REASONS = new Set(p.skip);
  if (p.normal != null) NORMAL_MIN_RATIO = p.normal;
  if (p.gap != null) RETURN_GAP_WEEKS = p.gap;
  if (p.recovery != null) setRecovery({ on: p.recovery });
  if (p.recoveryTable) setRecovery({ table: p.recoveryTable });
}

const med = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export type Abnormal = "за главным стартом" | "старт" | "после старта" | "подводка" | "пик" | "сигнал здоровья" | "провал объёма" | "мало дней";

/** Пик ли неделя объёмом total при объёмах prior (8 недель до неё). Строго «больше»: неделя ровно на границе не отсекается. */
export function isPeak(prior: number[], total: number): boolean {
  return PEAK_RULE ? PEAK_RULE(prior, total) : PEAK_RATIO > 0 && total > PEAK_RATIO * med(prior);
}

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
    if (isPeak(prior.map((x) => x.total), w.total)) return "пик";
    if (w.days < med(prior.map((x) => x.days)) - 1) return "мало дней";
  }
  return null;
}

/**
 * НЕДЕЛЯ ИЗ ЗАВЕРШЁННОГО ЦИКЛА НЕ ОБРАЗЕЦ (решение Игоря 17.10): если между образцом и целевой неделей прошёл ГЛАВНЫЙ старт, образец из другой
 * жизни — независимо от множителя. Пример: Семешина, неделя 31.08 (430 мин) — вершина марафонского блока, марафон 27.09 прошёл, а
 * целевая неделя 19.10. Главный старт образца = ближайший старт самого образца (nextRaceIsMain), неделя которого строго раньше целевой.
 * Сама неделя старта и подводка — свои классы (старт, подводка), здесь только «старт остался позади».
 */
export function beyondMainRace(sample: CWeek, target: CWeek): boolean {
  if (BEYOND_MAIN === "off") return false;
  if (!sample.nextRaceIsMain || sample.weeksToRace == null || sample.weeksToRace <= 0) return false;
  if (addDays(sample.weekStart, 7 * sample.weeksToRace) >= target.weekStart) return false;
  // ВНУТРИ окна восстановления таблица (post-race.ts) по замыслу масштабирует ПРЕДСТАРТОВУЮ обычную неделю — отдельное решение Игоря 15.10
  // («после марафонного блока образец — последняя обычная неделя, а не чужой прецедент»). Режим "outside" его не трогает; "all" — буквально.
  if (BEYOND_MAIN === "outside" && recoveryFactor(target.lastRaceKm, target.weeksSinceRace) != null) return false;
  return true;
}
/** off — правило выключено; outside — только вне окна таблицы восстановления; all — буквально для любой недели (ломает путь «таблица × предстартовая неделя»). */
export let BEYOND_MAIN: "off" | "outside" | "all" = "outside";
export function setBeyondMain(m: "off" | "outside" | "all"): void { BEYOND_MAIN = m; }

/**
 * ДОНОР-ПИК (аудит r10): правило «пик не образец» раньше жило только в ветке повтора, а прецедент брал донором любую неделю
 * по близости состояния — в тестовых неделях 6 из 139 доноров оказались пиками. Тот же вред, что у Семешиной (430 мин), через другую ветку.
 * «Провал» донором остаётся допустимым: у возврата после паузы низкая неделя — норма; «старт»/«подводка»/«после старта» — донор по замыслу.
 */
export function donorExcluded(ix: Index, p: CWeek): boolean { return abnormalReason(ix, p) === "пик"; }

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
    const why = beyondMainRace(own[i], t) ? "за главным стартом" : abnormalReason(ix, own[i]);
    if (!why || (why !== "за главным стартом" && !SKIP_REASONS.has(why))) { base = own[i]; break; }
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
  // КАЧЕСТВО ПО ПРАКТИКЕ: до дельты-таблицы и предстартового запрета — они ниже сами снимут добавленное, если неделя этого не допускает.
  let qualityNote = "";
  if (QUALITY_SHARE_MIN != null && !recoveryWeek && !t.ill && !t.illAtStart && !sessions.some((x) => x.kind === "quality")) {
    const win = own.slice(-QUALITY_LOOKBACK).filter((w) => w.phase !== "race" && w.phase !== "post").slice(-QUALITY_WINDOW);
    const qWeeks = win.filter((w) => w.qCount > 0);
    if (win.length >= 4 && qWeeks.length / win.length >= QUALITY_SHARE_MIN) {
      const tpl = [...qWeeks].reverse().flatMap((w) => w.sessions.filter((x) => x.kind === "quality" && !x.race))[0];
      const days = qWeeks.flatMap((w) => w.sessions.filter((x) => x.kind === "quality" && !x.race).map((x) => x.dayIdx));
      const modal = [...new Set(days)].sort((a, b) => days.filter((d) => d === b).length - days.filter((d) => d === a).length || a - b)[0];
      const easy = sessions.filter((x) => x.kind === "easy").sort((a, b) => Math.abs(a.dayIdx - modal) - Math.abs(b.dayIdx - modal) || b.dayIdx - a.dayIdx)[0];
      if (tpl && easy) {
        const free = !sessions.some((x) => x.dayIdx === modal);
        sessions = sessions.filter((x) => x !== easy);
        sessions.push({ dayIdx: free ? modal : easy.dayIdx, kind: "quality", title: tpl.title, src: tpl, work: tpl.work, minutes: tpl.minutes });
        sessions.sort((a, b) => a.dayIdx - b.dayIdx);
        qualityNote = `качество по практике (${qWeeks.length} из ${win.length} своих недель), образец его не содержал: ${tpl.title} вместо «${easy.title}»`;
      }
    }
  }
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
  if (qualityNote) deltaWhy += `; ${qualityNote}`;
  return { kind: "repeat", base, skipped, delta: Math.round(100 * delta) / 100, deltaWhy, sessions };
}
