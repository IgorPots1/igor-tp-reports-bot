// Club Mini App (/m/club) — tunable constants. Kept isolated from /m/desk and
// /m/n. All windows/thresholds live here so they can be revised without touching
// the service logic. See docs/miniapp-club-plan.md §5 and docs/questions.md.

/** Timezone used for "week"/"month"/"today" windows (club feed, challenge, streak). */
export const CLUB_TIMEZONE = "Europe/Belgrade";

/** How many days back the club feed scans the cache. Small club → a few hundred rows max. */
export const CLUB_FEED_WINDOW_DAYS = 45;

/** Page size for the infinite feed. */
export const CLUB_FEED_PAGE_SIZE = 20;

/** How far back records reconstruction looks. */
export const CLUB_RECORDS_WINDOW_DAYS = 365;

/** How many club athletes to show per distance in the club records leaderboard. */
export const CLUB_RECORDS_TOP_N = 5;

/** Distance targets for personal records, reconstructed from completed running workouts. */
export const CLUB_RECORD_DISTANCES: Array<{
  key: "5k" | "10k" | "21k" | "42k";
  meters: number;
  km: number;
  label: string;
  /** 5k is flagged preliminary by design (naryad): short, most sensitive to band noise. */
  alwaysPreliminary: boolean;
}> = [
  { key: "5k", meters: 5000, km: 5, label: "5 км", alwaysPreliminary: true },
  { key: "10k", meters: 10000, km: 10, label: "10 км", alwaysPreliminary: false },
  { key: "21k", meters: 21097, km: 21.097, label: "21.1 км", alwaysPreliminary: false },
  { key: "42k", meters: 42195, km: 42.195, label: "42.2 км", alwaysPreliminary: false },
];

/** Distance corridor around a target to count a workout as that distance (naryad: ±500 m). */
export const CLUB_RECORD_BAND_KM = 0.5;

/** Narrow corridor that on its own qualifies a record as reliable (tight distance match). */
export const CLUB_RECORD_NARROW_BAND_KM = 0.15;

/** Max coefficient of variation of per-lap pace for a record to count as "reliable". */
export const CLUB_RECORD_PACE_CV_RELIABLE = 0.08;

/**
 * Club challenge goal (total km) — FIXTURE. Coach OS has no challenge/goal table,
 * so this target is a placeholder. The PROGRESS (club km) is real; only the goal
 * is demo. Never present this as a real target. See docs/questions.md §4.
 */
export const CLUB_CHALLENGE_GOAL_KM_FIXTURE = 500;

/** How many "красавчики недели" rows to surface. */
export const CLUB_TOP_PERFORMERS_N = 5;
