/* Paces for the runner track, from the best recent result.
 *
 * NOT A NEW FORMULA. The same math as Igor's pace calculator (igorp.run/tools/plan and its English
 * copy /tools/en/plan): src/app/tools/plan/vdot.ts. VDOT from the race by Daniels' formulas,
 * threshold anchor FTPa = pace at VDOT x 0.913, zones as percentage multipliers of FTPa (Friel):
 *   easy  (zone 2) = FTPa x 1.142 ... 1.292
 *   tempo (zone 3) = FTPa x 1.058 ... 1.142
 * These are the same bands as the TrainingPeaks speed method-2 scheme the roster uses
 * (tools/trainingpeaks-export/scripts/lib/tp-zone-formulas.ts: speed fractions 0.775 / 0.878 /
 * 0.944 of threshold → pace multipliers 1.290 / 1.139 / 1.059), checked in check:en-week.
 * A lead sees the same numbers in the free week as in the calculator.
 *
 * Which pace goes where:
 *   easy run, easy + strides (easy part), long run → easy band;
 *   recovery run → slower than the slow edge of the easy band;
 *   int_walk work reps (RPE 6, "breathing noticeably faster, you can still talk") → tempo band.
 * No result → no paces at all (effort only, as before). */

import { FRIEL_ZONES, ftpaSecPerKm, vdotFromRace, zonePaceRange } from "@/app/tools/plan/vdot";

import { RESULT_RANGE_SEC, type RaceDist } from "./logic";

export type RaceDistance = RaceDist;

export const RACE_METERS: Record<RaceDistance, number> = { "5k": 5000, "10k": 10000, half: 21097.5, marathon: 42195 };
export const RACE_LABELS: Record<RaceDistance, string> = { "5k": "5K", "10k": "10K", half: "Half marathon", marathon: "Marathon" };

/** Sane result ranges, seconds [fastest, slowest]: outside → the form asks to check the time. */
export const RESULT_RANGE = RESULT_RANGE_SEC;

export function isRaceDistance(v: unknown): v is RaceDistance {
  return typeof v === "string" && v in RACE_METERS;
}

/** "52:00" or "1:52:00" (plain "52" is not accepted). Same rule as the app's
 * parseTargetResultToSeconds (ai-running-coach onboarding/service.ts): m:ss or h:mm:ss, seconds < 60. */
export function parseResultTime(input: string): number | null {
  const s = input.trim();
  const m = s.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/u);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (sec > 59 || (m[1] && min > 59)) return null;
  return h * 3600 + min * 60 + sec;
}

export type ResultCheck = { ok: true; seconds: number } | { ok: false; error: "format" | "range" };

export function checkResult(distance: RaceDistance, input: string): ResultCheck {
  const sec = parseResultTime(input);
  if (sec === null) return { ok: false, error: "format" };
  const [a, b] = RESULT_RANGE[distance];
  return sec >= a && sec <= b ? { ok: true, seconds: sec } : { ok: false, error: "range" };
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** [fast, slow] seconds per km. */
export type PaceRange = [number, number];
export type Paces = { easy: PaceRange; tempo: PaceRange };

export function pacesFromResult(distance: RaceDistance, seconds: number): Paces {
  const ftpa = ftpaSecPerKm(vdotFromRace(RACE_METERS[distance], seconds));
  return {
    easy: zonePaceRange(ftpa, FRIEL_ZONES.easy.fast, FRIEL_ZONES.easy.slow),
    tempo: zonePaceRange(ftpa, FRIEL_ZONES.tempo.fast, FRIEL_ZONES.tempo.slow),
  };
}

const KM_PER_MILE = 1.609344;

function mmss(sec: number): string {
  const t = Math.round(sec);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** "6:12-7:01 /km (9:59-11:18 /mi)" */
export function paceRangeText(r: PaceRange): string {
  return `${mmss(r[0])}-${mmss(r[1])} /km (${mmss(r[0] * KM_PER_MILE)}-${mmss(r[1] * KM_PER_MILE)} /mi)`;
}

/** "slower than 7:01 /km (11:18 /mi)" */
export function slowerThanText(sec: number): string {
  return `slower than ${mmss(sec)} /km (${mmss(sec * KM_PER_MILE)} /mi)`;
}

export function easyMidSecPerKm(p: Paces | null): number {
  return p ? (p.easy[0] + p.easy[1]) / 2 : DEFAULT_EASY_SEC_PER_KM;
}

/** No result: minutes per km assumed only to turn weekly km into minutes (6:30/km, a typical
 * recreational easy pace). Never shown to the person. */
export const DEFAULT_EASY_SEC_PER_KM = 390;
