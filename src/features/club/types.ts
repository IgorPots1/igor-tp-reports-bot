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
  /** Short neutral caption derived from the workout title (safe subset). */
  caption: string | null;
  /** Placeholder so the UI can reserve room for future reactions (disabled in v1). */
  reactionsEnabled: false;
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
  topPerformers: ClubTopPerformer[];
  personal: {
    contributionKm: number;
    contributionPct: number;
    completionPct: number;
    plannedCount: number;
    completedCount: number;
    noPlan: boolean;
  } | null;
};

export type ClubRecordEntry = {
  distanceKey: "5k" | "10k" | "21k" | "42k";
  distanceLabel: string;
  durationSeconds: number;
  paceSecPerKm: number | null;
  date: string;
  dateLabel: string;
  /** false → shown as "предварительно" (weak band match / no pace-stability evidence). */
  reliable: boolean;
};

export type ClubRecordsClubTopRow = {
  distanceKey: "5k" | "10k" | "21k" | "42k";
  rank: number;
  displayName: string;
  monogram: string;
  durationSeconds: number;
  paceSecPerKm: number | null;
  isCurrentStudent: boolean;
  reliable: boolean;
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
