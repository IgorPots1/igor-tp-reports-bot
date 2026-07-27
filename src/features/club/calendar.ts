// Club Phase 5 — unified 45-day calendar (day_off / preference / note / race).
// Read/write over club_calendar_entries. Nothing here is written to TrainingPeaks
// (that is Phase 11). Isolated from /m/desk and /m/n. Tolerant of the migration not
// being applied (reads return an inactive view, writes report "section not active").

import { createSupabaseServerClient } from "@/features/supabase/server";

import { CLUB_CALENDAR_DAYS, CLUB_TIMEZONE } from "./constants";
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
    .select("id, entry_date, kind, preferred_workout_type, note, race_name, race_city, race_distance_label, race_target_seconds, status")
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
  // active=false only when the table is missing (migration unapplied) → the client
  // shows a "not active yet" hint instead of an empty calendar it can't write to.
  return { active: !error, fromDate: from, toDate: to, days };
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
    race_name: null,
    race_city: null,
    race_distance_label: null,
    race_target_seconds: null,
  };

  if (kind === "preference") {
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
  // day_off carries no extra fields.

  const supabase = createSupabaseServerClient();
  // day_off / preference are one-per-day → upsert; note / race may repeat → insert.
  const singleton = kind === "day_off" || kind === "preference";
  const { error } = singleton
    ? await supabase.from("club_calendar_entries").upsert(row, { onConflict: "student_id,entry_date,kind" })
    : await supabase.from("club_calendar_entries").insert(row);
  if (error) {
    return { ok: false, error: "Календарь пока не активен." };
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
    return { ok: false, error: "Не удалось удалить." };
  }
  return { ok: true };
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
