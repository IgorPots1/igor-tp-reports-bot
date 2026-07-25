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
import {
  evaluateCandidate,
  referenceVdotForAthlete,
  type EvaluatedRecord,
  type RecordCandidate,
  type RecordDistanceKey,
  type WorkoutQuality,
} from "./records";
import type {
  ClubAchievement,
  ClubChallengeView,
  ClubExtendedTopsView,
  ClubFeedItem,
  ClubFeedView,
  ClubFreshness,
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
 * Builds a quality index for a set of workout_cache_ids from laps + derived
 * metrics. Powers all three record trust levels + plausibility checks. Missing
 * data => a conservative record (hasLaps:false) which caps the record at
 * `preliminary`.
 */
async function loadWorkoutQualityIndex(ids: string[]): Promise<Map<string, WorkoutQuality>> {
  const index = new Map<string, WorkoutQuality>();
  if (ids.length === 0) {
    return index;
  }
  const supabase = createSupabaseServerClient();
  const [lapsRes, derivedRes] = await Promise.all([
    withSupabaseNetworkRetry(() =>
      supabase
        .from("trainingpeaks_workout_laps")
        .select("workout_cache_id, pace_sec_per_km, is_work, timer_time_s, elapsed_time_s, distance_m")
        .in("workout_cache_id", ids)
    ),
    withSupabaseNetworkRetry(() =>
      supabase
        .from("trainingpeaks_workout_derived_metrics")
        .select("workout_cache_id, reps_detected_count, rep_detection_method, has_fit")
        .in("workout_cache_id", ids)
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
  if (!lapsRes.error) {
    for (const row of (lapsRes.data as Array<{
      workout_cache_id: string;
      pace_sec_per_km: number | null;
      is_work: boolean | null;
      timer_time_s: number | null;
      elapsed_time_s: number | null;
      distance_m: number | null;
    }> | null) ?? []) {
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

  const derivedByWorkout = new Map<string, { isInterval: boolean; hasFit: boolean }>();
  if (!derivedRes.error) {
    for (const row of (derivedRes.data as Array<{
      workout_cache_id: string;
      reps_detected_count: number | null;
      rep_detection_method: string | null;
      has_fit: boolean | null;
    }> | null) ?? []) {
      const reps = toFiniteNumber(row.reps_detected_count) ?? 0;
      const method = row.rep_detection_method ?? "none";
      const isInterval = reps >= 2 && (method === "structure" || method === "lap_trigger");
      derivedByWorkout.set(row.workout_cache_id, { isInterval, hasFit: row.has_fit === true });
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

function collectCandidates(rows: ClubWorkoutRow[]): RecordCandidate[] {
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
    for (const target of C.CLUB_RECORD_DISTANCES) {
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
        });
      }
    }
  }
  return out;
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

function toRecordEntry(ev: EvaluatedRecord): ClubRecordEntry {
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
    const prevKm = clubKmInRange(rows, visibleIds, prevFrom, prevTo);
    if (prevKm > 0) {
      const raw = prevKm * C.CLUB_CHALLENGE_AUTO_FACTOR;
      goalKm = Math.ceil(raw / C.CLUB_CHALLENGE_AUTO_ROUND_STEP) * C.CLUB_CHALLENGE_AUTO_ROUND_STEP;
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
  const today = clubTodayIso();
  const from = addDaysIso(today, -C.CLUB_RECORDS_WINDOW_DAYS);
  const [students, rows, freshness] = await Promise.all([
    loadClubStudents(),
    loadClubWorkoutRows({ from, to: today }),
    buildFreshness(),
  ]);
  const visibleById = new Map(students.filter(isVisible).map((s) => [s.id, s]));
  const visibleRows = rows.filter((r) => visibleById.has(r.studentId));

  const candidates = collectCandidates(visibleRows);
  const quality = await loadWorkoutQualityIndex(candidates.map((c) => c.workoutId));
  const byStudent = reconstructRecords(candidates, quality);

  const personal: ClubRecordEntry[] = [];
  const clubTops: ClubRecordsView["clubTops"] = [];
  const ownResults = byStudent.get(input.currentStudentId);

  for (const target of C.CLUB_RECORD_DISTANCES) {
    const ownBest = ownResults?.get(target.key)?.best;
    if (ownBest) {
      personal.push(toRecordEntry(ownBest));
    }

    // Club top: each student's VERIFIED best only; preliminary/hidden never leak in.
    const verifiedBests: EvaluatedRecord[] = [];
    for (const perDist of byStudent.values()) {
      const bv = perDist.get(target.key)?.bestVerified;
      if (bv) {
        verifiedBests.push(bv);
      }
    }
    verifiedBests.sort((a, b) => a.candidate.durationSeconds - b.candidate.durationSeconds);
    const topRows: ClubRecordsClubTopRow[] = verifiedBests
      .slice(0, C.CLUB_RECORDS_TOP_N)
      .map((ev, index) => ({
        distanceKey: target.key,
        rank: index + 1,
        studentId: ev.candidate.studentId,
        displayName: firstWord(ev.candidate.studentName),
        monogram: monogram(ev.candidate.studentName),
        durationSeconds: ev.candidate.durationSeconds,
        paceSecPerKm: paceSecPerKm(ev.candidate.distanceKm, ev.candidate.durationSeconds),
        isCurrentStudent: ev.candidate.studentId === input.currentStudentId,
        trust: "verified",
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
  const candidates = collectCandidates(own);
  const quality = await loadWorkoutQualityIndex(candidates.map((c) => c.workoutId));
  const byStudent = reconstructRecords(candidates, quality);
  const perDist = byStudent.get(studentId);
  const out: ClubRecordEntry[] = [];
  for (const target of C.CLUB_RECORD_DISTANCES) {
    const best = perDist?.get(target.key)?.best;
    if (best) {
      out.push(toRecordEntry(best));
    }
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

/** Exposed for the validation script (Stage C4): raw per-candidate evaluation. */
export async function evaluateAllRecordsForValidation(): Promise<{
  students: ClubStudent[];
  byStudent: Map<string, Map<RecordDistanceKey, DistanceResult>>;
  quality: Map<string, WorkoutQuality>;
  candidateCount: number;
  runningWorkoutCount: number;
}> {
  const today = clubTodayIso();
  const from = addDaysIso(today, -C.CLUB_RECORDS_WINDOW_DAYS);
  const [students, rows] = await Promise.all([loadClubStudents(), loadClubWorkoutRows({ from, to: today })]);
  const visibleById = new Map(students.filter(isVisible).map((s) => [s.id, s]));
  const visibleRows = rows.filter((r) => visibleById.has(r.studentId));
  const runningWorkoutCount = visibleRows.filter((r) => r.isCompleted && r.isRunning).length;
  const candidates = collectCandidates(visibleRows);
  const quality = await loadWorkoutQualityIndex(candidates.map((c) => c.workoutId));
  const byStudent = reconstructRecords(candidates, quality);
  return {
    students: students.filter(isVisible),
    byStudent,
    quality,
    candidateCount: candidates.length,
    runningWorkoutCount,
  };
}

export { formatDuration, formatRuDate };
export type { ClubStudent };
