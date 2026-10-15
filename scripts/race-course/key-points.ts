/* Ключевые точки тактики: детерминированные правила по профилю и ветру, без цифр темпа.
 * Каждое правило ниже даёт кандидата с приоритетом; в выдачу идут 5–6 лучших, по порядку км.
 * Два шаблона: keyPoints для шоссе (как было, на «вы») и keyPointsTrail для трейла (на «ты»,
 * шаг на крутом, спуски, фонарь, питание; наряд 15.10.2026). Чистые функции без сети,
 * их стережёт scripts/check-race-course.ts. */

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
  /** «Старт в толпе» только у массовых стартов: false для ультра и малых (меньше 300). Не задано, значит true. */
  crowd?: boolean;
}): KeyPoint[] {
  const { totalM, segments, perKm, wind } = input;
  const crowd = input.crowd ?? true;
  // Уклон участка: не просто «набрал 5 м», а набрал заметно больше, чем сбросил.
  const tilt = (x?: { gain: number; loss: number }) => (!x ? 0 : x.gain - x.loss >= 5 ? 1 : x.loss - x.gain >= 5 ? -1 : 0);
  const c: Candidate[] = [];

  // Старт: первый километр в толпе.
  const startTilt = tilt(input.startStretch ?? perKm[0]);
  const startText = !crowd
    ? startTilt > 0
      ? "Старт сразу в горку: первый километр начните спокойнее, чем хочется, разгон потом."
      : startTilt < 0
        ? "Старт под уклон: легко убежать слишком быстро, первый километр держите сдержанно."
        : "Первый километр спокойнее, чем хочется: силы пригодятся во второй половине."
    : startTilt > 0
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

/** Пункты питания из положения: сколько всего и какие известны по километрам. */
export type AidInfo = { count: number | null; known: { km: number; name: string }[] };

const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;
const num = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");

/** Трейловый шаблон: тот же профиль, другие подсказки. Без «толпы»: на трейле и ультра её нет.
 *  startMin/cutoffMin — час старта своей дистанции и контрольное время в минутах; sun — восход и
 *  закат в минутах местного времени; aid — пункты из положения (null, если положения нет). */
export function keyPointsTrail(input: Parameters<typeof keyPoints>[0] & {
  distanceKm: number;
  startMin: number | null;
  cutoffMin: number | null;
  sun: { sunrise: number; sunset: number } | null;
  aid: AidInfo | null;
}): KeyPoint[] {
  const { totalM, segments, perKm, wind, distanceKm, startMin, cutoffMin, sun, aid } = input;
  const tilt = (x?: { gain: number; loss: number }) => (!x ? 0 : x.gain - x.loss >= 5 ? 1 : x.loss - x.gain >= 5 ? -1 : 0);
  const c: Candidate[] = [];

  // Старт: без толпы; до рассвета, значит фонарь.
  const dark = startMin != null && sun != null && startMin < sun.sunrise;
  const startTilt = tilt(input.startStretch ?? perKm[0]);
  const first = startTilt > 0
    ? "первые минуты шагом или совсем легко, пульс ещё успеет вырасти."
    : "первый километр спокойно, на трейле время теряют не на старте, а на последних подъёмах.";
  c.push({
    km: 0,
    type: "other",
    text: dark ? `Старт до рассвета: налобный фонарь и запасные батарейки, ${first}` : startTilt > 0 ? `Старт сразу в подъём: ${first}` : `Первый километр спокойно: на трейле время теряют не на старте, а на последних подъёмах.`,
    prio: 100,
  });

  // Финиш после заката у тех, кто бежит до контрольного времени: где стемнеет при ровном темпе.
  if (startMin != null && cutoffMin != null && sun != null && startMin + cutoffMin > sun.sunset && startMin < sun.sunset) {
    const hours = Math.floor(((sun.sunset - startMin) / 60) * 2) / 2;
    const km = Math.max(1, Math.min(distanceKm - 1, (distanceKm * (sun.sunset - startMin)) / cutoffMin));
    c.push({ km, type: "other", text: `Если бежишь дольше ${num(hours)} ч, где-то здесь стемнеет: налобный фонарь и запасные батарейки с собой.`, prio: 97 });
  }

  // Подъёмы: два самых больших заметных.
  const ups = segments.filter((s) => s.kind === "up" && s.delta >= MIN_SEGMENT_M).sort((a, b) => b.delta - a.delta).slice(0, 2);
  for (const s of ups) {
    const lenKm = (s.toM - s.fromM) / 1000;
    c.push({
      km: kmOf(s.fromM),
      type: "climb",
      text: lenKm >= 1
        ? `Длинный подъём, около ${round5(s.delta)} м вверх на ${lenKm.toFixed(1).replace(".", ",")} км: темп по дыханию и пульсу, не по часам. На крутом шагом выгоднее, чем бегом; палки, если разрешены.`
        : `Подъём, около ${round5(s.delta)} м: на крутых участках шагом выгоднее, чем бегом; палки, если разрешены.`,
      prio: 90 + s.delta / 100,
    });
  }

  // Спуск: самый большой заметный.
  const down = segments.filter((s) => s.kind === "down" && s.delta >= MIN_SEGMENT_M).sort((a, b) => b.delta - a.delta)[0];
  if (down) {
    c.push({
      km: kmOf(down.fromM),
      type: "descent",
      text: `Спуск, около ${round5(down.delta)} м вниз: короткий частый шаг, смотри на 3-5 м вперёд. На техничном спуске не обгоняй.`,
      prio: 70 + down.delta / 100,
    });
  }

  // Питание и вода: дистанция больше 20 км или контрольное время больше 2,5 часа.
  if (distanceKm > 20 || (cutoffMin != null && cutoffMin > 150)) {
    let text: string;
    let km = Math.max(1, distanceKm / 3);
    if (aid && (aid.count || aid.known.length)) {
      const known = [...aid.known].sort((a, b) => a.km - b.km);
      const n = aid.count ?? known.length;
      // Самый длинный перегон: по известным км, если известны все пункты, иначе в среднем.
      const gap = known.length === n
        ? Math.max(...[0, ...known.map((k) => k.km), distanceKm].map((x, i, arr) => (i ? x - arr[i - 1] : 0)))
        : distanceKm / (n + 1);
      const where = known.length ? `, ${known.map((k) => `${k.name} на ${num(k.km)} км`).join(", ")}` : "";
      text = `На трассе ${n} ${plural(n, "пункт питания", "пункта питания", "пунктов питания")}${where}: `
        + (gap > 10 ? "между ними больше 10 км, бери воду с собой." : "воду всё равно бери с собой, пей по плану.");
      if (known.length) km = known[0].km;
    } else {
      text = "Воду и еду бери с собой на всю дистанцию: где пункты питания, уточни в положении.";
    }
    c.push({ km, type: "other", text, prio: 92 });
  }

  // Ветер: только длинный встречный отрезок, и без «держитесь в группе»: на тропе группы нет.
  // Ниже спуска по приоритету: на одном км с вершиной ветер вытеснял главный спуск (FerrumFest 19, 15.10).
  if (wind && wind.medianMs >= WIND_WORTH_MS) {
    let best: [number, number] | null = null;
    let runStart = -1;
    perKm.forEach((k, i) => {
      if (k.wind !== "head") { runStart = -1; return; }
      if (runStart < 0) runStart = i;
      if (!best || i - runStart > best[1] - best[0]) best = [runStart, i];
    });
    const head = best as [number, number] | null;
    if (head && head[1] - head[0] + 1 >= MIN_HEAD_RUN_KM) {
      const a = perKm[head[0]].km, z = perKm[head[1]].km;
      c.push({ km: a - 0.5, type: "wind", text: `С ${a}-го по ${z}-й км ветер чаще в лицо (обычно дует ${windFrom(wind.dirLabel)}): на открытых участках держи усилие, а не темп.`, prio: 65 });
    }
  }

  // Вторая половина длинной дистанции: место, где обычно тяжелеет.
  if (distanceKm >= 10) {
    c.push({ km: Math.round((totalM * 2) / 3 / 1000), type: "other", text: "Здесь обычно наваливается усталость: ешь и пей по плану, даже если не хочется.", prio: 50 });
  }

  // Финиш по профилю последнего километра.
  const finishTilt = tilt(input.finishStretch ?? perKm[perKm.length - 1]);
  c.push({
    km: Math.max(0, Math.round(totalM / 100) / 10 - 1),
    type: "other",
    text: finishTilt > 0
      ? "Финиш в горку: оставь силы на последний подъём."
      : finishTilt < 0
        ? "Финиш под уклон: не рискуй ради секунд, падение дороже."
        : "Последний километр ровный: если силы есть, прибавляй.",
    prio: 95,
  });

  const picked: Candidate[] = [];
  for (const x of [...c].sort((a, b) => b.prio - a.prio)) {
    if (picked.length >= 6) break;
    if (picked.some((p) => Math.abs(p.km - x.km) < 0.5)) continue;
    picked.push(x);
  }
  return picked.sort((a, b) => a.km - b.km).map(({ km, type, text }) => ({ km: Math.round(km * 10) / 10, type, text }));
}

/** Суть трассы одной строкой для выбора дистанции в боте: «2 подъёма до 200 м, спуск до 325 м, финиш в горку».
 *  Считаются подъёмы от 30 м: мелочь в одну строку не нужна. */
export function courseSummary(segments: Segment[], finish?: { gain: number; loss: number }): string {
  const ups = segments.filter((s) => s.kind === "up" && s.delta >= 30);
  const downs = segments.filter((s) => s.kind === "down" && s.delta >= 30);
  const parts: string[] = [];
  if (!ups.length && !downs.length) parts.push("почти без перепадов");
  if (ups.length) parts.push(`${ups.length} ${plural(ups.length, "подъём", "подъёма", "подъёмов")} до ${round5(Math.max(...ups.map((s) => s.delta)))} м`);
  if (downs.length) parts.push(`спуск до ${round5(Math.max(...downs.map((s) => s.delta)))} м`);
  if (finish && finish.gain - finish.loss >= 5) parts.push("финиш в горку");
  else if (finish && finish.loss - finish.gain >= 5) parts.push("финиш под уклон");
  return parts.join(", ");
}

/** До 4 точек для короткого разбора в боте: подъёмы, затем спуск, фонарь, питание; выводятся по порядку км. */
export function shortPoints(points: KeyPoint[], max = 4): KeyPoint[] {
  const rank = (p: KeyPoint) => (p.type === "climb" ? 3 : p.type === "descent" ? 2.8 : /фонарь/i.test(p.text) ? 2.6 : /пункт|воду/i.test(p.text) ? 2.5 : p.type === "wind" ? 1 : 0);
  return [...points].filter((p) => rank(p) > 0).sort((a, b) => rank(b) - rank(a)).slice(0, max).sort((a, b) => a.km - b.km);
}
