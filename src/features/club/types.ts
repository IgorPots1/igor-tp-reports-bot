// Club Mini App (/m/club) — view contracts shared between the service layer and
// the client page. Read-only; nothing here is written back to TrainingPeaks.

export type ClubFreshness = {
  /** ISO timestamp of the most recent cache scan, or null if the cache is empty. */
  latestScannedAt: string | null;
  /** Human-friendly relative label, e.g. "обновлено 12 мин назад". */
  label: string | null;
};

// Phase 4 — GPS route silhouette (simplified polyline + bbox). Optional everywhere
// so nothing changes when CLUB_TRACKS_ENABLED is off (always null then).
export type ClubTrack = {
  /** [lat, lng] pairs, 50–150 points. */
  polyline: Array<[number, number]>;
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  pointCount: number;
};

export type ClubFeedItem = {
  id: string;
  /** Owner student id — enables tap-through to a public profile (respecting privacy). */
  studentId: string;
  studentDisplayName: string;
  monogram: string;
  /** Human-readable activity type, e.g. "Бег". Gender-neutral. */
  typeLabel: string;
  isRunning: boolean;
  /** Workout date, ISO (YYYY-MM-DD). */
  date: string;
  dateLabel: string;
  distanceKm: number | null;
  durationSeconds: number | null;
  paceSecPerKm: number | null;
  /** Average heart rate (bpm) from FIT-derived metrics, when available. */
  avgHr: number | null;
  /** Local wall-clock start "07:30" - only when start_time is a trustworthy local value
   * (naive-local or offset-carrying). null for UTC/absent (we never show a time we can't trust). */
  timeLabel: string | null;
  /** Short insight vs the athlete's OWN recent history at a comparable distance, e.g.
   * "На 6% быстрее обычного". null when not running / too few comparable runs / not faster. */
  insight: string | null;
  /** Workout title (title fill-rate ~100%), shown on the feed card. */
  title: string | null;
  /** Short neutral caption derived from the workout title (safe subset). */
  caption: string | null;
  /** Phase 4: GPS route silhouette (null when no track / feature off). */
  track: ClubTrack | null;
  /** Whether the reactions row is interactive (CLUB_REACTIONS_ENABLED). */
  reactionsEnabled: boolean;
  /** Aggregate reaction counts (real when reactions enabled, else zero). */
  reactions: { like: number; fire: number };
  /** Whether THIS student already reacted (for toggle state). */
  mine: { like: boolean; fire: boolean };
};

export type ClubFeedView = {
  items: ClubFeedItem[];
  /** Opaque cursor for the next page, or null when exhausted. */
  nextCursor: string | null;
  freshness: ClubFreshness;
};

export type ClubTopPerformer = {
  studentId: string;
  displayName: string;
  monogram: string;
  /** Completion ratio 0..1 (completed running workouts / planned running workouts). */
  completionPct: number;
  plannedCount: number;
  completedCount: number;
  /** True when the athlete had no planned running workouts this week (ratio undefined). */
  noPlan: boolean;
  isCurrentStudent: boolean;
};

// Phase C — one admin-managed challenge with live club + personal progress.
export type ClubChallengeGoalType = "km" | "workouts";
export type ClubChallengeItem = {
  id: string;
  title: string;
  goalType: ClubChallengeGoalType;
  goalValue: number;
  startsAt: string;
  endsAt: string;
  dateLabel: string;
  daysLeft: number;
  /** Club total toward the goal (km sum, or completed running workouts), over participants. */
  clubProgress: number;
  personalProgress: number;
  progressPct: number;
  /** all = whole visible club; selected = a chosen subset. */
  participantScope: "all" | "selected";
  participantCount: number;
};

export type ClubChallengeView = {
  clubKm: number;
  goalKm: number;
  /** True → goal is a demo/fixture value (Coach OS has no real goal source). */
  goalIsFixture: boolean;
  progressPct: number;
  weekLabel: string;
  /** How the goal was resolved: auto (prev week + factor) | manual | fixture. */
  goalMode: "auto" | "manual" | "fixture";
  /** Phase C: active admin challenges (empty → the auto club-km challenge above is shown). */
  challenges: ClubChallengeItem[];
  /** Phase C: period the красавчики list is computed over. */
  performersPeriod: "week" | "month";
  performersPeriodLabel: string;
  topPerformers: ClubTopPerformer[];
  personal: {
    contributionKm: number;
    contributionPct: number;
    completionPct: number;
    plannedCount: number;
    completedCount: number;
    noPlan: boolean;
  } | null;
  freshness: ClubFreshness;
};

import type { RecordSource, RecordTrust } from "./records";

export type ClubRecordEntry = {
  distanceKey: "5k" | "10k" | "21k" | "42k";
  distanceLabel: string;
  durationSeconds: number;
  paceSecPerKm: number | null;
  date: string;
  dateLabel: string;
  /** verified | preliminary (hidden records are never emitted to the UI). */
  trust: RecordTrust;
  /** reconstructed for now; schema leaves room for official_protocol / coach_confirmed. */
  source: RecordSource;
  /** best_split (fastest continuous segment) | whole_workout (fallback, no laps). */
  calcMethod: "best_split" | "whole_workout";
  /** race (declared-race date / coach-confirmed) vs training_split (segment of a training run). */
  recordType: "race" | "training_split";
};

export type ClubRecordsClubTopRow = {
  distanceKey: "5k" | "10k" | "21k" | "42k";
  rank: number;
  studentId: string;
  displayName: string;
  monogram: string;
  durationSeconds: number;
  paceSecPerKm: number | null;
  isCurrentStudent: boolean;
  /** Club tops only ever contain verified records. */
  trust: RecordTrust;
  /** Club tops only ever contain real races. */
  recordType: "race";
};

export type ClubRecordsView = {
  /** Current student's personal records, one per distance (missing distances omitted). */
  personal: ClubRecordEntry[];
  /** Club leaderboards per distance. */
  clubTops: Array<{
    distanceKey: "5k" | "10k" | "21k" | "42k";
    distanceLabel: string;
    alwaysPreliminary: boolean;
    rows: ClubRecordsClubTopRow[];
  }>;
  freshness: ClubFreshness;
};

export type ClubProfileView = {
  displayName: string;
  monogram: string;
  weekKm: number;
  monthKm: number;
  streakDays: number;
  records: ClubRecordEntry[];
  challengeRank: number | null;
  challengeParticipants: number;
  completionPct: number;
  noPlan: boolean;
};

// --- Stage A: extended BUILD views ---

export type ClubTypeBreakdown = { family: string; label: string; count: number; km: number };

export type ClubVolumePoint = { label: string; km: number };

export type ClubAchievement = {
  code: string;
  title: string;
  /** The rule, in plain words (Phase 3.5) — always shown so the badge is never cryptic. */
  hint: string;
  earned: boolean;
  earnedDateLabel: string | null;
  /** demo card (data not available yet) — only surfaced under CLUB_STUBS_ENABLED. */
  stub: boolean;
  /** Progress toward earning (Phase 3.5). null for binary/one-off achievements. */
  progress: { current: number; target: number; unit: string } | null;
};

export type ClubProfileDetailView = ClubProfileView & {
  yearKm: number;
  bestWeekKm: number;
  bestWeekLabel: string | null;
  /** Last ~12 ISO weeks of running volume, for a lightweight SVG chart. */
  weeklySeries: ClubVolumePoint[];
  typeBreakdown: ClubTypeBreakdown[];
  achievements: ClubAchievement[];
  /** Current club visibility of THIS student (for the profile opt-out toggle). */
  clubVisible: boolean;
  /** Whether the opt-out toggle is live (CLUB_PRIVACY_ENABLED); UI hint only. */
  privacyEnabled: boolean;
  freshness: ClubFreshness;
};

export type ClubStatisticsView = {
  weekLabel: string;
  clubKm: number;
  activeCount: number;
  workoutsCount: number;
  avgCompletionPct: number;
  prevClubKm: number;
  weekOverWeekPct: number | null;
  freshness: ClubFreshness;
};

export type ClubTopRow = {
  studentId: string;
  displayName: string;
  monogram: string;
  value: string;
  isCurrentStudent: boolean;
};

export type ClubExtendedTopsView = {
  weekLabel: string;
  byVolume: ClubTopRow[];
  byCount: ClubTopRow[];
  byCompletion: ClubTopRow[];
  byStreak: ClubTopRow[];
  freshness: ClubFreshness;
};

// --- Cabinet sections (blocks 6/7/8) ---

export type ClubRaceStatus = "declared" | "approved" | "synced_to_tp" | "rejected";
export type ClubRace = {
  id: string;
  name: string;
  raceDate: string;
  dateLabel: string;
  distanceLabel: string | null;
  city: string | null;
  targetResultSeconds: number | null;
  status: ClubRaceStatus;
};

export type ClubDayoffStatus = "pending" | "approved" | "rejected" | "applied";
export type ClubDayoffRequest = {
  id: string;
  fromDate: string;
  toDate: string;
  reason: string | null;
  status: ClubDayoffStatus;
};

export type ClubWish = {
  id: string;
  dateLabel: string;
  loadScale: number | null;
  wellbeingScale: number | null;
  scheduleScale: number | null;
  note: string | null;
};

// Phase 5 — unified 45-day calendar entry.
export type ClubCalendarKind = "day_off" | "preference" | "note" | "race";
export type ClubCalendarPreferredType = "long" | "intervals" | "rest";
export type ClubCalendarStatus = "pending" | "approved" | "rejected" | "applied";

export type ClubCalendarEntry = {
  id: string;
  date: string; // ISO YYYY-MM-DD
  kind: ClubCalendarKind;
  preferredType: ClubCalendarPreferredType | null;
  note: string | null;
  /** day_off: TP Availability reason enum (Appointment/Injury/Sick/Vacation/Work/Other) or null. */
  dayOffReason: string | null;
  raceName: string | null;
  raceCity: string | null;
  raceDistanceLabel: string | null;
  raceTargetSeconds: number | null;
  status: ClubCalendarStatus;
};

export type ClubCalendarDay = {
  date: string;
  dateLabel: string;
  weekday: number; // 0=Mon..6=Sun
  isToday: boolean;
  entries: ClubCalendarEntry[];
};

// Phase B — a known upcoming race (from trainingpeaks_race_events) offered as autofill
// in the calendar race form, so the student taps instead of retyping.
export type ClubRaceSuggestion = {
  date: string;
  dateLabel: string;
  title: string;
  distanceLabel: string | null;
};

export type ClubCalendarView = {
  active: boolean;
  /** True when the calendar READ failed with a REAL DB error (permission/column/other) rather
   * than an absent table — the client shows a generic "напиши тренеру", not an empty calendar. */
  loadError?: boolean;
  fromDate: string;
  toDate: string;
  days: ClubCalendarDay[];
  /** Phase B: this student's known upcoming races for the race-form autofill. */
  raceSuggestions: ClubRaceSuggestion[];
};

export type ClubBillingView = {
  available: boolean;
  note: string;
  /** Human status label, e.g. "Оплачено" / "Ожидается" / "Просрочено 3 дн.". */
  status: string | null;
  statusKind: "paid" | "due" | "overdue" | "unknown";
  /** Next planned payment date (ISO) if known. */
  nextDueDate: string | null;
  /** Planned amount label, e.g. "3500 ₽". NO card/requisite/PII fields ever. */
  amountLabel: string | null;
  history: Array<{ label: string; amount: string | null }>;
  /**
   * T-Bank payment link (from CLUB_TBANK_PAYMENT_URL). The mini app opens it via
   * Telegram.WebApp.openLink (in-app browser), never renders payment fields itself.
   * null when unconfigured.
   */
  payUrl: string | null;
};

export type ClubPrediction = {
  available: boolean;
  reason: string;
  raceName: string | null;
  distanceLabel: string | null;
  low: number | null; // seconds
  high: number | null;
  recomputedLabel: string | null;
  basedOn: string | null;
};

/** One day in the last-7-days activity strip on a participant profile. */
export type ClubActivityDay = {
  date: string;
  weekday: number; // 0=Mon..6=Sun
  active: boolean; // had a completed running workout
  km: number;
};

/** Rolling 30-day running summary on a participant profile. */
export type ClubMonthSummary = {
  runs: number;
  km: number;
  movingSeconds: number; // sum of workout durations (cache has one time, not moving-vs-elapsed)
  avgPaceSecPerKm: number | null;
  ascentM: number | null; // sum of per-lap total_ascent_m over the window (null when no lap data)
};

export type ClubPublicProfileView = {
  studentId: string;
  displayName: string;
  monogram: string;
  visible: boolean;
  weekKm: number;
  monthKm: number;
  streakDays: number;
  /** First cached workout date "в клубе с …" (member-since). null when unknown. */
  joinDateLabel: string | null;
  /** Last 7 days activity strip (oldest → newest). */
  last7Days: ClubActivityDay[];
  /** Rolling 30-day running summary. */
  month30: ClubMonthSummary;
  records: ClubRecordEntry[];
  /** Past races with a real result (race-type records: date + distance + finish time). */
  pastRaces: ClubRecordEntry[];
  /** Achievements with rule + earned state (shown to everyone: club social layer). */
  achievements: ClubAchievement[];
  recentFeed: ClubFeedItem[];
  /** Phase 3.9: last ~12 ISO weeks of running volume (weekly trend). */
  weeklySeries: ClubVolumePoint[];
};

// --- Phase 3.8: single-workout detail (tap from the feed) ---

export type ClubWorkoutLap = {
  index: number;
  distanceKm: number | null;
  durationSeconds: number | null;
  paceSecPerKm: number | null;
  avgHr: number | null;
  avgCadence: number | null;
};

/** One heart-rate zone slice (seconds in zone), when time_in_zones is present. */
export type ClubZoneSlice = { zone: number; label: string; seconds: number };

export type ClubWorkoutDetailView = {
  id: string;
  studentId: string;
  studentDisplayName: string;
  monogram: string;
  typeLabel: string;
  isRunning: boolean;
  dateLabel: string;
  title: string | null;
  /** Metrics grid — each null when unavailable (shown only when present). */
  distanceKm: number | null;
  durationSeconds: number | null;
  paceSecPerKm: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  ascentM: number | null;
  /** Per-lap breakdown (empty when no FIT laps for this workout). */
  laps: ClubWorkoutLap[];
  /** HR zones (empty when time_in_zones absent). */
  zones: ClubZoneSlice[];
  zoneBasisLabel: string | null;
  /** Phase 4: GPS route silhouette (null when no track / feature off). */
  track: ClubTrack | null;
  /** Phase D: whether the comments UI is interactive (CLUB_COMMENTS_ENABLED). */
  commentsEnabled: boolean;
};

/** Phase D: a single student comment on a club workout. */
export type ClubComment = {
  id: string;
  studentId: string;
  authorName: string;
  monogram: string;
  body: string;
  /** e.g. "24 июл, 14:30". */
  dateLabel: string;
  /** Author edited the comment after posting. */
  edited: boolean;
  /** True when the current caller is the author (can edit/delete). */
  mine: boolean;
};
