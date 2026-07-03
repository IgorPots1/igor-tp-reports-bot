import process from "node:process";

import type { TrainingPeaksRaceEventRow } from "@/features/trainingpeaks/repository";
import { buildCoachDeskStartsView } from "@/features/trainingpeaks/coach-desk-starts";

const LOG_PREFIX = "[check-coach-desk-starts]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function row(
  studentId: string,
  studentName: string | null,
  eventDate: string,
  title: string,
  distanceRaw: string | null
): TrainingPeaksRaceEventRow {
  return { id: `${studentId}-${eventDate}`, studentId, studentName, eventDate, title, distanceRaw, source: "scan" };
}

function run(): void {
  const asOf = "2026-07-03";
  const rows: TrainingPeaksRaceEventRow[] = [
    // "Белые ночи" — same date, messy title variants + varied distance → ONE event.
    row("a", "Anton Malyk", "2026-07-04", "Белые ночи", "10 км"),
    row("b", "Sergei Ivoshin", "2026-07-04", "Белые ночи марафон", "42.2 км"),
    row("c", "Olga", "2026-07-04", "Марафон «Белые ночи»", null),
    row("d", "Ekaterina Golovko", "2026-07-04", "Белые Ночи", "0"),
    // Anton listed twice for same event (dedupe).
    row("a", "Anton Malyk", "2026-07-04", "Белые ночи", "10 км"),
    // A later single-distance event.
    row("e", "Koroleva Anna", "2026-07-08", "Женский ночной забег", "5 км"),
    row("f", "Anna B", "2026-07-08", "Женский ночной забег", "5 км"),
    // No-name athlete, far event.
    row("g", null, "2026-07-28", "Дальний старт", "21 км"),
  ];

  const view = buildCoachDeskStartsView(rows, asOf);

  // 3 distinct events (Белые ночи collapsed, Женский, Дальний).
  assert(view.counts.events === 3, `3 events, got ${view.counts.events}`);

  const belye = view.thisWeek.find((e) => /белы/iu.test(e.title));
  assert(belye !== undefined, "Белые ночи event exists");
  // 4 unique athletes (Anton deduped from 2 → 1).
  assert(belye!.athletes.length === 4, `Белые ночи has 4 athletes, got ${belye!.athletes.length}`);
  // Varied distances → "дистанции разнятся" (10 / 42.2, "0" & null dropped).
  assert(belye!.distanceLabel === "дистанции разнятся", `varied distance label, got ${belye!.distanceLabel}`);
  assert(belye!.daysTo === 1 && belye!.thisWeek, "Белые ночи is tomorrow, this week");
  // "0" distance → shown as null (уточняется), not "0".
  const golovko = belye!.athletes.find((a) => a.name === "Ekaterina Golovko");
  assert(golovko!.distance === null, "'0' distance normalized to null");

  // Женский — single distance 5 км.
  const zhensky = view.thisWeek.find((e) => /женск/iu.test(e.title));
  assert(zhensky!.distanceLabel === "5 км", "single shared distance shown as-is");
  assert(zhensky!.athletes.length === 2, "Женский 2 athletes");

  // Дальний — later group, no-name athlete → "Без имени".
  assert(view.later.length === 1 && /дальн/iu.test(view.later[0].title), "far event in later group");
  assert(view.later[0].athletes[0].name === "Без имени", "null name → Без имени");

  // Counts + sort: thisWeek 2, athletes total = 4+2+1 = 7, events sorted by date.
  assert(view.counts.thisWeek === 2, `2 this-week events, got ${view.counts.thisWeek}`);
  assert(view.counts.athletes === 7, `7 athletes total, got ${view.counts.athletes}`);
  assert(view.thisWeek[0].date <= view.thisWeek[1].date, "this-week sorted by date");

  // Empty input → empty state.
  const empty = buildCoachDeskStartsView([], asOf);
  assert(empty.counts.events === 0, "empty input → 0 events");

  console.log(`${LOG_PREFIX} PASS`);
}

if (process.argv[1] && process.argv[1].endsWith("check-coach-desk-starts.ts")) {
  try {
    run();
  } catch (error) {
    console.error(`${LOG_PREFIX} FAIL`, error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
