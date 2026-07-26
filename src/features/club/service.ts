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
import { fetchAllRows, fetchAllInChunks, chunkIds } from "@/features/supabase/paginate";
import { getTrainingPeaksWorkoutCacheFreshness } from "@/features/trainingpeaks/repository";
import {
  classifyTrainingPeaksWorkoutActivity,
  type TrainingPeaksWorkoutActivityFamily,
} from "@/features/trainingpeaks/workout-activity-classification";

import * as C from "./constants";
import {
  evaluateCandidate,
  referenceVdotForAthlete,
  baselinePaceSecPerKm,
  isSplitMeaningful,
  tpPeakPlausible,
  type ClubRecordType,
  type EvaluatedRecord,
  type RecordCalcMethod,
  type RecordCandidate,
  type RecordDistanceKey,
  type RecordSource,
  type WorkoutQuality,
} from "./records";
import type {
  ClubAchievement,
  ClubChallengeView,
  ClubExtendedTopsView,
  ClubFeedItem,
  ClubFeedView,
  ClubFreshness,
  ClubPrediction,
  ClubProfileDetailView,
  ClubPublicProfileView,
  ClubRecordEntry,
  ClubRecordsClubTopRow,
  ClubRecordsView,
  ClubStatisticsView,
  ClubTopPerformer,
  ClubTopRow,
  ClubTypeBreakdown,
  ClubVolumePoint,
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

export type ClubWorkoutRow = {
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
  // club_visible (migration 20260724120000_add_club_visible_flag.sql) is APPLIED:
  // boolean NOT NULL default true. When CLUB_PRIVACY_ENABLED is off, opt-out is
  // ignored and everyone stays visible (see isVisible); the column is still read so
  // the profile can show the current setting.
  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from("trainingpeaks_students")
      .select("id, student_name, is_active, is_service_account, club_visible")
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
      club_visible: boolean | null;
    }> | null) ?? []
  ).map((row) => ({
    id: row.id,
    name: row.student_name,
    isActive: row.is_active !== false,
    isServiceAccount: row.is_service_account === true,
    // null-safe: a missing/NULL value defaults to visible (matches column default true).
    clubVisible: row.club_visible !== false,
  }));
}

type ReactionAgg = { like: number; fire: number; mineLike: boolean; mineFire: boolean };

/**
 * One query for the whole feed page (no N+1). Returns per-workout aggregate counts
 * plus whether the current student reacted. Empty when reactions are disabled.
 */
async function loadReactionsForWorkouts(
  workoutIds: string[],
  currentStudentId: string
): Promise<Map<string, ReactionAgg>> {
  const out = new Map<string, ReactionAgg>();
  if (!C.isReactionsEnabled() || workoutIds.length === 0) {
    return out;
  }
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("club_reactions")
    .select("workout_cache_id, kind, student_id")
    .in("workout_cache_id", workoutIds);
  if (error) {
    // Table missing / schema-cache lag → treat as no reactions, never break the feed.
    return out;
  }
  for (const row of (data as Array<{ workout_cache_id: string; kind: string; student_id: string }> | null) ?? []) {
    const agg = out.get(row.workout_cache_id) ?? { like: 0, fire: 0, mineLike: false, mineFire: false };
    const mine = row.student_id === currentStudentId;
    if (row.kind === "like") {
      agg.like += 1;
      if (mine) agg.mineLike = true;
    } else if (row.kind === "fire") {
      agg.fire += 1;
      if (mine) agg.mineFire = true;
    }
    out.set(row.workout_cache_id, agg);
  }
  return out;
}

/**
 * A workout is reactable only if its owner is currently visible in the club
 * (active, non-service, and not opted out when privacy is on). Used to refuse
 * reacting to a hidden student's workout.
 */
export async function isWorkoutReactable(workoutId: string): Promise<boolean> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_workout_cache")
    .select("student_id")
    .eq("id", workoutId)
    .maybeSingle();
  if (error || !data) {
    return false;
  }
  const ownerId = (data as { student_id: string }).student_id;
  const students = await loadClubStudents();
  const owner = students.find((s) => s.id === ownerId);
  return owner ? isVisible(owner) : false;
}

/** Coarse rate limit: reactions created by this student in the last window. */
export async function countRecentReactions(studentId: string, windowSeconds: number): Promise<number> {
  const supabase = createSupabaseServerClient();
  const sinceIso = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count, error } = await supabase
    .from("club_reactions")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .gte("created_at", sinceIso);
  if (error) {
    return 0;
  }
  return count ?? 0;
}

/**
 * Audit a /m/club binding attempt (spec v3 block 2.1). Inert until the
 * club_link_events table is applied — never throws, never blocks the flow.
 */
export async function logClubLinkEvent(input: {
  telegramUserId: number | null;
  telegramUsername?: string | null;
  studentId?: string | null;
  result: "confirmed" | "rejected" | "conflict";
  reason?: string | null;
}): Promise<void> {
  try {
    const supabase = createSupabaseServerClient();
    await supabase.from("club_link_events").insert({
      telegram_user_id: input.telegramUserId,
      telegram_username: input.telegramUsername ?? null,
      student_id: input.studentId ?? null,
      result: input.result,
      reason: input.reason ?? null,
    });
  } catch {
    /* table not applied yet → swallow */
  }
}

function isVisible(student: ClubStudent): boolean {
  const base = student.isActive && !student.isServiceAccount;
  // Opt-out only takes effect when the privacy feature is enabled; otherwise the
  // club_visible flag is stored-but-ignored and everyone participates by default.
  if (C.isPrivacyEnabled()) {
    return base && student.clubVisible;
  }
  return base;
}

async function loadClubWorkoutRows(input: {
  from: string;
  to: string;
  /** Incremental recompute: restrict to these students (materialize). Omit = whole club. */
  studentIds?: string[];
}): Promise<ClubWorkoutRow[]> {
  const supabase = createSupabaseServerClient();
  // Lean explicit column list: never pull `source_snapshot` (raw private TP
  // payload) or per-workout compliance into the club layer.
  // Paginate: the window is ~20k rows — a single-shot select truncates at the
  // 1000-row PostgREST cap (the club used to see ~5% of data). Stable .order("id").
  const data = await fetchAllRows<Record<string, unknown>>(
    (fromRow, toRow) => {
      let q = supabase
        .from("trainingpeaks_workout_cache")
        .select(
          "id, student_id, student_name, workout_date, title, sport_or_type_code, workout_type_value_id, workout_sub_type_id, is_planned, is_completed, completed_time_raw, completed_distance_raw, start_time"
        )
        .gte("workout_date", input.from)
        .lte("workout_date", input.to);
      if (input.studentIds && input.studentIds.length > 0) {
        q = q.in("student_id", input.studentIds);
      }
      return withSupabaseNetworkRetry(() => q.order("id", { ascending: true }).range(fromRow, toRow));
    },
    { label: `club:workout_rows ${input.from}..${input.to}` }
  );
  return data.map((row) => {
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
 * Builds a quality index for a set of workout_cache_ids from laps + derived
 * metrics. Powers all three record trust levels + plausibility checks. Missing
 * data => a conservative record (hasLaps:false) which caps the record at
 * `preliminary`.
 */
async function loadWorkoutQualityIndex(idsRaw: string[]): Promise<Map<string, WorkoutQuality>> {
  const index = new Map<string, WorkoutQuality>();
  const ids = [...new Set(idsRaw)]; // candidates repeat workoutId across targets
  if (ids.length === 0) {
    return index;
  }
  const supabase = createSupabaseServerClient();
  // Chunk the `.in()` filters — with best-split ON the candidate set is large.
  type LapRow = {
    workout_cache_id: string;
    pace_sec_per_km: number | null;
    is_work: boolean | null;
    timer_time_s: number | null;
    elapsed_time_s: number | null;
    distance_m: number | null;
  };
  type DerivedRow = {
    workout_cache_id: string;
    reps_detected_count: number | null;
    rep_detection_method: string | null;
    has_fit: boolean | null;
    workout_type: string | null;
  };
  // Paginate EACH chunk's result: an interval workout can carry >1000 lap rows,
  // so a chunked `.in()` that is not paged truncates silently (the disguised
  // best-split "flakiness"). fetchAllInChunks chunks the id list AND pages each chunk.
  const [lapsData, derivedData] = await Promise.all([
    fetchAllInChunks<LapRow>(
      ids,
      IN_CHUNK,
      (ids0, fromRow, toRow) =>
        withSupabaseNetworkRetry(() =>
          supabase
            .from("trainingpeaks_workout_laps")
            .select("workout_cache_id, pace_sec_per_km, is_work, timer_time_s, elapsed_time_s, distance_m")
            .in("workout_cache_id", ids0)
            .order("workout_cache_id", { ascending: true })
            .order("lap_index", { ascending: true })
            .range(fromRow, toRow)
        ),
      { label: "club:quality_laps" }
    ),
    fetchAllInChunks<DerivedRow>(
      ids,
      IN_CHUNK,
      (ids0, fromRow, toRow) =>
        withSupabaseNetworkRetry(() =>
          supabase
            .from("trainingpeaks_workout_derived_metrics")
            .select("workout_cache_id, reps_detected_count, rep_detection_method, has_fit, workout_type")
            .in("workout_cache_id", ids0)
            .order("workout_cache_id", { ascending: true })
            .range(fromRow, toRow)
        ),
      { label: "club:quality_derived" }
    ),
  ]);

  type LapAgg = {
    workPaces: number[];
    allPaces: number[];
    timer: number;
    elapsed: number;
    dist: number;
    hasAny: boolean;
  };
  const lapAgg = new Map<string, LapAgg>();
  {
    for (const row of lapsData) {
      const agg = lapAgg.get(row.workout_cache_id) ?? {
        workPaces: [],
        allPaces: [],
        timer: 0,
        elapsed: 0,
        dist: 0,
        hasAny: false,
      };
      agg.hasAny = true;
      const pace = toFiniteNumber(row.pace_sec_per_km);
      if (pace !== null && pace > 0) {
        agg.allPaces.push(pace);
        if (row.is_work === true) {
          agg.workPaces.push(pace);
        }
      }
      agg.timer += toFiniteNumber(row.timer_time_s) ?? 0;
      agg.elapsed += toFiniteNumber(row.elapsed_time_s) ?? 0;
      agg.dist += toFiniteNumber(row.distance_m) ?? 0;
      lapAgg.set(row.workout_cache_id, agg);
    }
  }

  const derivedByWorkout = new Map<string, { isInterval: boolean; hasFit: boolean; workoutType: string | null }>();
  {
    for (const row of derivedData) {
      const reps = toFiniteNumber(row.reps_detected_count) ?? 0;
      const method = row.rep_detection_method ?? "none";
      const isInterval = reps >= 2 && (method === "structure" || method === "lap_trigger");
      derivedByWorkout.set(row.workout_cache_id, {
        isInterval,
        hasFit: row.has_fit === true,
        workoutType: row.workout_type ?? null,
      });
    }
  }

  function cv(paces: number[]): number | null {
    if (paces.length < 3) {
      return null;
    }
    const mean = paces.reduce((a, b) => a + b, 0) / paces.length;
    if (mean <= 0) {
      return null;
    }
    const variance = paces.reduce((a, b) => a + (b - mean) * (b - mean), 0) / paces.length;
    return Math.sqrt(variance) / mean;
  }

  for (const id of ids) {
    const agg = lapAgg.get(id);
    const derived = derivedByWorkout.get(id);
    const paceList = agg && agg.workPaces.length >= 3 ? agg.workPaces : agg?.allPaces ?? [];
    index.set(id, {
      hasLaps: agg?.hasAny ?? false,
      hasFit: derived?.hasFit ?? (agg?.hasAny ?? false),
      paceCv: cv(paceList),
      lapTimerSumS: agg && agg.timer > 0 ? agg.timer : null,
      lapElapsedSumS: agg && agg.elapsed > 0 ? agg.elapsed : null,
      lapDistanceSumM: agg && agg.dist > 0 ? agg.dist : null,
      isInterval: derived?.isInterval ?? false,
      workoutType: derived?.workoutType ?? null,
    });
  }
  return index;
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

const LABEL_BY_KEY = new Map(C.CLUB_RECORD_DISTANCES.map((d) => [d.key, d.label] as const));

type OrderedLap = {
  lapIndex: number;
  distanceM: number;
  movingS: number;
  elapsedS: number;
  pace: number | null;
};

/** Split an id list into chunks so a `.in(...)` filter never blows the URL length. */
const IN_CHUNK = 60;

/** Ordered (by lap_index) FIT laps per workout — for best-continuous-split. */
async function loadOrderedLaps(ids: string[]): Promise<Map<string, OrderedLap[]>> {
  const out = new Map<string, OrderedLap[]>();
  if (ids.length === 0) {
    return out;
  }
  const supabase = createSupabaseServerClient();
  // Chunk the `.in()` (URL length) AND paginate each chunk (row cap): an interval
  // workout carries many laps, so an unpaged chunk >1000 rows truncated silently —
  // dropping the tail of a workout's laps and poisoning best-split. Loud on error.
  type LapRow = {
    workout_cache_id: string;
    lap_index: number | null;
    distance_m: number | null;
    timer_time_s: number | null;
    elapsed_time_s: number | null;
    pace_sec_per_km: number | null;
  };
  const rows = await fetchAllInChunks<LapRow>(
    ids,
    IN_CHUNK,
    (ids0, fromRow, toRow) =>
      withSupabaseNetworkRetry(() =>
        supabase
          .from("trainingpeaks_workout_laps")
          .select("workout_cache_id, lap_index, distance_m, timer_time_s, elapsed_time_s, pace_sec_per_km")
          .in("workout_cache_id", ids0)
          .eq("source", "fit")
          .order("workout_cache_id", { ascending: true })
          .order("lap_index", { ascending: true })
          .range(fromRow, toRow)
      ),
    { label: "club:ordered_laps" }
  );
  for (const row of rows) {
    const distanceM = toFiniteNumber(row.distance_m) ?? 0;
    if (distanceM <= 0) {
      continue; // drop rest/zero-distance laps that would poison the window
    }
    const timer = toFiniteNumber(row.timer_time_s);
    const elapsed = toFiniteNumber(row.elapsed_time_s);
    const list = out.get(row.workout_cache_id) ?? [];
    list.push({
      lapIndex: toFiniteNumber(row.lap_index) ?? list.length,
      distanceM,
      movingS: (timer && timer > 0 ? timer : elapsed) ?? 0,
      elapsedS: (elapsed && elapsed > 0 ? elapsed : timer) ?? 0,
      pace: toFiniteNumber(row.pace_sec_per_km),
    });
    out.set(row.workout_cache_id, list);
  }
  return out;
}

function cvOf(paces: number[]): number | null {
  const clean = paces.filter((p) => p > 0);
  if (clean.length < 3) {
    return null;
  }
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  if (mean <= 0) {
    return null;
  }
  const variance = clean.reduce((a, b) => a + (b - mean) * (b - mean), 0) / clean.length;
  return Math.sqrt(variance) / mean;
}

/**
 * Fastest contiguous lap-segment whose summed distance covers `targetKm`
 * (within [target-under, target+over]). Returns null when no such segment exists
 * (workout shorter than target, or a single oversized lap → irregular/manual).
 */
type SplitSegment = {
  distanceKm: number;
  movingS: number;
  elapsedS: number;
  paceCv: number | null;
  startLap: number;
  endLap: number;
  lapCount: number;
};

function buildBestSplitSegment(laps: OrderedLap[], targetKm: number): SplitSegment | null {
  if (laps.length < 2) {
    return null; // single lap → cannot pick a tighter split than the whole file
  }
  const targetM = targetKm * 1000;
  const lo = targetM - C.CLUB_SPLIT_UNDER_TOLERANCE_M;
  const hi = targetM + C.CLUB_SPLIT_OVER_TOLERANCE_M;

  let best: SplitSegment | null = null;
  for (let i = 0; i < laps.length; i += 1) {
    let dist = 0;
    let moving = 0;
    let elapsed = 0;
    const paces: number[] = [];
    for (let j = i; j < laps.length; j += 1) {
      dist += laps[j].distanceM;
      moving += laps[j].movingS;
      elapsed += laps[j].elapsedS;
      if (laps[j].pace) {
        paces.push(laps[j].pace as number);
      }
      if (dist > hi) {
        break; // window already too long; a longer window is even worse
      }
      if (dist >= lo) {
        // qualifying window; prefer the fastest (min moving time)
        if (!best || moving < best.movingS) {
          best = {
            distanceKm: dist / 1000,
            movingS: moving,
            elapsedS: elapsed,
            paceCv: cvOf(paces),
            startLap: laps[i].lapIndex,
            endLap: laps[j].lapIndex,
            lapCount: j - i + 1,
          };
        }
      }
    }
  }
  return best;
}

/**
 * Build record candidates. When `useBestSplit`, prefer the fastest contiguous
 * lap-segment covering each target (local best_efforts); fall back to the whole
 * workout (in ±band) only when laps are missing or no segment qualifies.
 */
function collectCandidates(
  rows: ClubWorkoutRow[],
  lapsByWorkout: Map<string, OrderedLap[]>,
  useBestSplit: boolean
): RecordCandidate[] {
  const out: RecordCandidate[] = [];
  for (const row of rows) {
    if (!row.isCompleted || !row.isRunning) {
      continue;
    }
    const d = row.distanceKm;
    const t = row.durationSeconds;
    if (!d || d <= 0 || !t || t <= 0) {
      continue;
    }
    const laps = lapsByWorkout.get(row.id);
    for (const target of C.CLUB_RECORD_DISTANCES) {
      const seg = useBestSplit && laps ? buildBestSplitSegment(laps, target.km) : null;
      if (seg) {
        out.push({
          workoutId: row.id,
          studentId: row.studentId,
          studentName: row.studentName,
          distanceKey: target.key,
          targetKm: target.km,
          distanceKm: seg.distanceKm,
          durationSeconds: seg.movingS, // segment is continuous → moving time is fair
          date: row.workoutDate,
          bandDeltaKm: Math.abs(seg.distanceKm - target.km),
          calcMethod: "best_split",
          wholeDistanceKm: d,
          segment: seg,
        });
        continue;
      }
      // Fallback: whole workout, only if it lands in the ±band.
      const delta = Math.abs(d - target.km);
      if (delta <= C.CLUB_RECORD_BAND_KM) {
        out.push({
          workoutId: row.id,
          studentId: row.studentId,
          studentName: row.studentName,
          distanceKey: target.key,
          targetKm: target.km,
          distanceKm: d,
          durationSeconds: t,
          date: row.workoutDate,
          bandDeltaKm: delta,
          calcMethod: "whole_workout",
          wholeDistanceKm: d,
        });
      }
    }
  }
  return out;
}

/** Loads laps + quality and builds candidates for a set of rows. */
async function buildRecordInputs(
  rows: ClubWorkoutRow[],
  useBestSplit: boolean
): Promise<{ candidates: RecordCandidate[]; quality: Map<string, WorkoutQuality> }> {
  const runningIds = rows
    .filter((r) => r.isCompleted && r.isRunning && (r.distanceKm ?? 0) > 0 && (r.durationSeconds ?? 0) > 0)
    .map((r) => r.id);
  const laps = useBestSplit ? await loadOrderedLaps(runningIds) : new Map<string, OrderedLap[]>();
  const candidates = collectCandidates(rows, laps, useBestSplit);
  const quality = await loadWorkoutQualityIndex(candidates.map((c) => c.workoutId));
  return { candidates, quality };
}

export type DistanceResult = {
  best: EvaluatedRecord | null; // min-duration non-hidden (verified or preliminary)
  bestVerified: EvaluatedRecord | null; // min-duration verified only (feeds club tops)
  evaluated: EvaluatedRecord[]; // every candidate incl. hidden (for validation logging)
};

/** studentId -> distanceKey -> result. Pure over the quality index (no I/O here). */
function reconstructRecords(
  candidates: RecordCandidate[],
  quality: Map<string, WorkoutQuality>
): Map<string, Map<RecordDistanceKey, DistanceResult>> {
  const byStudent = new Map<string, Map<RecordDistanceKey, RecordCandidate[]>>();
  for (const cand of candidates) {
    const perDist = byStudent.get(cand.studentId) ?? new Map<RecordDistanceKey, RecordCandidate[]>();
    const list = perDist.get(cand.distanceKey) ?? [];
    list.push(cand);
    perDist.set(cand.distanceKey, list);
    byStudent.set(cand.studentId, perDist);
  }

  const result = new Map<string, Map<RecordDistanceKey, DistanceResult>>();
  for (const [studentId, perDist] of byStudent) {
    // Provisional per-distance min (pre-plausibility) → reference VDOT for the self-outlier check.
    const provisionalBest = new Map<RecordDistanceKey, RecordCandidate>();
    for (const [key, list] of perDist) {
      const min = list.reduce((a, b) => (b.durationSeconds < a.durationSeconds ? b : a));
      provisionalBest.set(key, min);
    }

    const perDistResult = new Map<RecordDistanceKey, DistanceResult>();
    for (const [key, list] of perDist) {
      const refVdot = referenceVdotForAthlete(provisionalBest, key);
      const evaluated = list
        .map((cand) => evaluateCandidate(cand, quality.get(cand.workoutId), refVdot))
        .sort((a, b) => a.candidate.durationSeconds - b.candidate.durationSeconds);
      const best = evaluated.find((e) => e.trust !== "hidden") ?? null;
      const bestVerified = evaluated.find((e) => e.trust === "verified") ?? null;
      perDistResult.set(key, { best, bestVerified, evaluated });
    }
    result.set(studentId, perDistResult);
  }
  return result;
}

function toRecordEntry(ev: EvaluatedRecord, recordType: ClubRecordType): ClubRecordEntry {
  const cand = ev.candidate;
  return {
    distanceKey: cand.distanceKey,
    distanceLabel: LABEL_BY_KEY.get(cand.distanceKey) ?? cand.distanceKey,
    durationSeconds: cand.durationSeconds,
    paceSecPerKm: paceSecPerKm(cand.distanceKm, cand.durationSeconds),
    date: cand.date,
    dateLabel: formatRuDate(cand.date),
    trust: ev.trust === "verified" ? "verified" : "preliminary",
    source: ev.source,
    calcMethod: ev.calcMethod,
    recordType,
  };
}

function coachRaceEntry(
  target: (typeof C.CLUB_RECORD_DISTANCES)[number],
  c: CoachRecord
): ClubRecordEntry {
  return {
    distanceKey: target.key,
    distanceLabel: target.label,
    durationSeconds: c.durationSeconds,
    paceSecPerKm: c.paceSecPerKm,
    date: c.recordDate ?? "",
    dateLabel: c.recordDate ? formatRuDate(c.recordDate) : "гонка",
    trust: "verified",
    source: "coach_confirmed",
    calcMethod: "whole_workout",
    recordType: "race",
  };
}

/** Best non-hidden EvaluatedRecord per record type (race / training_split) for a student+distance. */
function splitByType(
  evaluated: EvaluatedRecord[],
  studentId: string,
  raceDates: Map<string, Set<string>>
): { race: EvaluatedRecord | null; training: EvaluatedRecord | null; bestVerifiedRace: EvaluatedRecord | null } {
  let race: EvaluatedRecord | null = null;
  let training: EvaluatedRecord | null = null;
  let bestVerifiedRace: EvaluatedRecord | null = null;
  for (const ev of evaluated) {
    if (ev.trust === "hidden") continue;
    const type = classifyRecordType(studentId, ev.candidate.date, raceDates);
    if (type === "race") {
      if (!race || ev.candidate.durationSeconds < race.candidate.durationSeconds) race = ev;
      if (ev.trust === "verified" && (!bestVerifiedRace || ev.candidate.durationSeconds < bestVerifiedRace.candidate.durationSeconds)) {
        bestVerifiedRace = ev;
      }
    } else if (!training || ev.candidate.durationSeconds < training.candidate.durationSeconds) {
      training = ev;
    }
  }
  return { race, training, bestVerifiedRace };
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
  currentStudentId: string;
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

  // Single reactions query for the whole page (no N+1).
  const reactions = await loadReactionsForWorkouts(
    pageRows.map((r) => r.id),
    input.currentStudentId
  );

  const items: ClubFeedItem[] = pageRows.map((row) => {
    const label = typeLabel(row.family);
    const agg = reactions.get(row.id);
    return {
      id: row.id,
      studentId: row.studentId,
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
      reactionsEnabled: C.isReactionsEnabled(),
      reactions: { like: agg?.like ?? 0, fire: agg?.fire ?? 0 },
      mine: { like: agg?.mineLike ?? false, fire: agg?.mineFire ?? false },
    };
  });

  return { items, nextCursor, freshness };
}

/** Club running km completed within [from,to] over visible students. */
function clubKmInRange(rows: ClubWorkoutRow[], visibleIds: Set<string>, from: string, to: string): number {
  let km = 0;
  for (const row of rows) {
    if (!row.isCompleted || !row.isRunning || !visibleIds.has(row.studentId)) {
      continue;
    }
    if (row.workoutDate >= from && row.workoutDate <= to) {
      km += row.distanceKm ?? 0;
    }
  }
  return km;
}

/**
 * Auto challenge goal: rolling average of club km over the last N COMPLETED weeks,
 * nudged up by RAISE_STEP ONLY if the club beat its average last week. Anchoring on
 * an average of ACTUALS (not on the previous goal) means it never compounds into an
 * unreachable target. Returns null when there is no completed-week data yet.
 */
function computeAutoGoalKm(
  rows: ClubWorkoutRow[],
  visibleIds: Set<string>,
  currentWeekFrom: string
): number | null {
  const kmForWeekBack = (i: number): number => {
    const from = addDaysIso(currentWeekFrom, -7 * i);
    return clubKmInRange(rows, visibleIds, from, addDaysIso(from, 6));
  };
  // km[0]=last completed week (W-1) … km[4]=W-5
  const km = [1, 2, 3, 4, 5].map(kmForWeekBack);
  const n = C.CLUB_CHALLENGE_ROLLING_WEEKS;

  const baseWeeks = km.slice(0, n).filter((k) => k > 0);
  if (baseWeeks.length === 0) {
    return null;
  }
  const baseAvg = baseWeeks.reduce((a, b) => a + b, 0) / baseWeeks.length;

  const prevWeeks = km.slice(1, n + 1).filter((k) => k > 0);
  const prevAvg = prevWeeks.length ? prevWeeks.reduce((a, b) => a + b, 0) / prevWeeks.length : 0;
  const prevActual = km[0];
  const beatPrevious = prevActual > 0 && prevAvg > 0 && prevActual >= prevAvg;

  const raw = beatPrevious ? baseAvg * (1 + C.CLUB_CHALLENGE_RAISE_STEP) : baseAvg;
  const step = C.CLUB_CHALLENGE_AUTO_ROUND_STEP;
  return Math.max(step, Math.ceil(raw / step) * step);
}

async function loadManualGoalKm(): Promise<number | null> {
  // club_challenges migration is NOT applied in prod → this read fails/empty and
  // the caller falls back. Wrapped so a missing table never throws the view away.
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("club_challenges")
      .select("goal_km, starts_at, ends_at")
      .lte("starts_at", clubTodayIso())
      .gte("ends_at", clubTodayIso())
      .order("starts_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) {
      return null;
    }
    const goal = toFiniteNumber((data as { goal_km: number | null }).goal_km);
    return goal && goal > 0 ? goal : null;
  } catch {
    return null;
  }
}

export async function getClubChallenge(input: {
  currentStudentId: string;
}): Promise<ClubChallengeView> {
  const range = currentWeekRange();
  // Load enough history for the rolling-average goal (up to 5 completed weeks back).
  const historyFrom = addDaysIso(range.from, -7 * 5);
  const [students, rows, freshness] = await Promise.all([
    loadClubStudents(),
    loadClubWorkoutRows({ from: historyFrom, to: range.to }),
    buildFreshness(),
  ]);
  const visible = students.filter(isVisible);
  const visibleById = new Map(visible.map((s) => [s.id, s]));
  const visibleIds = new Set(visibleById.keys());

  const weekRows = rows.filter((r) => r.workoutDate >= range.from && r.workoutDate <= range.to);

  let clubKm = 0;
  let personalKm = 0;
  for (const row of weekRows) {
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

  const performers = buildWeekPerformers(weekRows, visibleById).map((p) => ({
    ...p,
    isCurrentStudent: p.studentId === input.currentStudentId,
  }));
  const currentPerformer = performers.find((p) => p.studentId === input.currentStudentId) ?? null;

  // Goal resolution: auto (prev week club km * factor) | manual (table) | fixture.
  const mode = C.resolveChallengeGoalMode();
  let goalKm = C.CLUB_CHALLENGE_GOAL_KM_FIXTURE;
  let goalMode: "auto" | "manual" | "fixture" = "fixture";
  if (mode === "manual") {
    const manual = await loadManualGoalKm();
    if (manual) {
      goalKm = manual;
      goalMode = "manual";
    }
  } else if (mode === "auto") {
    const auto = computeAutoGoalKm(rows, visibleIds, range.from);
    if (auto !== null) {
      goalKm = auto;
      goalMode = "auto";
    }
  }
  const progressPct = goalKm > 0 ? Math.min(Math.round((clubKm / goalKm) * 100), 100) : 0;

  return {
    clubKm,
    goalKm,
    goalIsFixture: goalMode === "fixture",
    goalMode,
    progressPct,
    weekLabel: weekLabel(range),
    freshness,
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
  // Reads MATERIALIZED snapshots (Phase 1.1) — no live lap loading. The whole tab
  // is now a few small reads instead of ~20k workouts + all laps. Snapshots are
  // refreshed by materializeClubRecords after each cache/FIT scan. Coach overrides
  // (club_records) still win at read time.
  const [students, snapshots, coach, freshness] = await Promise.all([
    loadClubStudents(),
    loadRecordSnapshots(),
    loadCoachRecords(),
    buildFreshness(),
  ]);
  const visibleById = new Map(students.filter(isVisible).map((s) => [s.id, s]));

  const personal: ClubRecordEntry[] = [];
  const clubTops: ClubRecordsView["clubTops"] = [];
  const ownSnap = snapshots.get(input.currentStudentId);

  for (const target of C.CLUB_RECORD_DISTANCES) {
    // Personal card: coach override wins; else snapshot (race + training split).
    const ownCoach = coach.get(`${input.currentStudentId}|${target.key}`);
    if (ownCoach) {
      if (ownCoach.trust !== "hidden") {
        personal.push(coachRaceEntry(target, ownCoach));
      }
    } else {
      const slot = ownSnap?.get(target.key);
      if (slot?.race) personal.push(snapshotToEntry(target.key, slot.race, "race"));
      if (slot?.training) personal.push(snapshotToEntry(target.key, slot.training, "training_split"));
    }

    // Club top: ONLY real races (verified). Coach-confirmed verified races count;
    // materialized best_verified races count; coach-hidden distance excluded.
    const raceRows: Array<{ studentId: string; name: string; durationSeconds: number; pace: number | null }> = [];
    for (const [studentId, perStudent] of snapshots) {
      if (!visibleById.has(studentId)) continue; // student turned non-visible after last materialize
      const c = coach.get(`${studentId}|${target.key}`);
      if (c) {
        if (c.trust === "verified") {
          raceRows.push({ studentId, name: visibleById.get(studentId)?.name ?? "", durationSeconds: c.durationSeconds, pace: c.paceSecPerKm });
        }
        continue; // coach override (verified pushed above, hidden/preliminary excluded from tops)
      }
      const rv = perStudent.get(target.key)?.raceVerified;
      if (rv) raceRows.push({ studentId, name: visibleById.get(studentId)?.name ?? "", durationSeconds: rv.durationSeconds, pace: rv.paceSecPerKm });
    }
    raceRows.sort((a, b) => a.durationSeconds - b.durationSeconds);
    const topRows: ClubRecordsClubTopRow[] = raceRows.slice(0, C.CLUB_RECORDS_TOP_N).map((r, index) => ({
      distanceKey: target.key,
      rank: index + 1,
      studentId: r.studentId,
      displayName: firstWord(r.name),
      monogram: monogram(r.name),
      durationSeconds: r.durationSeconds,
      paceSecPerKm: r.pace,
      isCurrentStudent: r.studentId === input.currentStudentId,
      trust: "verified",
      recordType: "race",
    }));
    clubTops.push({
      distanceKey: target.key,
      distanceLabel: target.label,
      alwaysPreliminary: target.alwaysPreliminary,
      rows: topRows,
    });
  }

  return { personal, clubTops, freshness };
}

/** Reusable: current student's records (best per distance, verified|preliminary). */
async function studentRecordsFromRows(
  rows: ClubWorkoutRow[],
  studentId: string
): Promise<ClubRecordEntry[]> {
  const own = rows.filter((r) => r.studentId === studentId);
  const { candidates, quality } = await buildRecordInputs(own, C.isBestSplitEnabled());
  const byStudent = reconstructRecords(candidates, quality);
  const [raceDates, coach] = await Promise.all([loadRaceDatesByStudent(), loadCoachRecords()]);
  const perDist = byStudent.get(studentId);
  const out: ClubRecordEntry[] = [];
  for (const target of C.CLUB_RECORD_DISTANCES) {
    const c = coach.get(`${studentId}|${target.key}`);
    if (c) {
      if (c.trust !== "hidden") out.push(coachRaceEntry(target, c));
      continue; // coach override wins over reconstruction for this distance
    }
    const split = splitByType(perDist?.get(target.key)?.evaluated ?? [], studentId, raceDates);
    if (split.race) out.push(toRecordEntry(split.race, "race"));
    if (split.training) out.push(toRecordEntry(split.training, "training_split"));
  }
  return out;
}

function weekStartIso(iso: string): string {
  const offset = dayOfWeekMondayZero(iso);
  return addDaysIso(iso, -offset);
}

function computeStreakDays(activeDays: Set<string>, today: string): number {
  let streak = 0;
  let cursor = today;
  if (!activeDays.has(cursor)) {
    cursor = addDaysIso(today, -1); // grace: today may not be logged yet
  }
  while (activeDays.has(cursor)) {
    streak += 1;
    cursor = addDaysIso(cursor, -1);
  }
  return streak;
}

/** Longest consecutive-day streak anywhere in the set (for the streak achievement). */
function longestStreak(activeDays: Set<string>): number {
  let best = 0;
  for (const day of activeDays) {
    if (activeDays.has(addDaysIso(day, -1))) {
      continue; // not a run start
    }
    let len = 1;
    let cursor = addDaysIso(day, 1);
    while (activeDays.has(cursor)) {
      len += 1;
      cursor = addDaysIso(cursor, 1);
    }
    best = Math.max(best, len);
  }
  return best;
}

function kmByWeek(runningRows: ClubWorkoutRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of runningRows) {
    const wk = weekStartIso(row.workoutDate);
    map.set(wk, (map.get(wk) ?? 0) + (row.distanceKm ?? 0));
  }
  return map;
}

function kmByMonth(runningRows: ClubWorkoutRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of runningRows) {
    const m = row.workoutDate.slice(0, 7);
    map.set(m, (map.get(m) ?? 0) + (row.distanceKm ?? 0));
  }
  return map;
}

function buildAchievements(
  studentRunningRows: ClubWorkoutRow[],
  studentAllRows: ClubWorkoutRow[],
  records: ClubRecordEntry[]
): ClubAchievement[] {
  const activeDays = new Set(studentRunningRows.map((r) => r.workoutDate));
  const maxStreak = longestStreak(activeDays);
  const monthMap = kmByMonth(studentRunningRows);
  const totalKm = studentRunningRows.reduce((a, r) => a + (r.distanceKm ?? 0), 0);
  const haveDistance = new Set(records.map((r) => r.distanceKey));

  // week completion 100%: any ISO week with >=1 planned run and completed>=planned
  const weekPlanned = new Map<string, number>();
  const weekDone = new Map<string, number>();
  for (const r of studentAllRows) {
    if (!r.isRunning) {
      continue;
    }
    const wk = weekStartIso(r.workoutDate);
    if (r.isPlanned) {
      weekPlanned.set(wk, (weekPlanned.get(wk) ?? 0) + 1);
    }
    if (r.isCompleted) {
      weekDone.set(wk, (weekDone.get(wk) ?? 0) + 1);
    }
  }
  let hadPerfectWeek = false;
  for (const [wk, planned] of weekPlanned) {
    if (planned > 0 && (weekDone.get(wk) ?? 0) >= planned) {
      hadPerfectWeek = true;
      break;
    }
  }

  const out: ClubAchievement[] = [];
  for (const rule of C.CLUB_ACHIEVEMENT_RULES) {
    if (rule.stub) {
      out.push({ code: rule.code, title: rule.title, hint: rule.hint, earned: false, earnedDateLabel: null, stub: true });
      continue;
    }
    let earned = false;
    switch (rule.kind) {
      case "first_distance":
        earned = rule.distanceKey ? haveDistance.has(rule.distanceKey) : false;
        break;
      case "month_volume":
        earned = [...monthMap.values()].some((km) => km >= (rule.param ?? Infinity));
        break;
      case "streak":
        earned = maxStreak >= (rule.param ?? Infinity);
        break;
      case "week_full_completion":
        earned = hadPerfectWeek;
        break;
      case "total_volume":
        earned = totalKm >= (rule.param ?? Infinity);
        break;
    }
    out.push({ code: rule.code, title: rule.title, hint: rule.hint, earned, earnedDateLabel: null, stub: false });
  }
  return out;
}

export async function getClubProfileDetail(input: {
  currentStudentId: string;
  currentStudentName: string;
}): Promise<ClubProfileDetailView> {
  const today = clubTodayIso();
  const from = addDaysIso(today, -C.CLUB_RECORDS_WINDOW_DAYS);
  const week = currentWeekRange();
  const month = currentMonthRange();
  const yearFrom = `${today.slice(0, 4)}-01-01`;
  const [students, rows, freshness] = await Promise.all([
    loadClubStudents(),
    loadClubWorkoutRows({ from, to: today }),
    buildFreshness(),
  ]);
  const visibleById = new Map(students.filter(isVisible).map((s) => [s.id, s]));
  // Own row is read from the FULL list (a student who opted out still sees their cabinet).
  const ownStudent = students.find((s) => s.id === input.currentStudentId) ?? null;

  const ownAll = rows.filter((r) => r.studentId === input.currentStudentId);
  const ownCompleted = ownAll.filter((r) => r.isCompleted);
  const ownRunning = ownCompleted.filter((r) => r.isRunning);

  let weekKm = 0;
  let monthKm = 0;
  let yearKm = 0;
  const activeDays = new Set<string>();
  for (const row of ownRunning) {
    const km = row.distanceKm ?? 0;
    if (row.workoutDate >= week.from && row.workoutDate <= week.to) weekKm += km;
    if (row.workoutDate >= month.from && row.workoutDate <= month.to) monthKm += km;
    if (row.workoutDate >= yearFrom) yearKm += km;
    activeDays.add(row.workoutDate);
  }

  const streakDays = computeStreakDays(activeDays, today);
  const records = await studentRecordsFromRows(ownRunning, input.currentStudentId);

  // Weekly series (last 12 ISO weeks) + best week (over full window).
  const weekMap = kmByWeek(ownRunning);
  const weeklySeries: ClubVolumePoint[] = [];
  let wkCursor = weekStartIso(today);
  const seriesWeeks: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    seriesWeeks.push(wkCursor);
    wkCursor = addDaysIso(wkCursor, -7);
  }
  seriesWeeks.reverse();
  for (const wk of seriesWeeks) {
    weeklySeries.push({ label: formatRuDate(wk), km: Number((weekMap.get(wk) ?? 0).toFixed(1)) });
  }
  let bestWeekKm = 0;
  let bestWeekLabel: string | null = null;
  for (const [wk, km] of weekMap) {
    if (km > bestWeekKm) {
      bestWeekKm = km;
      bestWeekLabel = formatRuDate(wk);
    }
  }

  // Type breakdown over all completed workouts.
  const typeAgg = new Map<string, { label: string; count: number; km: number }>();
  for (const row of ownCompleted) {
    const label = typeLabel(row.family);
    const agg = typeAgg.get(row.family) ?? { label, count: 0, km: 0 };
    agg.count += 1;
    agg.km += row.distanceKm ?? 0;
    typeAgg.set(row.family, agg);
  }
  const typeBreakdown: ClubTypeBreakdown[] = [...typeAgg.entries()]
    .map(([family, v]) => ({ family, label: v.label, count: v.count, km: Number(v.km.toFixed(1)) }))
    .sort((a, b) => b.count - a.count);

  const achievements = buildAchievements(ownRunning, ownAll, records).filter(
    (a) => !a.stub || C.isStubsEnabled()
  );

  // Challenge rank this week.
  const weekRows = rows.filter((r) => r.workoutDate >= week.from && r.workoutDate <= week.to);
  const performers = buildWeekPerformers(weekRows, visibleById);
  const rankIndex = performers.findIndex((p) => p.studentId === input.currentStudentId);
  const current = rankIndex >= 0 ? performers[rankIndex] : null;

  return {
    displayName: firstWord(input.currentStudentName),
    monogram: monogram(input.currentStudentName),
    weekKm: Number(weekKm.toFixed(1)),
    monthKm: Number(monthKm.toFixed(1)),
    yearKm: Number(yearKm.toFixed(1)),
    streakDays,
    bestWeekKm: Number(bestWeekKm.toFixed(1)),
    bestWeekLabel,
    weeklySeries,
    typeBreakdown,
    records,
    achievements,
    clubVisible: ownStudent?.clubVisible ?? true,
    privacyEnabled: C.isPrivacyEnabled(),
    challengeRank: rankIndex >= 0 ? rankIndex + 1 : null,
    challengeParticipants: performers.length,
    completionPct: current?.completionPct ?? 0,
    noPlan: current?.noPlan ?? true,
    freshness,
  };
}

export async function getClubStatistics(): Promise<ClubStatisticsView> {
  const range = currentWeekRange();
  const prevFrom = addDaysIso(range.from, -7);
  const prevTo = addDaysIso(range.to, -7);
  const [students, rows, freshness] = await Promise.all([
    loadClubStudents(),
    loadClubWorkoutRows({ from: prevFrom, to: range.to }),
    buildFreshness(),
  ]);
  const visible = students.filter(isVisible);
  const visibleById = new Map(visible.map((s) => [s.id, s]));
  const visibleIds = new Set(visibleById.keys());

  const weekRows = rows.filter((r) => r.workoutDate >= range.from && r.workoutDate <= range.to);
  const active = new Set<string>();
  let workoutsCount = 0;
  let clubKm = 0;
  for (const row of weekRows) {
    if (!row.isCompleted || !row.isRunning || !visibleIds.has(row.studentId)) {
      continue;
    }
    active.add(row.studentId);
    workoutsCount += 1;
    clubKm += row.distanceKm ?? 0;
  }
  clubKm = Number(clubKm.toFixed(1));
  const prevClubKm = Number(clubKmInRange(rows, visibleIds, prevFrom, prevTo).toFixed(1));

  const performers = buildWeekPerformers(weekRows, visibleById).filter((p) => !p.noPlan);
  const avgCompletionPct =
    performers.length > 0
      ? performers.reduce((a, p) => a + p.completionPct, 0) / performers.length
      : 0;

  return {
    weekLabel: weekLabel(range),
    clubKm,
    activeCount: active.size,
    workoutsCount,
    avgCompletionPct,
    prevClubKm,
    weekOverWeekPct: prevClubKm > 0 ? Math.round(((clubKm - prevClubKm) / prevClubKm) * 100) : null,
    freshness,
  };
}

export async function getClubExtendedTops(input: {
  currentStudentId: string;
}): Promise<ClubExtendedTopsView> {
  const today = clubTodayIso();
  const range = currentWeekRange();
  const from = addDaysIso(today, -60); // wide enough for streaks
  const [students, rows, freshness] = await Promise.all([
    loadClubStudents(),
    loadClubWorkoutRows({ from, to: today }),
    buildFreshness(),
  ]);
  const visible = students.filter(isVisible);
  const visibleById = new Map(visible.map((s) => [s.id, s]));
  const visibleIds = new Set(visibleById.keys());

  const weekRows = rows.filter((r) => r.workoutDate >= range.from && r.workoutDate <= range.to);

  const volume = new Map<string, number>();
  const count = new Map<string, number>();
  const activeDaysByStudent = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.isCompleted || !row.isRunning || !visibleIds.has(row.studentId)) {
      continue;
    }
    const days = activeDaysByStudent.get(row.studentId) ?? new Set<string>();
    days.add(row.workoutDate);
    activeDaysByStudent.set(row.studentId, days);
  }
  for (const row of weekRows) {
    if (!row.isCompleted || !row.isRunning || !visibleIds.has(row.studentId)) {
      continue;
    }
    volume.set(row.studentId, (volume.get(row.studentId) ?? 0) + (row.distanceKm ?? 0));
    count.set(row.studentId, (count.get(row.studentId) ?? 0) + 1);
  }

  const nameOf = (id: string) => firstWord(visibleById.get(id)?.name ?? "");
  const monoOf = (id: string) => monogram(visibleById.get(id)?.name ?? "");
  const mkRow = (id: string, value: string): ClubTopRow => ({
    studentId: id,
    displayName: nameOf(id),
    monogram: monoOf(id),
    value,
    isCurrentStudent: id === input.currentStudentId,
  });

  const byVolume = [...volume.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, C.CLUB_EXTENDED_TOP_N)
    .map(([id, km]) => mkRow(id, `${km.toFixed(1).replace(".", ",")} км`));

  const byCount = [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, C.CLUB_EXTENDED_TOP_N)
    .map(([id, n]) => mkRow(id, `${n} трен.`));

  const performers = buildWeekPerformers(weekRows, visibleById).filter((p) => !p.noPlan);
  const byCompletion = performers
    .slice(0, C.CLUB_EXTENDED_TOP_N)
    .map((p) => mkRow(p.studentId, `${Math.round(p.completionPct * 100)}%`));

  const streaks = [...activeDaysByStudent.entries()]
    .map(([id, days]) => [id, computeStreakDays(days, today)] as const)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, C.CLUB_EXTENDED_TOP_N)
    .map(([id, s]) => mkRow(id, `${s} дн`));

  return {
    weekLabel: weekLabel(range),
    byVolume,
    byCount,
    byCompletion,
    byStreak: streaks,
    freshness,
  };
}

export async function getClubPublicProfile(input: {
  currentStudentId: string;
  targetStudentId: string;
}): Promise<ClubPublicProfileView> {
  const today = clubTodayIso();
  const from = addDaysIso(today, -C.CLUB_RECORDS_WINDOW_DAYS);
  const week = currentWeekRange();
  const month = currentMonthRange();
  const [students, rows] = await Promise.all([
    loadClubStudents(),
    loadClubWorkoutRows({ from, to: today }),
  ]);
  const target = students.find((s) => s.id === input.targetStudentId);
  const isSelf = input.targetStudentId === input.currentStudentId;
  const canSee = Boolean(target) && (isSelf || (target ? isVisible(target) : false));

  const name = target?.name ?? "";
  if (!canSee) {
    return {
      studentId: input.targetStudentId,
      displayName: firstWord(name || "Участник клуба"),
      monogram: monogram(name || "•"),
      visible: false,
      weekKm: 0,
      monthKm: 0,
      streakDays: 0,
      records: [],
      recentFeed: [],
    };
  }

  const ownRunning = rows.filter((r) => r.studentId === input.targetStudentId && r.isCompleted && r.isRunning);
  let weekKm = 0;
  let monthKm = 0;
  const activeDays = new Set<string>();
  for (const row of ownRunning) {
    const km = row.distanceKm ?? 0;
    if (row.workoutDate >= week.from && row.workoutDate <= week.to) weekKm += km;
    if (row.workoutDate >= month.from && row.workoutDate <= month.to) monthKm += km;
    activeDays.add(row.workoutDate);
  }
  const records = await studentRecordsFromRows(ownRunning, input.targetStudentId);

  const recentCompleted = rows
    .filter((r) => r.studentId === input.targetStudentId && r.isCompleted && r.family !== "day_off")
    .sort((a, b) => (a.workoutDate < b.workoutDate ? 1 : a.workoutDate > b.workoutDate ? -1 : 0))
    .slice(0, 8);
  const recentFeed: ClubFeedItem[] = recentCompleted.map((row) => {
    const label = typeLabel(row.family);
    return {
      id: row.id,
      studentId: row.studentId,
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
      reactionsEnabled: C.isReactionsEnabled(),
      reactions: { like: 0, fire: 0 },
      mine: { like: false, fire: false },
    };
  });

  return {
    studentId: input.targetStudentId,
    displayName: firstWord(name),
    monogram: monogram(name),
    visible: true,
    weekKm: Number(weekKm.toFixed(1)),
    monthKm: Number(monthKm.toFixed(1)),
    streakDays: computeStreakDays(activeDays, today),
    records,
    recentFeed,
  };
}

const DISTANCE_METERS: Record<"5k" | "10k" | "21k" | "42k", number> = {
  "5k": 5000,
  "10k": 10000,
  "21k": 21097,
  "42k": 42195,
};

/**
 * Result prediction (Block 7.3). ONLY when the student has a declared/approved
 * upcoming race — predicts a RANGE (never one number) for that race's distance,
 * via Riegel from the athlete's own best record. No false precision.
 */
export async function getClubPrediction(input: { currentStudentId: string }): Promise<ClubPrediction> {
  const none = (reason: string): ClubPrediction => ({
    available: false,
    reason,
    raceName: null,
    distanceLabel: null,
    low: null,
    high: null,
    recomputedLabel: null,
    basedOn: null,
  });

  const today = clubTodayIso();
  const supabase = createSupabaseServerClient();
  const { data: raceRow } = await supabase
    .from("club_races")
    .select("name, race_date, distance_meters, distance_label")
    .eq("student_id", input.currentStudentId)
    .in("status", ["declared", "approved"])
    .gte("race_date", today)
    .order("race_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!raceRow) {
    return none("Прогноз появится, когда объявишь предстоящий старт.");
  }
  const race = raceRow as { name: string; distance_meters: number | null; distance_label: string | null };
  const targetM = race.distance_meters && race.distance_meters > 0 ? race.distance_meters : null;
  if (!targetM) {
    return none("У старта не указана дистанция — прогноз недоступен.");
  }

  const from = addDaysIso(today, -C.CLUB_RECORDS_WINDOW_DAYS);
  const rows = await loadClubWorkoutRows({ from, to: today });
  const own = rows.filter((r) => r.studentId === input.currentStudentId && r.isCompleted && r.isRunning);
  const allRecords = await studentRecordsFromRows(own, input.currentStudentId);
  // E-Predictor anchors on RACES only — a training-run segment corrupts the anchor.
  const records = allRecords.filter((r) => r.recordType === "race");
  if (records.length === 0) {
    return none("Прогноз строится по результатам гонок — их пока нет в данных. Заяви старт или дождись синка забега.");
  }

  // Pick the record whose distance is closest (log-ratio) to the target — most reliable base.
  let chosen = records[0];
  let bestGap = Infinity;
  for (const r of records) {
    const m = DISTANCE_METERS[r.distanceKey];
    const gap = Math.abs(Math.log(m / targetM));
    if (gap < bestGap) {
      bestGap = gap;
      chosen = r;
    }
  }
  const baseM = DISTANCE_METERS[chosen.distanceKey];
  // Riegel: T2 = T1 * (D2/D1)^1.06
  const pred = chosen.durationSeconds * Math.pow(targetM / baseM, 1.06);
  const low = Math.round(pred * 0.98);
  const high = Math.round(pred * 1.05);

  return {
    available: true,
    reason: "",
    raceName: race.name,
    distanceLabel: race.distance_label ?? `${(targetM / 1000).toFixed(1)} км`,
    low,
    high,
    recomputedLabel: formatRuDate(today),
    basedOn: `твой результат на ${chosen.distanceLabel}`,
  };
}

/**
 * Race dates per student from club_races (any non-rejected declared/approved race).
 * A reconstructed record whose date matches one of these is a RACE. Empty until the
 * club_races table has rows — which, per the root-cause finding, is exactly why
 * every current record is a training_split. Inert (empty) if the table is absent.
 */
/** Which source declared a given (student, date) a race. Priority high→low. */
export type RaceDateSource = "race_events" | "club_races";

/**
 * Race dates per student WITH their source (Phase 1.5). Two sources:
 *   - trainingpeaks_race_events — the TP calendar scan (133 real races). PRIORITY.
 *   - club_races                — student-declared starts in the mini app.
 * A date present in BOTH is a race_events race (higher priority) — this is the
 * dedup: one date → one source label → one race record (the workout that day gives
 * the time; race_events.distance_km is unreliable and intentionally unused).
 * Coach_confirmed overrides are handled separately (loadCoachRecords), above both.
 */
export async function loadRaceDatesWithSource(): Promise<Map<string, Map<string, RaceDateSource>>> {
  const out = new Map<string, Map<string, RaceDateSource>>();
  const supabase = createSupabaseServerClient();

  const put = (studentId: string, dateIso: string, source: RaceDateSource): void => {
    if (!studentId || !dateIso) return;
    const perStudent = out.get(studentId) ?? new Map<string, RaceDateSource>();
    const existing = perStudent.get(dateIso);
    // race_events wins over club_races; never downgrade.
    if (existing === "race_events") return;
    perStudent.set(dateIso, source);
    out.set(studentId, perStudent);
  };

  // club_races (lower priority) first, race_events second so it overrides.
  try {
    const { data } = await supabase
      .from("club_races")
      .select("student_id, race_date, status")
      .neq("status", "rejected");
    for (const row of (data as Array<{ student_id: string; race_date: string }> | null) ?? []) {
      put(row.student_id, (row.race_date ?? "").slice(0, 10), "club_races");
    }
  } catch {
    /* table absent → skip */
  }

  try {
    const rows = await fetchAllRows<{ student_id: string; event_date: string }>(
      (from, to) =>
        withSupabaseNetworkRetry(() =>
          supabase
            .from("trainingpeaks_race_events")
            .select("student_id, event_date")
            .order("id", { ascending: true })
            .range(from, to)
        ),
      { label: "club:race_events" }
    );
    for (const r of rows) {
      put(r.student_id, (r.event_date ?? "").slice(0, 10), "race_events");
    }
  } catch {
    /* table absent → skip */
  }

  return out;
}

/**
 * Race dates per student (union of all sources). Backs classifyRecordType, which
 * only needs "is this date a race?". Built from loadRaceDatesWithSource.
 */
export async function loadRaceDatesByStudent(): Promise<Map<string, Set<string>>> {
  const withSource = await loadRaceDatesWithSource();
  const out = new Map<string, Set<string>>();
  for (const [studentId, perStudent] of withSource) {
    out.set(studentId, new Set(perStudent.keys()));
  }
  return out;
}

export type CoachRecord = {
  durationSeconds: number;
  paceSecPerKm: number | null;
  recordDate: string | null;
  raceName: string | null;
  trust: "verified" | "preliminary" | "hidden";
  source: string;
};

/**
 * Coach-entered / coach-hidden results from club_records (source=coach_confirmed).
 * These OVERRIDE reconstruction: a verified coach row is a real race; a hidden row
 * suppresses that distance. Keyed `${studentId}|${distanceKey}`. Inert if the table
 * is absent. Feeds the club records tab, tops, and the E-Predictor anchor.
 */
export async function loadCoachRecords(): Promise<Map<string, CoachRecord>> {
  const out = new Map<string, CoachRecord>();
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("club_records")
      .select("student_id, distance_key, duration_seconds, pace_sec_per_km, record_date, race_name, trust, source")
      .eq("source", "coach_confirmed");
    if (error || !data) {
      return out;
    }
    for (const r of data as Array<Record<string, unknown>>) {
      out.set(`${r.student_id as string}|${r.distance_key as string}`, {
        durationSeconds: Number(r.duration_seconds ?? 0),
        paceSecPerKm: r.pace_sec_per_km != null ? Number(r.pace_sec_per_km) : null,
        recordDate: (r.record_date as string | null) ?? null,
        raceName: (r.race_name as string | null) ?? null,
        trust: (r.trust as CoachRecord["trust"]) ?? "verified",
        source: (r.source as string) ?? "coach_confirmed",
      });
    }
  } catch {
    /* table/columns absent → no coach overrides */
  }
  return out;
}

/** race = record date is a declared race date (or coach-confirmed, future); else training_split. */
export function classifyRecordType(
  studentId: string,
  dateIso: string,
  raceDatesByStudent: Map<string, Set<string>>
): ClubRecordType {
  return raceDatesByStudent.get(studentId)?.has(dateIso) ? "race" : "training_split";
}

// ---------------------------------------------------------------------------
// Materialized records (Phase 1.1) — precompute reconstruction into
// club_record_snapshots so the tab reads ready rows instead of loading ~20k
// workouts + all laps on every open. Reuses the SAME pure logic as the live path
// (buildRecordInputs → reconstructRecords → splitByType); only I/O differs.
// ---------------------------------------------------------------------------

type SnapshotSlot = "best" | "best_verified";

/** One materialized snapshot row (db shape is snake_case; see migration). */
type SnapshotDbRow = {
  student_id: string;
  distance_key: string;
  record_type: ClubRecordType;
  slot: SnapshotSlot;
  duration_seconds: number;
  distance_km: number | null;
  pace_sec_per_km: number | null;
  record_date: string | null;
  trust: "verified" | "preliminary";
  calc_method: RecordCalcMethod;
  source: string;
  source_workout_cache_id: string | null;
};

function evaluatedToSnapshot(
  studentId: string,
  distanceKey: RecordDistanceKey,
  recordType: ClubRecordType,
  slot: SnapshotSlot,
  ev: EvaluatedRecord,
  /** Provenance override for race records (race_events / club_races). training keeps ev.source. */
  sourceOverride?: RecordSource
): SnapshotDbRow {
  const cand = ev.candidate;
  return {
    student_id: studentId,
    distance_key: distanceKey,
    record_type: recordType,
    slot,
    duration_seconds: Math.round(cand.durationSeconds),
    distance_km: cand.distanceKm,
    pace_sec_per_km: paceSecPerKm(cand.distanceKm, cand.durationSeconds),
    record_date: cand.date || null,
    trust: ev.trust === "verified" ? "verified" : "preliminary",
    calc_method: ev.calcMethod,
    source: sourceOverride ?? ev.source,
    source_workout_cache_id: cand.workoutId || null,
  };
}

// --- A1 meaningfulness filter + A3 TP-peaks (applied at MATERIALIZE, not read) ---

/**
 * A1 — athlete baseline pace (sec/km) = median whole-workout pace over their
 * completed runs (≥ min distance). null → no trustworthy baseline → splits suppressed.
 */
function athleteBaselinePace(rows: ClubWorkoutRow[], studentId: string): number | null {
  const paces: number[] = [];
  for (const r of rows) {
    if (r.studentId !== studentId || !r.isCompleted || !r.isRunning) continue;
    const km = r.distanceKm ?? 0;
    const sec = r.durationSeconds ?? 0;
    if (km < C.CLUB_RECORD_BASELINE_MIN_KM || sec <= 0) continue;
    paces.push(sec / km);
  }
  return baselinePaceSecPerKm(paces, {
    minRuns: C.CLUB_RECORD_BASELINE_MIN_RUNS,
    floorSecPerKm: C.CLUB_RECORD_BASELINE_PACE_FLOOR_SEC_PER_KM,
    ceilingSecPerKm: C.CLUB_RECORD_PACE_CEILING_SEC_PER_KM,
  });
}

/** A1 — does a lap-based training split clear the meaningfulness bar? Filter off => passes. */
function trainingSplitPasses(training: EvaluatedRecord | null, baseline: number | null): boolean {
  if (!training) return false;
  if (!C.isMeaningfulSplitFilterEnabled()) return true;
  const pace = paceSecPerKm(training.candidate.distanceKm, training.candidate.durationSeconds);
  return isSplitMeaningful(pace, baseline, C.CLUB_RECORD_MEANINGFUL_SPLIT_MARGIN);
}

export type TpPeakBest = {
  durationSeconds: number;
  speedMps: number;
  workoutDate: string | null;
};

/**
 * A3 — best TrainingPeaks device peak per `${studentId}|${distanceKey}` from
 * club_tp_peaks. Inert (empty) unless CLUB_RECORDS_TP_PEAKS is on AND the table is
 * backfilled. Lap heuristic stays the fallback.
 */
export async function loadTpPeaksBest(): Promise<Map<string, TpPeakBest>> {
  const out = new Map<string, TpPeakBest>();
  if (!C.isTpPeaksEnabled()) {
    return out;
  }
  try {
    const supabase = createSupabaseServerClient();
    const rows = await fetchAllRows<Record<string, unknown>>(
      (fromRow, toRow) =>
        withSupabaseNetworkRetry(() =>
          supabase
            .from("club_tp_peaks")
            .select("student_id, distance_key, best_speed_mps, duration_seconds, workout_date")
            .order("id", { ascending: true })
            .range(fromRow, toRow)
        ),
      { label: "club:tp_peaks" }
    );
    for (const r of rows) {
      out.set(`${r.student_id as string}|${r.distance_key as string}`, {
        durationSeconds: Number(r.duration_seconds ?? 0),
        speedMps: Number(r.best_speed_mps ?? 0),
        workoutDate: (r.workout_date as string | null) ?? null,
      });
    }
  } catch {
    /* table absent → no TP peaks */
  }
  return out;
}

/**
 * Build the training-split snapshot row for a (student, distance), applying A3 then
 * A1. Preference: a TP device peak (A3) that is plausible, meaningful, and at least
 * as fast as the lap split wins (cleaner, no pause noise); else the lap split IF it
 * clears the A1 meaningfulness bar; else null (→ "нет данных"). All at materialize time.
 */
function buildTrainingSnapshotRow(
  studentId: string,
  target: (typeof C.CLUB_RECORD_DISTANCES)[number],
  training: EvaluatedRecord | null,
  baseline: number | null,
  tpPeak: TpPeakBest | undefined
): SnapshotDbRow | null {
  const filterOn = C.isMeaningfulSplitFilterEnabled();
  // A3: TP peak, if enabled + plausible + meaningful.
  if (tpPeak && tpPeak.durationSeconds > 0 && tpPeakPlausible(target.key, target.km, tpPeak.durationSeconds)) {
    const peakPace = paceSecPerKm(target.km, tpPeak.durationSeconds);
    const peakMeaningful = !filterOn || isSplitMeaningful(peakPace, baseline, C.CLUB_RECORD_MEANINGFUL_SPLIT_MARGIN);
    const lapDur = training?.candidate.durationSeconds ?? Infinity;
    if (peakMeaningful && tpPeak.durationSeconds <= lapDur) {
      return {
        student_id: studentId,
        distance_key: target.key,
        record_type: "training_split",
        slot: "best",
        duration_seconds: Math.round(tpPeak.durationSeconds),
        distance_km: target.km,
        pace_sec_per_km: peakPace,
        record_date: tpPeak.workoutDate || null,
        trust: "verified", // device-computed peak: clean by construction
        calc_method: "best_split",
        source: "reconstructed",
        source_workout_cache_id: null,
      };
    }
  }
  // A1: lap split only if meaningful.
  if (training && trainingSplitPasses(training, baseline)) {
    return evaluatedToSnapshot(studentId, target.key, "training_split", "best", training);
  }
  return null;
}

export type MaterializeResult = {
  studentsProcessed: number;
  rowsWritten: number;
  dryRun: boolean;
};

/**
 * Students whose workouts changed since `sinceIso` — summary (workout_cache) OR
 * FIT laps (workout_laps). Both matter: FIT arrives after summary and only the
 * laps table moves, so a cache-only signal would miss best-split trust upgrades.
 * This is the incremental recompute set — decoupled from any scan's internals.
 */
export async function loadStudentsTouchedSince(sinceIso: string): Promise<string[]> {
  const supabase = createSupabaseServerClient();
  const ids = new Set<string>();
  for (const table of ["trainingpeaks_workout_cache", "trainingpeaks_workout_laps"] as const) {
    const rows = await fetchAllRows<{ student_id: string | null }>(
      (from, to) =>
        withSupabaseNetworkRetry(() =>
          supabase
            .from(table)
            .select("student_id")
            .gt("updated_at", sinceIso)
            .order("student_id", { ascending: true })
            .range(from, to)
        ),
      { label: `club:touched:${table}` }
    );
    for (const r of rows) {
      if (r.student_id) ids.add(r.student_id);
    }
  }
  return [...ids];
}

/**
 * Recompute reconstructed records into club_record_snapshots. Scoped, incremental
 * DELETE+INSERT per affected student. `studentIds` null/empty => whole club.
 * Does NOT touch club_records (coach overrides). Idempotent.
 */
export async function materializeClubRecords(opts?: {
  studentIds?: string[] | null;
  dryRun?: boolean;
}): Promise<MaterializeResult> {
  const dryRun = opts?.dryRun ?? false;
  const today = clubTodayIso();
  const from = addDaysIso(today, -C.CLUB_RECORDS_WINDOW_DAYS);

  const students = await loadClubStudents();
  const visible = students.filter(isVisible);
  const visibleIds = new Set(visible.map((s) => s.id));

  const explicit = opts?.studentIds && opts.studentIds.length > 0;
  const targetIds = explicit
    ? opts!.studentIds!.filter((id) => visibleIds.has(id))
    : visible.map((s) => s.id);
  if (targetIds.length === 0) {
    return { studentsProcessed: 0, rowsWritten: 0, dryRun };
  }

  // Incremental read restricts to the target students; full recompute reads the club.
  const rows = await loadClubWorkoutRows({
    from,
    to: today,
    studentIds: explicit ? targetIds : undefined,
  });
  const visibleRows = rows.filter((r) => visibleIds.has(r.studentId));
  const { candidates, quality } = await buildRecordInputs(visibleRows, C.isBestSplitEnabled());
  const byStudent = reconstructRecords(candidates, quality);
  const raceDatesWithSource = await loadRaceDatesWithSource();
  const raceDates = new Map(
    [...raceDatesWithSource].map(([studentId, perStudent]) => [studentId, new Set(perStudent.keys())])
  );
  // Provenance for a race record: which source declared that date (race_events > club_races).
  const raceSourceFor = (studentId: string, dateIso: string): RecordSource =>
    raceDatesWithSource.get(studentId)?.get(dateIso) ?? "reconstructed";

  // A3 TP peaks (inert unless flag on + table backfilled). Loaded ONCE per recompute.
  const tpPeaks = await loadTpPeaksBest();

  const snapshotRows: SnapshotDbRow[] = [];
  const targetSet = new Set(targetIds);
  for (const studentId of targetIds) {
    const perDist = byStudent.get(studentId);
    // A1 baseline for this athlete (median usual pace) — computed here at materialize.
    const baseline = athleteBaselinePace(visibleRows, studentId);
    for (const target of C.CLUB_RECORD_DISTANCES) {
      const evaluated = perDist?.get(target.key)?.evaluated ?? [];
      const { race, training, bestVerifiedRace } = splitByType(evaluated, studentId, raceDates);
      // Races (race_events / coach_confirmed / declared) are NOT subject to A1/A3.
      if (race) {
        snapshotRows.push(
          evaluatedToSnapshot(studentId, target.key, "race", "best", race, raceSourceFor(studentId, race.candidate.date))
        );
      }
      if (bestVerifiedRace) {
        snapshotRows.push(
          evaluatedToSnapshot(studentId, target.key, "race", "best_verified", bestVerifiedRace, raceSourceFor(studentId, bestVerifiedRace.candidate.date))
        );
      }
      // Training split: A3 (TP peak) preferred, else A1-filtered lap split, else nothing.
      const trainingRow = buildTrainingSnapshotRow(studentId, target, training, baseline, tpPeaks.get(`${studentId}|${target.key}`));
      if (trainingRow) {
        snapshotRows.push(trainingRow);
      }
    }
  }

  if (dryRun) {
    return { studentsProcessed: targetIds.length, rowsWritten: snapshotRows.length, dryRun: true };
  }

  const supabase = createSupabaseServerClient();
  // Scoped replace: wipe THIS student set's snapshots, then insert fresh. Never
  // touches students outside targetSet, never touches club_records.
  for (const idChunk of chunkIds([...targetSet], 100)) {
    const { error } = await supabase.from("club_record_snapshots").delete().in("student_id", idChunk);
    if (error) {
      throw new Error(`materializeClubRecords: delete failed: ${error.message}`);
    }
  }
  for (const batch of chunkIds(snapshotRows, 500)) {
    const { error } = await supabase.from("club_record_snapshots").insert(batch);
    if (error) {
      throw new Error(`materializeClubRecords: insert failed: ${error.message}`);
    }
  }
  return { studentsProcessed: targetIds.length, rowsWritten: snapshotRows.length, dryRun: false };
}

export type SnapshotEntry = {
  durationSeconds: number;
  distanceKm: number | null;
  paceSecPerKm: number | null;
  date: string | null;
  trust: "verified" | "preliminary";
  calcMethod: RecordCalcMethod;
  source: string;
};

export type StudentSnapshot = Map<
  RecordDistanceKey,
  { race: SnapshotEntry | null; raceVerified: SnapshotEntry | null; training: SnapshotEntry | null }
>;

/** Read materialized snapshots: studentId -> distanceKey -> {race,raceVerified,training}. */
export async function loadRecordSnapshots(): Promise<Map<string, StudentSnapshot>> {
  const out = new Map<string, StudentSnapshot>();
  const supabase = createSupabaseServerClient();
  let rows: SnapshotDbRow[];
  try {
    rows = await fetchAllRows<SnapshotDbRow>(
      (from, to) =>
        withSupabaseNetworkRetry(() =>
          supabase
            .from("club_record_snapshots")
            .select(
              "student_id, distance_key, record_type, slot, duration_seconds, distance_km, pace_sec_per_km, record_date, trust, calc_method, source, source_workout_cache_id"
            )
            .order("id", { ascending: true })
            .range(from, to)
        ),
      { label: "club:record_snapshots" }
    );
  } catch {
    return out; // table absent (pre-migration) → empty; caller renders nothing
  }
  for (const r of rows) {
    const distanceKey = r.distance_key as RecordDistanceKey;
    const perStudent = out.get(r.student_id) ?? (new Map() as StudentSnapshot);
    const slot = perStudent.get(distanceKey) ?? { race: null, raceVerified: null, training: null };
    const entry: SnapshotEntry = {
      durationSeconds: Number(r.duration_seconds ?? 0),
      distanceKm: r.distance_km != null ? Number(r.distance_km) : null,
      paceSecPerKm: r.pace_sec_per_km != null ? Number(r.pace_sec_per_km) : null,
      date: (r.record_date as string | null) ?? null,
      trust: r.trust,
      calcMethod: r.calc_method,
      source: r.source,
    };
    if (r.record_type === "race" && r.slot === "best") slot.race = entry;
    else if (r.record_type === "race" && r.slot === "best_verified") slot.raceVerified = entry;
    else if (r.record_type === "training_split" && r.slot === "best") slot.training = entry;
    perStudent.set(distanceKey, slot);
    out.set(r.student_id, perStudent);
  }
  return out;
}

function snapshotToEntry(
  distanceKey: RecordDistanceKey,
  entry: SnapshotEntry,
  recordType: ClubRecordType
): ClubRecordEntry {
  return {
    distanceKey,
    distanceLabel: LABEL_BY_KEY.get(distanceKey) ?? distanceKey,
    durationSeconds: entry.durationSeconds,
    paceSecPerKm: entry.paceSecPerKm,
    date: entry.date ?? "",
    dateLabel: entry.date ? formatRuDate(entry.date) : "",
    trust: entry.trust,
    source: entry.source as ClubRecordEntry["source"],
    calcMethod: entry.calcMethod,
    recordType,
  };
}

/** Exposed for the validation script (Stage C4): raw per-candidate evaluation. */
export async function evaluateAllRecordsForValidation(opts?: { useBestSplit?: boolean }): Promise<{
  students: ClubStudent[];
  byStudent: Map<string, Map<RecordDistanceKey, DistanceResult>>;
  quality: Map<string, WorkoutQuality>;
  candidateCount: number;
  runningWorkoutCount: number;
  rows: ClubWorkoutRow[];
  raceDatesByStudent: Map<string, Set<string>>;
}> {
  const today = clubTodayIso();
  const from = addDaysIso(today, -C.CLUB_RECORDS_WINDOW_DAYS);
  const [students, rows] = await Promise.all([loadClubStudents(), loadClubWorkoutRows({ from, to: today })]);
  const visibleById = new Map(students.filter(isVisible).map((s) => [s.id, s]));
  const visibleRows = rows.filter((r) => visibleById.has(r.studentId));
  const runningWorkoutCount = visibleRows.filter((r) => r.isCompleted && r.isRunning).length;
  const { candidates, quality } = await buildRecordInputs(
    visibleRows,
    opts?.useBestSplit ?? C.isBestSplitEnabled()
  );
  const byStudent = reconstructRecords(candidates, quality);
  return {
    students: students.filter(isVisible),
    byStudent,
    quality,
    candidateCount: candidates.length,
    runningWorkoutCount,
    rows: visibleRows,
    raceDatesByStudent: await loadRaceDatesByStudent(),
  };
}

export { formatDuration, formatRuDate };
export type { ClubStudent };
