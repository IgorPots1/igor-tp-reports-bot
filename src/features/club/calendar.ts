// Club Phase 5 — unified 45-day calendar (day_off / preference / note / race).
// Read/write over club_calendar_entries. Nothing here is written to TrainingPeaks
// (that is Phase 11). Isolated from /m/desk and /m/n. Tolerant of the migration not
// being applied (reads return an inactive view, writes report "section not active").

import { createSupabaseServerClient } from "@/features/supabase/server";

import { CLUB_CALENDAR_DAYS, CLUB_DAYOFF_REASONS, CLUB_TIMEZONE, type ClubDayoffReason } from "./constants";
import { logClubDbError, CLUB_DB_ERROR_STUDENT_MESSAGE } from "./db-errors";
import type {
  ClubCalendarDay,
  ClubCalendarEntry,
  ClubCalendarKind,
  ClubCalendarPreferredType,
  ClubCalendarView,
} from "./types";

const RU_MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** Today in the club timezone as ISO YYYY-MM-DD (en-CA yields that format). */
function clubTodayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CLUB_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map((n) => Number.parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Monday=0 … Sunday=6 for an ISO date. */
function weekdayMondayZero(iso: string): number {
  const [y, m, d] = iso.split("-").map((n) => Number.parseInt(n, 10));
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  return (dow + 6) % 7;
}

function formatRuDate(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (!match) return iso;
  const day = Number.parseInt(match[3], 10);
  const month = RU_MONTHS[Number.parseInt(match[2], 10) - 1] ?? "";
  return `${day} ${month}`;
}

const VALID_KINDS: ClubCalendarKind[] = ["day_off", "preference", "note", "race"];
const VALID_PREF: ClubCalendarPreferredType[] = ["long", "intervals", "rest"];

function mapEntryRow(r: Record<string, unknown>): ClubCalendarEntry {
  return {
    id: r.id as string,
    date: r.entry_date as string,
    kind: (r.kind as ClubCalendarKind) ?? "note",
    preferredType: (r.preferred_workout_type as ClubCalendarPreferredType | null) ?? null,
    note: (r.note as string | null) ?? null,
    dayOffReason: (r.day_off_reason as string | null) ?? null,
    raceName: (r.race_name as string | null) ?? null,
    raceCity: (r.race_city as string | null) ?? null,
    raceDistanceLabel: (r.race_distance_label as string | null) ?? null,
    raceTargetSeconds: (r.race_target_seconds as number | null) ?? null,
    status: (r.status as ClubCalendarEntry["status"]) ?? "pending",
  };
}

/** The 45-day calendar for one student, day-by-day with any entries. */
export async function getClubCalendar(studentId: string): Promise<ClubCalendarView> {
  const from = clubTodayIso();
  const to = addDaysIso(from, CLUB_CALENDAR_DAYS - 1);
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("club_calendar_entries")
    .select("id, entry_date, kind, preferred_workout_type, note, day_off_reason, race_name, race_city, race_distance_label, race_target_seconds, status")
    .eq("student_id", studentId)
    .gte("entry_date", from)
    .lte("entry_date", to)
    .order("entry_date", { ascending: true });

  const byDate = new Map<string, ClubCalendarEntry[]>();
  if (!error && data) {
    for (const row of data as Array<Record<string, unknown>>) {
      const entry = mapEntryRow(row);
      const list = byDate.get(entry.date) ?? [];
      list.push(entry);
      byDate.set(entry.date, list);
    }
  }

  const days: ClubCalendarDay[] = [];
  for (let i = 0; i < CLUB_CALENDAR_DAYS; i += 1) {
    const date = addDaysIso(from, i);
    days.push({
      date,
      dateLabel: formatRuDate(date),
      weekday: weekdayMondayZero(date),
      isToday: date === from,
      entries: byDate.get(date) ?? [],
    });
  }
  const raceSuggestions = await loadRaceSuggestions(studentId, from, to);
  // Distinguish three failure shapes so they never look identical:
  //  - absent TABLE (migration unapplied) → active:false, the benign "not set up yet" hint;
  //  - missing column / permission / other → active:true + loadError:true (a REAL failure the
  //    student sees as "напиши тренеру", logged with its cause) — NOT an empty calendar;
  //  - no error → active:true, loadError:false.
  const kind = logClubDbError("getClubCalendar.select", error);
  const benignMissingTable = kind === "missing_table";
  return { active: !benignMissingTable, loadError: kind !== null && !benignMissingTable, fromDate: from, toDate: to, days, raceSuggestions };
}

/**
 * Phase B — this student's known upcoming races (trainingpeaks_race_events) inside the
 * 45-day window, for the race-form autofill. Read-only, tolerant of a missing table /
 * errors (returns []). distance_raw is shown as-is (distance_km is unreliable — the TP
 * repository intentionally omits it). No new races section: this feeds the calendar form.
 */
async function loadRaceSuggestions(
  studentId: string,
  from: string,
  to: string
): Promise<ClubCalendarView["raceSuggestions"]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_race_events")
    .select("event_date, title, distance_raw")
    .eq("student_id", studentId)
    .gte("event_date", from)
    .lte("event_date", to)
    .order("event_date", { ascending: true })
    .limit(20);
  if (error || !data) {
    logClubDbError("loadRaceSuggestions", error);
    return [];
  }
  return (data as Array<{ event_date: string; title: string | null; distance_raw: string | null }>)
    .filter((r) => r.event_date && (r.title ?? "").trim())
    .map((r) => ({
      date: r.event_date,
      dateLabel: formatRuDate(r.event_date),
      title: (r.title as string).trim(),
      distanceLabel: r.distance_raw && r.distance_raw.trim() ? r.distance_raw.trim() : null,
    }));
}

function hms(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v > 0 ? Math.round(v) : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const parts = v.trim().split(":").map((x) => Number(x));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  let s = 0;
  if (parts.length === 3) s = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) s = parts[0] * 60 + parts[1];
  else if (parts.length === 1) s = parts[0];
  return s > 0 ? Math.round(s) : null;
}

function ymd(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(v.trim()) ? v.trim() : null;
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/gu, " ").trim().slice(0, max);
  return t.length > 0 ? t : null;
}

/**
 * Create (or upsert for day_off/preference) a calendar entry for the student.
 * Validates kind/date; races require an exact name (naryad 5.2). All entries land as
 * `pending` in the coach inbox. Nothing is written to TrainingPeaks here.
 */
export async function createCalendarEntry(
  studentId: string,
  input: {
    date?: unknown;
    kind?: unknown;
    preferredType?: unknown;
    note?: unknown;
    dayOffReason?: unknown;
    raceName?: unknown;
    raceCity?: unknown;
    raceDistanceLabel?: unknown;
    raceTarget?: unknown;
  }
): Promise<{ ok: boolean; error?: string }> {
  const date = ymd(input.date);
  const kind = typeof input.kind === "string" && VALID_KINDS.includes(input.kind as ClubCalendarKind) ? (input.kind as ClubCalendarKind) : null;
  if (!date || !kind) {
    return { ok: false, error: "Укажи день и тип записи." };
  }
  // Only future-or-today dates make sense for a forward-looking calendar.
  if (date < clubTodayIso()) {
    return { ok: false, error: "Можно отмечать только сегодняшний день и будущие." };
  }

  const row: Record<string, unknown> = {
    student_id: studentId,
    entry_date: date,
    kind,
    status: "pending",
    source: "club",
    preferred_workout_type: null,
    note: null,
    day_off_reason: null,
    race_name: null,
    race_city: null,
    race_distance_label: null,
    race_target_seconds: null,
  };

  if (kind === "day_off") {
    // Optional reason from the TP Availability enum; anything else is ignored (no error —
    // a day off without a reason is valid, "No reason selected").
    const reason = typeof input.dayOffReason === "string" && (CLUB_DAYOFF_REASONS as readonly string[]).includes(input.dayOffReason)
      ? (input.dayOffReason as ClubDayoffReason)
      : null;
    row.day_off_reason = reason;
  } else if (kind === "preference") {
    const pref = typeof input.preferredType === "string" && VALID_PREF.includes(input.preferredType as ClubCalendarPreferredType) ? input.preferredType : null;
    if (!pref) return { ok: false, error: "Выбери тип: длительная, интервальная или отдых." };
    row.preferred_workout_type = pref;
  } else if (kind === "note") {
    const note = cleanText(input.note, 500);
    if (!note) return { ok: false, error: "Напиши заметку." };
    row.note = note;
  } else if (kind === "race") {
    const name = cleanText(input.raceName, 120);
    if (!name) return { ok: false, error: "Укажи точное название забега." };
    row.race_name = name;
    row.race_city = cleanText(input.raceCity, 80);
    row.race_distance_label = cleanText(input.raceDistanceLabel, 40);
    row.race_target_seconds = hms(input.raceTarget);
    row.note = cleanText(input.note, 300); // race wishes (naryad 5.2)
  }

  const supabase = createSupabaseServerClient();
  // day_off / preference are one-per-day → upsert; note / race may repeat → insert.
  const singleton = kind === "day_off" || kind === "preference";
  const { error } = singleton
    ? await supabase.from("club_calendar_entries").upsert(row, { onConflict: "student_id,entry_date,kind" })
    : await supabase.from("club_calendar_entries").insert(row);
  if (error) {
    // Log the REAL cause (this is where a missing column masqueraded as «Календарь пока не
    // активен»). Only an absent TABLE is the benign "not set up" case; a missing column /
    // permission / other is a real failure and the student gets a generic line, not a flag-off
    // one, so the two states never look identical.
    const kind = logClubDbError("createCalendarEntry", error);
    return { ok: false, error: kind === "missing_table" ? "Календарь ещё не настроен. Напиши тренеру." : CLUB_DB_ERROR_STUDENT_MESSAGE };
  }
  return { ok: true };
}

/** Delete the student's OWN entry (only while still pending — approved ones stay). */
export async function deleteCalendarEntry(studentId: string, entryId: string): Promise<{ ok: boolean; error?: string }> {
  if (typeof entryId !== "string" || !entryId) {
    return { ok: false, error: "Нет записи." };
  }
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("club_calendar_entries")
    .delete()
    .eq("id", entryId)
    .eq("student_id", studentId)
    .eq("status", "pending");
  if (error) {
    logClubDbError("deleteCalendarEntry", error);
    return { ok: false, error: CLUB_DB_ERROR_STUDENT_MESSAGE };
  }
  return { ok: true };
}

/**
 * Phase 11 execution write-back (naryad 1.6). After the TP create for a calendar entry
 * SUCCEEDS, persist the link + advance status to 'applied'. This is the piece that makes
 * idempotency real: the planner skips entries whose applied_tp_workout_id is set (see
 * planCalendarEntryAction), and rollback deletes the TP workout by this id. DB-only —
 * nothing here talks to TrainingPeaks. The caller (the executor, Igor's hand) passes the
 * server-assigned TP workout id from the create response.
 */
export async function markCalendarEntryApplied(
  entryId: string,
  tpWorkoutId: number,
  entityType: "workout" | "event" | "note" | "availability",
): Promise<{ ok: boolean; error?: string }> {
  if (!entryId || !Number.isFinite(tpWorkoutId)) {
    return { ok: false, error: "Нужны entryId и числовой tpWorkoutId." };
  }
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("club_calendar_entries")
    // applied_entity_type is written so rollback deletes the right TP resource without
    // re-planning by (possibly different) current flags. See the 2026-08-10 migration.
    .update({ applied_tp_workout_id: tpWorkoutId, applied_entity_type: entityType, applied_at: new Date().toISOString(), status: "applied" })
    .eq("id", entryId)
    .eq("status", "approved"); // only an approved entry may transition to applied
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Rollback the DB half after the TP workout was deleted (delete_workout by
 * applied_tp_workout_id). Clears the link and returns the entry to 'approved' so it can be
 * re-executed or re-reviewed. Pairs with markCalendarEntryApplied.
 */
export async function rollbackCalendarEntryApplied(entryId: string): Promise<{ ok: boolean; error?: string; tpWorkoutId?: number | null }> {
  if (!entryId) {
    return { ok: false, error: "Нет записи." };
  }
  const supabase = createSupabaseServerClient();
  const { data: before } = await supabase
    .from("club_calendar_entries")
    .select("applied_tp_workout_id")
    .eq("id", entryId)
    .maybeSingle();
  const tpWorkoutId = (before as { applied_tp_workout_id: number | null } | null)?.applied_tp_workout_id ?? null;
  const { error } = await supabase
    .from("club_calendar_entries")
    .update({ applied_tp_workout_id: null, applied_entity_type: null, applied_at: null, status: "approved" })
    .eq("id", entryId)
    .eq("status", "applied");
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, tpWorkoutId };
}

/**
 * Auto-planner interface (Phase 11.2): the approved constraints for a student on a
 * given date, as one machine-readable object. Answers "what did this student ask for
 * on date X?" in a single query, for a future planner to consume.
 */
export async function getStudentDateConstraints(
  studentId: string,
  date: string
): Promise<{ dayOff: boolean; preferredType: ClubCalendarPreferredType | null; notes: string[]; races: ClubCalendarEntry[] }> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("club_calendar_entries")
    .select("id, entry_date, kind, preferred_workout_type, note, race_name, race_city, race_distance_label, race_target_seconds, status")
    .eq("student_id", studentId)
    .eq("entry_date", date)
    .in("status", ["approved", "applied"]);
  const entries = ((data as Array<Record<string, unknown>> | null) ?? []).map(mapEntryRow);
  return {
    dayOff: entries.some((e) => e.kind === "day_off"),
    preferredType: entries.find((e) => e.kind === "preference")?.preferredType ?? null,
    notes: entries.filter((e) => e.kind === "note" && e.note).map((e) => e.note as string),
    races: entries.filter((e) => e.kind === "race"),
  };
}
