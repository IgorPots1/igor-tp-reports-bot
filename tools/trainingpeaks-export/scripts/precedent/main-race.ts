/**
 * ГЛАВНЫЙ СТАРТ против ПРОХОДНОГО (решение Игоря 15.10): к проходным он не подводит,
 * там забег сам и есть тренировка — предстартовый запрет и «подводка как не-образец» их не касаются.
 *
 * Механизм уже есть в сборщике: pickTargetRace (lib/training-cycle.ts) выбирает старт, к которому
 * строится цикл. Старт ГЛАВНЫЙ, если когда-либо был выбран целью цикла — то есть если с какого-то
 * понедельника за [TARGET_RACE_MIN_WEEKS … длина цикла под его дистанцию] недель до него он оказался
 * лучшим среди известных стартов атлета (длинная дистанция бьёт короткую, при равной — более ранний).
 * Длина подготовки — это и есть «горизонт»: марафон главный за 18 недель, десятка за 14.
 *
 * ОГРАНИЧЕНИЕ: в race_events нет даты внесения старта, поэтому «известные стартовые» берутся все
 * записанные у атлета, в том числе внесённые позже. Старт, внесённый за неделю до гонки, в тот
 * понедельник цикла не получил бы — здесь он может оказаться главным. Для бэктеста это
 * допущение, для живого планирования его нет: там races = то, что есть сегодня.
 */
import { LENGTH_WEEKS, TARGET_RACE_MIN_WEEKS, intentFromDistance, pickTargetRace } from "../lib/training-cycle.ts";

export type RaceRef = { id: string; event_date: string; distance_km: number | null };

const DAY = 86400000;
const mondayOf = (s: string): string => {
  const d = new Date(`${s}T00:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
};

/** Ключи главных стартов из списка стартов ОДНОГО атлета (по id). */
export function mainRaceIds(races: RaceRef[]): Set<string> {
  const out = new Set<string>();
  for (const r of races) {
    if (r.distance_km == null) continue; // без дистанции целью не бывает — тип цикла не вывести
    const horizon = LENGTH_WEEKS[intentFromDistance(r.distance_km)];
    const raceMonday = mondayOf(r.event_date);
    for (let w = TARGET_RACE_MIN_WEEKS; w <= horizon; w++) {
      const m = new Date(Date.parse(raceMonday) - w * 7 * DAY).toISOString().slice(0, 10);
      if (pickTargetRace(races, m)?.id === r.id) { out.add(r.id); break; }
    }
  }
  return out;
}
