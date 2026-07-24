// Club Mini App (/m/club) service layer. Read-only over Coach OS data
// (trainingpeaks_workout_cache + laps + students). Nothing is written to
// TrainingPeaks. Isolated from /m/desk (coach) and /m/n (nutrition): this file
// owns its own lean Supabase reads and never imports those surfaces.
//
// Units (verified against existing consumers, see docs/miniapp-club-plan.md §1):
//  - *_time_raw     = decimal HOURS  (formatWorkoutDuration treats raw as hours)
//  - *_distance_raw = meters OR km   (normalizeDistanceKm heuristic: >100 => meters/1000)

import {
  createSupabaseServerClient,
  withSupabaseNetworkRetry,
} from "@/features/supabase/server";
import { getTrainingPeaksWorkoutCacheFreshness } from "@/features/trainingpeaks/repository";
import {
  classifyTrainingPeaksWorkoutActivity,
  type TrainingPeaksWorkoutActivityFamily,
} from "@/features/trainingpeaks/workout-activity-classification";

import * as C from "./constants";
import type {
  ClubChallengeView,
  ClubFeedItem,
  ClubFeedView,
  ClubFreshness,
  ClubProfileView,
  ClubRecordEntry,
  ClubRecordsClubTopRow,
  ClubRecordsView,
  ClubTopPerformer,
} from "./types";

// ---------------------------------------------------------------------------
// Low-level rows
// ---------------------------------------------------------------------------

type ClubStudent = {
  id: string;
  name: string;
  isActive: boolean;
  isServiceAccount: boolean;
  clubVisible: boolean;
};

type ClubWorkoutRow = {
  id: string;
  studentId: string;
  studentName: string;
  workoutDate: string;
  title: string | null;
  sportOrTypeCode: string | null;
  workoutTypeValueId: number | null;
  workoutSubTypeId: number | null;
  isPlanned: boolean;
  isCompleted: boolean;
  completedTimeRaw: number | string | null;
  completedDistanceRaw: number | string | null;
  startTime: string | null;
  distanceKm: number | null;
  durationSeconds: number | null;
  isRunning: boolean;
  family: TrainingPeaksWorkoutActivityFamily;
};

async function loadClubStudents(): Promise<ClubStudent[]> {
  const supabase = createSupabaseServerClient();
  // NOTE: `club_visible` ships in supabase/migrations/..._add_club_visible_flag.sql
  // (not applied in prod). Once applied, add it to the select and read it below;
  // the default stays `true` (everyone participates) until then.
  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from("trainingpeaks_students")
      .select("id, student_name, is_active, is_service_account")
      .order("student_name", { ascending: true })
  );
  if (error) {
    throw new Error(`club: failed to load students: ${error.message}`);
  }
  return (
    (data as Array<{
      id: string;
      student_name: string;
      is_active: boolean | null;
      is_service_account: boolean | null;
    }> | null) ?? []
  ).map((row) => ({
    id: row.id,
    name: row.student_name,
    isActive: row.is_active !== false,
    isServiceAccount: row.is_service_account === true,
    clubVisible: true,
  }));
}

function isVisible(student: ClubStudent): boolean {
  return student.isActive && !student.isServiceAccount && student.clubVisible;
}

async function loadClubWorkoutRows(input: {
  from: string;
  to: string;
}): Promise<ClubWorkoutRow[]> {
  const supabase = createSupabaseServerClient();
  // Lean explicit column list: never pull `source_snapshot` (raw private TP
  // payload) or per-workout compliance into the club layer.
  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from("trainingpeaks_workout_cache")
      .select(
        "id, student_id, student_name, workout_date, title, sport_or_type_code, workout_type_value_id, workout_sub_type_id, is_planned, is_completed, completed_time_raw, completed_distance_raw, start_time"
      )
      .gte("workout_date", input.from)
      .lte("workout_date", input.to)
  );
  if (error) {
    throw new Error(
      `club: failed to load workout rows ${input.from}..${input.to}: ${error.message}`
    );
  }
  return (
    (data as Array<Record<string, unknown>> | null) ?? []
  ).map((row) => {
    const classification = classifyTrainingPeaksWorkoutActivity({
      title: (row.title as string | null) ?? null,
      sportOrTypeCode: (row.sport_or_type_code as string | null) ?? null,
      workoutTypeValueId: (row.workout_type_value_id as number | null) ?? null,
      workoutSubTypeId: (row.workout_sub_type_id as number | null) ?? null,
    });
    const distanceKm = normalizeDistanceKm(row.completed_distance_raw as number | string | null);
    const durationSeconds = rawHoursToSeconds(row.completed_time_raw as number | string | null);
    return {
      id: row.id as string,
      studentId: row.student_id as string,
      studentName: (row.student_name as string) ?? "",
      workoutDate: row.workout_date as string,
      title: (row.title as string | null) ?? null,
      sportOrTypeCode: (row.sport_or_type_code as string | null) ?? null,
      workoutTypeValueId: (row.workout_type_value_id as number | null) ?? null,
      workoutSubTypeId: (row.workout_sub_type_id as number | null) ?? null,
      isPlanned: row.is_planned === true,
      isCompleted: row.is_completed === true,
      completedTimeRaw: (row.completed_time_raw as number | string | null) ?? null,
      completedDistanceRaw: (row.completed_distance_raw as number | string | null) ?? null,
      startTime: (row.start_time as string | null) ?? null,
      distanceKm,
      durationSeconds,
      isRunning: classification.isRunning,
      family: classification.family,
    };
  });
}

/**
 * Returns the set of workout_cache_ids whose per-lap pace is stable enough to
 * certify a record as reliable (CV of pace_sec_per_km <= threshold, >=3 laps).
 * Missing laps => id simply absent from the set (record falls back to the
 * narrow-band reliability check).
 */
async function loadStableWorkoutIds(ids: string[]): Promise<Set<string>> {
  const stable = new Set<string>();
  if (ids.length === 0) {
    return stable;
  }
  const supabase = createSupabaseServerClient();
  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from("trainingpeaks_workout_laps")
      .select("workout_cache_id, pace_sec_per_km, is_work")
      .in("workout_cache_id", ids)
  );
  if (error) {
    // Reliability degrades gracefully to narrow-band only; never throw the view away.
    return stable;
  }
  const byWorkout = new Map<string, number[]>();
  for (const row of (data as Array<{
    workout_cache_id: string;
    pace_sec_per_km: number | null;
    is_work: boolean | null;
  }> | null) ?? []) {
    const pace = toFiniteNumber(row.pace_sec_per_km);
    if (pace === null || pace <= 0) {
      continue;
    }
    // Prefer work laps; if a workout has none flagged, all laps are considered.
    const bucket = byWorkout.get(row.workout_cache_id) ?? [];
    bucket.push(pace);
    byWorkout.set(row.workout_cache_id, bucket);
  }
  for (const [workoutId, paces] of byWorkout) {
    if (paces.length < 3) {
      continue;
    }
    const mean = paces.reduce((a, b) => a + b, 0) / paces.length;
    if (mean <= 0) {
      continue;
    }
    const variance =
      paces.reduce((a, b) => a + (b - mean) * (b - mean), 0) / paces.length;
    const cv = Math.sqrt(variance) / mean;
    if (cv <= C.CLUB_RECORD_PACE_CV_RELIABLE) {
      stable.add(workoutId);
    }
  }
  return stable;
}

// ---------------------------------------------------------------------------
// Unit + format helpers
// ---------------------------------------------------------------------------

function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Cache distance is sometimes meters, sometimes km. Mirrors project heuristic. */
function normalizeDistanceKm(raw: number | string | null): number | null {
  const value = toFiniteNumber(raw);
  if (value === null || value <= 0) {
    return null;
  }
  if (value > 100) {
    return Number((value / 1000).toFixed(3));
  }
  return Number(value.toFixed(3));
}

/** Cache time is decimal hours. */
function rawHoursToSeconds(raw: number | string | null): number | null {
  const hours = toFiniteNumber(raw);
  if (hours === null || hours <= 0) {
    return null;
  }
  return Math.round(hours * 3600);
}

function paceSecPerKm(distanceKm: number | null, durationSeconds: number | null): number | null {
  if (!distanceKm || distanceKm <= 0 || !durationSeconds || durationSeconds <= 0) {
    return null;
  }
  return Math.round(durationSeconds / distanceKm);
}

function firstWord(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) {
    return "Участник клуба";
  }
  return trimmed.split(/\s+/u)[0] ?? trimmed;
}

function monogram(name: string): string {
  const words = (name ?? "").trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) {
    return "•";
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toLocaleUpperCase("ru");
  }
  return (words[0][0] + words[1][0]).toLocaleUpperCase("ru");
}

const FAMILY_LABEL: Record<TrainingPeaksWorkoutActivityFamily, string> = {
  run: "Бег",
  strength: "Силовая",
  bike: "Вело",
  swim: "Плавание",
  walk_hike: "Ходьба",
  paddle: "Гребля",
  row: "Гребля",
  ski: "Лыжи",
  crosstrain: "Кросс-тренинг",
  day_off: "Отдых",
  other: "Тренировка",
  unknown: "Тренировка",
};

function typeLabel(family: TrainingPeaksWorkoutActivityFamily): string {
  return FAMILY_LABEL[family] ?? "Тренировка";
}

/** Strip long dashes (naryad rule) and trim a title into a safe short caption. */
function sanitizeCaption(title: string | null, label: string): string | null {
  if (!title) {
    return null;
  }
  const cleaned = title
    .replace(/[—–]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned) {
    return null;
  }
  if (cleaned.toLocaleLowerCase("ru") === label.toLocaleLowerCase("ru")) {
    return null;
  }
  return cleaned.length > 80 ? `${cleaned.slice(0, 79)}…` : cleaned;
}

const RU_MONTHS = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

function formatRuDate(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (!match) {
    return iso;
  }
  const day = Number.parseInt(match[3], 10);
  const month = RU_MONTHS[Number.parseInt(match[2], 10) - 1] ?? "";
  return `${day} ${month}`;
}

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) {
    return null;
  }
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Belgrade date-window helpers (no external deps)
// ---------------------------------------------------------------------------

function isoInTz(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: C.CLUB_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function clubTodayIso(): string {
  return isoInTz(new Date());
}

function addDaysIso(iso: string, days: number): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (!match) {
    return iso;
  }
  const dt = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12, 0, 0)
  );
  return dt.toISOString().slice(0, 10);
}

function dayOfWeekMondayZero(iso: string): number {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (!match) {
    return 0;
  }
  const dow = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0)
  ).getUTCDay(); // 0=Sun..6=Sat
  return (dow + 6) % 7; // 0=Mon..6=Sun
}

function currentWeekRange(): { from: string; to: string } {
  const today = clubTodayIso();
  const offset = dayOfWeekMondayZero(today);
  const from = addDaysIso(today, -offset);
  const to = addDaysIso(from, 6);
  return { from, to };
}

function currentMonthRange(): { from: string; to: string } {
  const today = clubTodayIso();
  const from = `${today.slice(0, 7)}-01`;
  return { from, to: today };
}

function weekLabel(range: { from: string; to: string }): string {
  return `${formatRuDate(range.from)} - ${formatRuDate(range.to)}`;
}

async function buildFreshness(): Promise<ClubFreshness> {
  const { latestScannedAt } = await getTrainingPeaksWorkoutCacheFreshness();
  if (!latestScannedAt) {
    return { latestScannedAt: null, label: null };
  }
  const scanned = new Date(latestScannedAt).getTime();
  const diffMin = Math.max(0, Math.round((Date.now() - scanned) / 60000));
  let label: string;
  if (diffMin < 1) {
    label = "обновлено только что";
  } else if (diffMin < 60) {
    label = `обновлено ${diffMin} мин назад`;
  } else {
    const diffH = Math.round(diffMin / 60);
    label = diffH < 24 ? `обновлено ${diffH} ч назад` : `обновлено ${Math.round(diffH / 24)} дн назад`;
  }
  return { latestScannedAt, label };
}

// ---------------------------------------------------------------------------
// Records reconstruction (shared by records + profile)
// ---------------------------------------------------------------------------

type RecordCandidate = {
  workoutId: string;
  studentId: string;
  studentName: string;
  distanceKm: number;
  durationSeconds: number;
  date: string;
  bandDeltaKm: number;
};

function collectCandidatesByDistance(rows: ClubWorkoutRow[]): Map<string, RecordCandidate[]> {
  const byDistance = new Map<string, RecordCandidate[]>();
  for (const target of C.CLUB_RECORD_DISTANCES) {
    byDistance.set(target.key, []);
  }
  for (const row of rows) {
    if (!row.isCompleted || !row.isRunning) {
      continue;
    }
    const d = row.distanceKm;
    const t = row.durationSeconds;
    if (!d || d <= 0 || !t || t <= 0) {
      continue;
    }
    for (const target of C.CLUB_RECORD_DISTANCES) {
      const delta = Math.abs(d - target.km);
      if (delta <= C.CLUB_RECORD_BAND_KM) {
        byDistance.get(target.key)!.push({
          workoutId: row.id,
          studentId: row.studentId,
          studentName: row.studentName,
          distanceKm: d,
          durationSeconds: t,
          date: row.workoutDate,
          bandDeltaKm: delta,
        });
      }
    }
  }
  return byDistance;
}

/** Best (min duration) candidate per student for one distance. */
function bestPerStudent(candidates: RecordCandidate[]): Map<string, RecordCandidate> {
  const best = new Map<string, RecordCandidate>();
  for (const cand of candidates) {
    const existing = best.get(cand.studentId);
    if (!existing || cand.durationSeconds < existing.durationSeconds) {
      best.set(cand.studentId, cand);
    }
  }
  return best;
}

function isReliable(
  target: (typeof C.CLUB_RECORD_DISTANCES)[number],
  cand: RecordCandidate,
  stableIds: Set<string>
): boolean {
  if (target.alwaysPreliminary) {
    return false;
  }
  if (cand.bandDeltaKm <= C.CLUB_RECORD_NARROW_BAND_KM) {
    return true;
  }
  return stableIds.has(cand.workoutId);
}

function toRecordEntry(
  target: (typeof C.CLUB_RECORD_DISTANCES)[number],
  cand: RecordCandidate,
  reliable: boolean
): ClubRecordEntry {
  return {
    distanceKey: target.key,
    distanceLabel: target.label,
    durationSeconds: cand.durationSeconds,
    paceSecPerKm: paceSecPerKm(cand.distanceKm, cand.durationSeconds),
    date: cand.date,
    dateLabel: formatRuDate(cand.date),
    reliable,
  };
}

// ---------------------------------------------------------------------------
// Weekly performers (shared by challenge + profile)
// ---------------------------------------------------------------------------

type PerformerAccum = {
  studentId: string;
  displayName: string;
  planned: number;
  completed: number;
};

function buildWeekPerformers(
  rows: ClubWorkoutRow[],
  visibleById: Map<string, ClubStudent>
): ClubTopPerformer[] {
  const accum = new Map<string, PerformerAccum>();
  for (const student of visibleById.values()) {
    accum.set(student.id, {
      studentId: student.id,
      displayName: firstWord(student.name),
      planned: 0,
      completed: 0,
    });
  }
  for (const row of rows) {
    if (!row.isRunning) {
      continue;
    }
    const entry = accum.get(row.studentId);
    if (!entry) {
      continue;
    }
    if (row.isPlanned) {
      entry.planned += 1;
    }
    if (row.isCompleted) {
      entry.completed += 1;
    }
  }
  const performers: ClubTopPerformer[] = [...accum.values()].map((entry) => {
    const noPlan = entry.planned === 0;
    const completionPct = noPlan
      ? entry.completed > 0
        ? 1
        : 0
      : Math.min(entry.completed / entry.planned, 1);
    return {
      studentId: entry.studentId,
      displayName: entry.displayName,
      monogram: monogram(visibleById.get(entry.studentId)?.name ?? entry.displayName),
      completionPct,
      plannedCount: entry.planned,
      completedCount: entry.completed,
      noPlan,
      isCurrentStudent: false,
    };
  });
  // Rank: real plans first, then by completion %, then by number of completed sessions.
  performers.sort((a, b) => {
    if (a.noPlan !== b.noPlan) {
      return a.noPlan ? 1 : -1;
    }
    if (b.completionPct !== a.completionPct) {
      return b.completionPct - a.completionPct;
    }
    return b.completedCount - a.completedCount;
  });
  return performers;
}

// ---------------------------------------------------------------------------
// Public view builders
// ---------------------------------------------------------------------------

function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) {
    return 0;
  }
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function getClubFeed(input: {
  cursor?: string | null;
}): Promise<ClubFeedView> {
  const today = clubTodayIso();
  const from = addDaysIso(today, -C.CLUB_FEED_WINDOW_DAYS);
  const [students, rows, freshness] = await Promise.all([
    loadClubStudents(),
    loadClubWorkoutRows({ from, to: today }),
    buildFreshness(),
  ]);
  const visibleIds = new Set(students.filter(isVisible).map((s) => s.id));

  const feedRows = rows
    .filter(
      (row) =>
        row.isCompleted &&
        visibleIds.has(row.studentId) &&
        row.family !== "day_off" &&
        ((row.distanceKm ?? 0) > 0 || (row.durationSeconds ?? 0) > 0)
    )
    .sort((a, b) => {
      if (a.workoutDate !== b.workoutDate) {
        return a.workoutDate < b.workoutDate ? 1 : -1;
      }
      const sa = a.startTime ?? "";
      const sb = b.startTime ?? "";
      if (sa !== sb) {
        return sa < sb ? 1 : -1;
      }
      return a.id < b.id ? 1 : -1;
    });

  const offset = decodeCursor(input.cursor);
  const pageRows = feedRows.slice(offset, offset + C.CLUB_FEED_PAGE_SIZE);
  const nextOffset = offset + C.CLUB_FEED_PAGE_SIZE;
  const nextCursor = nextOffset < feedRows.length ? String(nextOffset) : null;

  const items: ClubFeedItem[] = pageRows.map((row) => {
    const label = typeLabel(row.family);
    return {
      id: row.id,
      studentDisplayName: firstWord(row.studentName),
      monogram: monogram(row.studentName),
      typeLabel: label,
      isRunning: row.isRunning,
      date: row.workoutDate,
      dateLabel: formatRuDate(row.workoutDate),
      distanceKm: row.distanceKm,
      durationSeconds: row.durationSeconds,
      paceSecPerKm: row.isRunning ? paceSecPerKm(row.distanceKm, row.durationSeconds) : null,
      caption: sanitizeCaption(row.title, label),
      reactionsEnabled: false,
    };
  });

  return { items, nextCursor, freshness };
}

export async function getClubChallenge(input: {
  currentStudentId: string;
}): Promise<ClubChallengeView> {
  const range = currentWeekRange();
  const [students, rows] = await Promise.all([
    loadClubStudents(),
    loadClubWorkoutRows({ from: range.from, to: range.to }),
  ]);
  const visible = students.filter(isVisible);
  const visibleById = new Map(visible.map((s) => [s.id, s]));
  const visibleIds = new Set(visibleById.keys());

  let clubKm = 0;
  let personalKm = 0;
  for (const row of rows) {
    if (!row.isCompleted || !row.isRunning || !visibleIds.has(row.studentId)) {
      continue;
    }
    const km = row.distanceKm ?? 0;
    clubKm += km;
    if (row.studentId === input.currentStudentId) {
      personalKm += km;
    }
  }
  clubKm = Number(clubKm.toFixed(1));
  personalKm = Number(personalKm.toFixed(1));

  const performers = buildWeekPerformers(rows, visibleById).map((p) => ({
    ...p,
    isCurrentStudent: p.studentId === input.currentStudentId,
  }));
  const currentPerformer = performers.find((p) => p.studentId === input.currentStudentId) ?? null;

  const goalKm = C.CLUB_CHALLENGE_GOAL_KM_FIXTURE;
  const progressPct = goalKm > 0 ? Math.min(Math.round((clubKm / goalKm) * 100), 100) : 0;

  return {
    clubKm,
    goalKm,
    goalIsFixture: true,
    progressPct,
    weekLabel: weekLabel(range),
    topPerformers: performers.slice(0, C.CLUB_TOP_PERFORMERS_N),
    personal: currentPerformer
      ? {
          contributionKm: personalKm,
          contributionPct: clubKm > 0 ? Math.round((personalKm / clubKm) * 100) : 0,
          completionPct: currentPerformer.completionPct,
          plannedCount: currentPerformer.plannedCount,
          completedCount: currentPerformer.completedCount,
          noPlan: currentPerformer.noPlan,
        }
      : null,
  };
}

export async function getClubRecords(input: {
  currentStudentId: string;
}): Promise<ClubRecordsView> {
  const today = clubTodayIso();
  const from = addDaysIso(today, -C.CLUB_RECORDS_WINDOW_DAYS);
  const [students, rows] = await Promise.all([
    loadClubStudents(),
    loadClubWorkoutRows({ from, to: today }),
  ]);
  const visibleById = new Map(students.filter(isVisible).map((s) => [s.id, s]));
  const visibleRows = rows.filter((r) => visibleById.has(r.studentId));

  const byDistance = collectCandidatesByDistance(visibleRows);

  // Determine winners first, then fetch laps once for reliability certification.
  const winnerIds = new Set<string>();
  const clubBest = new Map<string, Map<string, RecordCandidate>>();
  for (const target of C.CLUB_RECORD_DISTANCES) {
    const best = bestPerStudent(byDistance.get(target.key) ?? []);
    clubBest.set(target.key, best);
    for (const cand of best.values()) {
      winnerIds.add(cand.workoutId);
    }
  }
  const stableIds = await loadStableWorkoutIds([...winnerIds]);

  const personal: ClubRecordEntry[] = [];
  const clubTops: ClubRecordsView["clubTops"] = [];
  for (const target of C.CLUB_RECORD_DISTANCES) {
    const best = clubBest.get(target.key)!;

    const own = best.get(input.currentStudentId);
    if (own) {
      personal.push(toRecordEntry(target, own, isReliable(target, own, stableIds)));
    }

    const ranked = [...best.values()].sort(
      (a, b) => a.durationSeconds - b.durationSeconds
    );
    const rows: ClubRecordsClubTopRow[] = ranked
      .slice(0, C.CLUB_RECORDS_TOP_N)
      .map((cand, index) => ({
        distanceKey: target.key,
        rank: index + 1,
        displayName: firstWord(cand.studentName),
        monogram: monogram(cand.studentName),
        durationSeconds: cand.durationSeconds,
        paceSecPerKm: paceSecPerKm(cand.distanceKm, cand.durationSeconds),
        isCurrentStudent: cand.studentId === input.currentStudentId,
        reliable: isReliable(target, cand, stableIds),
      }));
    clubTops.push({
      distanceKey: target.key,
      distanceLabel: target.label,
      alwaysPreliminary: target.alwaysPreliminary,
      rows,
    });
  }

  return { personal, clubTops };
}

export async function getClubProfile(input: {
  currentStudentId: string;
  currentStudentName: string;
}): Promise<ClubProfileView> {
  const today = clubTodayIso();
  const from = addDaysIso(today, -C.CLUB_RECORDS_WINDOW_DAYS);
  const week = currentWeekRange();
  const month = currentMonthRange();
  const [students, rows] = await Promise.all([
    loadClubStudents(),
    loadClubWorkoutRows({ from, to: today }),
  ]);
  const visibleById = new Map(students.filter(isVisible).map((s) => [s.id, s]));

  const ownRows = rows.filter(
    (r) => r.studentId === input.currentStudentId && r.isCompleted && r.isRunning
  );

  let weekKm = 0;
  let monthKm = 0;
  const activeDays = new Set<string>();
  for (const row of ownRows) {
    const km = row.distanceKm ?? 0;
    if (row.workoutDate >= week.from && row.workoutDate <= week.to) {
      weekKm += km;
    }
    if (row.workoutDate >= month.from && row.workoutDate <= month.to) {
      monthKm += km;
    }
    activeDays.add(row.workoutDate);
  }

  // Streak: consecutive days (ending today or yesterday) with >=1 completed run.
  let streakDays = 0;
  let cursor = today;
  if (!activeDays.has(cursor)) {
    cursor = addDaysIso(today, -1); // grace: today may not be logged yet
  }
  while (activeDays.has(cursor)) {
    streakDays += 1;
    cursor = addDaysIso(cursor, -1);
  }

  // Records for this student.
  const byDistance = collectCandidatesByDistance(ownRows);
  const winnerIds = new Set<string>();
  const bestByKey = new Map<string, RecordCandidate>();
  for (const target of C.CLUB_RECORD_DISTANCES) {
    const best = bestPerStudent(byDistance.get(target.key) ?? []).get(input.currentStudentId);
    if (best) {
      bestByKey.set(target.key, best);
      winnerIds.add(best.workoutId);
    }
  }
  const stableIds = await loadStableWorkoutIds([...winnerIds]);
  const records: ClubRecordEntry[] = [];
  for (const target of C.CLUB_RECORD_DISTANCES) {
    const best = bestByKey.get(target.key);
    if (best) {
      records.push(toRecordEntry(target, best, isReliable(target, best, stableIds)));
    }
  }

  // Challenge rank among all visible participants (this week).
  const weekRows = rows.filter((r) => r.workoutDate >= week.from && r.workoutDate <= week.to);
  const performers = buildWeekPerformers(weekRows, visibleById);
  const rankIndex = performers.findIndex((p) => p.studentId === input.currentStudentId);
  const current = rankIndex >= 0 ? performers[rankIndex] : null;

  return {
    displayName: firstWord(input.currentStudentName),
    monogram: monogram(input.currentStudentName),
    weekKm: Number(weekKm.toFixed(1)),
    monthKm: Number(monthKm.toFixed(1)),
    streakDays,
    records,
    challengeRank: rankIndex >= 0 ? rankIndex + 1 : null,
    challengeParticipants: performers.length,
    completionPct: current?.completionPct ?? 0,
    noPlan: current?.noPlan ?? true,
  };
}

export { formatDuration, formatRuDate };
