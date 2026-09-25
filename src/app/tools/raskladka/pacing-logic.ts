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
 * Старты и пункты питания сверены 25.09.2026 с официальным расписанием
 * (moscowmarathon10km.runc.run, moscowmarathon.runc.run/raspisanie и /trassa).
 * 09:00 у обеих дистанций — элитный кластер с Воробьёвской набережной, это НЕ
 * наш старт. Массовый бегун стартует волнами с улицы Косыгина: на десятке
 * кластер А в 09:05, дальше до 10:20; на марафоне кластер А в 09:04, дальше до
 * 09:59. Часы считают личное время от своей волны, поэтому раскладка привязана
 * к первой массовой волне, а не к 09:00.
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

/** kind различает пункты на профиле: питание рисуется кружком, вода штрихом. */
export type Station = { km: number; label: string; kind: "food" | "water" };

export type Start = {
  /** День забега, как в официальном расписании. */
  date: string;
  /** Элитный кластер: другое место и другое время, к массовому старту не относится. */
  elite: string;
  /** Уже в нужном падеже: подставляется после предлога «с». */
  eliteWhere: string;
  /** Первая массовая волна, кластер А. От неё и считается раскладка. */
  first: string;
  /** Последняя волна по расписанию. */
  last: string;
};

export type Course = {
  id: CourseId;
  name: string;
  total: number;
  start: Start;
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
  defaultTarget: string;
};

export const COURSES: Record<CourseId, Course> = {
  "10": {
    id: "10",
    name: "10 км",
    total: 10,
    start: {
      date: "26 сентября",
      elite: "09:00",
      eliteWhere: "Воробьёвской набережной",
      first: "09:05",
      last: "10:20",
    },
    where: "старт ул. Косыгина у МГУ, финиш «Лужники»",
    hint:
      "Первые три километра идут вниз, дальше ровно до финиша. Примерно в середине короткий заезд на Бородинский мост. Единственный пункт на 4,7 км.",
    elev: [190, 177, 152, 126, 123, 123, 129, 121, 122, 124, 125],
    bands: [
      { from: 0, to: 3, title: "спуск с Косыгина", text: "Придёт без усилий. Быстрее не бежать." },
      { from: 3, to: 8, title: "рабочий", text: "Ровно, без рывков. На мосту темп просядет." },
      { from: 8, to: 10, title: "финиш", text: "Всё, что есть." },
    ],
    shapeEven: [1.014, 1.0, 0.996],
    shapeKick: [1.009, 1.0, 0.94],
    checks: [3, 5, 8],
    stations: [{ km: 4.7, label: "вода и губки", kind: "water" }],
    marks: [{ km: 4.5, label: "Бородинский мост", kind: "water" }],
    presets: ["38:00", "40:00", "44:00", "48:00", "50:00", "52:00", "57:00", "1:03:00"],
    defaultTarget: "50:00",
  },
  "42": {
    id: "42",
    name: "42,2 км",
    total: 42.2,
    start: {
      date: "27 сентября",
      elite: "09:00",
      eliteWhere: "Воробьёвской набережной",
      first: "09:04",
      last: "09:59",
    },
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
      { km: 4.9, label: "вода", kind: "water" },
      { km: 8.3, label: "питание", kind: "food" },
      { km: 14.6, label: "вода", kind: "water" },
      { km: 16.3, label: "вода", kind: "water" },
      { km: 19.8, label: "питание и гели", kind: "food" },
      { km: 23.8, label: "изотоник", kind: "water" },
      { km: 29.6, label: "питание", kind: "food" },
      { km: 33, label: "газвода", kind: "water" },
      { km: 35.4, label: "питание и гели", kind: "food" },
      { km: 37.2, label: "вода", kind: "water" },
      { km: 38.7, label: "питание и газвода", kind: "food" },
    ],
    marks: [],
    presets: ["3:00:00", "3:15:00", "3:30:00", "3:45:00", "4:00:00", "4:30:00", "5:00:00"],
    defaultTarget: "4:00:00",
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

/** Десятичный разделитель на странице всюду запятая, точка не пролезает. */
export function formatDec(x: number, digits = 1): string {
  return x.toFixed(digits).replace(".", ",");
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

/** Промах по цели меньше сотой секунды — это ошибка double, а не промах. */
const EXACT_EPS = 0.005;

/** Насколько далеко от идеального темпа полосы решателю разрешено искать. */
const WINDOW = 20;

/** Предел разгона: финиш быстрее рабочего темпа не больше чем на столько. */
const MAX_KICK = 15;

/** Самая медленная рабочая полоса: всё между спуском и финишем. */
function workingPace(paces: number[]): number {
  const middle = paces.slice(1, paces.length - 1);
  return middle.length ? Math.max(...middle) : paces[0];
}

/** На сколько секунд финишная полоса быстрее рабочего темпа. */
function kickSize(paces: number[], finish: Finish): number {
  return finish === "kick" ? workingPace(paces) - paces[paces.length - 1] : 0;
}

/* Допустимый промах по цели: треть секунды на километр.
 *
 * НА ДЕСЯТКЕ ЭТО «ТОЛЬКО ТОЧНО». Полосы там 3, 5 и 2 км, темпы кратны пяти
 * секундам, значит сумма кратна пяти, и любая цель в целых минутах берётся
 * ровно. Допуск 3 с при решётке шагом 5 с не открывает ни одного неточного
 * варианта, зато не приходится писать «для десятки ноль» отдельным условием.
 *
 * НА МАРАФОНЕ ЭТО ЧЕТЫРНАДЦАТЬ СЕКУНД, и они нужны. Последняя полоса 10,2 км, и
 * суммы 5a + 15b + 12c + 10,2d при темпах кратных пяти ложатся редкой решёткой:
 * для 3:30:00 «С разгоном» единственная точная раскладка в окне это
 * 5:15 / 5:20 / 4:45 / 4:35, то есть сорок секунд размаха и вторая половина на
 * 11 % тяжелее первой. Требовать точность здесь значит требовать вредный совет.
 * Четырнадцать секунд на 42,2 км это 0,09 % дистанции и треть секунды на
 * километр — тоньше, чем живой человек отработает по часам. Запас именно такой,
 * а не уже, из-за предела разгона: на 3:45:00 «С разгоном» весь выбор это либо
 * 3:44:47 с разгоном 15, либо 3:45:03 с разгоном 10, и второе опаздывает.
 *
 * ОПОЗДАНИЕ СЧИТАЕТСЯ ВДВОЕ. Промах в обе стороны одинаков по модулю, но не по
 * смыслу: цель на часах это обещание успеть. Прийти на шесть секунд раньше
 * лучше, чем на четыре позже, и допуск устроен так, чтобы решатель выбирал
 * именно так. */
function missAllowance(totalKm: number): number {
  return Math.max(1, Math.round(totalKm / 3));
}
const LATE_WEIGHT = 2;

/* Форма раскладки — ЖЁСТКИЕ условия, а не слагаемые цены.
 *
 * Сначала было наоборот: промах по цели и кривизна формы складывались в одну
 * цену, и решатель их разменивал. Получалось два разных вранья. Когда форма
 * весила больше, 50:00 «Ровный» выдавал 49:55, а 3:15:00 не добирал двадцать
 * секунд — сверка по часам врала к финишу на целую минуту. Когда точность
 * весила больше, сходилось время, но рассыпался смысл: на марафоне 3:15:00
 * ровная часть шла 4:45 против 4:35 на холмистой середине, то есть бегуну
 * предлагали замедлиться там, где стало легче, а кнопки «Ровный» и «С разгоном»
 * начали давать одинаковый ответ.
 *
 * Поэтому условия ниже не обсуждаются: раскладка, которая их нарушает, не
 * рассматривается вообще. Точность выбирается уже внутри допустимого, форма
 * дотягивается мягкой ценой. */
function shapeAllowed(paces: number[], finish: Finish): boolean {
  const last = paces.length - 1;
  // Спуск не медленнее рабочей полосы, но и не уносит больше 15 с.
  if (paces[0] > paces[1]) return false;
  if (paces[0] < paces[1] - 15) return false;
  // После спуска темп не ползёт вверх от полосы к полосе: там, где стало легче,
  // не может стать медленнее.
  for (let q = 2; q < last; q += 1) if (paces[q] > paces[q - 1]) return false;
  if (finish === "kick") {
    // Разгон — это разгон: финишная полоса быстрее предыдущей, иначе кнопка врёт.
    if (paces[last] > paces[last - 1] - 5) return false;
    // Но разгон МЯГКИЙ. Отсчёт идёт от самой медленной рабочей полосы, а не от
    // соседней: на марафоне между холмистой серединой и финишем стоит ровная
    // часть, и сравнение только с ней прятало настоящий размах. На 3:45:00
    // выходило 5:30 в середине против 5:10 на финише — двадцать секунд, которые
    // по соседним полосам читались как пять.
    return workingPace(paces) - paces[last] <= MAX_KICK;
  }
  // Ровный финиш: та же цифра до конца, плюс-минус один шаг решётки. Пять секунд
  // на последней полосе это не разгон, а округление; запрещать их значит на
  // ровном месте терять точное попадание в цель (на десятке 44:00 иначе не
  // складывается совсем).
  return Math.abs(paces[last] - paces[last - 1]) <= 5;
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

  // Идеальный темп полосы: то, что вышло бы без округления до пяти секунд.
  const ideal = c.bands.map((_, bi) => {
    const ss = segs.filter((s) => s.band === bi);
    return ss.reduce((a, s) => a + base * s.factor * s.len, 0) / bandKm[bi];
  });
  const options = ideal.map((v) => {
    const c0 = Math.round(v / 5) * 5;
    const out: number[] = [];
    for (let d = -WINDOW; d <= WINDOW; d += 5) if (c0 + d >= 100) out.push(c0 + d);
    return out;
  });

  const allowance = missAllowance(c.total);

  type Cand = {
    effMiss: number;
    kick: number;
    score: number;
    paces: number[];
    total: number;
    diff: number;
  };

  /* Два победителя сразу: лучший среди НЕ ОПАЗДЫВАЮЩИХ и лучший вообще.
   *
   * Опоздание раньше было тяжёлым слагаемым в допуске, и этого хватало, пока
   * над ним не появился более старший ключ. Стоило мягкости разгона встать
   * выше — опоздание тут же пролезло: марафон 3:45:00 «С разгоном» начал
   * финишировать в 3:45:03. Цель на часах это обещание успеть, поэтому берём
   * опаздывающий вариант только если не опаздывающих нет вовсе. */
  let best: Cand | null = null;
  let bestNotLate: Cand | null = null;
  const idx = options.map(() => 0);

  for (;;) {
    const paces = options.map((o, i) => o[idx[i]]);
    if (shapeAllowed(paces, finish)) {
      const total = paces.reduce((a, v, bi) => a + v * bandKm[bi], 0);
      const diff = target - total;
      const miss = Math.abs(diff);
      const last = paces.length - 1;

      let cost = 0;
      for (let i = 0; i < paces.length; i += 1) cost += Math.abs(paces[i] - ideal[i]) * 1.6;
      // ПРИЙТИ РАНЬШЕ ЦЕЛИ, А НЕ ПОЗЖЕ. Промах в обе стороны одинаков по модулю,
      // но не по смыслу: цель на часах это обещание успеть, а не «примерно там».
      if (diff < 0) cost += 25;
      // ровный финиш тем лучше, чем ровнее
      if (finish === "even" && paces[last] !== paces[last - 1]) cost += 10;

      // ПОРЯДОК ОТБОРА, ровно в этом старшинстве:
      //   1. точность по цели (с допуском, см. missAllowance);
      //   2. мягкость разгона — из допустимых берём вариант с наименьшим;
      //   3. всё остальное ценой: близость к идеалу, быстрый спуск, запас к цели.
      // Быстрый спуск остаётся предпочтением, но уступает мягкому финишу: если
      // одно мешает другому, спуск сравнивается с рабочим темпом.
      const weighted = diff < 0 ? miss * LATE_WEIGHT : miss;
      const effMiss = Math.max(0, weighted - allowance);
      const kick = kickSize(paces, finish);
      const score = cost + miss * 1.5 + (paces[0] >= paces[1] ? 12 : 0);
      const cand: Cand = { effMiss, kick, score, paces: [...paces], total, diff };
      const beats = (b: Cand | null) =>
        !b ||
        effMiss < b.effMiss - EXACT_EPS ||
        (effMiss <= b.effMiss + EXACT_EPS && (kick < b.kick || (kick === b.kick && score < b.score)));
      if (beats(best)) best = cand;
      if (diff >= -EXACT_EPS && beats(bestNotLate)) bestNotLate = cand;
    }

    let pos = options.length - 1;
    while (pos >= 0) {
      idx[pos] += 1;
      if (idx[pos] < options[pos].length) break;
      idx[pos] = 0;
      pos -= 1;
    }
    if (pos < 0) break;
  }

  const chosen = (bestNotLate ?? best) as Cand;

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

  return {
    segs,
    bandPaces: chosen.paces,
    bandKm,
    total: chosen.total,
    diff: chosen.diff,
    shift,
    checks,
    // Стрелка разгона следует за РЕЖИМОМ, а не за сравнением двух чисел. Иначе
    // «Ровный», где последняя полоса округлилась на пять секунд вниз, показывал
    // бы стрелку разгона, которого никто не планировал.
    kick: finish === "kick",
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
  const lines = [
    // «финиш», а не «цель»: на марафоне план может прийти на несколько секунд
    // раньше введённой цели, и называть его целью значит тихо подменить число.
    `${c.name} · финиш ${formatTime(plan.total)} · ${c.start.date}, волна ${c.start.first}`,
  ];
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
