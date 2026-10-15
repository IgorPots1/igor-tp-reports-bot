/**
 * НЕДАВНИЙ ФАКТИЧЕСКИЙ УРОВЕНЬ атлета и «есть ли недавняя история». Чистые функции по корпусу недель.
 *
 * Уровень = p75 ПЛАНОВЫХ минут своих недель за последние RECENT_WINDOW_WEEKS (верх обычного, не среднее).
 * Выбрано замером r7-guard.ts среди пяти определений по тому, насколько редко НЕДЕЛИ ИГОРЯ превышают порог:
 *   p75 плана — выше 1.5× только 2% его недель (p99 = 1.67); медиана плана — 9%; медиана ФАКТА — 37% (факт шумит:
 *   у четверти недель выполнено меньше половины плана, и «уровень по факту» занижен).
 * История есть, если за окно ≥ MIN_RECENT_WEEKS своих недель и последняя не дальше MAX_GAP_WEEKS назад.
 */
import type { CWeek } from "./corpus.ts";
import { weeksBetween } from "./corpus.ts";
import type { Index } from "./precedent.ts";

export const RECENT_WINDOW_WEEKS = 8;
export const MIN_RECENT_WEEKS = 3;
/** Пауза (пропущенных недель подряд перед целевой) от стольких — недавней истории нет. Замер r7-guard.ts. */
export let MAX_GAP_WEEKS = 4;
/** Неделя выше стольких недавних уровней не выдаётся. Замер r7-guard.ts. */
export let LEVEL_MAX_RATIO = 1.5;
export function setGuardParams(p: { gap?: number; ratio?: number }): void { if (p.gap != null) MAX_GAP_WEEKS = p.gap; if (p.ratio != null) LEVEL_MAX_RATIO = p.ratio; }

const p75 = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(0.75 * (s.length - 1))] : 0; };

export type Recent = { level: number | null; weeks: number; gapWeeks: number | null; ok: boolean; why: string };

export function recent(ix: Index, aid: number, weekStart: string): Recent {
  const own = (ix.byAid.get(aid) ?? []).filter((w: CWeek) => w.weekStart < weekStart && weeksBetween(w.weekStart, weekStart) <= RECENT_WINDOW_WEEKS);
  const last = own[own.length - 1];
  const gapWeeks = last ? weeksBetween(last.weekStart, weekStart) - 1 : null;
  const level = own.length >= MIN_RECENT_WEEKS ? p75(own.map((w) => w.total)) : null;
  const ok = own.length >= MIN_RECENT_WEEKS && gapWeeks != null && gapWeeks < MAX_GAP_WEEKS && level != null && level > 0;
  const why = ok ? "" : own.length < MIN_RECENT_WEEKS
    ? `за ${RECENT_WINDOW_WEEKS} нед своих недель ${own.length} (нужно ≥ ${MIN_RECENT_WEEKS})`
    : gapWeeks != null && gapWeeks >= MAX_GAP_WEEKS ? `пауза ${gapWeeks} нед (допустимо < ${MAX_GAP_WEEKS})` : "уровень не определён";
  return { level, weeks: own.length, gapWeeks, ok, why };
}
