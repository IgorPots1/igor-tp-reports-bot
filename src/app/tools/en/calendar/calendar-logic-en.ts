/* English version of ../../calendar/calendar-logic.ts.
 *
 * The same dates and rules (18 weeks of preparation, recovery after the last
 * race, base weeks by current volume). Date helpers are shared with the Russian
 * tool, so the daylight-saving fix lives in one place. Only texts differ.
 */

import {
  MAX_REC_WEEKS,
  PREP_WEEKS,
  addDays,
  daysBetween,
  parseIsoDate,
  startOfDay,
  type CalendarInput,
  type CalendarResult,
  type CountId,
  type KmId,
  type LastId,
  type Phase,
  type PhaseId,
  type TimelineItem,
} from "../../calendar/calendar-logic";

export const ERR_TOO_SOON_EN = "Pick a date at least 3 weeks from today.";
export const ERR_TOO_FAR_EN = "Pick a marathon within the next two years.";
const NOTE_REC_PAST_EN = "Your recovery after the last race is already done, you can move on to the off-season.";
const NOTE_REC_NO_DATE_EN = "Add the date of your last race and the recovery will be more accurate.";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const REC_WEEKS: Record<Exclude<LastId, "none">, number> = { "10": 1, "21": 2, "42": 3 };
const BASE_WEEKS: Record<KmId, number> = { lt20: 8, "20to30": 3, "30p": 0 };

export function dayMonthEn(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function dayMonthYearEn(d: Date): string {
  return `${dayMonthEn(d)}, ${d.getFullYear()}`;
}

function weeks(n: number): string {
  return `${n} ${n === 1 ? "week" : "weeks"}`;
}

function recoveryWeeks(last: LastId, count: CountId): number {
  if (last === "none") return 0;
  return Math.min(MAX_REC_WEEKS, REC_WEEKS[last] + (count === "6p" ? 1 : 0));
}

const PHASE_TEXT: Record<PhaseId, string> = {
  rec: "Easy running only, no hard sessions. Your muscles and tendons need time to recover.",
  off: "3-4 easy runs a week, building the volume back to your usual, short 20-second strides inside the runs, strength work 2 times a week.",
  dev: "Threshold reps once a week, the long run grows from 15-18 km to 25 km.",
  mp: "Marathon pace blocks in your key session and in the long run, plus fuelling practice.",
  taper: "Cut the volume by 40-60%, keep the pace. Your last hard session is 4 days before the race.",
};

const PHASE_NAME: Record<PhaseId, string> = {
  rec: "Recovery",
  off: "Off-season",
  dev: "Build: development",
  mp: "Marathon pace",
  taper: "Taper",
};

export function buildCalendarEn(input: CalendarInput, todayRaw: Date): CalendarResult {
  const T = startOfDay(todayRaw);
  const R = parseIsoDate(input.race);
  if (!R) return { ok: false, error: null };
  if (R < addDays(T, 21)) return { ok: false, error: ERR_TOO_SOON_EN };
  if (R > addDays(T, 730)) return { ok: false, error: ERR_TOO_FAR_EN };

  let recW = recoveryWeeks(input.last, input.count);
  let L = input.lastDate ? parseIsoDate(input.lastDate) : null;
  if (L && L > T) L = T;
  let recEnd = T;
  let recNote = "";
  if (recW) {
    recEnd = addDays(L ?? T, recW * 7);
    if (recEnd <= T) {
      recNote = NOTE_REC_PAST_EN;
      recEnd = T;
      recW = 0;
    } else if (!L) {
      recNote = NOTE_REC_NO_DATE_EN;
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
    note = `Your marathon is less than 18 weeks away, so there's no time for a full build. Better pick a marathon on ${dayMonthYearEn(earliest)} or later, and run the half at this race.`;
  } else if (needReady > prepStart) {
    const earliest = addDays(needReady, PREP_WEEKS * 7);
    note = `Not enough time for your base: you need ${weeks(baseW)} more of calm volume building before the build starts. A marathon on ${dayMonthYearEn(earliest)} or later is safer.`;
  } else {
    const spare = Math.round(daysBetween(needReady, prepStart) / 7);
    fits = true;
    note =
      spare >= 2
        ? `The timing works: you have ${weeks(spare)} of off-season before your build starts.`
        : "The timing works, but it's tight: the off-season goes almost straight into the build.";
  }
  if (recNote) note = `${recNote} ${note}`;

  const phases: Phase[] = [];
  const push = (id: PhaseId, from: Date, to: Date, text = PHASE_TEXT[id]) =>
    phases.push({ id, name: PHASE_NAME[id], from, to, text });
  if (recW) push("rec", T, recEnd);
  if (prepStart > recEnd) {
    push("off", recEnd, prepStart, PHASE_TEXT.off + (baseW ? " First get your volume to at least 30 km a week." : ""));
  }
  const ps = prepStart > T ? prepStart : T;
  push("dev", ps, devEnd > ps ? devEnd : ps);
  push("mp", devEnd > T ? devEnd : T, taper);
  push("taper", taper > T ? taper : T, R);

  const cur = phases.find((p) => T >= p.from && T < p.to) ?? phases[0];
  const phaseNow = cur.name.replace("Build: development", "Build, development phase");

  const weeksLeft = Math.round(daysBetween(T, R) / 7);
  const weeksText = `${weeks(weeksLeft)} to your marathon, race day ${dayMonthYearEn(R)}.`;

  const totalDays = daysBetween(T, R);
  const nonEmpty = phases.filter((p) => p.to > p.from);
  const bar = nonEmpty.map((p) => ({
    id: p.id,
    name: p.name,
    pct: (daysBetween(p.from, p.to) / totalDays) * 100,
  }));
  const barLabel = nonEmpty.map((p) => `${p.name} until ${dayMonthEn(p.to)}`).join(", ");

  const timeline: TimelineItem[] = nonEmpty.map((p) => ({
    kind: p.id,
    date: p.from,
    when: `${dayMonthEn(p.from)} to ${dayMonthEn(addDays(p.to, -1))}`,
    name: p.name,
    text: p.text,
    current: p === cur,
  }));
  if (long25 > T) {
    timeline.push({ kind: "long25", date: long25, when: dayMonthEn(long25), name: "First 25 km long run", text: "Easy, with gels, like a future rehearsal.", current: false });
  }
  if (long30 > T) {
    timeline.push({ kind: "long30", date: long30, when: dayMonthEn(long30), name: "28-30 km long run", text: "Easy, the last 8-10 km at marathon pace. Fuel like on race day.", current: false });
  }
  if (key > T) {
    timeline.push({ kind: "key", date: key, when: dayMonthEn(key), name: "Key session", text: "29-34 km: the first half easy, the second half at marathon pace, a gel every 30 minutes. The slower your pace, the closer to 29 km.", current: false });
  }
  timeline.push({ kind: "race", date: R, when: dayMonthYearEn(R), name: "Marathon", text: "The first km 5-10 seconds slower than your goal pace, speed up in the second half.", current: false });
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
