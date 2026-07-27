// Club Mini App (/m/club) — view contracts shared between the service layer and
// the client page. Read-only; nothing here is written back to TrainingPeaks.

export type ClubFreshness = {
  /** ISO timestamp of the most recent cache scan, or null if the cache is empty. */
  latestScannedAt: string | null;
  /** Human-friendly relative label, e.g. "обновлено 12 мин назад". */
  label: string | null;
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
  /** Workout title (title fill-rate ~100%), shown on the feed card. */
  title: string | null;
  /** Short neutral caption derived from the workout title (safe subset). */
  caption: string | null;
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

export type ClubChallengeView = {
  clubKm: number;
  goalKm: number;
  /** True → goal is a demo/fixture value (Coach OS has no real goal source). */
  goalIsFixture: boolean;
  progressPct: number;
  weekLabel: string;
  /** How the goal was resolved: auto (prev week + factor) | manual | fixture. */
  goalMode: "auto" | "manual" | "fixture";
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
  hint: string;
  earned: boolean;
  earnedDateLabel: string | null;
  /** demo card (data not available yet) — only surfaced under CLUB_STUBS_ENABLED. */
  stub: boolean;
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

export type ClubPublicProfileView = {
  studentId: string;
  displayName: string;
  monogram: string;
  visible: boolean;
  weekKm: number;
  monthKm: number;
  streakDays: number;
  records: ClubRecordEntry[];
  recentFeed: ClubFeedItem[];
};
