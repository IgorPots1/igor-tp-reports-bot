// ±1-day shifted-race gate for the COMPARISON BASE (the personal norm).
//
// fetchRaceKeys (feedback-enqueue) already keeps races out of the norm by an exact
// (student_id, event_date) match. But some races are logged the day before/after the
// event date — a night start, or a timezone that rolls the run past midnight — so the
// max effort slips into the base and later reads as "the student regressed".
//
// A BLIND ±1 would be wrong: people often run an easy shakeout the day around a race,
// and that easy run must stay in the norm. So this gate fires ONLY when the adjacent
// run looks like the race itself:
//   • no run on the exact event date, AND
//   • the adjacent run is a HARD effort — avg HR over the student's own median,
//     trusted HR only (an easy run is slow / low-HR → never flagged), AND
//   • its distance matches the race (±20%) — or, when the race distance is unknown,
//     a stronger HR margin (+10 over median) stands in for the distance check.
//
// Live calibration (2026-07-30, scripts/prove-race-norm-shift-gate.ts): of 18 event/
// adjacent candidates the gate newly excludes exactly 2 — a night race and a marathon
// logged the day around the event — and 0 easy runs (a 25km easy long run, a «Лёгкий
// бег» and untrusted-HR runs all stay). This ADDS to the exact-day match; it never
// removes an exact-day exclusion.

export type RaceDayDistances = Map<string, Map<string, number | null>>; // sid → (event day → race km, nullable)

/** A run the ±1 gate reasons about: its day, distance, and effort. */
export type RunForExclusion = {
  studentId: string;
  date: string; // 'YYYY-MM-DD'
  distanceKm: number | null;
  avgHr: number | null;
  hrTrusted: boolean;
};

const RACE_DIST_TOL = 0.2; // adjacent run within ±20% of race distance = same event
const HR_MARGIN_WITH_DIST = 5; // bpm over median when distance also matches
const HR_MARGIN_NO_DIST = 10; // bpm over median when race distance is unknown (HR carries it alone)

const shiftDay = (ymd: string, delta: number): string => {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + delta)).toISOString().slice(0, 10);
};

/**
 * Keys ('studentId|YYYY-MM-DD') of runs to keep OUT of the comparison base: every exact
 * race day, PLUS ±1-day runs that pass the shifted-race gate. `runs` is the student run
 * history the base is built from. The exact-day keys mirror fetchRaceKeys exactly.
 */
export function buildRaceExclusionKeys(races: RaceDayDistances, runs: RunForExclusion[]): Set<string> {
  const exclude = new Set<string>();

  const runsByStudentDay = new Map<string, Map<string, RunForExclusion>>();
  const hrByStudent = new Map<string, number[]>();
  for (const r of runs) {
    const day = r.date.slice(0, 10);
    (runsByStudentDay.get(r.studentId) ?? runsByStudentDay.set(r.studentId, new Map()).get(r.studentId)!).set(day, r);
    if (r.hrTrusted && r.avgHr != null) (hrByStudent.get(r.studentId) ?? hrByStudent.set(r.studentId, []).get(r.studentId)!).push(r.avgHr);
  }
  const medianHr = (sid: string): number | null => {
    const a = (hrByStudent.get(sid) ?? []).slice().sort((x, y) => x - y);
    return a.length ? a[Math.floor(a.length / 2)]! : null;
  };

  for (const [sid, raceMap] of races) {
    const runsByDay = runsByStudentDay.get(sid) ?? new Map<string, RunForExclusion>();
    const median = medianHr(sid);
    for (const [eventDay, raceKm] of raceMap) {
      exclude.add(`${sid}|${eventDay}`); // exact-day: unconditional (mirrors fetchRaceKeys)
      if (runsByDay.has(eventDay)) continue; // a run on the exact day → nothing shifted
      for (const delta of [-1, 1]) {
        const day = shiftDay(eventDay, delta);
        const run = runsByDay.get(day);
        if (!run || !run.hrTrusted || run.avgHr == null || median == null) continue;
        const distMatch = raceKm != null && run.distanceKm != null ? Math.abs(run.distanceKm - raceKm) / raceKm <= RACE_DIST_TOL : false;
        const shiftedRace =
          raceKm != null
            ? distMatch && run.avgHr >= median + HR_MARGIN_WITH_DIST
            : run.avgHr >= median + HR_MARGIN_NO_DIST; // race distance unknown → HR alone, stricter margin
        if (shiftedRace) exclude.add(`${sid}|${day}`);
      }
    }
  }
  return exclude;
}
