/* Тест готовности к марафону: чистая логика без React.
 *
 * Правило одно на весь файл: БАЗА ЭТО МАКСИМУМ, А НЕ СУММА. Нехватки стажа,
 * объёма, частоты и длительной лечатся ОДНОВРЕМЕННО, одними и теми же неделями
 * спокойного бега, поэтому складывать их значило бы пугать человека сроком
 * вчетверо больше настоящего.
 *
 * Боль обрывает расчёт целиком. Это не ещё один минус в списке: на марафонских
 * объёмах регулярная боль усиливается, и называть дату старта поверх неё
 * значит звать человека в травму.
 */

export type ExpId = "lt6" | "6to12" | "1to2" | "2p";
export type KmId = "lt20" | "20to30" | "30to45" | "45p";
export type RunsId = "1to2" | "3" | "4" | "5p";
export type LongId = "lt10" | "10to15" | "15to21" | "21p";
export type PainId = "no" | "some" | "often";
export type RaceId = "none" | "lt3" | "3to4" | "4to6" | "6p";

export type Answers = {
  exp?: ExpId;
  km?: KmId;
  runs?: RunsId;
  long?: LongId;
  pain?: PainId;
  race?: RaceId;
  resTime?: number | null;
  resDist?: number | null;
};

export type CheckMark = "y" | "w" | "n";
export type Check = { mark: CheckMark; title: string; text: string };
export type VerdictClass = "ok" | "mid" | "no";

export type Plan = {
  checks: Check[];
  /** Недели базы до старта подготовки. Ноль — можно начинать сейчас. */
  base: number;
  /** Сама подготовка всегда 18 недель. */
  prep: number;
  total: number;
  /** Регулярная боль: остальное не считается. */
  stop: boolean;
  verdict: string;
  verdictClass: VerdictClass;
  sub: string;
  /** Дата самого реального марафона, null при боли. */
  date: Date | null;
  /** Конец базы, null когда базы нет или при боли. */
  baseEnd: Date | null;
  nextStep: string;
  /** Предупреждение про выбранный забег, null если его не нужно показывать. */
  raceNote: string | null;
  forecast: { lo: number; hi: number } | null;
  shareText: string;
};

export const PREP_WEEKS = 18;

const MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];
const MONTHS_OF = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

const WEEK_MS = 7 * 864e5;

export function parseTime(raw: string): number | null {
  const s = (raw || "").trim().replace(/[.,]/g, ":");
  if (!s) return null;
  const parts = s.split(":").map(Number);
  if (parts.some((x) => Number.isNaN(x))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function formatTime(sec: number): string {
  const t = Math.round(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Темп на километр марафона из полного времени. */
export function paceOf(sec: number): string {
  const p = sec / 42.195;
  return `${Math.floor(p / 60)}:${String(Math.round(p % 60)).padStart(2, "0")}`;
}

export function round5min(sec: number): number {
  return Math.round(sec / 300) * 300;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function monthYear(d: Date): string {
  const m = MONTHS[d.getMonth()];
  return `${m.charAt(0).toUpperCase()}${m.slice(1)} ${d.getFullYear()}`;
}

export function dayMonth(d: Date): string {
  return `${d.getDate()} ${MONTHS_OF[d.getMonth()]}`;
}

/** Границы допустимого времени: 10 км 27:00-1:35:00, полумарафон 1:00:00-3:30:00. */
export function resultLooksReal(dist: number, sec: number): boolean {
  return dist === 10 ? sec >= 27 * 60 && sec <= 95 * 60 : sec >= 60 * 60 && sec <= 210 * 60;
}

/** Срок до выбранного забега в неделях. null, если забег не выбран. */
function raceWeeks(race: RaceId | undefined): number | null {
  switch (race) {
    case "lt3": return 12;
    case "3to4": return 15;
    case "4to6": return 21;
    case "6p": return 30;
    default: return null;
  }
}

export function buildPlan(a: Answers, today: Date = new Date()): Plan {
  const checks: Check[] = [];
  const weeks: number[] = [];

  if (a.exp === "lt6") {
    checks.push({ mark: "n", title: "Стажа пока мало", text: "Марафону нужен год регулярного бега. Сначала 10 км или полумарафон." });
    weeks.push(36);
  } else if (a.exp === "6to12") {
    checks.push({ mark: "w", title: "Почти год бега", text: "Добери стаж до года, за это время спокойно подтянешь объём." });
    weeks.push(13);
  } else {
    checks.push({ mark: "y", title: "Стаж больше года", text: "База для марафона есть." });
  }

  if (a.km === "lt20") {
    checks.push({ mark: "n", title: "Объём меньше 20 км", text: "Подними до 30 км в неделю, прибавляя понемногу каждую неделю." });
    weeks.push(8);
  } else if (a.km === "20to30") {
    checks.push({ mark: "w", title: "Объём 20-30 км", text: "Ещё немного, и будут нужные 30 км в неделю." });
    weeks.push(3);
  } else {
    checks.push({ mark: "y", title: "Объём от 30 км в неделю", text: "С этого и начинается подготовка." });
  }

  if (a.runs === "1to2") {
    checks.push({ mark: "n", title: "1-2 тренировки в неделю", text: "Для марафона нужно хотя бы 3, лучше 4. Добавь одну лёгкую пробежку." });
    weeks.push(4);
  } else {
    checks.push({
      mark: "y",
      title: "Тренировок достаточно",
      text: a.runs === "3" ? "Три в неделю хватит, четыре будет ещё лучше." : "Отличная частота для подготовки.",
    });
  }

  if (a.long === "lt10") {
    checks.push({ mark: "n", title: "Длинная пробежка до 10 км", text: "Доведи её до 12-15 км, прибавляя по 1-2 км в неделю." });
    weeks.push(5);
  } else {
    checks.push({
      mark: "y",
      title: "Длинная пробежка от 10 км",
      text: a.long === "21p"
        ? "Уже бегаешь больше полумарафона, это сильно облегчит подготовку."
        : "Отсюда длительная спокойно дорастёт до 30 км.",
    });
  }

  let stop = false;
  if (a.pain === "often") {
    checks.push({ mark: "n", title: "Регулярная боль", text: "С болью в подготовку не идут: на марафонских объёмах она усилится. Сначала разберись с причиной." });
    stop = true;
  } else if (a.pain === "some") {
    checks.push({ mark: "w", title: "Иногда бывает дискомфорт", text: "Следи за ним: если не проходит за день-два, снизь нагрузку." });
  } else {
    checks.push({ mark: "y", title: "Без боли и дискомфорта", text: "Тело готово к росту нагрузки." });
  }

  const base = weeks.length ? Math.max(...weeks) : 0;
  const prep = PREP_WEEKS;
  const total = base + prep;
  const date = stop ? null : new Date(today.getTime() + total * WEEK_MS);
  const baseEnd = stop || base === 0 ? null : new Date(today.getTime() + base * WEEK_MS);

  let verdict: string;
  let verdictClass: VerdictClass;
  let sub: string;
  if (stop) {
    verdict = "Сначала разберись с болью";
    verdictClass = "no";
    sub = "Остальное подождёт. Когда боль уйдёт, возвращайся к тесту.";
  } else if (base === 0) {
    verdict = "Можно начинать подготовку";
    verdictClass = "ok";
    sub = "База есть. Дальше 4-5 месяцев понятной работы до старта.";
  } else if (base <= 8) {
    verdict = "Почти можно";
    verdictClass = "mid";
    sub = `Ещё ${base} ${plural(base, "неделя", "недели", "недель")} базы, и можно начинать подготовку.`;
  } else {
    verdict = "Пока рано";
    verdictClass = "no";
    sub = "Сначала база. Марафон никуда не денется, а начать сейчас значит рисковать травмой.";
  }

  let nextStep: string;
  if (stop) nextStep = "Не наращивай нагрузку. Покажись специалисту и разберись, откуда боль.";
  else if (a.exp === "lt6") nextStep = "Бегай 3 раза в неделю в лёгком темпе и выбери первую цель поближе: 10 км.";
  else if (a.km === "lt20" || a.km === "20to30") nextStep = "Добавь 2-3 км к одной из лёгких пробежек. Так объём будет расти без перегрузки.";
  else if (a.runs === "1to2") nextStep = "Добавь третью тренировку в неделю: 30-40 минут в разговорном темпе.";
  else if (a.long === "lt10") nextStep = "Сделай длинную пробежку на 1-2 км длиннее обычной, спокойно и без ускорений.";
  else nextStep = "Выбери плоский марафон через 4-5 месяцев и посчитай свои тренировочные темпы.";

  const rw = raceWeeks(a.race);
  let raceNote: string | null = null;
  if (!stop && rw !== null && date) {
    if (rw < total) {
      raceNote = `Твой марафон раньше, чем стоит. Безопаснее выбрать старт на ${MONTHS[date.getMonth()]} ${date.getFullYear()} или позже, а на ближайшем забеге пробежать полумарафон.`;
    } else if (base === 0) {
      raceNote = "По срокам всё сходится: до твоего марафона хватает времени на полноценную подготовку.";
    }
  }

  let forecast: { lo: number; hi: number } | null = null;
  if (a.resTime && a.resDist) {
    forecast = {
      lo: round5min(a.resTime * Math.pow(42.195 / a.resDist, 1.06)),
      hi: round5min(a.resTime * Math.pow(42.195 / a.resDist, 1.12)),
    };
  }

  const shareWhen = stop ? "после восстановления" : monthYear(date as Date);
  const shareText = `${verdict}. Самый реальный марафон для меня: ${shareWhen}. А тебе пора готовиться?`;

  return {
    checks, base, prep, total, stop, verdict, verdictClass, sub,
    date, baseEnd, nextStep, raceNote, forecast, shareText,
  };
}
