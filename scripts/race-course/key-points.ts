/* Ключевые точки тактики: детерминированные правила по профилю и ветру, без цифр темпа.
 * Каждое правило ниже даёт кандидата с приоритетом; в выдачу идут 5–6 лучших, по порядку км.
 * Чистые функции без сети, их стережёт scripts/check-race-course.ts. */

import { windFrom } from "@/features/race-course/types";
import type { Segment } from "./profile";
import type { WindSide } from "./wind";

export type KeyPoint = { km: number; type: "climb" | "descent" | "wind" | "other"; text: string };

/** Подъём/спуск считается заметным от стольких метров перепада. */
export const MIN_SEGMENT_M = 8;
/** Ветер стоит упоминать, если медиана на старте не меньше этого, м/с. */
export const WIND_WORTH_MS = 3;
/** Встречный отрезок упоминаем от стольких км подряд, попутный от стольких. */
export const MIN_HEAD_RUN_KM = 2;
export const MIN_TAIL_RUN_KM = 3;

type Candidate = KeyPoint & { prio: number };

const kmOf = (m: number) => Math.max(1, Math.round(m / 100) / 10);
const round5 = (x: number) => Math.max(5, Math.round(x / 5) * 5);

export function keyPoints(input: {
  totalM: number;
  segments: Segment[];
  perKm: { km: number; gain: number; loss: number; wind: WindSide }[];
  wind: { dirLabel: string; medianMs: number } | null;
  /** Набор/сброс первых и последних 1000 м. Не задано, значит первый/последний км из perKm
   *  (последний км бывает неполным, поэтому вызывающему лучше посчитать честно). */
  startStretch?: { gain: number; loss: number };
  finishStretch?: { gain: number; loss: number };
}): KeyPoint[] {
  const { totalM, segments, perKm, wind } = input;
  // Уклон участка: не просто «набрал 5 м», а набрал заметно больше, чем сбросил.
  const tilt = (x?: { gain: number; loss: number }) => (!x ? 0 : x.gain - x.loss >= 5 ? 1 : x.loss - x.gain >= 5 ? -1 : 0);
  const c: Candidate[] = [];

  // Старт: первый километр в толпе.
  const startTilt = tilt(input.startStretch ?? perKm[0]);
  const startText = startTilt > 0
    ? "Старт сразу в горку и в толпе: первый километр начните спокойнее, чем хочется, разгон потом."
    : startTilt < 0
      ? "Старт под уклон и в толпе: легко убежать слишком быстро, первый километр держите сдержанно."
      : "Старт в толпе: не тратьте силы на обгоны, первый километр спокойнее, чем хочется.";
  c.push({ km: 0, type: "other", text: startText, prio: 100 });

  // Подъёмы: два самых больших заметных.
  const ups = segments.filter((s) => s.kind === "up" && s.delta >= MIN_SEGMENT_M).sort((a, b) => b.delta - a.delta).slice(0, 2);
  for (const s of ups) {
    const lenKm = (s.toM - s.fromM) / 1000;
    const long = lenKm >= 1;
    c.push({
      km: kmOf(s.fromM),
      type: "climb",
      text: long
        ? `Затяжной подъём, около ${round5(s.delta)} м вверх на ${lenKm.toFixed(1).replace(".", ",")} км: придержите усилие, ориентир на дыхание, а не на часы. Время отыграете на спуске.`
        : `Короткий подъём, около ${round5(s.delta)} м: короче шаг, руки работают, не рвите. Наверху дайте себе секунд десять войти в ритм.`,
      prio: 90 + s.delta / 100,
    });
  }

  // Спуск: самый большой заметный.
  const down = segments.filter((s) => s.kind === "down" && s.delta >= MIN_SEGMENT_M).sort((a, b) => b.delta - a.delta)[0];
  if (down) {
    c.push({
      km: kmOf(down.fromM),
      type: "descent",
      text: `Спуск, около ${round5(down.delta)} м вниз: можно отпустить, частый короткий шаг, корпус чуть вперёд, не тормозите ногами.`,
      prio: 70 + down.delta / 100,
    });
  }

  // Ветер: самый длинный подряд встречный отрезок (от 2 км), если ветер вообще заметный.
  // Встречного отрезка нет, а попутный длинный (от 3 км), значит говорим про попутный:
  // один встречный километр среди боковых погоды не делает и в тактику не идёт.
  if (wind && wind.medianMs >= WIND_WORTH_MS) {
    const longestRun = (side: WindSide): [number, number] | null => {
      let best: [number, number] | null = null;
      let runStart = -1;
      perKm.forEach((k, i) => {
        if (k.wind !== side) { runStart = -1; return; }
        if (runStart < 0) runStart = i;
        if (!best || i - runStart > best[1] - best[0]) best = [runStart, i];
      });
      return best;
    };
    const head = longestRun("head");
    const tail = longestRun("tail");
    const from = wind.dirLabel;
    if (head && head[1] - head[0] + 1 >= MIN_HEAD_RUN_KM) {
      const a = perKm[head[0]].km, z = perKm[head[1]].km;
      c.push({
        km: a - 0.5,
        type: "wind",
        text: `С ${a}-го по ${z}-й км ветер чаще всего в лицо (обычно дует ${windFrom(from)}): держитесь в группе за спинами, не выходите вперёд.`,
        prio: 75 + (head[1] - head[0]),
      });
    } else if (tail && tail[1] - tail[0] + 1 >= MIN_TAIL_RUN_KM) {
      const a = perKm[tail[0]].km, z = perKm[tail[1]].km;
      c.push({
        km: a - 0.5,
        type: "wind",
        text: `С ${a}-го по ${z}-й км ветер чаще всего в спину (обычно дует ${windFrom(from)}): бежится легче, чем кажется, не разгоняйтесь сверх плана, силы пригодятся дальше.`,
        prio: 65 + (tail[1] - tail[0]) / 10,
      });
    }
  }

  // Плоская трасса: ни одного заметного подъёма и спуска.
  if (!ups.length && !down) {
    c.push({
      km: Math.min(1, totalM / 2000),
      type: "other",
      text: "Рельеф почти плоский: держите ровное усилие всю дистанцию, без рывков. Главные переменные здесь ветер и повороты.",
      prio: 60,
    });
  }

  // Половина дистанции: сверить ощущения.
  c.push({ km: Math.round(totalM / 2000), type: "other", text: "Половина дистанции: сверьте ощущения. Если дышится ровно и ноги свежие, можно понемногу добавлять; если тяжело, держите, не догоняйте.", prio: 40 });

  // Вторая половина: место, где обычно тяжелеет.
  const twoThirds = Math.round((totalM * 2) / 3 / 1000);
  c.push({ km: twoThirds, type: "other", text: "Здесь обычно наваливается усталость: держите технику и ритм, ешьте и пейте по плану, даже если не хочется.", prio: 50 });

  // Финиш: последний километр по профилю.
  const finishTilt = tilt(input.finishStretch ?? perKm[perKm.length - 1]);
  const finishKm = Math.max(0, Math.round(totalM / 100) / 10 - 1);
  const finishText = finishTilt > 0
    ? "Финишный километр в горку: оставьте силы на него, ускорение только на последних сотнях метров."
    : finishTilt < 0
      ? "Финишный километр под уклон: можно прибавить раньше обычного, рельеф поможет."
      : "Финишный километр ровный: если силы есть, прибавляйте с этой отметки.";
  c.push({ km: finishKm, type: "other", text: finishText, prio: 95 });

  // Отбор: 6 по приоритету, но не две точки на одном километре; затем по порядку км.
  const picked: Candidate[] = [];
  for (const x of [...c].sort((a, b) => b.prio - a.prio)) {
    if (picked.length >= 6) break;
    if (picked.some((p) => Math.abs(p.km - x.km) < 0.5)) continue;
    picked.push(x);
  }
  return picked.sort((a, b) => a.km - b.km).map(({ km, type, text }) => ({ km: Math.round(km * 10) / 10, type, text }));
}
