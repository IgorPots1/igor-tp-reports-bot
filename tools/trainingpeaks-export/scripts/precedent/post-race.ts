/**
 * ПОСЛЕ СТАРТА: восстановление по дистанции и неделе + снятие качества после марафона.
 * ОДНА РЕАЛИЗАЦИЯ ДЛЯ ОБЕИХ ВЕТОК (повтор своей недели и прецедент). Раньше жила только в «повторе», а в прецеденте
 * при том же дефекте стоял жёсткий отказ (решение Игоря 15.10: правило в одной ветке из двух — тот же дефект, что был у Богачёва).
 *
 * ТАБЛИЦА (неделя +k / обычная неделя до старта; замер r9-recovery.ts), ТОЛЬКО ОБУЧАЮЩИЙ ОТРЕЗОК (до 2026-03-02):
 * полный корпус включал тестовые недели, и «провал на втором месяце» после марафона (0.71 / 0.66 / 0.74 на +5…+7) в обучающих
 * данных не воспроизвёлся (0.82 / 0.82 / 0.94) — по правилу Игоря при расхождении берутся обучающие числа.
 * Короткие дистанции в обучающих данных тоже расходятся с полным корпусом (до 0.24, n=16–21): см. отчёт r9.
 */
import type { CSess, CWeek, Kind } from "./corpus.ts";
import type { Index, PSess } from "./precedent.ts";
import { hasQualityContent, POST_MARATHON_NO_QUALITY_WEEKS } from "./validate.ts";
import { WARMUP_TITLE_RE } from "../lib/practice-signals.ts";

type Row = number[];
export const RECOVERY_TRAIN: Record<"marathon" | "half" | "short", Row> = {
  marathon: [0.39, 0.71, 0.77, 0.81, 0.82, 0.82, 0.94],
  half: [0.59, 0.99, 0.99],
  // до 15 км: понижаем ТОЛЬКО +1. На +2 (медиана 0.76) p75 = 1.04, на +3 (0.94) p75 = 1.09 — разброс накрывает единицу, надёжного
  // числа нет, «лучше не понижать вовсе, чем понижать наугад» (решение Игоря 15.10; r12-spread.ts, правило записано до замера).
  short: [0.74, 1.0, 1.0],
};
/** Прежняя таблица по ВСЕМУ корпусу (включая тест) — только для диагностики в бэктесте. */
export const RECOVERY_ALL: Record<"marathon" | "half" | "short", Row> = {
  marathon: [0.39, 0.75, 0.81, 0.81, 0.71, 0.66, 0.74],
  half: [0.76, 0.99, 0.99],
  short: [0.86, 1.0, 1.02], // 1.02 как измерено; recoveryFactor зажимает до 1 — восстановление нагрузку не повышает
};
export let RECOVERY: Record<"marathon" | "half" | "short", Row> = RECOVERY_TRAIN;
export let RECOVERY_ON = true;
export function setRecovery(p: { on?: boolean; table?: "train" | "all" }): void {
  if (p.on != null) RECOVERY_ON = p.on;
  if (p.table) RECOVERY = p.table === "train" ? RECOVERY_TRAIN : RECOVERY_ALL;
}

export function recoveryFactor(lastRaceKm: number | null, weeksSinceRace: number | null): number | null {
  if (!RECOVERY_ON || lastRaceKm == null || weeksSinceRace == null || weeksSinceRace < 1) return null;
  const row = lastRaceKm >= 30 ? RECOVERY.marathon : lastRaceKm >= 15 ? RECOVERY.half : RECOVERY.short;
  if (weeksSinceRace > row.length) return null;
  return Math.min(1, row[weeksSinceRace - 1]);
}

/** Нижняя граница восстановительного множителя: 0.39 после марафона — это не зажим, а замер. */
export const RECOVERY_DELTA_MIN = 0.35;
/** Снятие дня по глубине снижения — только для дельты цикла (repeat.ts); восстановление после старта решает измеренная неделя +1 после марафона. */
export const DROP_DAY_BELOW = 0.75;

const round5 = (m: number): number => Math.max(20, Math.round(m / 5) * 5);

/** Последняя «чистая» (без качества по содержанию) сессия атлета нужного вида за 12 недель — замена, а не выдумка. */
export function plainTemplate(ix: Index, aid: number, before: string, kinds: Kind[]): CSess | null {
  const own = (ix.byAid.get(aid) ?? []).filter((w) => w.weekStart < before).slice(-12).reverse();
  for (const k of kinds) for (const w of own) for (const s of w.sessions) if (!s.race && s.kind === k && !WARMUP_TITLE_RE.test(s.title) && !hasQualityContent({ kind: s.kind, title: s.title, description: s.desc })) return s;
  return null;
}

/**
 * Применить правила «после старта» к собранным сессиям.
 *  alreadyFactor — множитель восстановления, который УЖЕ заложен в сессиях (повтор: 1; прецедент: множитель недели донора,
 *  если донор сам был неделей восстановления). Масштабируем только на разницу и никогда не повышаем нагрузку.
 *  1) нагрузка: лёгкие и длительная × rel (качественная — рецепт, не масштабируется);
 *  2) марафон, недели +1…+3: качество и темп марафона заменяются его же обычной сессией (нет такой — день снят);
 *  3) rel < 0.75: снимается самая короткая лёгкая.
 */
export function postRaceAdjust(ix: Index, t: CWeek, sessions: PSess[], alreadyFactor = 1): { sessions: PSess[]; rel: number | null; notes: string[] } {
  const rf = recoveryFactor(t.lastRaceKm, t.weeksSinceRace);
  if (rf == null || rf >= 1) return { sessions, rel: null, notes: [] };
  const rel = Math.min(1, Math.max(RECOVERY_DELTA_MIN, rf) / Math.max(RECOVERY_DELTA_MIN, alreadyFactor));
  const notes = [`восстановление: неделя +${t.weeksSinceRace} после старта на ${t.lastRaceKm} км ×${Math.round(100 * rel) / 100} (замер по неделям Игоря, обучающий отрезок)`];
  let out: PSess[] = sessions.map((s) => (s.kind === "quality" || rel >= 1 ? s : { ...s, minutes: round5(s.minutes * rel) }));
  if (t.lastRaceKm != null && t.lastRaceKm >= 30 && t.weeksSinceRace != null && t.weeksSinceRace <= POST_MARATHON_NO_QUALITY_WEEKS) {
    const changed: string[] = [];
    out = out.flatMap((s) => {
      if (!hasQualityContent({ kind: s.kind, title: s.title, description: s.src.desc })) return [s];
      const tpl = plainTemplate(ix, t.aid, t.weekStart, s.kind === "long" ? ["long", "easy"] : ["easy"]);
      if (!tpl) { changed.push(`${s.title} ${s.minutes} мин — снята`); return []; }
      changed.push(`${s.title} ${s.minutes} мин → «${tpl.title}»`);
      return [{ dayIdx: s.dayIdx, kind: s.kind === "quality" ? "easy" : s.kind, title: tpl.title, src: tpl, work: 0, minutes: round5(tpl.minutes * rel) } as PSess];
    });
    if (changed.length) notes.push(`качество снято: ${changed.join("; ")}`);
  }
  // ДЕНЬ СНИМАЕТСЯ ТОЛЬКО НА 1-Й НЕДЕЛЕ ПОСЛЕ МАРАФОНА. Замер по неделям Игоря (n=15–20): дней относительно обычных на +1 — 0.67
  // (≈3 из 4), на +2, +3, +4 — 1.00; объём режется ВНУТРИ сессий. Раньше день снимался по порогу множителя (<0.75), и таблица,
  // которая уже описывает общий объём недели, применялась дважды: Семешина на +2 (×0.71) теряла день и получала 185 вместо ~240.
  if (t.lastRaceKm != null && t.lastRaceKm >= 30 && t.weeksSinceRace === 1) {
    const easy = out.filter((s) => s.kind === "easy").sort((a, b) => a.minutes - b.minutes);
    if (easy.length > 1 || (easy.length === 1 && out.length > 2)) { out = out.filter((s) => s !== easy[0]); notes.push(`снята самая короткая лёгкая (${easy[0].minutes} мин)`); }
  }
  return { sessions: out, rel, notes };
}
