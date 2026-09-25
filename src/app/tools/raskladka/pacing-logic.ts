/* Раскладка на Московский марафон: чистая логика без React.
 *
 * Профили высот.
 *   10 км  — маршрут восстановлен по официальному перечню улиц (Косыгина →
 *            Бережковская наб. → Смоленская наб. → Бородинский мост →
 *            Ростовская → Саввинская → Новодевичья → Лужники). Длины улиц из
 *            OpenStreetMap дают 9,34 км плюс связки, что сходится с 9,9 км по
 *            треку организатора. Высоты сняты с трека и сверены по SRTM30m и
 *            ASTER30m: набережные ровные, 120-127 м, весь перепад на Косыгина.
 *   42,2 км — профиль снят с трека организатора (racewall), 190 м на старте,
 *            холмистая середина до двадцатого километра, дальше ровно.
 *
 * Поправка на уклон — полином Минетти для энергостоимости бега. Чистая формула
 * переоценивает выигрыш на спуске, потому что не знает про торможение и
 * эксцентрику, поэтому спуск приглушён до DOWN, подъём до UP. На уклоне 2,5 %
 * это даёт около пяти секунд на километр, что совпадает с практикой.
 *
 * ВАЖНО: высоты модельные, спутниковая сетка 30 м не видит мостов. Форма
 * профиля надёжная, точные метры на мостах — нет.
 */

export type CourseId = "10" | "42";
export type Finish = "even" | "kick";

export type BandDef = {
  from: number;
  to: number;
  title: string;
  text: string;
};

export type Station = { km: number; label: string };

export type Course = {
  id: CourseId;
  name: string;
  total: number;
  startTime: string;
  where: string;
  hint: string;
  elev: number[];
  bands: BandDef[];
  shapeEven: number[];
  shapeKick: number[];
  checks: number[];
  stations: Station[];
  marks: Station[];
  presets: string[];
};

export const COURSES: Record<CourseId, Course> = {
  "10": {
    id: "10",
    name: "10 км",
    total: 10,
    startTime: "09:05",
    where: "старт ул. Косыгина у МГУ, финиш «Лужники»",
    hint:
      "Первые три километра идут вниз, дальше ровно до финиша. Примерно в середине короткий заезд на Бородинский мост. Единственный пункт на 4,7 км.",
    elev: [190, 177, 152, 126, 123, 123, 129, 121, 122, 124, 125],
    bands: [
      { from: 0, to: 3, title: "спуск с Косыгина", text: "Придёт сам. Быстрее не бежать." },
      { from: 3, to: 8, title: "рабочий", text: "Ровно, без рывков. На мосту темп просядет." },
      { from: 8, to: 10, title: "финиш", text: "Всё, что осталось." },
    ],
    shapeEven: [1.014, 1.0, 0.996],
    shapeKick: [1.009, 1.0, 0.94],
    checks: [3, 5, 8],
    stations: [{ km: 4.7, label: "вода и губки" }],
    marks: [{ km: 4.5, label: "Бородинский мост" }],
    presets: ["38:00", "40:00", "44:00", "48:00", "52:00", "57:00", "1:03:00"],
  },
  "42": {
    id: "42",
    name: "42,2 км",
    total: 42.2,
    startTime: "09:04",
    where: "старт ул. Косыгина у МГУ, финиш «Лужники»",
    hint:
      "Спуск до четвёртого километра, затем холмистая середина до двадцатого, дальше ровно. Гели на трассе только на 19,8 и 35,4 км.",
    elev: [
      190, 176, 150, 125, 123, 124, 142, 148, 152, 161, 164, 158, 158, 151, 165, 151, 148, 162,
      163, 147, 125, 125, 124, 124, 123, 120, 121, 122, 123, 123, 122, 125, 127, 129, 133, 130,
      131, 138, 129, 124, 124, 125, 124, 124,
    ],
    bands: [
      { from: 0, to: 5, title: "спуск и выход", text: "Вниз с Косыгина. Тут теряют гонку, а не выигрывают." },
      { from: 5, to: 20, title: "холмистая середина", text: "Держать усилие, а не цифру на часах." },
      { from: 20, to: 32, title: "ровная часть", text: "Самый длинный и самый скучный кусок." },
      { from: 32, to: 42.2, title: "последняя треть", text: "Здесь решается всё." },
    ],
    shapeEven: [1.026, 1.006, 1.0, 1.002],
    shapeKick: [1.018, 1.0, 0.996, 0.972],
    checks: [10, 21.1, 30, 35],
    stations: [
      { km: 4.9, label: "вода" },
      { km: 8.3, label: "питание" },
      { km: 14.6, label: "вода" },
      { km: 16.3, label: "вода" },
      { km: 19.8, label: "питание + гели" },
      { km: 23.8, label: "изотоник" },
      { km: 29.6, label: "питание" },
      { km: 33, label: "газвода" },
      { km: 35.4, label: "питание + гели" },
      { km: 37.2, label: "вода" },
      { km: 38.7, label: "питание" },
    ],
    marks: [],
    presets: ["3:00:00", "3:15:00", "3:30:00", "3:45:00", "4:00:00", "4:30:00", "5:00:00"],
  },
};

const DOWN = 0.42;
const UP = 0.6;

function minettiCost(g: number): number {
  return 155.4 * g ** 5 - 30.4 * g ** 4 - 43.3 * g ** 3 + 46.3 * g ** 2 + 19.5 * g + 3.6;
}
const COST_FLAT = minettiCost(0);

/** Во сколько раз темп на уклоне g отличается от ровного при том же усилии. */
export function gradeFactor(g: number): number {
  const ratio = minettiCost(g) / COST_FLAT;
  return 1 + (ratio - 1) * (g < 0 ? DOWN : UP);
}

export function parseTime(raw: string): number | null {
  if (!raw) return null;
  const parts = raw.trim().replace(/[.,]/g, ":").split(":").map((x) => Number.parseInt(x, 10));
  if (parts.some((x) => Number.isNaN(x))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

export function formatTime(sec: number): string {
  const t = Math.round(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatPace(sec: number): string {
  const t = Math.round(sec);
  return `${Math.floor(t / 60)}:${t % 60 < 10 ? "0" : ""}${t % 60}`;
}

export function formatKm(x: number): string {
  return String(Math.round(x * 10) / 10).replace(".", ",");
}

export type Seg = {
  from: number;
  to: number;
  len: number;
  elevTo: number;
  grade: number;
  band: number;
  factor: number;
  pace: number;
  flatPace: number;
  cum: number;
};

export type Plan = {
  segs: Seg[];
  bandPaces: number[];
  bandKm: number[];
  total: number;
  diff: number;
  shift: number;
  checks: Array<{ km: number; time: number }>;
  kick: boolean;
};

function buildSegs(c: Course): Omit<Seg, "band" | "factor" | "pace" | "flatPace" | "cum">[] {
  const out: Omit<Seg, "band" | "factor" | "pace" | "flatPace" | "cum">[] = [];
  for (let i = 0; i < c.elev.length - 1; i += 1) {
    const from = Math.min(i, c.total);
    const to = i + 1 >= c.elev.length - 1 ? c.total : Math.min(i + 1, c.total);
    const len = to - from;
    if (len <= 0.0001) continue;
    out.push({ from, to, len, elevTo: c.elev[i + 1], grade: (c.elev[i + 1] - c.elev[i]) / (len * 1000) });
  }
  return out;
}

function bandIndex(c: Course, km: number): number {
  for (let i = 0; i < c.bands.length; i += 1) {
    if (km >= c.bands[i].from && km < c.bands[i].to) return i;
  }
  return c.bands.length - 1;
}

/** Раскладка под целевое время. Темп каждой полосы кратен пяти секундам. */
export function buildPlan(c: Course, target: number, finish: Finish): Plan {
  const shape = finish === "even" ? c.shapeEven : c.shapeKick;
  const segs: Seg[] = buildSegs(c).map((s) => {
    const band = bandIndex(c, s.from);
    return { ...s, band, factor: gradeFactor(s.grade) * shape[band], pace: 0, flatPace: 0, cum: 0 };
  });

  const bandKm = c.bands.map((_, bi) =>
    segs.filter((s) => s.band === bi).reduce((a, s) => a + s.len, 0),
  );
  const base = target / segs.reduce((a, s) => a + s.factor * s.len, 0);

  let best: { cost: number; paces: number[]; total: number; diff: number } | null = null;

  for (let k = -60; k <= 60; k += 1) {
    const p0 = base * (1 + k * 0.0007);
    const ideal = c.bands.map((_, bi) => {
      const ss = segs.filter((s) => s.band === bi);
      return ss.reduce((a, s) => a + p0 * s.factor * s.len, 0) / bandKm[bi];
    });
    const options = ideal.map((v) => {
      const c0 = Math.round(v / 5) * 5;
      return [c0 - 5, c0, c0 + 5];
    });

    const idx = options.map(() => 0);
    for (;;) {
      const paces = options.map((o, i) => o[idx[i]]);
      const total = paces.reduce((a, v, bi) => a + v * bandKm[bi], 0);
      const diff = target - total;
      const last = paces.length - 1;

      let cost = diff >= 0 ? diff : -diff * 5;
      for (let i = 0; i < paces.length; i += 1) cost += Math.abs(paces[i] - ideal[i]) * 1.6;
      // спуск не должен уносить больше 15 с против рабочего темпа
      if (paces[0] < paces[1] - 15) cost += 60;
      if (paces[0] > paces[1]) cost += 35;
      // после спуска темп не ползёт вверх от полосы к полосе
      for (let q = 2; q < last; q += 1) if (paces[q] > paces[q - 1]) cost += 18;
      if (finish === "kick") {
        if (paces[last] > paces[last - 1]) cost += 70;
        if (paces[last] > paces[last - 1] - 5) cost += 20;
      } else if (Math.abs(paces[last] - paces[last - 1]) > 5) {
        cost += 45;
      }

      if (!best || cost < best.cost) best = { cost, paces: [...paces], total, diff };

      let pos = options.length - 1;
      while (pos >= 0) {
        idx[pos] += 1;
        if (idx[pos] < options[pos].length) break;
        idx[pos] = 0;
        pos -= 1;
      }
      if (pos < 0) break;
    }
  }

  const chosen = best as { cost: number; paces: number[]; total: number; diff: number };

  let cum = 0;
  segs.forEach((s) => {
    s.pace = chosen.paces[s.band];
    s.flatPace = s.pace / gradeFactor(s.grade);
    cum += s.pace * s.len;
    s.cum = cum;
  });

  const half = c.total / 2;
  let firstFlat = 0;
  let secondFlat = 0;
  segs.forEach((s) => {
    if ((s.from + s.to) / 2 < half) firstFlat += s.flatPace * s.len;
    else secondFlat += s.flatPace * s.len;
  });
  const shift = ((secondFlat / (c.total - half) - firstFlat / half) / (firstFlat / half)) * 100;

  const checks = c.checks.map((d) => {
    let t = 0;
    for (const s of segs) {
      if (s.to <= d + 1e-9) t += s.pace * s.len;
      else if (s.from < d) {
        t += s.pace * (d - s.from);
        break;
      } else break;
    }
    return { km: d, time: t };
  });

  const n = chosen.paces.length;
  return {
    segs,
    bandPaces: chosen.paces,
    bandKm,
    total: chosen.total,
    diff: chosen.diff,
    shift,
    checks,
    kick: chosen.paces[n - 1] < chosen.paces[n - 2],
  };
}

/** Коридор эквивалентного усилия: на десятке нужен негативный сплит, на марафоне ровно. */
export function effortVerdict(c: Course, shift: number): { ok: boolean; text: string } {
  const lo = c.total > 20 ? -2.5 : -4;
  const hi = c.total > 20 ? 1 : -0.4;
  const ok = shift >= lo && shift <= hi;
  if (ok) {
    return {
      ok,
      text:
        c.total > 20
          ? "Для марафона это норма: ровное усилие от старта до финиша."
          : "Это нужный коридор: лёгкий негативный сплит по усилию.",
    };
  }
  return {
    ok,
    text:
      shift > hi
        ? "В начале заложено слишком много. Возьми цель поспокойнее или переключись на разгон к финишу."
        : "Вторая половина выходит слишком тяжёлой. Цель агрессивная: смягчи её или сделай финиш ровным.",
  };
}

export function planAsText(c: Course, plan: Plan): string {
  const lines = [`${c.name} · цель ${formatTime(plan.total)} · старт ${c.startTime}`];
  c.bands.forEach((b, i) => {
    lines.push(
      `${formatPace(plan.bandPaces[i])}  км ${formatKm(b.from === 0 ? 1 : b.from)}-${formatKm(b.to)}  ${b.title}`,
    );
  });
  lines.push(
    `Сверка: ${plan.checks.map((ch) => `${formatKm(ch.km)} км ${formatTime(ch.time)}`).join(" · ")} · финиш ${formatTime(plan.total)}`,
  );
  return lines.join("\n");
}
