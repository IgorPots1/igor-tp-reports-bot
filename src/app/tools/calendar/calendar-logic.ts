/* Календарь до марафона: чистая логика без React.
 *
 * «Сегодня» приходит параметром и нигде внутри не берётся из new Date():
 * иначе чек зависел бы от дня прогона и ничего бы не воспроизводил.
 *
 * ДАТЫ СДВИГАЮТСЯ КАЛЕНДАРНЫМИ ДНЯМИ (setDate), А НЕ МИЛЛИСЕКУНДАМИ. Сутки не
 * всегда 24 часа: на переходе на летнее время сдвиг на 24 ч × N уезжает на час
 * назад, и полночь становится 23:00 предыдущего дня. В первой версии
 * прототипа так длительная выпала на субботу 30 января вместо воскресенья
 * 31-го. Все даты здесь без времени, местная полночь.
 *
 * Тексты перенесены из прототипа тренера без правок.
 */

import { plural } from "@/app/tools/marathon/marathon-logic";

export type KmId = "lt20" | "20to30" | "30p";
export type LastId = "none" | "10" | "21" | "42";
export type CountId = "1to2" | "3to5" | "6p";
export type PhaseId = "rec" | "off" | "dev" | "mp" | "taper";

export type CalendarInput = {
  /** Дата марафона, ГГГГ-ММ-ДД из input type=date. */
  race: string;
  km: KmId;
  last: LastId;
  /** Дата последнего старта, ГГГГ-ММ-ДД или пусто. */
  lastDate: string;
  count: CountId;
};

export type Phase = {
  id: PhaseId;
  name: string;
  from: Date;
  /** Конец не включительно: это же начало следующего этапа. */
  to: Date;
  text: string;
};

export type TimelineItem = {
  kind: PhaseId | "long25" | "long30" | "key" | "race";
  date: Date;
  when: string;
  name: string;
  text: string;
  current: boolean;
};

export type CalendarResult =
  | { ok: false; error: string | null }
  | {
      ok: true;
      /** «Межсезонье», «Подготовка, развитие»… */
      phaseNow: string;
      phaseNowId: PhaseId;
      weeksLeft: number;
      weeksText: string;
      /** Зелёная плашка, когда по срокам всё сходится, оранжевая иначе. */
      fits: boolean;
      note: string;
      phases: Phase[];
      /** Доли полосы в процентах, только этапы ненулевой длины. */
      bar: { id: PhaseId; name: string; pct: number }[];
      barLabel: string;
      timeline: TimelineItem[];
      /** Важные даты, чтобы чек мог сверять их без разбора строк. */
      dates: {
        prepStart: Date;
        devEnd: Date;
        long25: Date;
        long30: Date;
        key: Date;
        taper: Date;
        race: Date;
        recEnd: Date;
      };
    };

export const ERR_TOO_SOON = "Выбери дату хотя бы через 3 недели от сегодня.";
export const ERR_TOO_FAR = "Возьми марафон в пределах двух лет.";
export const NOTE_REC_PAST = "Восстановление после старта уже позади, можно переходить к межсезонью.";
export const NOTE_REC_NO_DATE = "Укажи дату старта, и восстановление посчитается точнее.";

const MONTHS_OF = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

const REC_WEEKS: Record<Exclude<LastId, "none">, number> = { "10": 1, "21": 2, "42": 3 };
const BASE_WEEKS: Record<KmId, number> = { lt20: 8, "20to30": 3, "30p": 0 };
export const MAX_REC_WEEKS = 4;
export const PREP_WEEKS = 18;

/** Местная полночь того же календарного дня. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Сдвиг календарными днями: переход на летнее время не уводит дату назад. */
export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

/** Разница в днях по календарю. Через UTC, где переходов времени нет. */
export function daysBetween(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / 864e5);
}

/** ГГГГ-ММ-ДД → местная полночь; null, если строка не дата. */
export function parseIsoDate(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((v || "").trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
    return null;
  }
  return d;
}

export function toIsoDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function dayMonth(d: Date): string {
  return `${d.getDate()} ${MONTHS_OF[d.getMonth()]}`;
}

export function dayMonthYear(d: Date): string {
  return `${dayMonth(d)} ${d.getFullYear()}`;
}

function weeksWord(n: number): string {
  return plural(n, "неделя", "недели", "недель");
}

/** По умолчанию: ближайшее воскресенье примерно через полгода. */
export function defaultRaceDate(today: Date): Date {
  const d = addDays(today, 182);
  return addDays(d, (7 - d.getDay()) % 7);
}

/** Недели восстановления после последнего старта, до вычета прошедших. */
export function recoveryWeeks(last: LastId, count: CountId): number {
  if (last === "none") return 0;
  return Math.min(MAX_REC_WEEKS, REC_WEEKS[last] + (count === "6p" ? 1 : 0));
}

const PHASE_TEXT: Record<PhaseId, string> = {
  rec: "Только лёгкий бег, без интенсивных тренировок. Организму нужно время, чтобы восстановились мышцы и связки.",
  off: "3-4 лёгкие пробежки в неделю, объём постепенно до своего обычного, внутри пробежек короткие ускорения по 20 секунд, силовые 2 раза в неделю.",
  dev: "Раз в неделю пороговые отрезки, длительная растёт с 15-18 до 25 км.",
  mp: "Вставки целевого темпа в ключевую тренировку и в длительную, репетиция питания.",
  taper: "Объём вниз на 40-60%, темп не трогаем. Последняя интенсивная за 4 дня до старта.",
};

const PHASE_NAME: Record<PhaseId, string> = {
  rec: "Восстановление",
  off: "Межсезонье",
  dev: "Подготовка: развитие",
  mp: "Марафонский темп",
  taper: "Подводка",
};

export function buildCalendar(input: CalendarInput, todayRaw: Date): CalendarResult {
  const T = startOfDay(todayRaw);
  const R = parseIsoDate(input.race);
  if (!R) return { ok: false, error: null };
  if (R < addDays(T, 21)) return { ok: false, error: ERR_TOO_SOON };
  if (R > addDays(T, 730)) return { ok: false, error: ERR_TOO_FAR };

  // Восстановление считается от даты последнего старта. Дата в будущем
  // считается сегодняшней: старт ещё не пробежан, а восстанавливаться после
  // него раньше него нельзя.
  let recW = recoveryWeeks(input.last, input.count);
  let L = input.lastDate ? parseIsoDate(input.lastDate) : null;
  if (L && L > T) L = T;
  let recEnd = T;
  let recNote = "";
  if (recW) {
    recEnd = addDays(L ?? T, recW * 7);
    if (recEnd <= T) {
      recNote = NOTE_REC_PAST;
      recEnd = T;
      recW = 0;
    } else if (!L) {
      recNote = NOTE_REC_NO_DATE;
    }
  }

  const baseW = BASE_WEEKS[input.km];
  const prepStart = addDays(R, -PREP_WEEKS * 7);
  const devEnd = addDays(R, -8 * 7);
  const long25 = addDays(R, -10 * 7);
  const long30 = addDays(R, -6 * 7);
  const key = addDays(R, -3 * 7);
  const taper = addDays(R, -2 * 7);
  const needReady = addDays(recEnd, baseW * 7);

  let note: string;
  let fits = false;
  if (prepStart < T) {
    const earliest = addDays(needReady, PREP_WEEKS * 7);
    note = `До марафона меньше 18 недель, полноценной подготовки не получится. Лучше выбрать марафон не раньше ${dayMonthYear(earliest)}, а на этом забеге пробежать полумарафон.`;
  } else if (needReady > prepStart) {
    const earliest = addDays(needReady, PREP_WEEKS * 7);
    note = `Времени на базу не хватает: нужно ещё ${baseW} ${weeksWord(baseW)} спокойного набора объёма до старта подготовки. Безопаснее выбрать марафон не раньше ${dayMonthYear(earliest)}.`;
  } else {
    const spare = Math.round(daysBetween(needReady, prepStart) / 7);
    fits = true;
    note =
      spare >= 2
        ? `По срокам всё сходится: до старта подготовки у тебя ${spare} ${weeksWord(spare)} межсезонья.`
        : "По срокам всё сходится, но впритык: межсезонье почти сразу переходит в подготовку.";
  }
  if (recNote) note = `${recNote} ${note}`;

  const phases: Phase[] = [];
  const push = (id: PhaseId, from: Date, to: Date, text = PHASE_TEXT[id]) =>
    phases.push({ id, name: PHASE_NAME[id], from, to, text });
  if (recW) push("rec", T, recEnd);
  if (prepStart > recEnd) {
    push("off", recEnd, prepStart, PHASE_TEXT.off + (baseW ? " Сначала доведи объём хотя бы до 30 км в неделю." : ""));
  }
  const ps = prepStart > T ? prepStart : T;
  push("dev", ps, devEnd > ps ? devEnd : ps);
  push("mp", devEnd > T ? devEnd : T, taper);
  push("taper", taper > T ? taper : T, R);

  const cur = phases.find((p) => T >= p.from && T < p.to) ?? phases[0];
  const phaseNow = cur.name
    .replace("Подготовка: ", "подготовка, ")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());

  const weeksLeft = Math.round(daysBetween(T, R) / 7);
  const weeksText = `До марафона ${weeksLeft} ${weeksWord(weeksLeft)}, старт ${dayMonthYear(R)}.`;

  const totalDays = daysBetween(T, R);
  const nonEmpty = phases.filter((p) => p.to > p.from);
  const bar = nonEmpty.map((p) => ({
    id: p.id,
    name: p.name,
    pct: (daysBetween(p.from, p.to) / totalDays) * 100,
  }));
  const barLabel = nonEmpty.map((p) => `${p.name} до ${dayMonth(p.to)}`).join(", ");

  const timeline: TimelineItem[] = nonEmpty.map((p) => ({
    kind: p.id,
    date: p.from,
    when: `с ${dayMonth(p.from)} по ${dayMonth(p.to)}`,
    name: p.name,
    text: p.text,
    current: p === cur,
  }));
  if (long25 > T) {
    timeline.push({ kind: "long25", date: long25, when: dayMonth(long25), name: "Первая длительная 25 км", text: "Спокойно, с гелями, как будущая репетиция.", current: false });
  }
  if (long30 > T) {
    timeline.push({ kind: "long30", date: long30, when: dayMonth(long30), name: "Длительная 28-30 км", text: "Спокойно, последние 8-10 км в марафонском темпе. Питание как на старте.", current: false });
  }
  if (key > T) {
    timeline.push({ kind: "key", date: key, when: dayMonth(key), name: "Главная тренировка", text: "29-34 км: первая половина легко, вторая в марафонском темпе, гели каждые 30 минут. Чем медленнее твой темп, тем ближе к 29 км.", current: false });
  }
  timeline.push({ kind: "race", date: R, when: dayMonthYear(R), name: "Марафон", text: "Первые километры на 5-10 секунд медленнее цели, ускорение во второй половине.", current: false });
  // Сортировка устойчивая: этап и тренировка в один день идут в порядке добавления.
  timeline.sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    ok: true,
    phaseNow,
    phaseNowId: cur.id,
    weeksLeft,
    weeksText,
    fits,
    note,
    phases,
    bar,
    barLabel,
    timeline,
    dates: { prepStart, devEnd, long25, long30, key, taper, race: R, recEnd },
  };
}
