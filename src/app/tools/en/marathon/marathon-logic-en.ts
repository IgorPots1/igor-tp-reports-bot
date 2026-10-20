/* English version of ../../marathon/marathon-logic.ts.
 *
 * Same rules: the base is the MAXIMUM of the gaps, not their sum (experience,
 * volume, frequency and the long run all grow in the same calm weeks), and
 * regular pain stops the calculation completely. Only texts differ.
 */

import { PREP_WEEKS, round5min, type Answers, type Check, type Plan, type RaceId, type VerdictClass } from "../../marathon/marathon-logic";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function addWeeksFromMidnight(d: Date, weeks: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + weeks * 7);
  return x;
}

export function monthYearEn(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function dayMonthEn(d: Date): string {
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function weeksWord(n: number): string {
  return n === 1 ? "week" : "weeks";
}

function raceWeeks(race: RaceId | undefined): number | null {
  switch (race) {
    case "lt3": return 12;
    case "3to4": return 15;
    case "4to6": return 21;
    case "6p": return 30;
    default: return null;
  }
}

export function buildPlanEn(a: Answers, today: Date = new Date()): Plan {
  const checks: Check[] = [];
  const weeks: number[] = [];

  if (a.exp === "lt6") {
    checks.push({ mark: "n", title: "Not much running history yet", text: "A marathon needs a year of regular running. Start with a 10K or a half." });
    weeks.push(36);
  } else if (a.exp === "6to12") {
    checks.push({ mark: "w", title: "Almost a year of running", text: "Get to a full year, and use that time to build your volume calmly." });
    weeks.push(13);
  } else {
    checks.push({ mark: "y", title: "More than a year of running", text: "You have a base for a marathon." });
  }

  if (a.km === "lt20") {
    checks.push({ mark: "n", title: "Under 20 km a week", text: "Build up to 30 km a week, adding a little every week." });
    weeks.push(8);
  } else if (a.km === "20to30") {
    checks.push({ mark: "w", title: "20-30 km a week", text: "A bit more and you'll have the 30 km a week you need." });
    weeks.push(3);
  } else {
    checks.push({ mark: "y", title: "30 km a week or more", text: "That's where marathon training starts." });
  }

  if (a.runs === "1to2") {
    checks.push({ mark: "n", title: "1-2 runs a week", text: "A marathon needs at least 3, better 4. Add one easy run." });
    weeks.push(4);
  } else {
    checks.push({
      mark: "y",
      title: "Enough runs a week",
      text: a.runs === "3" ? "Three a week is enough, four is even better." : "A great frequency for marathon training.",
    });
  }

  if (a.long === "lt10") {
    checks.push({ mark: "n", title: "Long run under 10 km", text: "Bring it up to 12-15 km, adding 1-2 km a week." });
    weeks.push(5);
  } else {
    checks.push({
      mark: "y",
      title: "Long run of 10 km or more",
      text: a.long === "21p"
        ? "You already run longer than a half, that makes the build much easier."
        : "From here your long run can grow calmly to 30 km.",
    });
  }

  let stop = false;
  if (a.pain === "often") {
    checks.push({ mark: "n", title: "Regular pain", text: "Don't start marathon training with pain: at marathon volume it gets worse. Find the cause first." });
    stop = true;
  } else if (a.pain === "some") {
    checks.push({ mark: "w", title: "Some discomfort now and then", text: "Keep an eye on it: if it doesn't go away in a day or two, cut back." });
  } else {
    checks.push({ mark: "y", title: "No pain or discomfort", text: "Your body is ready for more training." });
  }

  const base = weeks.length ? Math.max(...weeks) : 0;
  const prep = PREP_WEEKS;
  const total = base + prep;
  const date = stop ? null : addWeeksFromMidnight(today, total);
  const baseEnd = stop || base === 0 ? null : addWeeksFromMidnight(today, base);

  let verdict: string;
  let verdictClass: VerdictClass;
  let sub: string;
  if (stop) {
    verdict = "Deal with the pain first";
    verdictClass = "no";
    sub = "Everything else can wait. When the pain is gone, come back to the test.";
  } else if (base === 0) {
    verdict = "You can start your marathon build";
    verdictClass = "ok";
    sub = "You have the base. Next come 4-5 months of clear work to race day.";
  } else if (base <= 8) {
    verdict = "Almost there";
    verdictClass = "mid";
    sub = `${base} more ${weeksWord(base)} of base, and you can start your build.`;
  } else {
    verdict = "Too early for now";
    verdictClass = "no";
    sub = "Base first. The marathon isn't going anywhere, and starting now means risking an injury.";
  }

  let nextStep: string;
  if (stop) nextStep = "Don't add more training. See a specialist and find out where the pain comes from.";
  else if (a.exp === "lt6") nextStep = "Run 3 times a week at an easy pace, and pick a closer first goal: a 10K.";
  else if (a.km === "lt20" || a.km === "20to30") nextStep = "Add 2-3 km to one of your easy runs. That way your volume grows without overload.";
  else if (a.runs === "1to2") nextStep = "Add a third run to your week: 30-40 minutes at a pace where you can talk.";
  else if (a.long === "lt10") nextStep = "Make your long run 1-2 km longer than usual, easy and with no fast parts.";
  else nextStep = "Pick a flat marathon 4-5 months from now and work out your training paces.";

  const rw = raceWeeks(a.race);
  let raceNote: string | null = null;
  if (!stop && rw !== null && date) {
    if (rw < total) {
      raceNote = `Your marathon comes sooner than it should. A race in ${monthYearEn(date)} or later is safer, and at the nearer race you could run the half.`;
    } else if (base === 0) {
      raceNote = "The timing works: you have enough time for a full build before your marathon.";
    }
  }

  let forecast: { lo: number; hi: number } | null = null;
  if (a.resTime && a.resDist) {
    forecast = {
      lo: round5min(a.resTime * Math.pow(42.195 / a.resDist, 1.06)),
      hi: round5min(a.resTime * Math.pow(42.195 / a.resDist, 1.12)),
    };
  }

  const shareWhen = stop ? "after recovery" : monthYearEn(date as Date);
  const shareText = `${verdict}. My most realistic marathon: ${shareWhen}. Is it time for yours?`;

  return {
    checks, base, prep, total, stop, verdict, verdictClass, sub,
    date, baseEnd, nextStep, raceNote, forecast, shareText,
  };
}
