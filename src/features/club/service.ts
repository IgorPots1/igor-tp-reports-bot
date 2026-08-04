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
import { logClubDbError } from "./db-errors";
import { getTrainingPeaksWorkoutCacheFreshness } from "@/features/trainingpeaks/repository";
import {
  classifyTrainingPeaksWorkoutActivity,
  type TrainingPeaksWorkoutActivityFamily,
} from "@/features/trainingpeaks/workout-activity-classification";

import * as C from "./constants";
import { CLUB_MARKER_TITLE_SENTINEL } from "./cache-guard";
import { signAvatarPath } from "./avatars";
import { signTrackImagePath } from "./track-maps";
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
  ClubComment,
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
  ClubTrack,
  ClubActivityDay,
  ClubMonthSummary,
  ClubTypeBreakdown,
  ClubVolumePoint,
  ClubWorkoutDetailView,
  ClubWorkoutLap,
  ClubZoneSlice,
} from "./types";

// ---------------------------------------------------------------------------
// Low-level rows
// ---------------------------------------------------------------------------

type ClubStudent = {
  id: string;
  name: string;
  /** Club-facing display name: club_display_name override, else first+last real name. */
  displayName: string;
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
  /** Sort key = coalesce(start_time, workout_date). Non-null; feeds keyset ordering by fact time. */
  feedTs: string;
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
  // club_display_name (migration 20260802000000) is optional; select it defensively
  // so the layer still works before the migration is applied (PostgREST returns the
  // column only when present — we read it with `?? null`).
  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from("trainingpeaks_students")
      .select("id, student_name, club_display_name, is_active, is_service_account, club_visible")
      .order("student_name", { ascending: true })
  );
  if (error) {
    // Column may not exist yet (migration pending) → retry without it, never break.
    const retry = await withSupabaseNetworkRetry(() =>
      supabase
        .from("trainingpeaks_students")
        .select("id, student_name, is_active, is_service_account, club_visible")
        .order("student_name", { ascending: true })
    );
    if (retry.error) {
      throw new Error(`club: failed to load students: ${retry.error.message}`);
    }
    return mapClubStudentRows(retry.data);
  }
  return mapClubStudentRows(data);
}

/**
 * Perf (UI-polish item 6): one student by id with the same club fields as
 * loadClubStudents — so the workout-detail owner + visibility check does not load the
 * whole roster (~113 rows) just to find one row. Tolerant of the display-name column
 * being absent (migration pending) via a retry, like loadClubStudents.
 */
async function loadClubStudentById(id: string): Promise<ClubStudent | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from("trainingpeaks_students")
      .select("id, student_name, club_display_name, is_active, is_service_account, club_visible")
      .eq("id", id)
      .maybeSingle()
  );
  if (error) {
    const retry = await withSupabaseNetworkRetry(() =>
      supabase
        .from("trainingpeaks_students")
        .select("id, student_name, is_active, is_service_account, club_visible")
        .eq("id", id)
        .maybeSingle()
    );
    if (retry.error || !retry.data) return null;
    return mapClubStudentRows([retry.data])[0] ?? null;
  }
  if (!data) return null;
  return mapClubStudentRows([data])[0] ?? null;
}

function mapClubStudentRows(data: unknown): ClubStudent[] {
  return (
    (data as Array<{
      id: string;
      student_name: string;
      club_display_name?: string | null;
      is_active: boolean | null;
      is_service_account: boolean | null;
      club_visible: boolean | null;
    }> | null) ?? []
  ).map((row) => {
    const override = (row.club_display_name ?? "").trim();
    return {
      id: row.id,
      name: row.student_name,
      displayName: override.length > 0 ? override : fullName(row.student_name),
      isActive: row.is_active !== false,
      isServiceAccount: row.is_service_account === true,
      // null-safe: a missing/NULL value defaults to visible (matches column default true).
      clubVisible: row.club_visible !== false,
    };
  });
}

/**
 * Phase 4 — batched read of GPS tracks (simplified polylines) for a set of workouts.
 * Empty unless CLUB_TRACKS_ENABLED. Tolerant of a missing table (feature off / migration
 * not applied) → returns empty so the feed/detail simply render no silhouette.
 */
async function loadTracksForWorkouts(workoutIds: string[]): Promise<Map<string, ClubTrack>> {
  const out = new Map<string, ClubTrack>();
  if (!C.isClubTracksEnabled() || workoutIds.length === 0) {
    return out;
  }
  const supabase = createSupabaseServerClient();
  // Select `city` (maps Phase 4b), but TOLERATE the column not existing yet (migration 20260818
  // not applied): fall back to the pre-maps columns so the silhouette keeps rendering. Without
  // this, deploying the maps code before the migration would break the track read entirely.
  type TrackRowRaw = { workout_cache_id: string; polyline: unknown; bbox: unknown; point_count: number | null; city?: string | null };
  const primary = await supabase
    .from("trainingpeaks_workout_tracks")
    .select("workout_cache_id, polyline, bbox, point_count, city")
    .in("workout_cache_id", workoutIds);
  let rows = (primary.data as TrackRowRaw[] | null) ?? [];
  if (primary.error) {
    const fallback = await supabase
      .from("trainingpeaks_workout_tracks")
      .select("workout_cache_id, polyline, bbox, point_count")
      .in("workout_cache_id", workoutIds);
    if (fallback.error) return out;
    rows = (fallback.data as TrackRowRaw[] | null) ?? [];
  }
  const mapTilesOn = C.isClubMapTilesEnabled();
  for (const row of rows) {
    const polyline = Array.isArray(row.polyline) ? (row.polyline as Array<[number, number]>) : null;
    const bbox = row.bbox as ClubTrack["bbox"] | null;
    if (polyline && polyline.length >= 2 && bbox) {
      out.set(row.workout_cache_id, {
        polyline,
        bbox,
        pointCount: row.point_count ?? polyline.length,
        // Signed, cacheable image path — minted server-side so no Mapbox URL/token reaches the
        // browser. Null when tiles are off → the club keeps showing the silhouette only.
        mapImageUrl: mapTilesOn ? signTrackImagePath(row.workout_cache_id, polyline) : null,
        city: row.city ?? null,
      });
    }
  }
  return out;
}

/**
 * One batched read of per-workout average heart rate from FIT-derived metrics
 * (avg_hr, one row per workout_cache_id). Only trusted HR is returned — a workout
 * whose HR the cleaner flagged as unreliable (hr_trusted=false) is omitted so the
 * feed never shows a bogus pulse. Empty on any error / missing table.
 */
async function loadAvgHrForWorkouts(workoutIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (workoutIds.length === 0) {
    return out;
  }
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_workout_derived_metrics")
    .select("workout_cache_id, avg_hr, hr_trusted")
    .in("workout_cache_id", workoutIds);
  if (error) {
    return out;
  }
  for (const row of (data as Array<{ workout_cache_id: string; avg_hr: number | null; hr_trusted: boolean | null }> | null) ?? []) {
    // hr_trusted null (older rows) is treated as trusted; only an explicit false hides it.
    if (row.avg_hr && row.avg_hr > 0 && row.hr_trusted !== false) {
      out.set(row.workout_cache_id, Math.round(row.avg_hr));
    }
  }
  return out;
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
  // Phase 3.1: a service account participates in the club ONLY when explicitly
  // allowlisted (CLUB_INCLUDE_SERVICE_STUDENT_IDS) — the coach's own row. The
  // is_service_account flag itself stays set for every other surface.
  const serviceOk = !student.isServiceAccount || C.clubIncludedServiceStudentIds().has(student.id);
  const base = student.isActive && serviceOk;
  // Opt-out only takes effect when the privacy feature is enabled; otherwise the
  // club_visible flag is stored-but-ignored and everyone participates by default.
  if (C.isPrivacyEnabled()) {
    return base && student.clubVisible;
  }
  return base;
}

// Lean explicit column list: never pull `source_snapshot` (raw private TP payload)
// or per-workout compliance into the club layer. Shared by the windowed reader and
// the keyset feed loader.
const WORKOUT_CACHE_COLUMNS =
  "id, student_id, student_name, workout_date, title, sport_or_type_code, workout_type_value_id, workout_sub_type_id, is_planned, is_completed, completed_time_raw, completed_distance_raw, start_time";

/** Map one trainingpeaks_workout_cache DB row → the lean ClubWorkoutRow (+ classification). */
function mapWorkoutCacheRow(row: Record<string, unknown>): ClubWorkoutRow {
  const classification = classifyTrainingPeaksWorkoutActivity({
    title: (row.title as string | null) ?? null,
    sportOrTypeCode: (row.sport_or_type_code as string | null) ?? null,
    workoutTypeValueId: (row.workout_type_value_id as number | null) ?? null,
    workoutSubTypeId: (row.workout_sub_type_id as number | null) ?? null,
  });
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
    // feed_ts is selected only by the feed loader; other readers omit it → fall back to workout_date.
    feedTs: (row.feed_ts as string | null) ?? (row.workout_date as string),
    distanceKm: normalizeDistanceKm(row.completed_distance_raw as number | string | null),
    durationSeconds: rawHoursToSeconds(row.completed_time_raw as number | string | null),
    isRunning: classification.isRunning,
    family: classification.family,
  };
}

// --- Feed card enrichment (Stage 2, screen 1) ---------------------------------

/**
 * "07:30" from a workout start_time. TP-API scan stores a NAIVE-LOCAL ISO
 * (raw.startTime, the athlete's local wall-clock, no offset); the FIT path stores UTC
 * (normalizeIsoDateFromUtc → toISOString → trailing "Z"). We show the wall-clock digits
 * for naive-local and explicit-offset strings (both already carry local time), but NEVER
 * for a UTC "Z" value - its local time is unknown without a per-athlete timezone, and a
 * wrong time is worse than none. Timeless / unparseable → null (block not drawn).
 */
export function localStartHm(startTime: string | null): string | null {
  if (!startTime) return null;
  const s = startTime.trim();
  if (/z$/iu.test(s)) return null; // UTC (FIT path): local wall-clock unknown, don't show
  const m = s.match(/^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/u);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return `${m[1]}:${m[2]}`;
}

// Insight rule (documented so it can be tuned): compare a running workout's pace to the
// athlete's OWN recent runs of comparable distance. Cross-distance pace is noisy, so we
// only compare within a distance band and require enough samples before making a claim.
const INSIGHT_MIN_KM = 3; // ignore very short runs (pace is noisy / warm-ups)
const INSIGHT_BAND = 0.4; // comparable = ±40% of this run's distance
const INSIGHT_MIN_SAMPLES = 3; // need at least this many comparable prior runs
const INSIGHT_MIN_FASTER = 0.04; // ≥4% faster than the athlete's usual pace at this distance
const INSIGHT_BASELINE_DAYS = 120; // how far back to build the per-athlete baseline

/**
 * Structured-interval detection: the SAME signal the record reconstruction uses to
 * exclude interval/fartlek sessions (loadWorkoutQualityIndex). It detects lap STRUCTURE
 * (>=2 repeated work reps), NOT day intensity: a continuous tempo (hard) and an easy jog
 * both have 0 reps. Single source of truth so the feed gate can never drift from records.
 */
export function isStructuredInterval(reps: number | null | undefined, method: string | null | undefined): boolean {
  return (reps ?? 0) >= 2 && (method === "structure" || method === "lap_trigger");
}

type PaceSample = { id: string; date: string; km: number; pace: number };

/** Group loaded rows into per-athlete running pace samples (date-ascending, as loaded). */
function buildInsightBaseline(rows: ClubWorkoutRow[]): Map<string, PaceSample[]> {
  const by = new Map<string, PaceSample[]>();
  for (const r of rows) {
    if (!r.isCompleted || !r.isRunning) continue;
    const km = r.distanceKm ?? 0;
    if (km < INSIGHT_MIN_KM) continue;
    const pace = paceSecPerKm(r.distanceKm, r.durationSeconds);
    if (!pace || pace <= 0) continue;
    const arr = by.get(r.studentId) ?? [];
    arr.push({ id: r.id, date: r.workoutDate, km, pace });
    by.set(r.studentId, arr);
  }
  return by;
}

/** "На N% быстрее обычного" when this run beats the athlete's usual pace at this distance. */
function computeFeedInsight(
  item: { id: string; date: string; distanceKm: number | null; paceSecPerKm: number | null; isRunning: boolean },
  baseline: PaceSample[]
): string | null {
  if (!item.isRunning || !item.paceSecPerKm || item.paceSecPerKm <= 0) return null;
  if (!item.distanceKm || item.distanceKm < INSIGHT_MIN_KM) return null;
  const lo = item.distanceKm * (1 - INSIGHT_BAND);
  const hi = item.distanceKm * (1 + INSIGHT_BAND);
  const comparable = baseline
    .filter((s) => s.id !== item.id && s.date <= item.date && s.km >= lo && s.km <= hi)
    .slice(-10); // most recent up to 10 (baseline is date-ascending)
  if (comparable.length < INSIGHT_MIN_SAMPLES) return null;
  const avg = comparable.reduce((a, b) => a + b.pace, 0) / comparable.length;
  if (avg <= 0) return null;
  const faster = (avg - item.paceSecPerKm) / avg; // >0 → this run's pace is smaller = faster
  if (faster < INSIGHT_MIN_FASTER) return null;
  return `На ${Math.round(faster * 100)}% быстрее обычного`;
}

/** Workout ids on the page that are structured interval sessions (same signal records use).
 *  Used to suppress the "faster than usual" insight: an interval session's whole-workout
 *  average is skewed by fast work reps, so "faster than usual" there is misleading. */
async function loadIntervalWorkoutIds(workoutIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (workoutIds.length === 0) return out;
  const supabase = createSupabaseServerClient();
  const rows = await fetchAllInChunks<{ workout_cache_id: string; reps_detected_count: number | null; rep_detection_method: string | null }>(
    workoutIds,
    IN_CHUNK,
    (ids0, fromRow, toRow) =>
      withSupabaseNetworkRetry(() =>
        supabase
          .from("trainingpeaks_workout_derived_metrics")
          .select("workout_cache_id, reps_detected_count, rep_detection_method")
          .in("workout_cache_id", ids0)
          .order("workout_cache_id", { ascending: true })
          .range(fromRow, toRow)
      ),
    { label: "club:feed_intervals" }
  );
  for (const r of rows) {
    if (isStructuredInterval(r.reps_detected_count, r.rep_detection_method)) out.add(r.workout_cache_id);
  }
  return out;
}

// --- Participant profile enrichment (Stage 2, screen 2) -----------------------

/** Earliest cached workout date for a student ("в клубе с …"), UNBOUNDED by the profile
 *  window (the profile only loads the recent window, which can miss the true first date).
 *  Index-aligned: (student_id, workout_date) → ascending limit 1 is a cheap scan. */
async function loadFirstWorkoutDate(studentId: string): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const { data } = await withSupabaseNetworkRetry(() =>
    supabase
      .from("trainingpeaks_workout_cache")
      .select("workout_date")
      .eq("student_id", studentId)
      .order("workout_date", { ascending: true })
      .limit(1)
      .maybeSingle()
  );
  return (data as { workout_date: string } | null)?.workout_date ?? null;
}

/** Sum of per-lap total_ascent_m over a set of workouts (null when no lap ascent at all).
 *  Chunked AND paged: an interval workout can carry >1000 lap rows, so a bare .in() would
 *  truncate silently. */
async function loadAscentForWorkouts(workoutIds: string[]): Promise<number | null> {
  if (workoutIds.length === 0) return null;
  const supabase = createSupabaseServerClient();
  const rows = await fetchAllInChunks<{ total_ascent_m: number | null }>(
    workoutIds,
    IN_CHUNK,
    (ids0, fromRow, toRow) =>
      withSupabaseNetworkRetry(() =>
        supabase
          .from("trainingpeaks_workout_laps")
          .select("total_ascent_m")
          .in("workout_cache_id", ids0)
          .order("workout_cache_id", { ascending: true })
          .order("lap_index", { ascending: true })
          .range(fromRow, toRow)
      ),
    { label: "club:profile_ascent" }
  );
  let sum: number | null = null;
  for (const r of rows) {
    if (r.total_ascent_m != null) sum = (sum ?? 0) + r.total_ascent_m;
  }
  return sum != null ? Math.round(sum) : null;
}

/** Weekday for an ISO date as 0=Mon..6=Sun (matches ClubCalendarDay.weekday). */
function weekdayMon0(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export async function loadClubWorkoutRows(input: {
  from: string;
  to: string;
  /** Incremental recompute: restrict to these students (materialize). Omit = whole club. */
  studentIds?: string[];
}): Promise<ClubWorkoutRow[]> {
  const supabase = createSupabaseServerClient();
  // Paginate: the window can be ~20k rows — a single-shot select truncates at the
  // 1000-row PostgREST cap. Order by (workout_date, id) — index-aligned (Phase 1.3).
  const data = await fetchAllRows<Record<string, unknown>>(
    (fromRow, toRow) => {
      let q = supabase
        .from("trainingpeaks_workout_cache")
        .select(WORKOUT_CACHE_COLUMNS)
        .gte("workout_date", input.from)
        .lte("workout_date", input.to)
        // Phase A: club marker workouts (day_off/preference/note pometki created in TP by
        // Phase 11) return via cache and would pollute completion counting / aggregates /
        // records. Excluded here at the SINGLE club load chokepoint, at the DB, by their
        // title sentinel — so every club consumer (performers, daily/week aggregates,
        // materialize, records) is clean in one place. Races carry no sentinel (real runs).
        .not("title", "ilike", `%${CLUB_MARKER_TITLE_SENTINEL}%`);
      if (input.studentIds && input.studentIds.length > 0) {
        q = q.in("student_id", input.studentIds);
      }
      return withSupabaseNetworkRetry(() =>
        q.order("workout_date", { ascending: true }).order("id", { ascending: true }).range(fromRow, toRow)
      );
    },
    { label: `club:workout_rows ${input.from}..${input.to}` }
  );
  return data.map(mapWorkoutCacheRow);
}

/**
 * Keyset page of COMPLETED workouts for the feed, newest first, filtered + ordered +
 * limited IN POSTGRES. Ordering key is (feed_ts DESC, id DESC) where feed_ts =
 * coalesce(start_time, workout_date) — so within a day workouts sort by FACT start time
 * (an evening run no longer floats above a morning one just by insertion order), and a
 * late-uploaded workout lands at its real time, not at the top. Untimed rows (feed_ts =
 * workout_date, ~0.75%) fall to the bottom of their day. The cursor resumes strictly after
 * (beforeFeedTs, beforeId). is_completed is filtered in SQL; the "running / visible /
 * non-empty" predicate is a JS post-filter on this bounded batch, so the caller over-fetches.
 */
async function loadFeedCandidates(input: {
  from: string;
  to: string;
  beforeFeedTs: string | null;
  beforeId: string | null;
  limit: number;
}): Promise<ClubWorkoutRow[]> {
  const supabase = createSupabaseServerClient();
  // Shared filter (select FIRST, then the SQL predicates). Called with different column lists for the
  // primary (with feed_ts) and the fallback (without), so it can't bake in the select.
  const filtered = (cols: string) =>
    supabase
      .from("trainingpeaks_workout_cache")
      .select(cols)
      .gte("workout_date", input.from)
      .lte("workout_date", input.to)
      .eq("is_completed", true)
      // Phase A defense-in-depth: club markers are planned Other(100), so is_completed=true
      // already excludes them from the feed; still filter the sentinel here so a marker can
      // never surface in the feed even if a future path marks one completed.
      .not("title", "ilike", `%${CLUB_MARKER_TITLE_SENTINEL}%`);

  // PRIMARY: order by fact start time. Keyset on (feed_ts, id), both non-null → no NULL edge cases.
  let q = filtered(`${WORKOUT_CACHE_COLUMNS}, feed_ts`);
  if (input.beforeFeedTs && input.beforeId) {
    q = q.or(`feed_ts.lt.${input.beforeFeedTs},and(feed_ts.eq.${input.beforeFeedTs},id.lt.${input.beforeId})`);
  }
  const primary = await withSupabaseNetworkRetry(() =>
    q.order("feed_ts", { ascending: false }).order("id", { ascending: false }).limit(input.limit)
  );
  // feed_ts is a new generated column absent from the generated Supabase types → cast through unknown.
  if (!primary.error) return ((primary.data as unknown as Record<string, unknown>[] | null) ?? []).map(mapWorkoutCacheRow);

  // FALLBACK (feed_ts column not migrated yet — deploy-before-migrate): old (workout_date, id) order.
  // feed_ts ≡ workout_date here, so the same cursor works via its date prefix; the feed stays alive.
  if (!/feed_ts|column|schema cache|42703|does not exist/iu.test(primary.error.message)) {
    throw new Error(`club: feed candidates failed: ${primary.error.message}`);
  }
  let fq = filtered(WORKOUT_CACHE_COLUMNS);
  const beforeDate = input.beforeFeedTs ? input.beforeFeedTs.slice(0, 10) : null;
  if (beforeDate && input.beforeId) {
    fq = fq.or(`workout_date.lt.${beforeDate},and(workout_date.eq.${beforeDate},id.lt.${input.beforeId})`);
  }
  const fb = await withSupabaseNetworkRetry(() =>
    fq.order("workout_date", { ascending: false }).order("id", { ascending: false }).limit(input.limit)
  );
  if (fb.error) throw new Error(`club: feed candidates failed: ${fb.error.message}`);
  return ((fb.data as unknown as Record<string, unknown>[] | null) ?? []).map(mapWorkoutCacheRow);
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
      const isInterval = isStructuredInterval(toFiniteNumber(row.reps_detected_count), row.rep_detection_method);
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

/**
 * Club display name: first + last (Phase 3.2). Coach OS stores names as
 * "Имя Фамилия" (occasionally with a patronymic/extra word). The club shows the
 * first TWO words — enough to identify by name+surname without leaking a full
 * three-part legal name. Falls back to "Участник клуба" when empty.
 */
function fullName(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) {
    return "Участник клуба";
  }
  const words = trimmed.split(/\s+/u).filter(Boolean);
  return words.slice(0, 2).join(" ") || trimmed;
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

/** Phase 3.6: collapse raw families into a few big buckets for the profile breakdown. */
function typeBucket(family: TrainingPeaksWorkoutActivityFamily): { key: string; label: string } {
  switch (family) {
    case "run":
      return { key: "run", label: "Бег" };
    case "strength":
      return { key: "strength", label: "Силовая" };
    case "bike":
      return { key: "bike", label: "Вело" };
    case "swim":
      return { key: "swim", label: "Плавание" };
    default:
      return { key: "other", label: "Другое" };
  }
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

/** Workout title for the feed card / detail header: whitespace-normalised, capped. */
function cleanTitle(title: string | null): string | null {
  if (!title) {
    return null;
  }
  const cleaned = title.replace(/\s+/gu, " ").trim();
  if (!cleaned) {
    return null;
  }
  return cleaned.length > 90 ? `${cleaned.slice(0, 89)}…` : cleaned;
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
/** Test-only: club "today" (Europe/Belgrade) so a harness can match the streak anchor. */
export function __clubTodayIsoForTest(): string {
  return clubTodayIso();
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
    wholeDistanceKm: cand.wholeDistanceKm,
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

/** Entry from a club_records override: official_protocol → race, strava_best_effort → training_split.
 *  (coach_confirmed keeps its own builder above.) The row's source flows through unchanged. */
function clubRecordOverrideEntry(
  target: (typeof C.CLUB_RECORD_DISTANCES)[number],
  c: CoachRecord,
  recordType: ClubRecordType
): ClubRecordEntry {
  return {
    distanceKey: target.key,
    distanceLabel: target.label,
    durationSeconds: c.durationSeconds,
    paceSecPerKm: c.paceSecPerKm,
    date: c.recordDate ?? "",
    dateLabel: c.recordDate ? formatRuDate(c.recordDate) : recordType === "race" ? "гонка" : "тренировка",
    trust: c.trust === "preliminary" ? "preliminary" : "verified",
    source: c.source as RecordSource,
    calcMethod: "whole_workout",
    recordType,
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

/** Per-student running planned/completed counts — the ONLY input performers need. */
type PerfCounts = Map<string, { planned: number; completed: number }>;

function performerCountsFromRows(rows: ClubWorkoutRow[]): PerfCounts {
  const counts: PerfCounts = new Map();
  for (const row of rows) {
    if (!row.isRunning) continue;
    const e = counts.get(row.studentId) ?? { planned: 0, completed: 0 };
    if (row.isPlanned) e.planned += 1;
    if (row.isCompleted) e.completed += 1;
    counts.set(row.studentId, e);
  }
  return counts;
}

function performerCountsFromAgg(aggRows: DailyAgg[]): PerfCounts {
  const counts: PerfCounts = new Map();
  for (const a of aggRows) {
    const e = counts.get(a.studentId) ?? { planned: 0, completed: 0 };
    e.planned += a.plannedRunning;
    e.completed += a.completedRunning;
    counts.set(a.studentId, e);
  }
  return counts;
}

/**
 * Turn per-student counts into the ranked performer list. Seeds EVERY visible student
 * (0/0) in visibleById order, then applies counts — so tie-breaking (equal completion%
 * + completed) is by that order, identical whether the counts came from raw rows or
 * aggregates. This is the shared tail that guarantees identical «красавчики» ordering.
 */
function finalizePerformers(counts: PerfCounts, visibleById: Map<string, ClubStudent>): ClubTopPerformer[] {
  const accum = new Map<string, PerformerAccum>();
  for (const student of visibleById.values()) {
    const c = counts.get(student.id);
    accum.set(student.id, {
      studentId: student.id,
      displayName: student.displayName,
      planned: c?.planned ?? 0,
      completed: c?.completed ?? 0,
    });
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
      avatarUrl: C.isClubAvatarsEnabled() ? signAvatarPath(entry.studentId) : null,
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

/** Raw-path performers (unchanged behaviour): count rows → finalize. */
function buildWeekPerformers(rows: ClubWorkoutRow[], visibleById: Map<string, ClubStudent>): ClubTopPerformer[] {
  return finalizePerformers(performerCountsFromRows(rows), visibleById);
}

// ---------------------------------------------------------------------------
// Daily aggregates (Phase 1.4) — precomputed per-student per-day RUNNING numbers
// behind CLUB_AGGREGATES_ENABLED. computeDailyAggregates is the SINGLE source of
// aggregation truth: materialize writes exactly what it returns, and the parity
// harness feeds the same output into the same reducers as the DB path — so in-memory
// parity == DB-path parity.
// ---------------------------------------------------------------------------

export type DailyAgg = {
  studentId: string;
  day: string; // ISO date (YYYY-MM-DD)
  runningKm: number; // completed running km that day, FULL precision
  completedRunning: number;
  plannedRunning: number;
};

/** Pure: raw club rows → per-(student,day) running aggregates (rows with any activity). */
export function computeDailyAggregates(rows: ClubWorkoutRow[]): DailyAgg[] {
  const byKey = new Map<string, DailyAgg>();
  for (const row of rows) {
    if (!row.isRunning) continue;
    if (!row.isPlanned && !row.isCompleted) continue; // nothing to count
    const key = `${row.studentId}|${row.workoutDate}`;
    const agg = byKey.get(key) ?? { studentId: row.studentId, day: row.workoutDate, runningKm: 0, completedRunning: 0, plannedRunning: 0 };
    if (row.isPlanned) agg.plannedRunning += 1;
    if (row.isCompleted) {
      agg.completedRunning += 1;
      agg.runningKm += row.distanceKm ?? 0;
    }
    byKey.set(key, agg);
  }
  return [...byKey.values()];
}

// Test-only source override: lets the parity harness feed IN-MEMORY aggregates into
// the REAL consumer code paths (so the parity check exercises the actual reducers, not
// a re-implementation). null in production → always reads the DB.
let _dailyAggSourceForTest: ((input: { from: string; to: string; studentIds?: string[] }) => Promise<DailyAgg[]>) | null = null;
export function __setDailyAggregatesSourceForTest(
  fn: ((input: { from: string; to: string; studentIds?: string[] }) => Promise<DailyAgg[]>) | null
): void {
  _dailyAggSourceForTest = fn;
}

/** Read materialized daily aggregates for a date window (optionally a subset of students). */
async function loadDailyAggregates(input: { from: string; to: string; studentIds?: string[] }): Promise<DailyAgg[]> {
  if (_dailyAggSourceForTest) return _dailyAggSourceForTest(input);
  const supabase = createSupabaseServerClient();
  const data = await fetchAllRows<Record<string, unknown>>(
    (fromRow, toRow) => {
      let q = supabase
        .from("club_daily_aggregates")
        .select("student_id, day, running_km, completed_running, planned_running")
        .gte("day", input.from)
        .lte("day", input.to);
      if (input.studentIds && input.studentIds.length > 0) q = q.in("student_id", input.studentIds);
      return withSupabaseNetworkRetry(() => q.order("day", { ascending: true }).order("student_id", { ascending: true }).range(fromRow, toRow));
    },
    { label: `club:daily_agg ${input.from}..${input.to}` }
  );
  return data.map((r) => ({
    studentId: r.student_id as string,
    day: r.day as string,
    runningKm: Number(r.running_km ?? 0),
    completedRunning: Number(r.completed_running ?? 0),
    plannedRunning: Number(r.planned_running ?? 0),
  }));
}

/** Club running km over visible students within [from,to] — aggregate mirror of clubKmInRange. */
function clubKmFromAgg(aggRows: DailyAgg[], visibleIds: Set<string>, from: string, to: string): number {
  let km = 0;
  for (const a of aggRows) {
    if (!visibleIds.has(a.studentId)) continue;
    if (a.day >= from && a.day <= to) km += a.runningKm;
  }
  return km;
}

/** Auto challenge goal from aggregates — same algebra as computeAutoGoalKm, agg source. */
function computeAutoGoalKmFromAgg(aggRows: DailyAgg[], visibleIds: Set<string>, currentWeekFrom: string): number | null {
  const kmForWeekBack = (i: number): number => {
    const from = addDaysIso(currentWeekFrom, -7 * i);
    return clubKmFromAgg(aggRows, visibleIds, from, addDaysIso(from, 6));
  };
  const km = [1, 2, 3, 4, 5].map(kmForWeekBack);
  const n = C.CLUB_CHALLENGE_ROLLING_WEEKS;
  const baseWeeks = km.slice(0, n).filter((k) => k > 0);
  if (baseWeeks.length === 0) return null;
  const baseAvg = baseWeeks.reduce((a, b) => a + b, 0) / baseWeeks.length;
  const prevWeeks = km.slice(1, n + 1).filter((k) => k > 0);
  const prevAvg = prevWeeks.length ? prevWeeks.reduce((a, b) => a + b, 0) / prevWeeks.length : 0;
  const prevActual = km[0];
  const beatPrevious = prevActual > 0 && prevAvg > 0 && prevActual >= prevAvg;
  const raw = beatPrevious ? baseAvg * (1 + C.CLUB_CHALLENGE_RAISE_STEP) : baseAvg;
  const step = C.CLUB_CHALLENGE_AUTO_ROUND_STEP;
  return Math.max(step, Math.ceil(raw / step) * step);
}

// ---------------------------------------------------------------------------
// Weekly rollups (Phase 1.4 follow-up) — one row per (student, ISO week) + per-student
// current streak, so tops/challenge/stats/rank read a single page. computeWeekRollups /
// computeStudentStreaks are the aggregation truth (materialize writes exactly them; the
// parity harness feeds them into the same reducers). Behind CLUB_WEEK_ROLLUP_ENABLED,
// with a daily-path fallback when the tables are empty (never shows zeros).
// ---------------------------------------------------------------------------

export type WeekRollup = { studentId: string; weekStart: string; runningKm: number; completedRunning: number; plannedRunning: number };
export type StudentStreak = { studentId: string; currentStreak: number };

/** Pure: raw club rows → per-(student, ISO-week) running rollups (weeks with any activity). */
export function computeWeekRollups(rows: ClubWorkoutRow[]): WeekRollup[] {
  const byKey = new Map<string, WeekRollup>();
  for (const row of rows) {
    if (!row.isRunning) continue;
    if (!row.isPlanned && !row.isCompleted) continue;
    const wk = weekStartIso(row.workoutDate);
    const key = `${row.studentId}|${wk}`;
    const r = byKey.get(key) ?? { studentId: row.studentId, weekStart: wk, runningKm: 0, completedRunning: 0, plannedRunning: 0 };
    if (row.isPlanned) r.plannedRunning += 1;
    if (row.isCompleted) {
      r.completedRunning += 1;
      r.runningKm += row.distanceKm ?? 0;
    }
    byKey.set(key, r);
  }
  return [...byKey.values()];
}

/** Pure: raw club rows → per-student current streak (consecutive active days ending `today`). */
export function computeStudentStreaks(rows: ClubWorkoutRow[], today: string): StudentStreak[] {
  const daysByStudent = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.isCompleted || !row.isRunning) continue;
    const s = daysByStudent.get(row.studentId) ?? new Set<string>();
    s.add(row.workoutDate);
    daysByStudent.set(row.studentId, s);
  }
  const out: StudentStreak[] = [];
  for (const [studentId, days] of daysByStudent) {
    const streak = computeStreakDays(days, today);
    if (streak > 0) out.push({ studentId, currentStreak: streak });
  }
  return out;
}

// Test overrides (parity harness feeds in-memory rollups into the real consumer code).
let _weekRollupSourceForTest: ((input: { fromWeek: string; toWeek: string; studentIds?: string[] }) => Promise<WeekRollup[]>) | null = null;
let _studentStreakSourceForTest: ((studentIds?: string[]) => Promise<StudentStreak[]>) | null = null;
export function __setWeekRollupSourcesForTest(
  weekFn: ((input: { fromWeek: string; toWeek: string; studentIds?: string[] }) => Promise<WeekRollup[]>) | null,
  streakFn: ((studentIds?: string[]) => Promise<StudentStreak[]>) | null
): void {
  _weekRollupSourceForTest = weekFn;
  _studentStreakSourceForTest = streakFn;
}

/** Read weekly rollups for a week_start range (inclusive), optionally a subset of students. */
async function loadWeekRollups(input: { fromWeek: string; toWeek: string; studentIds?: string[] }): Promise<WeekRollup[]> {
  if (_weekRollupSourceForTest) return _weekRollupSourceForTest(input);
  const supabase = createSupabaseServerClient();
  const data = await fetchAllRows<Record<string, unknown>>(
    (from, to) => {
      let q = supabase
        .from("club_week_rollup")
        .select("student_id, week_start, running_km, completed_running, planned_running")
        .gte("week_start", input.fromWeek)
        .lte("week_start", input.toWeek);
      if (input.studentIds && input.studentIds.length > 0) q = q.in("student_id", input.studentIds);
      return withSupabaseNetworkRetry(() => q.order("week_start", { ascending: true }).order("student_id", { ascending: true }).range(from, to));
    },
    { label: `club:week_rollup ${input.fromWeek}..${input.toWeek}` }
  );
  return data.map((r) => ({
    studentId: r.student_id as string,
    weekStart: r.week_start as string,
    runningKm: Number(r.running_km ?? 0),
    completedRunning: Number(r.completed_running ?? 0),
    plannedRunning: Number(r.planned_running ?? 0),
  }));
}

/** Read per-student current streaks (optionally a subset). */
async function loadStudentStreaks(studentIds?: string[]): Promise<StudentStreak[]> {
  if (_studentStreakSourceForTest) return _studentStreakSourceForTest(studentIds);
  const supabase = createSupabaseServerClient();
  const data = await fetchAllRows<Record<string, unknown>>(
    (from, to) => {
      let q = supabase.from("club_student_rollup").select("student_id, current_streak");
      if (studentIds && studentIds.length > 0) q = q.in("student_id", studentIds);
      return withSupabaseNetworkRetry(() => q.order("student_id", { ascending: true }).range(from, to));
    },
    { label: "club:student_rollup" }
  );
  return data.map((r) => ({ studentId: r.student_id as string, currentStreak: Number(r.current_streak ?? 0) }));
}

/** Per-student running counts from weekly rollup rows (for finalizePerformers). */
function performerCountsFromRollup(rows: WeekRollup[]): PerfCounts {
  const counts: PerfCounts = new Map();
  for (const r of rows) {
    const e = counts.get(r.studentId) ?? { planned: 0, completed: 0 };
    e.planned += r.plannedRunning;
    e.completed += r.completedRunning;
    counts.set(r.studentId, e);
  }
  return counts;
}

/** Club running km for ONE week_start over visible students (rollup mirror of clubKmInRange). */
function clubKmForWeekRollup(rows: WeekRollup[], visibleIds: Set<string>, weekStart: string): number {
  let km = 0;
  for (const r of rows) {
    if (r.weekStart === weekStart && visibleIds.has(r.studentId)) km += r.runningKm;
  }
  return km;
}

/** Auto goal from weekly rollups — same algebra as computeAutoGoalKm, rollup source. */
function computeAutoGoalKmFromRollup(rows: WeekRollup[], visibleIds: Set<string>, currentWeekFrom: string): number | null {
  const km = [1, 2, 3, 4, 5].map((i) => clubKmForWeekRollup(rows, visibleIds, addDaysIso(currentWeekFrom, -7 * i)));
  const n = C.CLUB_CHALLENGE_ROLLING_WEEKS;
  const baseWeeks = km.slice(0, n).filter((k) => k > 0);
  if (baseWeeks.length === 0) return null;
  const baseAvg = baseWeeks.reduce((a, b) => a + b, 0) / baseWeeks.length;
  const prevWeeks = km.slice(1, n + 1).filter((k) => k > 0);
  const prevAvg = prevWeeks.length ? prevWeeks.reduce((a, b) => a + b, 0) / prevWeeks.length : 0;
  const prevActual = km[0];
  const beatPrevious = prevActual > 0 && prevAvg > 0 && prevActual >= prevAvg;
  const raw = beatPrevious ? baseAvg * (1 + C.CLUB_CHALLENGE_RAISE_STEP) : baseAvg;
  const step = C.CLUB_CHALLENGE_AUTO_ROUND_STEP;
  return Math.max(step, Math.ceil(raw / step) * step);
}

// ---------------------------------------------------------------------------
// Public view builders
// ---------------------------------------------------------------------------

/** Keyset feed cursor: "<feed_ts>|<id>" of the last returned card. feed_ts (an ISO wall-clock or a
 *  bare date) never contains "|", so the first "|" splits it cleanly. Old "<date>|<id>" cursors in
 *  flight during a deploy still decode (feed_ts = the date), self-healing on the next page. */
function decodeFeedCursor(cursor: string | null | undefined): { feedTs: string; id: string } | null {
  if (!cursor) return null;
  const i = cursor.indexOf("|");
  if (i <= 0) return null;
  const feedTs = cursor.slice(0, i);
  const id = cursor.slice(i + 1);
  return feedTs && id ? { feedTs, id } : null;
}
function encodeFeedCursor(row: { feedTs: string; id: string }): string {
  return `${row.feedTs}|${row.id}`;
}

/** Feed post-filter (depends on classification, so it can't be a SQL column filter). */
function isFeedRow(row: ClubWorkoutRow, visibleIds: Set<string>): boolean {
  return (
    row.isCompleted &&
    visibleIds.has(row.studentId) &&
    row.family !== "day_off" &&
    ((row.distanceKm ?? 0) > 0 || (row.durationSeconds ?? 0) > 0)
  );
}

export async function getClubFeed(input: {
  cursor?: string | null;
  currentStudentId: string;
}): Promise<ClubFeedView> {
  const today = clubTodayIso();
  const from = addDaysIso(today, -C.CLUB_FEED_WINDOW_DAYS);
  const [students, freshness] = await Promise.all([loadClubStudents(), buildFreshness()]);
  const visibleIds = new Set(students.filter(isVisible).map((s) => s.id));
  const displayById = new Map(students.map((s) => [s.id, s.displayName]));

  // Keyset pagination IN POSTGRES: fetch batches newest-first from the cursor, over-
  // fetching (×4) to survive the JS running/visible post-filter, until the page is full
  // or the window is exhausted. Replaces the old "load 45d whole-club, sort+slice in JS".
  const pageSize = C.CLUB_FEED_PAGE_SIZE;
  const batchLimit = pageSize * 4;
  const decoded = decodeFeedCursor(input.cursor);
  let cursorFeedTs = decoded?.feedTs ?? null;
  let cursorId = decoded?.id ?? null;
  const pageRows: ClubWorkoutRow[] = [];
  let exhausted = false;

  while (pageRows.length < pageSize && !exhausted) {
    const batch = await loadFeedCandidates({ from, to: today, beforeFeedTs: cursorFeedTs, beforeId: cursorId, limit: batchLimit });
    if (batch.length < batchLimit) exhausted = true;
    for (const row of batch) {
      cursorFeedTs = row.feedTs;
      cursorId = row.id;
      if (!isFeedRow(row, visibleIds)) continue;
      pageRows.push(row);
      if (pageRows.length >= pageSize) break;
    }
  }
  // hasMore: full page AND more data may remain past it. A rare false-positive only
  // costs one empty "показать ещё" (the UI then shows the end hint). No offset drift.
  const nextCursor =
    pageRows.length === pageSize && !exhausted ? encodeFeedCursor(pageRows[pageRows.length - 1]) : null;

  // Single reactions + avg-HR + track query each for the whole page (no N+1). Plus a
  // bounded baseline read (page athletes over INSIGHT_BASELINE_DAYS) for the "faster than
  // usual" insight: computed from each athlete's OWN history, not the whole club.
  const pageIds = pageRows.map((r) => r.id);
  const uniqueAthletes = [...new Set(pageRows.map((r) => r.studentId))];
  const baselineFrom = addDaysIso(today, -INSIGHT_BASELINE_DAYS);
  const [reactions, avgHrById, tracksById, baselineRows, intervalIds] = await Promise.all([
    loadReactionsForWorkouts(pageIds, input.currentStudentId),
    loadAvgHrForWorkouts(pageIds),
    loadTracksForWorkouts(pageIds),
    uniqueAthletes.length > 0
      ? loadClubWorkoutRows({ from: baselineFrom, to: today, studentIds: uniqueAthletes })
      : Promise.resolve([] as ClubWorkoutRow[]),
    loadIntervalWorkoutIds(pageIds),
  ]);
  const insightBaseline = buildInsightBaseline(baselineRows);

  const items: ClubFeedItem[] = pageRows.map((row) => {
    const label = typeLabel(row.family);
    const agg = reactions.get(row.id);
    const pace = row.isRunning ? paceSecPerKm(row.distanceKm, row.durationSeconds) : null;
    return {
      id: row.id,
      studentId: row.studentId,
      studentDisplayName: displayById.get(row.studentId) ?? fullName(row.studentName),
      monogram: monogram(row.studentName),
      avatarUrl: C.isClubAvatarsEnabled() ? signAvatarPath(row.studentId) : null,
      typeLabel: label,
      isRunning: row.isRunning,
      date: row.workoutDate,
      dateLabel: formatRuDate(row.workoutDate),
      distanceKm: row.distanceKm,
      durationSeconds: row.durationSeconds,
      paceSecPerKm: pace,
      avgHr: avgHrById.get(row.id) ?? null,
      timeLabel: localStartHm(row.startTime),
      insight: intervalIds.has(row.id)
        ? null // structured interval session: whole-workout "faster than usual" is misleading
        : computeFeedInsight(
            { id: row.id, date: row.workoutDate, distanceKm: row.distanceKm, paceSecPerKm: pace, isRunning: row.isRunning },
            insightBaseline.get(row.studentId) ?? []
          ),
      title: cleanTitle(row.title),
      caption: sanitizeCaption(row.title, label),
      track: tracksById.get(row.id) ?? null,
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

type ChallengeRow = {
  id: string;
  title: string | null;
  goal_type: string | null;
  goal_value: number | null;
  goal_km: number | null;
  starts_at: string;
  ends_at: string;
  participant_scope: string | null;
  participant_ids: string[] | null;
  status: string | null;
};

/**
 * Phase C — active admin challenges with live club + personal progress. Reads
 * club_challenges (extended in 20260806); tolerant of the pre-Phase-C shape / missing
 * table (returns []). Progress is completed running distance (km) or completed running
 * workout COUNT over the challenge window, restricted to participants (all visible club,
 * or a selected subset intersected with visible). Never counts club marker rows (they
 * are already excluded at loadClubWorkoutRows — Phase A).
 */
async function getClubActiveChallenges(
  currentStudentId: string,
  visibleById: Map<string, ClubStudent>
): Promise<import("./types").ClubChallengeItem[]> {
  const today = clubTodayIso();
  let rows: ChallengeRow[] = [];
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("club_challenges")
      .select("id, title, goal_type, goal_value, goal_km, starts_at, ends_at, participant_scope, participant_ids, status")
      .eq("status", "active")
      .lte("starts_at", today)
      .gte("ends_at", today)
      .order("starts_at", { ascending: true });
    if (error || !data) return [];
    rows = data as ChallengeRow[];
  } catch {
    return [];
  }
  if (rows.length === 0) return [];

  const earliest = rows.reduce((min, r) => (r.starts_at < min ? r.starts_at : min), today);
  const workoutRows = await loadClubWorkoutRows({ from: earliest, to: today });
  const completedRunning = workoutRows.filter((r) => r.isCompleted && r.isRunning && visibleById.has(r.studentId));

  return rows.map((r) => {
    const goalType: "km" | "workouts" = r.goal_type === "workouts" ? "workouts" : "km";
    const goalValue = toFiniteNumber(r.goal_value) ?? toFiniteNumber(r.goal_km) ?? 0;
    const scope: "all" | "selected" = r.participant_scope === "selected" ? "selected" : "all";
    const selected = new Set((r.participant_ids ?? []).filter((id) => visibleById.has(id)));
    const isParticipant = (id: string) => (scope === "all" ? visibleById.has(id) : selected.has(id));
    const participantCount = scope === "all" ? visibleById.size : selected.size;
    const winFrom = r.starts_at;
    const winTo = r.ends_at < today ? r.ends_at : today;

    let clubProgress = 0;
    let personalProgress = 0;
    for (const row of completedRunning) {
      if (row.workoutDate < winFrom || row.workoutDate > winTo) continue;
      if (!isParticipant(row.studentId)) continue;
      const inc = goalType === "km" ? row.distanceKm ?? 0 : 1;
      clubProgress += inc;
      if (row.studentId === currentStudentId) personalProgress += inc;
    }
    clubProgress = goalType === "km" ? Number(clubProgress.toFixed(1)) : clubProgress;
    personalProgress = goalType === "km" ? Number(personalProgress.toFixed(1)) : personalProgress;
    const progressPct = goalValue > 0 ? Math.min(Math.round((clubProgress / goalValue) * 100), 100) : 0;
    const daysLeft = Math.max(0, Math.round((Date.parse(r.ends_at) - Date.parse(today)) / 86400000));

    return {
      id: r.id,
      title: (r.title && r.title.trim()) || (goalType === "km" ? "Клубный километраж" : "Число тренировок"),
      goalType,
      goalValue,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      dateLabel: `${formatRuDate(r.starts_at)} - ${formatRuDate(r.ends_at)}`,
      daysLeft,
      clubProgress,
      personalProgress,
      progressPct,
      participantScope: scope,
      participantCount,
    };
  });
}

export async function getClubChallenge(input: {
  currentStudentId: string;
  /** Phase C: красавчики over "week" (default) or "month". */
  period?: "week" | "month";
}): Promise<ClubChallengeView> {
  const range = currentWeekRange();
  // Load enough history for the rolling-average goal (up to 5 completed weeks back).
  const historyFrom = addDaysIso(range.from, -7 * 5);
  const [students, freshness] = await Promise.all([loadClubStudents(), buildFreshness()]);
  const visible = students.filter(isVisible);
  const visibleById = new Map(visible.map((s) => [s.id, s]));
  const visibleIds = new Set(visibleById.keys());

  let clubKmRaw = 0;
  let personalKmRaw = 0;
  let performersBase: ClubTopPerformer[];
  let autoGoal: number | null;

  const chRollup = C.isAggregatesEnabled() && C.isWeekRollupEnabled()
    ? await loadWeekRollups({ fromWeek: historyFrom, toWeek: range.from, studentIds: [...visibleIds] })
    : [];
  if (chRollup.length > 0) {
    // Weekly rollup path.
    const thisWeek = chRollup.filter((r) => r.weekStart === range.from);
    for (const r of thisWeek) {
      if (!visibleIds.has(r.studentId)) continue;
      clubKmRaw += r.runningKm;
      if (r.studentId === input.currentStudentId) personalKmRaw += r.runningKm;
    }
    performersBase = finalizePerformers(performerCountsFromRollup(thisWeek), visibleById);
    autoGoal = computeAutoGoalKmFromRollup(chRollup, visibleIds, range.from);
  } else if (C.isAggregatesEnabled()) {
    const agg = await loadDailyAggregates({ from: historyFrom, to: range.to, studentIds: [...visibleIds] });
    const weekAgg = agg.filter((a) => a.day >= range.from && a.day <= range.to);
    for (const a of weekAgg) {
      if (!visibleIds.has(a.studentId)) continue;
      clubKmRaw += a.runningKm;
      if (a.studentId === input.currentStudentId) personalKmRaw += a.runningKm;
    }
    performersBase = finalizePerformers(performerCountsFromAgg(weekAgg), visibleById);
    autoGoal = computeAutoGoalKmFromAgg(agg, visibleIds, range.from);
  } else {
    const rows = await loadClubWorkoutRows({ from: historyFrom, to: range.to });
    const weekRows = rows.filter((r) => r.workoutDate >= range.from && r.workoutDate <= range.to);
    for (const row of weekRows) {
      if (!row.isCompleted || !row.isRunning || !visibleIds.has(row.studentId)) continue;
      const km = row.distanceKm ?? 0;
      clubKmRaw += km;
      if (row.studentId === input.currentStudentId) personalKmRaw += km;
    }
    performersBase = buildWeekPerformers(weekRows, visibleById);
    autoGoal = computeAutoGoalKm(rows, visibleIds, range.from);
  }
  const clubKm = Number(clubKmRaw.toFixed(1));
  const personalKm = Number(personalKmRaw.toFixed(1));

  const performers = performersBase.map((p) => ({
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
    if (autoGoal !== null) {
      goalKm = autoGoal;
      goalMode = "auto";
    }
  }
  const progressPct = goalKm > 0 ? Math.min(Math.round((clubKm / goalKm) * 100), 100) : 0;

  // Phase C: красавчики period toggle. week (default) = the performers computed above;
  // month = recompute over the calendar month (raw path — the aggregate optimization is
  // week-shaped; month is a rarer view, so a plain read is fine). clubKm/goal/personal
  // stay weekly — only the leaderboard period changes.
  const period: "week" | "month" = input.period === "month" ? "month" : "week";
  let periodPerformers = performers;
  if (period === "month") {
    const monthRange = currentMonthRange();
    const monthRows = await loadClubWorkoutRows({ from: monthRange.from, to: monthRange.to });
    periodPerformers = buildWeekPerformers(monthRows, visibleById).map((p) => ({
      ...p,
      isCurrentStudent: p.studentId === input.currentStudentId,
    }));
  }
  const challenges = await getClubActiveChallenges(input.currentStudentId, visibleById);

  return {
    clubKm,
    goalKm,
    goalIsFixture: goalMode === "fixture",
    goalMode,
    progressPct,
    weekLabel: weekLabel(range),
    challenges,
    performersPeriod: period,
    performersPeriodLabel: period === "month" ? "за месяц" : "за неделю",
    freshness,
    topPerformers: periodPerformers.slice(0, C.CLUB_TOP_PERFORMERS_N),
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

/**
 * Personal records for ONE student from MATERIALIZED snapshots (+ coach overrides).
 * The SINGLE SOURCE for personal records, shared by the Results tab (getClubRecords)
 * and the Profile tab (getClubProfileDetail) so the two can never diverge. Coach
 * override wins; else the snapshot's race + training split. No live lap loading.
 */
function personalRecordsFromSnapshots(
  studentId: string,
  snapshots: Map<string, StudentSnapshot>,
  overrides: Map<string, CoachRecord>
): ClubRecordEntry[] {
  const ownSnap = snapshots.get(studentId);
  const out: ClubRecordEntry[] = [];
  for (const target of C.CLUB_RECORD_DISTANCES) {
    const ov = overrides.get(`${studentId}|${target.key}`);
    const slot = ownSnap?.get(target.key);
    // coach_confirmed: unchanged — overrides the WHOLE distance (hidden suppresses both slots).
    if (ov?.source === "coach_confirmed") {
      if (ov.trust !== "hidden") out.push(coachRaceEntry(target, ov));
      continue;
    }
    // RACE slot: official_protocol (a real race result) beats the reconstructed race snapshot.
    if (ov?.source === "official_protocol") out.push(clubRecordOverrideEntry(target, ov, "race"));
    else if (slot?.race) out.push(snapshotToEntry(target.key, slot.race, "race"));
    // TRAINING slot: strava_best_effort (a measured segment) beats reconstruction. Kept SEPARATE from
    // the race slot, so «Гонки» и «Лучшие отрезки тренировок» stay distinct.
    if (ov?.source === "strava_best_effort") out.push(clubRecordOverrideEntry(target, ov, "training_split"));
    else if (slot?.training) out.push(snapshotToEntry(target.key, slot.training, "training_split"));
  }
  return out;
}

const SEGMENT_NOMINAL_KM: Record<string, number> = { "5k": 5, "10k": 10, "21k": 21.097, "42k": 42.195 };
const SEGMENT_STANDARD_KM = [5, 10, 21, 42];
const SEGMENT_RATIO = 1.6; // parent effort > 1.6x nominal => a within-race segment

function nearestStandardKm(km: number): number {
  return SEGMENT_STANDARD_KM.reduce((best, s) => (Math.abs(s - km) < Math.abs(best - km) ? s : best), SEGMENT_STANDARD_KM[0]);
}

/** race_events for one student, keyed by date → the day's MAIN (longest) event title +
 *  its distance. Used to caption within-race segments. Inert if the table is absent. */
async function loadRaceEventsByDate(
  studentId: string
): Promise<Map<string, { title: string | null; maxKm: number | null }>> {
  const out = new Map<string, { title: string | null; maxKm: number | null }>();
  try {
    const supabase = createSupabaseServerClient();
    const { data } = await supabase
      .from("trainingpeaks_race_events")
      .select("event_date, title, distance_km")
      .eq("student_id", studentId);
    for (const row of (data as Array<{ event_date: string | null; title: string | null; distance_km: number | null }> | null) ?? []) {
      const d = (row.event_date ?? "").slice(0, 10);
      if (!d) continue;
      const cur = out.get(d) ?? { title: null, maxKm: null };
      const km = typeof row.distance_km === "number" ? row.distance_km : null;
      if (km != null && (cur.maxKm == null || km > cur.maxKm)) {
        cur.maxKm = km;
        if (row.title) cur.title = row.title; // title of the longest event that day
      } else if (cur.title == null && row.title) {
        cur.title = row.title; // fallback title when distances are missing (e.g. the Nazarov case)
      }
      out.set(d, cur);
    }
  } catch {
    /* table absent → no captions */
  }
  return out;
}

/** Mutates: sets raceSegmentLabel on race records that are a shorter SEGMENT of a longer
 *  race the same day. Signals (any): a same-date race record of a longer distance; the
 *  day's event distance; the source-workout distance (live path). Caption uses the day's
 *  event title, else the parent distance. Nothing is hidden — this only annotates. */
function annotateRaceSegments(
  records: ClubRecordEntry[],
  eventsByDate: Map<string, { title: string | null; maxKm: number | null }>
): void {
  const raceByDate = new Map<string, ClubRecordEntry[]>();
  for (const r of records) {
    if (r.recordType !== "race" || !r.date) continue;
    const arr = raceByDate.get(r.date) ?? [];
    arr.push(r);
    raceByDate.set(r.date, arr);
  }
  for (const r of records) {
    if (r.recordType !== "race" || !r.date) continue;
    const nominal = SEGMENT_NOMINAL_KM[r.distanceKey] ?? 0;
    if (nominal <= 0) continue;
    const ev = eventsByDate.get(r.date);
    const sameDayKms = (raceByDate.get(r.date) ?? [])
      .filter((o) => o !== r)
      .map((o) => SEGMENT_NOMINAL_KM[o.distanceKey] ?? 0);
    const sameDayLongerKm = sameDayKms.length ? Math.max(...sameDayKms) : 0;
    const workoutKm = r.wholeDistanceKm ?? null;
    const isSegment =
      sameDayLongerKm > nominal * SEGMENT_RATIO ||
      (ev?.maxKm != null && ev.maxKm > nominal * SEGMENT_RATIO) ||
      (r.calcMethod === "best_split" && workoutKm != null && workoutKm > nominal * SEGMENT_RATIO);
    if (!isSegment) continue;
    if (ev?.title) {
      r.raceSegmentLabel = `отрезок гонки «${ev.title}»`;
    } else {
      const parentKm = ev?.maxKm ?? (sameDayLongerKm > 0 ? sameDayLongerKm : workoutKm);
      r.raceSegmentLabel =
        parentKm != null ? `в составе ${nearestStandardKm(parentKm)} км` : "отрезок более длинной гонки";
    }
  }
}

/** Batch variant of loadRaceEventsByDate for many students (club tops). */
async function loadRaceEventsByStudents(
  studentIds: string[]
): Promise<Map<string, Map<string, { title: string | null; maxKm: number | null }>>> {
  const out = new Map<string, Map<string, { title: string | null; maxKm: number | null }>>();
  if (studentIds.length === 0) return out;
  try {
    const supabase = createSupabaseServerClient();
    const { data } = await supabase
      .from("trainingpeaks_race_events")
      .select("student_id, event_date, title, distance_km")
      .in("student_id", studentIds);
    for (const row of (data as Array<{ student_id: string; event_date: string | null; title: string | null; distance_km: number | null }> | null) ?? []) {
      const sid = row.student_id;
      const d = (row.event_date ?? "").slice(0, 10);
      if (!sid || !d) continue;
      const byDate = out.get(sid) ?? new Map<string, { title: string | null; maxKm: number | null }>();
      const cur = byDate.get(d) ?? { title: null, maxKm: null };
      const km = typeof row.distance_km === "number" ? row.distance_km : null;
      if (km != null && (cur.maxKm == null || km > cur.maxKm)) {
        cur.maxKm = km;
        if (row.title) cur.title = row.title;
      } else if (cur.title == null && row.title) {
        cur.title = row.title;
      }
      byDate.set(d, cur);
      out.set(sid, byDate);
    }
  } catch {
    /* table absent → no captions */
  }
  return out;
}

/** Segment caption for one club-top row, using the student's snapshots (a same-date record
 *  of a longer distance) + their race_events. Returns null for a standalone result. */
function topRowSegmentLabel(
  row: ClubRecordsClubTopRow,
  studentSnap: StudentSnapshot | undefined,
  events: Map<string, { title: string | null; maxKm: number | null }> | undefined
): string | null {
  const date = row.date ? row.date.slice(0, 10) : null;
  if (!date) return null;
  const nominal = SEGMENT_NOMINAL_KM[row.distanceKey] ?? 0;
  if (nominal <= 0) return null;
  let sameDayLongerKm = 0;
  if (studentSnap) {
    for (const [key, slot] of studentSnap) {
      const km = SEGMENT_NOMINAL_KM[key] ?? 0;
      if (km <= nominal) continue;
      const d = (slot.race?.date ?? slot.raceVerified?.date ?? "").slice(0, 10);
      if (d && d === date) sameDayLongerKm = Math.max(sameDayLongerKm, km);
    }
  }
  const ev = events?.get(date);
  const isSegment = sameDayLongerKm > nominal * SEGMENT_RATIO || (ev?.maxKm != null && ev.maxKm > nominal * SEGMENT_RATIO);
  if (!isSegment) return null;
  if (ev?.title) return `отрезок гонки «${ev.title}»`;
  const parentKm = ev?.maxKm ?? (sameDayLongerKm > 0 ? sameDayLongerKm : null);
  return parentKm != null ? `в составе ${nearestStandardKm(parentKm)} км` : "отрезок более длинной гонки";
}

export async function getClubRecords(input: {
  currentStudentId: string;
}): Promise<ClubRecordsView> {
  // Reads MATERIALIZED snapshots (Phase 1.1) — no live lap loading. The whole tab
  // is now a few small reads instead of ~20k workouts + all laps. Snapshots are
  // refreshed by materializeClubRecords after each cache/FIT scan. Coach overrides
  // (club_records) still win at read time.
  const [students, snapshots, overrides, freshness] = await Promise.all([
    loadClubStudents(),
    loadRecordSnapshots(),
    loadClubRecordOverrides(),
    buildFreshness(),
  ]);
  const visibleById = new Map(students.filter(isVisible).map((s) => [s.id, s]));

  // Personal card uses the shared snapshot source (identical to the Profile tab), now with
  // club_records overrides (coach/official → race slot, strava → training slot) layered on.
  const personal = personalRecordsFromSnapshots(input.currentStudentId, snapshots, overrides);
  annotateRaceSegments(personal, await loadRaceEventsByDate(input.currentStudentId));
  const clubTops: ClubRecordsView["clubTops"] = [];

  for (const target of C.CLUB_RECORD_DISTANCES) {
    // Club top: ONLY real races (verified). Coach-confirmed verified races count;
    // materialized best_verified races count; coach-hidden distance excluded.
    const raceRows: Array<{ studentId: string; name: string; durationSeconds: number; pace: number | null; date: string | null; isCoach: boolean }> = [];
    // Iterate ALL visible students (not just those with a snapshot): a runner with an official_protocol
    // race but no reconstructed snapshot must still make the tops.
    for (const [studentId, student] of visibleById) {
      const perStudent = snapshots.get(studentId);
      const c = overrides.get(`${studentId}|${target.key}`);
      // coach_confirmed: verified → race top; hidden/preliminary excluded. Overrides the distance.
      if (c?.source === "coach_confirmed") {
        if (c.trust === "verified") {
          raceRows.push({ studentId, name: student.name ?? "", durationSeconds: c.durationSeconds, pace: c.paceSecPerKm, date: c.recordDate ?? null, isCoach: true });
        }
        continue;
      }
      // official_protocol: a real race result — authoritative race top; occupies the race slot.
      if (c?.source === "official_protocol") {
        raceRows.push({ studentId, name: student.name ?? "", durationSeconds: c.durationSeconds, pace: c.paceSecPerKm, date: c.recordDate ?? null, isCoach: true });
        continue;
      }
      // strava_best_effort is a TRAINING segment, NOT a race → never enters the tops; fall through to
      // the student's reconstructed race (raceVerified), exactly as with no override.
      const rv = perStudent?.get(target.key)?.raceVerified;
      if (rv) raceRows.push({ studentId, name: student.name ?? "", durationSeconds: rv.durationSeconds, pace: rv.paceSecPerKm, date: rv.date, isCoach: false });
    }
    raceRows.sort((a, b) => a.durationSeconds - b.durationSeconds);
    const topRows: ClubRecordsClubTopRow[] = raceRows.slice(0, C.CLUB_RECORDS_TOP_N).map((r, index) => ({
      distanceKey: target.key,
      rank: index + 1,
      studentId: r.studentId,
      displayName: visibleById.get(r.studentId)?.displayName ?? fullName(r.name),
      monogram: monogram(r.name),
      durationSeconds: r.durationSeconds,
      paceSecPerKm: r.pace,
      isCurrentStudent: r.studentId === input.currentStudentId,
      trust: "verified",
      recordType: "race",
      date: r.date,
      // Segment caption is filled in a post-pass below (needs each student's race_events).
      raceSegmentLabel: r.isCoach ? null : undefined,
      // Signed avatar URL for everyone; the proxy re-checks the member's opt-out live (403 →
      // monogram) and a missing photo 404s → monogram. So the UI always keeps a monogram fallback.
      avatarUrl: C.isClubAvatarsEnabled() ? signAvatarPath(r.studentId) : null,
    }));
    clubTops.push({
      distanceKey: target.key,
      distanceLabel: target.label,
      alwaysPreliminary: target.alwaysPreliminary,
      rows: topRows,
    });
  }

  // Segment captions for the tops (consistency with the card): a top result that is a
  // shorter segment of a longer race that day gets the same «отрезок гонки …» note. Coach
  // rows were pre-set to null above. One batched race_events read for the top students.
  const topStudentIds = [
    ...new Set(clubTops.flatMap((t) => t.rows.filter((r) => r.raceSegmentLabel === undefined).map((r) => r.studentId))),
  ];
  const eventsByStudent = await loadRaceEventsByStudents(topStudentIds);
  for (const top of clubTops) {
    for (const row of top.rows) {
      if (row.raceSegmentLabel !== undefined) continue; // coach row (null) already decided
      row.raceSegmentLabel = topRowSegmentLabel(row, snapshots.get(row.studentId), eventsByStudent.get(row.studentId));
    }
  }

  return { personal, clubTops, freshness };
}

/** Reusable: current student's records (best per distance, verified|preliminary). */
async function studentRecordsFromRows(
  rows: ClubWorkoutRow[],
  studentId: string,
  overrides?: Map<string, CoachRecord>
): Promise<ClubRecordEntry[]> {
  const own = rows.filter((r) => r.studentId === studentId);
  const { candidates, quality } = await buildRecordInputs(own, C.isBestSplitEnabled());
  const byStudent = reconstructRecords(candidates, quality);
  // A DISPLAY caller passes `overrides` (coach + official + strava) so this live path matches the
  // materialized «Результаты» tab. Without it (E-Predictor) we load coach-only — the predictor's anchor
  // set stays exactly as before (official_protocol is NOT silently added as a prediction anchor).
  const [raceDates, clubRecs] = await Promise.all([
    loadRaceDatesByStudent(),
    overrides ? Promise.resolve(overrides) : loadCoachRecords(),
  ]);
  const perDist = byStudent.get(studentId);
  const out: ClubRecordEntry[] = [];
  for (const target of C.CLUB_RECORD_DISTANCES) {
    const c = clubRecs.get(`${studentId}|${target.key}`);
    // coach_confirmed overrides the WHOLE distance (hidden suppresses). Coach-only map → all rows are this.
    if (c?.source === "coach_confirmed") {
      if (c.trust !== "hidden") out.push(coachRaceEntry(target, c));
      continue;
    }
    const split = splitByType(perDist?.get(target.key)?.evaluated ?? [], studentId, raceDates);
    // RACE slot: official_protocol (display path only) beats the reconstructed race.
    if (c?.source === "official_protocol") out.push(clubRecordOverrideEntry(target, c, "race"));
    else if (split.race) out.push(toRecordEntry(split.race, "race"));
    // TRAINING slot: strava_best_effort (display path only) beats reconstruction; kept as a segment,
    // so «Гонки» и «Лучшие отрезки» stay distinct here too.
    if (c?.source === "strava_best_effort") out.push(clubRecordOverrideEntry(target, c, "training_split"));
    else if (split.training) out.push(toRecordEntry(split.training, "training_split"));
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
  const bestMonthKm = Math.max(0, ...monthMap.values());
  const longestRunKm = Math.max(0, ...studentRunningRows.map((r) => r.distanceKm ?? 0));
  const haveDistance = new Set(records.map((r) => r.distanceKey));
  // Target distance (km) per first_distance rule, for the progress bar.
  const DIST_TARGET_KM: Record<string, number> = { "10k": 10, "21k": 21.1, "42k": 42.2 };

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
      // Phase 3.5: undisplayable / demo badges are dropped entirely (never shown as
      // a cryptic locked card). Only kept when CLUB_STUBS_ENABLED for local preview.
      if (!C.isStubsEnabled()) continue;
      out.push({ code: rule.code, title: rule.title, hint: rule.hint, earned: false, earnedDateLabel: null, stub: true, progress: null });
      continue;
    }
    let earned = false;
    let progress: ClubAchievement["progress"] = null;
    switch (rule.kind) {
      case "first_distance": {
        earned = rule.distanceKey ? haveDistance.has(rule.distanceKey) : false;
        const target = rule.distanceKey ? DIST_TARGET_KM[rule.distanceKey] ?? 0 : 0;
        if (target > 0) progress = { current: Number(Math.min(longestRunKm, target).toFixed(1)), target, unit: "км" };
        break;
      }
      case "month_volume":
        earned = bestMonthKm >= (rule.param ?? Infinity);
        progress = { current: Math.round(Math.min(bestMonthKm, rule.param ?? 0)), target: rule.param ?? 0, unit: "км" };
        break;
      case "streak":
        earned = maxStreak >= (rule.param ?? Infinity);
        progress = { current: Math.min(maxStreak, rule.param ?? 0), target: rule.param ?? 0, unit: "дн" };
        break;
      case "week_full_completion":
        earned = hadPerfectWeek;
        break;
      case "total_volume":
        earned = totalKm >= (rule.param ?? Infinity);
        progress = { current: Math.round(Math.min(totalKm, rule.param ?? 0)), target: rule.param ?? 0, unit: "км" };
        break;
    }
    out.push({ code: rule.code, title: rule.title, hint: rule.hint, earned, earnedDateLabel: null, stub: false, progress });
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
  // Two NARROW reads instead of one 365-day whole-club scan (Phase 1):
  //  - ownRows: this student's 365-day rows only (volumes, series, type, achievements);
  //  - challenge rank: the WHOLE club but only the current week (performers). Under
  //    CLUB_AGGREGATES_ENABLED that comes from club_daily_aggregates, else raw rows.
  // The old path loaded all students × 365 days just to use one student's slice + the
  // current week — that whole-club-year read was the profile's dominant cost.
  const [students, ownRows, snapshots, coach, freshness] = await Promise.all([
    loadClubStudents(),
    loadClubWorkoutRows({ from, to: today, studentIds: [input.currentStudentId] }),
    loadRecordSnapshots(),
    loadCoachRecords(),
    buildFreshness(),
  ]);
  const visibleById = new Map(students.filter(isVisible).map((s) => [s.id, s]));
  // Own row is read from the FULL list (a student who opted out still sees their cabinet).
  const ownStudent = students.find((s) => s.id === input.currentStudentId) ?? null;

  const ownAll = ownRows;
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
  // Records come from the SAME materialized snapshots as the Results tab — no live
  // lap reconstruction here (Phase 1.1 removed loadOrderedLaps + loadWorkoutQualityIndex
  // from the profile path). Guarantees profile records == Results tab records.
  const records = personalRecordsFromSnapshots(input.currentStudentId, snapshots, coach);
  annotateRaceSegments(records, await loadRaceEventsByDate(input.currentStudentId));

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

  // Type breakdown over all completed workouts. Phase 3.6: collapse the ~11 raw
  // families into a few big, clear buckets (Бег / Силовая / Вело / Плавание / Другое)
  // — less fragmentation, bigger rows in the UI.
  const typeAgg = new Map<string, { label: string; count: number; km: number }>();
  for (const row of ownCompleted) {
    const bucket = typeBucket(row.family);
    const agg = typeAgg.get(bucket.key) ?? { label: bucket.label, count: 0, km: 0 };
    agg.count += 1;
    agg.km += row.distanceKm ?? 0;
    typeAgg.set(bucket.key, agg);
  }
  const typeBreakdown: ClubTypeBreakdown[] = [...typeAgg.entries()]
    .map(([family, v]) => ({ family, label: v.label, count: v.count, km: Number(v.km.toFixed(1)) }))
    .sort((a, b) => b.count - a.count);

  const achievements = buildAchievements(ownRunning, ownAll, records).filter(
    (a) => !a.stub || C.isStubsEnabled()
  );

  // Challenge rank this week (whole club, current week only) — aggregates or raw rows.
  let performers: ClubTopPerformer[];
  if (C.isAggregatesEnabled()) {
    const ids = [...visibleById.keys()];
    const rollup = C.isWeekRollupEnabled() ? await loadWeekRollups({ fromWeek: week.from, toWeek: week.from, studentIds: ids }) : [];
    if (rollup.length > 0) {
      performers = finalizePerformers(performerCountsFromRollup(rollup), visibleById);
    } else {
      const weekAgg = await loadDailyAggregates({ from: week.from, to: week.to, studentIds: ids });
      performers = finalizePerformers(performerCountsFromAgg(weekAgg), visibleById);
    }
  } else {
    const weekAllRows = await loadClubWorkoutRows({ from: week.from, to: week.to });
    performers = buildWeekPerformers(weekAllRows, visibleById);
  }
  const rankIndex = performers.findIndex((p) => p.studentId === input.currentStudentId);
  const current = rankIndex >= 0 ? performers[rankIndex] : null;

  // Route opt-out state — a targeted, tolerant read, isolated from the hot loadClubStudents path
  // (the club_routes_visible column may not exist until the migration is applied → default true).
  let routesVisible = true;
  try {
    const { data: rv } = await createSupabaseServerClient()
      .from("trainingpeaks_students")
      .select("club_routes_visible")
      .eq("id", input.currentStudentId)
      .maybeSingle();
    if (rv && (rv as { club_routes_visible?: boolean | null }).club_routes_visible === false) {
      routesVisible = false;
    }
  } catch {
    /* column absent → default visible */
  }

  // Avatar opt-out state — separate tolerant read so it degrades independently of routesVisible
  // (the club_avatar_visible column ships in migration 20260821; absent → default visible).
  let avatarVisible = true;
  try {
    const { data: av } = await createSupabaseServerClient()
      .from("trainingpeaks_students")
      .select("club_avatar_visible")
      .eq("id", input.currentStudentId)
      .maybeSingle();
    if (av && (av as { club_avatar_visible?: boolean | null }).club_avatar_visible === false) {
      avatarVisible = false;
    }
  } catch {
    /* column absent → default visible */
  }

  return {
    displayName: ownStudent?.displayName ?? fullName(input.currentStudentName),
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
    routesVisible,
    mapTilesEnabled: C.isClubMapTilesEnabled(),
    avatarsEnabled: C.isClubAvatarsEnabled(),
    avatarVisible,
    avatarUrl: C.isClubAvatarsEnabled() && avatarVisible ? signAvatarPath(input.currentStudentId) : null,
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
  const [students, freshness] = await Promise.all([loadClubStudents(), buildFreshness()]);
  const visible = students.filter(isVisible);
  const visibleById = new Map(visible.map((s) => [s.id, s]));
  const visibleIds = new Set(visibleById.keys());

  const active = new Set<string>();
  let workoutsCount = 0;
  let clubKmRaw = 0;
  let prevClubKmRaw = 0;
  let performersAll: ClubTopPerformer[];

  const rollup = C.isAggregatesEnabled() && C.isWeekRollupEnabled()
    ? await loadWeekRollups({ fromWeek: prevFrom, toWeek: range.from, studentIds: [...visibleIds] })
    : [];
  if (rollup.length > 0) {
    // Weekly rollup path (single-page read).
    const thisWeek = rollup.filter((r) => r.weekStart === range.from);
    for (const r of thisWeek) {
      if (!visibleIds.has(r.studentId)) continue;
      if (r.completedRunning > 0) active.add(r.studentId);
      workoutsCount += r.completedRunning;
      clubKmRaw += r.runningKm;
    }
    prevClubKmRaw = clubKmForWeekRollup(rollup, visibleIds, prevFrom);
    performersAll = finalizePerformers(performerCountsFromRollup(thisWeek), visibleById);
  } else if (C.isAggregatesEnabled()) {
    // Daily-aggregate path (fallback when rollups not yet materialized).
    const agg = await loadDailyAggregates({ from: prevFrom, to: range.to, studentIds: [...visibleIds] });
    const weekAgg = agg.filter((a) => a.day >= range.from && a.day <= range.to);
    for (const a of weekAgg) {
      if (!visibleIds.has(a.studentId)) continue;
      if (a.completedRunning > 0) active.add(a.studentId);
      workoutsCount += a.completedRunning;
      clubKmRaw += a.runningKm;
    }
    prevClubKmRaw = clubKmFromAgg(agg, visibleIds, prevFrom, prevTo);
    performersAll = finalizePerformers(performerCountsFromAgg(weekAgg), visibleById);
  } else {
    const rows = await loadClubWorkoutRows({ from: prevFrom, to: range.to });
    const weekRows = rows.filter((r) => r.workoutDate >= range.from && r.workoutDate <= range.to);
    for (const row of weekRows) {
      if (!row.isCompleted || !row.isRunning || !visibleIds.has(row.studentId)) continue;
      active.add(row.studentId);
      workoutsCount += 1;
      clubKmRaw += row.distanceKm ?? 0;
    }
    prevClubKmRaw = clubKmInRange(rows, visibleIds, prevFrom, prevTo);
    performersAll = buildWeekPerformers(weekRows, visibleById);
  }
  const clubKm = Number(clubKmRaw.toFixed(1));
  const prevClubKm = Number(prevClubKmRaw.toFixed(1));

  const performers = performersAll.filter((p) => !p.noPlan);
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
  // Read through the END of the current week (like statistics/challenge), so byCompletion
  // counts this week's PLANNED-but-future sessions consistently across all tabs. Planned
  // future rows are is_completed=false → they don't affect volume/count/streaks.
  const toTops = range.to > today ? range.to : today;
  const [students, freshness] = await Promise.all([loadClubStudents(), buildFreshness()]);
  const visible = students.filter(isVisible);
  const visibleById = new Map(visible.map((s) => [s.id, s]));
  const visibleIds = new Set(visibleById.keys());

  const volume = new Map<string, number>();
  const count = new Map<string, number>();
  const activeDaysByStudent = new Map<string, Set<string>>();
  const streakByStudent = new Map<string, number>();
  let performersAll: ClubTopPerformer[];

  const topsRollup = C.isAggregatesEnabled() && C.isWeekRollupEnabled()
    ? await loadWeekRollups({ fromWeek: range.from, toWeek: range.from, studentIds: [...visibleIds] })
    : [];
  if (topsRollup.length > 0) {
    // Weekly rollup path: current-week volume/count + performers + precomputed streaks.
    for (const r of topsRollup) {
      if (!visibleIds.has(r.studentId) || r.completedRunning <= 0) continue;
      volume.set(r.studentId, (volume.get(r.studentId) ?? 0) + r.runningKm);
      count.set(r.studentId, (count.get(r.studentId) ?? 0) + r.completedRunning);
    }
    performersAll = finalizePerformers(performerCountsFromRollup(topsRollup), visibleById);
    for (const s of await loadStudentStreaks([...visibleIds])) {
      if (visibleIds.has(s.studentId)) streakByStudent.set(s.studentId, s.currentStreak);
    }
  } else if (C.isAggregatesEnabled()) {
    const agg = await loadDailyAggregates({ from, to: toTops, studentIds: [...visibleIds] });
    const weekAgg = agg.filter((a) => a.day >= range.from && a.day <= range.to);
    for (const a of agg) {
      if (!visibleIds.has(a.studentId) || a.completedRunning <= 0) continue;
      const days = activeDaysByStudent.get(a.studentId) ?? new Set<string>();
      days.add(a.day);
      activeDaysByStudent.set(a.studentId, days);
    }
    for (const a of weekAgg) {
      if (!visibleIds.has(a.studentId) || a.completedRunning <= 0) continue;
      volume.set(a.studentId, (volume.get(a.studentId) ?? 0) + a.runningKm);
      count.set(a.studentId, (count.get(a.studentId) ?? 0) + a.completedRunning);
    }
    performersAll = finalizePerformers(performerCountsFromAgg(weekAgg), visibleById);
    for (const [id, days] of activeDaysByStudent) streakByStudent.set(id, computeStreakDays(days, today));
  } else {
    const rows = await loadClubWorkoutRows({ from, to: toTops });
    const weekRows = rows.filter((r) => r.workoutDate >= range.from && r.workoutDate <= range.to);
    for (const row of rows) {
      if (!row.isCompleted || !row.isRunning || !visibleIds.has(row.studentId)) continue;
      const days = activeDaysByStudent.get(row.studentId) ?? new Set<string>();
      days.add(row.workoutDate);
      activeDaysByStudent.set(row.studentId, days);
    }
    for (const row of weekRows) {
      if (!row.isCompleted || !row.isRunning || !visibleIds.has(row.studentId)) continue;
      volume.set(row.studentId, (volume.get(row.studentId) ?? 0) + (row.distanceKm ?? 0));
      count.set(row.studentId, (count.get(row.studentId) ?? 0) + 1);
    }
    performersAll = buildWeekPerformers(weekRows, visibleById);
    for (const [id, days] of activeDaysByStudent) streakByStudent.set(id, computeStreakDays(days, today));
  }

  const nameOf = (id: string) => visibleById.get(id)?.displayName ?? fullName(visibleById.get(id)?.name ?? "");
  const monoOf = (id: string) => monogram(visibleById.get(id)?.name ?? "");
  const mkRow = (id: string, value: string): ClubTopRow => ({
    studentId: id,
    displayName: nameOf(id),
    monogram: monoOf(id),
    avatarUrl: C.isClubAvatarsEnabled() ? signAvatarPath(id) : null,
    value,
    isCurrentStudent: id === input.currentStudentId,
  });

  // Secondary key studentId asc makes tie order DETERMINISTIC and independent of Map
  // insertion order — so the raw path and the aggregate path (which iterate in different
  // orders) produce identical leaderboards. Applied to both paths (shared tail).
  const byStudentId = (a: readonly [string, number], b: readonly [string, number]) =>
    b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;

  const byVolume = [...volume.entries()]
    .sort(byStudentId)
    .slice(0, C.CLUB_EXTENDED_TOP_N)
    .map(([id, km]) => mkRow(id, `${km.toFixed(1).replace(".", ",")} км`));

  const byCount = [...count.entries()]
    .sort(byStudentId)
    .slice(0, C.CLUB_EXTENDED_TOP_N)
    .map(([id, n]) => mkRow(id, `${n} трен.`));

  const performers = performersAll.filter((p) => !p.noPlan);
  const byCompletion = performers
    .slice(0, C.CLUB_EXTENDED_TOP_N)
    .map((p) => mkRow(p.studentId, `${Math.round(p.completionPct * 100)}%`));

  const streaks = [...streakByStudent.entries()]
    .filter(([, s]) => s > 0)
    .sort(byStudentId)
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
  // Perf (UI-polish item 7): the member profile only ever uses THIS student's rows —
  // every consumer below filters to targetStudentId. Loading the whole club's window
  // (~20k rows) to then throw all-but-one away made the profile 6-12 s. Restrict the
  // read to the target student (studentIds) — same result, a fraction of the rows.
  const [students, rows, firstDate] = await Promise.all([
    loadClubStudents(),
    loadClubWorkoutRows({ from, to: today, studentIds: [input.targetStudentId] }),
    loadFirstWorkoutDate(input.targetStudentId),
  ]);
  const target = students.find((s) => s.id === input.targetStudentId);
  const isSelf = input.targetStudentId === input.currentStudentId;
  const canSee = Boolean(target) && (isSelf || (target ? isVisible(target) : false));

  const name = target?.name ?? "";
  if (!canSee) {
    return {
      studentId: input.targetStudentId,
      displayName: target?.displayName ?? fullName(name || "Участник клуба"),
      monogram: monogram(name || "•"),
      visible: false,
      weekKm: 0,
      monthKm: 0,
      streakDays: 0,
      joinDateLabel: null,
      last7Days: [],
      month30: { runs: 0, km: 0, movingSeconds: 0, avgPaceSecPerKm: null, ascentM: null },
      records: [],
      pastRaces: [],
      achievements: [],
      recentFeed: [],
      weeklySeries: [],
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
  // Pass club_records overrides so the profile screen shows official_protocol / strava_best_effort
  // consistently with the «Результаты» tab (no discrepancy between the two record surfaces).
  const records = await studentRecordsFromRows(ownRunning, input.targetStudentId, await loadClubRecordOverrides());
  annotateRaceSegments(records, await loadRaceEventsByDate(input.targetStudentId));

  // Screen 2 enrichment. Last-7-days activity strip (oldest → newest).
  const last7Days: ClubActivityDay[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = addDaysIso(today, -i);
    const dayRuns = ownRunning.filter((r) => r.workoutDate === d);
    const km = dayRuns.reduce((a, r) => a + (r.distanceKm ?? 0), 0);
    last7Days.push({ date: d, weekday: weekdayMon0(d), active: dayRuns.length > 0, km: Number(km.toFixed(1)) });
  }

  // Rolling 30-day running summary. Cache stores one duration (not moving-vs-elapsed), so
  // movingSeconds ≈ total workout time; ascent is summed from per-lap total_ascent_m.
  const m30From = addDaysIso(today, -29);
  const m30Rows = ownRunning.filter((r) => r.workoutDate >= m30From && r.workoutDate <= today);
  const m30Km = m30Rows.reduce((a, r) => a + (r.distanceKm ?? 0), 0);
  const m30Seconds = m30Rows.reduce((a, r) => a + (r.durationSeconds ?? 0), 0);
  const month30: ClubMonthSummary = {
    runs: m30Rows.length,
    km: Number(m30Km.toFixed(1)),
    movingSeconds: m30Seconds,
    avgPaceSecPerKm: m30Km > 0 && m30Seconds > 0 ? Math.round(m30Seconds / m30Km) : null,
    ascentM: await loadAscentForWorkouts(m30Rows.map((r) => r.id)),
  };

  // Achievements (rule + earned state): shown to everyone (club social layer, per Igor).
  const achievements = buildAchievements(ownRunning, rows, records).filter((a) => !a.stub || C.isStubsEnabled());
  // Past races with a real result = race-type records (date + distance + finish time).
  // Upcoming DECLARED races are intentionally NOT exposed on another member's profile.
  const pastRaces = records.filter((r) => r.recordType === "race");
  const joinDateLabel = firstDate ? formatRuDate(firstDate) : null;

  // Phase 3.9 weekly trend: last 12 ISO weeks of running volume (same shape as the
  // own-profile chart) so a member profile shows a trend, not just current totals.
  const weekMap = kmByWeek(ownRunning);
  const weeklySeries: ClubVolumePoint[] = [];
  let wkCursor = weekStartIso(today);
  const trendWeeks: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    trendWeeks.push(wkCursor);
    wkCursor = addDaysIso(wkCursor, -7);
  }
  trendWeeks.reverse();
  for (const wk of trendWeeks) {
    weeklySeries.push({ label: formatRuDate(wk), km: Number((weekMap.get(wk) ?? 0).toFixed(1)) });
  }

  const recentCompleted = rows
    .filter((r) => r.studentId === input.targetStudentId && r.isCompleted && r.family !== "day_off")
    .sort((a, b) => (a.workoutDate < b.workoutDate ? 1 : a.workoutDate > b.workoutDate ? -1 : 0))
    .slice(0, 8);
  const recentFeed: ClubFeedItem[] = recentCompleted.map((row) => {
    const label = typeLabel(row.family);
    return {
      id: row.id,
      studentId: row.studentId,
      studentDisplayName: target?.displayName ?? fullName(row.studentName),
      monogram: monogram(row.studentName),
      typeLabel: label,
      isRunning: row.isRunning,
      date: row.workoutDate,
      dateLabel: formatRuDate(row.workoutDate),
      distanceKm: row.distanceKm,
      durationSeconds: row.durationSeconds,
      paceSecPerKm: row.isRunning ? paceSecPerKm(row.distanceKm, row.durationSeconds) : null,
      avgHr: null,
      timeLabel: localStartHm(row.startTime),
      insight: null,
      title: cleanTitle(row.title),
      caption: sanitizeCaption(row.title, label),
      track: null,
      reactionsEnabled: C.isReactionsEnabled(),
      reactions: { like: 0, fire: 0 },
      mine: { like: false, fire: false },
    };
  });

  return {
    studentId: input.targetStudentId,
    displayName: target?.displayName ?? fullName(name),
    monogram: monogram(name),
    avatarUrl: C.isClubAvatarsEnabled() ? signAvatarPath(input.targetStudentId) : null,
    visible: true,
    weekKm: Number(weekKm.toFixed(1)),
    monthKm: Number(monthKm.toFixed(1)),
    streakDays: computeStreakDays(activeDays, today),
    joinDateLabel,
    last7Days,
    month30,
    records,
    pastRaces,
    achievements,
    recentFeed,
    weeklySeries,
  };
}

// ---------------------------------------------------------------------------
// Phase 3.8 — single-workout detail (tap from feed)
// ---------------------------------------------------------------------------

type DetailLapRow = {
  lap_index: number;
  distance_m: number | null;
  timer_time_s: number | null;
  elapsed_time_s: number | null;
  pace_sec_per_km: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_cadence: number | null;
  total_ascent_m: number | null;
};

/** Parse derived_metrics.time_in_zones (array of seconds OR {z1:sec,...}) → slices. */
function parseZones(raw: unknown, basis: "threshold_hr" | "max_hr_pct" | null): ClubZoneSlice[] {
  const label = (z: number) => `Зона ${z}`;
  const out: ClubZoneSlice[] = [];
  if (Array.isArray(raw)) {
    raw.forEach((v, i) => {
      const sec = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(sec) && sec > 0) out.push({ zone: i + 1, label: label(i + 1), seconds: Math.round(sec) });
    });
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const z = Number(String(k).replace(/[^0-9]/gu, ""));
      const sec = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(z) && z > 0 && Number.isFinite(sec) && sec > 0) {
        out.push({ zone: z, label: label(z), seconds: Math.round(sec) });
      }
    }
    out.sort((a, b) => a.zone - b.zone);
  }
  // basis is accepted for future labelling; currently only used to expose a hint.
  void basis;
  return out;
}

export async function getClubWorkoutDetail(input: {
  currentStudentId: string;
  workoutId: string;
}): Promise<ClubWorkoutDetailView | null> {
  const supabase = createSupabaseServerClient();
  const { data: cacheData, error: cacheErr } = await supabase
    .from("trainingpeaks_workout_cache")
    .select(WORKOUT_CACHE_COLUMNS)
    .eq("id", input.workoutId)
    .maybeSingle();
  if (cacheErr || !cacheData) {
    return null;
  }
  const row = mapWorkoutCacheRow(cacheData as Record<string, unknown>);

  // Authorization: the workout owner must be visible in the club, OR it is the
  // caller's own workout. Never expose a hidden student's workout via a guessed id.
  // Perf (item 6): fetch only the owner row, not the whole roster.
  const owner = await loadClubStudentById(row.studentId);
  const isSelf = row.studentId === input.currentStudentId;
  if (!isSelf && !(owner && isVisible(owner))) {
    return null;
  }

  // Perf (item 6): the three per-workout reads (laps, derived metrics, track) are
  // independent — fire them together instead of three sequential round-trips.
  const [lapResult, derivedResult, trackMap] = await Promise.all([
    supabase
      .from("trainingpeaks_workout_laps")
      .select("lap_index, distance_m, timer_time_s, elapsed_time_s, pace_sec_per_km, avg_hr, max_hr, avg_cadence, total_ascent_m")
      .eq("workout_cache_id", input.workoutId)
      .order("lap_index", { ascending: true }),
    supabase
      .from("trainingpeaks_workout_derived_metrics")
      .select("avg_hr, hr_trusted, time_in_zones, zone_basis")
      .eq("workout_cache_id", input.workoutId)
      .maybeSingle(),
    loadTracksForWorkouts([input.workoutId]),
  ]);
  const lapRows = (lapResult.data as DetailLapRow[] | null) ?? [];
  const derived = (derivedResult.data as { avg_hr: number | null; hr_trusted: boolean | null; time_in_zones: unknown; zone_basis: "threshold_hr" | "max_hr_pct" | null } | null) ?? null;
  const track = trackMap.get(input.workoutId) ?? null;

  // Phase 5: downsampled HR+pace-over-time series for the smooth detail chart (running GPS workouts,
  // new only). Separate tolerant read so the feed's track payload stays light and a missing column
  // (migration 20260822 not applied) degrades to "no chart".
  let series: Array<{ t: number; hr: number | null; pace: number | null }> | null = null;
  try {
    const { data: sData } = await supabase
      .from("trainingpeaks_workout_tracks")
      .select("series")
      .eq("workout_cache_id", input.workoutId)
      .maybeSingle();
    const raw = (sData as { series?: unknown } | null)?.series;
    if (Array.isArray(raw) && raw.length > 0) {
      series = raw as Array<{ t: number; hr: number | null; pace: number | null }>;
    }
  } catch {
    /* column absent → no chart */
  }

  const laps: ClubWorkoutLap[] = lapRows.map((l) => ({
    index: l.lap_index,
    distanceKm: l.distance_m != null && l.distance_m > 0 ? Number((l.distance_m / 1000).toFixed(2)) : null,
    durationSeconds: l.timer_time_s ?? l.elapsed_time_s ?? null,
    paceSecPerKm: l.pace_sec_per_km ?? null,
    avgHr: l.avg_hr != null && l.avg_hr > 0 ? Math.round(l.avg_hr) : null,
    avgCadence: l.avg_cadence != null && l.avg_cadence > 0 ? Math.round(l.avg_cadence) : null,
  }));

  // Aggregate metrics — prefer FIT-derived, fall back to lap aggregates.
  const avgHr = derived && derived.avg_hr && derived.avg_hr > 0 && derived.hr_trusted !== false ? Math.round(derived.avg_hr) : null;
  const maxHrFromLaps = lapRows.reduce<number | null>((m, l) => (l.max_hr && l.max_hr > 0 ? Math.max(m ?? 0, l.max_hr) : m), null);
  const cadenceVals = lapRows.map((l) => l.avg_cadence).filter((c): c is number => c != null && c > 0);
  const avgCadence = cadenceVals.length > 0 ? Math.round(cadenceVals.reduce((a, b) => a + b, 0) / cadenceVals.length) : null;
  const ascentSum = lapRows.reduce<number | null>((s, l) => (l.total_ascent_m != null ? (s ?? 0) + l.total_ascent_m : s), null);
  const zones = derived ? parseZones(derived.time_in_zones, derived.zone_basis) : [];
  const zoneBasisLabel = derived?.zone_basis === "threshold_hr" ? "по порогу ЧСС" : derived?.zone_basis === "max_hr_pct" ? "по % от макс. ЧСС" : null;

  // Stepwise climb profile from per-lap ascent (no per-point altitude): cumulative ascent
  // vs cumulative distance at each lap boundary. x falls back to lap index when distance
  // is absent. null when no lap carries ascent → the block is simply not drawn.
  const elevationProfile = ((): Array<{ km: number; elevM: number }> | null => {
    if (lapRows.length === 0) return null;
    let cumKm = 0;
    let cumAsc = 0;
    let anyAsc = false;
    const pts: Array<{ km: number; elevM: number }> = [{ km: 0, elevM: 0 }];
    for (const l of lapRows) {
      cumKm += l.distance_m != null && l.distance_m > 0 ? l.distance_m / 1000 : 0;
      if (l.total_ascent_m != null && l.total_ascent_m > 0) {
        cumAsc += l.total_ascent_m;
        anyAsc = true;
      }
      pts.push({ km: Number(cumKm.toFixed(2)), elevM: Math.round(cumAsc) });
    }
    if (!anyAsc) return null;
    return cumKm > 0 ? pts : pts.map((p, i) => ({ km: i, elevM: p.elevM }));
  })();

  return {
    id: row.id,
    studentId: row.studentId,
    studentDisplayName: owner?.displayName ?? fullName(row.studentName),
    monogram: monogram(row.studentName),
    avatarUrl: C.isClubAvatarsEnabled() ? signAvatarPath(row.studentId) : null,
    typeLabel: typeLabel(row.family),
    isRunning: row.isRunning,
    dateLabel: formatRuDate(row.workoutDate),
    title: cleanTitle(row.title),
    distanceKm: row.distanceKm,
    durationSeconds: row.durationSeconds,
    paceSecPerKm: row.isRunning ? paceSecPerKm(row.distanceKm, row.durationSeconds) : null,
    avgHr,
    maxHr: maxHrFromLaps != null ? Math.round(maxHrFromLaps) : null,
    // Device cadence is single-leg rpm; for RUNNING the readable metric is steps/min
    // (both feet) = x2. Cycling cadence stays rpm. Verified against real lap data
    // (median ~85 rpm, not ~170 spm) — Phase UI-polish item 2.
    avgCadence: row.isRunning && avgCadence ? avgCadence * 2 : avgCadence,
    ascentM: ascentSum != null && ascentSum > 0 ? Math.round(ascentSum) : null,
    laps,
    elevationProfile,
    series,
    zones,
    zoneBasisLabel,
    track,
    commentsEnabled: C.isCommentsEnabled(),
  };
}

// ---------------------------------------------------------------------------
// Phase D — comments on club workouts (first proper student write path)
// ---------------------------------------------------------------------------

/** "24 июл, 14:30" from a timestamptz ISO string. Local formatting only, no deps. */
function formatRuDateTime(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/u);
  if (!m) {
    return formatRuDate(iso);
  }
  const day = Number.parseInt(m[3], 10);
  const month = RU_MONTHS[Number.parseInt(m[2], 10) - 1] ?? "";
  return `${day} ${month}, ${m[4]}:${m[5]}`;
}

/**
 * A workout is commentable only when its owner is currently visible in the club
 * (active, non-service, and not opted out when privacy is on). Mirrors
 * isWorkoutReactable: refuses commenting on a hidden student's workout.
 */
export async function isWorkoutCommentable(workoutId: string): Promise<boolean> {
  return isWorkoutReactable(workoutId);
}

/** Whether a student is themselves currently visible in the club (may write). */
export async function isStudentClubVisible(studentId: string): Promise<boolean> {
  const students = await loadClubStudents();
  const me = students.find((s) => s.id === studentId);
  return me ? isVisible(me) : false;
}

/** Coarse rate limit: comments created by this student in the last window. */
export async function countRecentComments(studentId: string, windowSeconds: number): Promise<number> {
  const supabase = createSupabaseServerClient();
  const sinceIso = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count, error } = await supabase
    .from("club_comments")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .gte("created_at", sinceIso);
  if (error) {
    return 0;
  }
  return count ?? 0;
}

/**
 * Comments for ONE workout, oldest first, with author display name + whether the
 * caller owns each. Author names use the club display-name override; a comment whose
 * author is no longer visible in the club is still shown (they wrote it while active),
 * but is labelled by their stored name. Empty when comments are disabled.
 */
export async function loadWorkoutComments(workoutId: string, currentStudentId: string): Promise<ClubComment[]> {
  if (!C.isCommentsEnabled()) {
    return [];
  }
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("club_comments")
    .select("id, student_id, body, created_at, updated_at")
    .eq("workout_cache_id", workoutId)
    .order("created_at", { ascending: true });
  if (error) {
    return [];
  }
  const rows = (data as Array<{ id: string; student_id: string; body: string; created_at: string; updated_at: string | null }> | null) ?? [];
  if (rows.length === 0) {
    return [];
  }
  const students = await loadClubStudents();
  const byId = new Map(students.map((s) => [s.id, s]));
  return rows.map((r) => {
    const author = byId.get(r.student_id);
    const name = author?.displayName ?? "Участник клуба";
    return {
      id: r.id,
      studentId: r.student_id,
      authorName: name,
      monogram: monogram(author?.name ?? name),
      body: r.body,
      dateLabel: formatRuDateTime(r.created_at),
      edited: r.updated_at != null,
      mine: r.student_id === currentStudentId,
    };
  });
}

/** Fetch one comment's owner (for edit/delete authorization). Null if absent. */
export async function getCommentOwner(commentId: string): Promise<{ studentId: string; workoutId: string } | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("club_comments")
    .select("student_id, workout_cache_id")
    .eq("id", commentId)
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  const row = data as { student_id: string; workout_cache_id: string };
  return { studentId: row.student_id, workoutId: row.workout_cache_id };
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

  // Coach visibility toggle (Phase E): a coach may hide the forecast for a given
  // student. Tolerant of a missing column (migration 20260808 not applied) -> visible.
  const { data: visRow, error: visErr } = await supabase
    .from("trainingpeaks_students")
    .select("club_prediction_visible")
    .eq("id", input.currentStudentId)
    .maybeSingle();
  logClubDbError("getClubPrediction.visibility", visErr);
  if (visRow && (visRow as { club_prediction_visible?: boolean | null }).club_prediction_visible === false) {
    return none("Прогноз пока недоступен.");
  }

  const { data: raceRow, error: raceErr } = await supabase
    .from("club_races")
    .select("name, race_date, distance_meters, distance_label")
    .eq("student_id", input.currentStudentId)
    .in("status", ["declared", "approved"])
    .gte("race_date", today)
    .order("race_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  logClubDbError("getClubPrediction.race", raceErr);
  if (!raceRow) {
    return none("Прогноз появится, когда объявишь предстоящий старт.");
  }
  const race = raceRow as { name: string; distance_meters: number | null; distance_label: string | null };
  const targetM = race.distance_meters && race.distance_meters > 0 ? race.distance_meters : null;
  if (!targetM) {
    return none("У старта не указана дистанция - прогноз недоступен.");
  }

  const from = addDaysIso(today, -C.CLUB_RECORDS_WINDOW_DAYS);
  const rows = await loadClubWorkoutRows({ from, to: today });
  const own = rows.filter((r) => r.studentId === input.currentStudentId && r.isCompleted && r.isRunning);
  const allRecords = await studentRecordsFromRows(own, input.currentStudentId);
  // E-Predictor anchors on genuine race RESULTS only. Two things corrupt an anchor and are
  // excluded: (a) training-run segments (recordType != race); (b) a race record that is
  // itself a shorter SEGMENT of a LONGER race that day - e.g. a 21k best-split of a marathon
  // run at marathon pace, which would badly UNDER-predict a standalone 21k (the Ivoshin case).
  // Detect (b) by the RELIABLE signal, the source-workout distance (wholeDistanceKm), plus the
  // day's event distance where present (TP event distance is often empty/wrong for ultras, so
  // the workout distance is primary - per the Nazarov finding).
  const SEGMENT_RATIO = 1.6; // source effort > 1.6x nominal => a segment, not a race + cooldown
  const { data: evRows } = await supabase
    .from("trainingpeaks_race_events")
    .select("event_date, distance_km")
    .eq("student_id", input.currentStudentId)
    .gte("event_date", from);
  const eventMaxKmByDate = new Map<string, number>();
  for (const e of (evRows as Array<{ event_date: string | null; distance_km: number | null }> | null) ?? []) {
    const d = (e.event_date ?? "").slice(0, 10);
    const km = typeof e.distance_km === "number" ? e.distance_km : null;
    if (!d || km == null) continue;
    eventMaxKmByDate.set(d, Math.max(eventMaxKmByDate.get(d) ?? 0, km));
  }
  const isWithinLongerRace = (r: ClubRecordEntry): boolean => {
    const nominalKm = DISTANCE_METERS[r.distanceKey] / 1000;
    const workoutSeg = r.calcMethod === "best_split" && r.wholeDistanceKm != null && r.wholeDistanceKm > nominalKm * SEGMENT_RATIO;
    const evMax = eventMaxKmByDate.get(r.date);
    const eventSeg = evMax != null && evMax > nominalKm * SEGMENT_RATIO;
    return workoutSeg || eventSeg;
  };
  const raceRecords = allRecords.filter((r) => r.recordType === "race");
  const records = raceRecords.filter((r) => !isWithinLongerRace(r));
  if (records.length === 0) {
    return none(
      raceRecords.length > 0
        ? "Прогноз пока недоступен: в данных только отрезки внутри более длинных гонок - нужен самостоятельный старт на дистанции."
        : "Прогноз строится по результатам гонок - их пока нет в данных. Заяви старт или дождись синка забега."
    );
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

  // Step 4: reads collapsed to the calendar (transfer done). Declared races come from
  // club_calendar_entries kind='race' (lower priority); race_events below overrides. The
  // legacy club_races read is dropped: its rows were migrated into the calendar. Label
  // stays "club_races" for provenance (same logical source: student-declared).
  try {
    const { data } = await supabase
      .from("club_calendar_entries")
      .select("student_id, entry_date, status")
      .eq("kind", "race")
      .neq("status", "rejected");
    for (const row of (data as Array<{ student_id: string; entry_date: string }> | null) ?? []) {
      put(row.student_id, (row.entry_date ?? "").slice(0, 10), "club_races");
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

/**
 * ALL authoritative club_records for the records tab — one row per (student,distance) (club_records is
 * UNIQUE on that pair), so the row's `source` alone decides its slot:
 *   coach_confirmed / official_protocol → RACE slot (a race); strava_best_effort → TRAINING slot
 *   (a measured segment from a TRAINING, not a race). Hierarchy inside a slot: coach_confirmed >
 *   official_protocol > (snapshot race_events); strava_best_effort > (snapshot reconstruction).
 * ONE query — a broader IN filter than loadCoachRecords, so NO extra round-trip vs the old coach read
 * (the records tab already paid for exactly one club_records query; this is the same query, wider).
 */
export async function loadClubRecordOverrides(): Promise<Map<string, CoachRecord>> {
  const out = new Map<string, CoachRecord>();
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("club_records")
      .select("student_id, distance_key, duration_seconds, pace_sec_per_km, record_date, race_name, trust, source")
      .in("source", ["coach_confirmed", "official_protocol", "strava_best_effort"]);
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
        source: (r.source as string) ?? "",
      });
    }
  } catch {
    /* table/columns absent → no overrides */
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
  // Read through the END of the current week, not just `today`: the daily aggregates
  // must include this week's PLANNED-but-future workouts, because the challenge /
  // statistics / profile-rank consumers count planned running to range.to (week end).
  // Reading only to `today` under-counted planned → parity broke on the real DB.
  // Harmless for records: future planned rows are is_completed=false, so they never
  // become record candidates.
  const weekEnd = currentWeekRange().to;
  const readTo = weekEnd > today ? weekEnd : today;

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
    to: readTo,
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

  // Phase 1.4 daily aggregates — same incremental pass, scoped to the target students.
  // computeDailyAggregates is the single source of aggregation truth (also used by the
  // parity harness). Written unconditionally (read is gated by CLUB_AGGREGATES_ENABLED),
  // so the table is warm before the flag is flipped.
  const targetRows = visibleRows.filter((r) => targetSet.has(r.studentId));
  const aggDbRows = computeDailyAggregates(targetRows).map((a) => ({
    student_id: a.studentId,
    day: a.day,
    running_km: a.runningKm,
    completed_running: a.completedRunning,
    planned_running: a.plannedRunning,
    active_day: a.completedRunning > 0,
  }));
  // Phase 1.4 follow-up: weekly rollups + per-student streak (same pass, same targets).
  const weekRollupDbRows = computeWeekRollups(targetRows).map((r) => ({
    student_id: r.studentId,
    week_start: r.weekStart,
    running_km: r.runningKm,
    completed_running: r.completedRunning,
    planned_running: r.plannedRunning,
  }));
  const streakDbRows = computeStudentStreaks(targetRows, today).map((s) => ({
    student_id: s.studentId,
    current_streak: s.currentStreak,
  }));

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

  // Daily aggregates: scoped replace by the SAME target set. Additive + tolerant — if
  // the migration is not applied yet, log and continue (never break the records path
  // or the scan; the aggregates read is flag-gated and simply stays empty until then).
  try {
    for (const idChunk of chunkIds([...targetSet], 100)) {
      const { error } = await supabase.from("club_daily_aggregates").delete().in("student_id", idChunk);
      if (error) throw new Error(error.message);
    }
    for (const batch of chunkIds(aggDbRows, 500)) {
      const { error } = await supabase.from("club_daily_aggregates").insert(batch);
      if (error) throw new Error(error.message);
    }
  } catch (e) {
    console.warn(`materializeClubRecords: daily aggregates write skipped: ${(e as Error).message}`);
  }

  // Weekly rollups + streaks: scoped replace by the SAME target set. Tolerant — if the
  // migration is not applied yet, log and continue (read is flag-gated + daily fallback).
  try {
    for (const idChunk of chunkIds([...targetSet], 100)) {
      const { error: e1 } = await supabase.from("club_week_rollup").delete().in("student_id", idChunk);
      if (e1) throw new Error(e1.message);
      const { error: e2 } = await supabase.from("club_student_rollup").delete().in("student_id", idChunk);
      if (e2) throw new Error(e2.message);
    }
    for (const batch of chunkIds(weekRollupDbRows, 500)) {
      const { error } = await supabase.from("club_week_rollup").insert(batch);
      if (error) throw new Error(error.message);
    }
    for (const batch of chunkIds(streakDbRows, 500)) {
      const { error } = await supabase.from("club_student_rollup").insert(batch);
      if (error) throw new Error(error.message);
    }
  } catch (e) {
    console.warn(`materializeClubRecords: week rollups write skipped: ${(e as Error).message}`);
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
