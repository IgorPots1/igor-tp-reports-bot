import type { TrainingPeaksRaceEventRow } from "@/features/trainingpeaks/repository";

// Coach-desk "Starts" view model — a read-only radar of upcoming races. One race (e.g. "Белые ночи"
// on the same date) is entered on 20+ athletes' calendars, so rows are COLLAPSED into one event card
// with a roster. Titles are messy (quotes, "Марафон «…»", city fragments) so grouping normalizes them.
// distance_km is never used (unreliable); distance_raw is shown as-is or "уточняется" when empty.
// Pure transform, unit-tested. See ops-log 2026-07-02 race-data scouting.

export type CoachDeskStartAthlete = {
  studentId: string;
  name: string;
  distance: string | null; // distance_raw as-is, or null → "уточняется" in UI
  pending?: boolean; // true = declared in the club, not yet in the athlete's TP calendar
};

export type CoachDeskStartEvent = {
  title: string;
  date: string; // ISO event_date
  daysTo: number; // days from asOfDate; 0 = today
  thisWeek: boolean; // within the next 7 days
  athletes: CoachDeskStartAthlete[];
  distanceLabel: string | null; // shared distance, "дистанции разнятся", or null (all empty)
};

export type CoachDeskStartsView = {
  thisWeek: CoachDeskStartEvent[];
  later: CoachDeskStartEvent[];
  counts: { events: number; athletes: number; thisWeek: number };
};

// Merge the scanned race_events with the club-declared races, deduped by (student, date): the SCANNED
// row wins, because a race that already reached TP and came back in a scan is the confirmed copy (real
// TP title, real source). A declared race NOT yet in race_events is appended, so the coach sees a
// start the moment a student submits it — not only after the weekly scan. This is the one dedup point
// that stops the same physical race (one row from the calendar, one from the scan) showing twice. Pure.
export function dedupeStartRows(
  scanned: TrainingPeaksRaceEventRow[],
  declared: TrainingPeaksRaceEventRow[]
): TrainingPeaksRaceEventRow[] {
  const seen = new Set(scanned.map((row) => `${row.studentId}|${row.eventDate}`));
  const extra = declared.filter((row) => !seen.has(`${row.studentId}|${row.eventDate}`));
  return [...scanned, ...extra];
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return 0;
  }
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

// Clean the messy title for DISPLAY: drop surrounding quotes/«», collapse whitespace, trim leading
// "Марафон"/"Забег" filler when a real name follows.
function cleanTitle(raw: string): string {
  const text = raw.replace(/[«»"']/gu, " ").replace(/\s+/gu, " ").trim();
  return text || "Старт";
}

// Grouping key: normalized name (lowercased, quotes/filler/punctuation stripped, "марафон"/"забег"
// dropped) + date. "Белые ночи" / "Марафон «Белые ночи»" / "Белые ночи марафон" collapse together.
function groupKey(title: string, date: string): string {
  // NB: JS \b is ASCII-only and never matches around Cyrillic, so filler words are stripped as plain
  // substrings (fine for a grouping key — over-stripping only merges, it never wrongly splits).
  const normalized = title
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'().,-]/gu, " ")
    .replace(/(марафон|полумарафон|забег|эстафета|трейл|ультра|км)/gu, " ")
    .replace(/\d+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return `${normalized || title.toLowerCase().trim()}|${date}`;
}

// Most-frequent cleaned title wins (the representative name most athletes carry, e.g. "Белые ночи"
// over a one-off "Эстафета Белые Ночи"); ties break to the shorter, core name.
function pickDisplayTitle(titles: string[]): string {
  const counts = new Map<string, number>();
  for (const title of titles) {
    const clean = cleanTitle(title);
    counts.set(clean, (counts.get(clean) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) =>
    b[1] !== a[1] ? b[1] - a[1] : a[0].length - b[0].length
  );
  return ranked[0]?.[0] ?? "Старт";
}

function normalizeDistance(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "0" || trimmed === "0 км" || /^0\s*км$/iu.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function eventDistanceLabel(distances: Array<string | null>): string | null {
  const present = [...new Set(distances.filter((d): d is string => Boolean(d)))];
  if (present.length === 0) {
    return null;
  }
  if (present.length === 1) {
    return present[0];
  }
  return "дистанции разнятся";
}

export function buildCoachDeskStartsView(
  rows: TrainingPeaksRaceEventRow[],
  asOfDate: string
): CoachDeskStartsView {
  const groups = new Map<
    string,
    { titles: string[]; date: string; athletes: CoachDeskStartAthlete[]; distances: Array<string | null> }
  >();

  for (const row of rows) {
    const key = groupKey(row.title, row.eventDate);
    const distance = normalizeDistance(row.distanceRaw);
    const athlete: CoachDeskStartAthlete = {
      studentId: row.studentId,
      name: row.studentName?.trim() || "Без имени",
      distance,
      // "club_declared" = a club start still queued for TP (approved, not applied). "club_applied"
      // and any scan/manual source are treated as already in TP, so no pending flag.
      pending: row.source === "club_declared",
    };
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        titles: [row.title],
        date: row.eventDate,
        athletes: [athlete],
        distances: [distance],
      });
      continue;
    }
    existing.titles.push(row.title);
    existing.distances.push(distance);
    // Dedupe the same athlete appearing twice for one event.
    if (!existing.athletes.some((a) => a.studentId === athlete.studentId)) {
      existing.athletes.push(athlete);
    }
  }

  const events: CoachDeskStartEvent[] = [...groups.values()]
    .map((group) => {
      const daysTo = daysBetween(asOfDate, group.date);
      return {
        title: pickDisplayTitle(group.titles),
        date: group.date,
        daysTo,
        thisWeek: daysTo >= 0 && daysTo <= 7,
        athletes: [...group.athletes].sort((a, b) => a.name.localeCompare(b.name, "ru-RU")),
        distanceLabel: eventDistanceLabel(group.distances),
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.athletes.length - a.athletes.length));

  const thisWeek = events.filter((e) => e.thisWeek);
  const later = events.filter((e) => !e.thisWeek);
  const athleteTotal = events.reduce((sum, e) => sum + e.athletes.length, 0);

  return {
    thisWeek,
    later,
    counts: { events: events.length, athletes: athleteTotal, thisWeek: thisWeek.length },
  };
}
