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

/** Max coefficient of variation of per-lap pace for a record to reach `verified`. */
export const CLUB_RECORD_PACE_CV_RELIABLE = 0.08;

/**
 * Fastest physically plausible pace (sec/km) per distance. A reconstructed record
 * faster than this is `hidden` (pace_too_fast) — the data is broken, not heroic.
 * Set to elite ceilings WITH margin for the strongest club runner, so only
 * impossible values get cut.
 */
export const CLUB_RECORD_PACE_FLOOR_SEC_PER_KM: Record<"5k" | "10k" | "21k" | "42k", number> = {
  "5k": 150, // 12:30 over 5k
  "10k": 155, // ~25:50 over 10k
  "21k": 165, // ~58:00 half
  "42k": 175, // ~2:03 full
};

/** elapsed/moving ratio above 1+this => paused effort => hidden (pause_gap). */
export const CLUB_RECORD_PAUSE_TOLERANCE = 0.1;

/** |sum(lap distance) - total| / total above this => broken record => hidden (lap_distance_mismatch). */
export const CLUB_RECORD_LAP_DISTANCE_TOLERANCE = 0.05;

/** Implied VDOT above the athlete's own other-distance VDOT by more than this => hidden (self_outlier). */
export const CLUB_RECORD_SELF_OUTLIER_VDOT_MARGIN = 8;

/**
 * Club challenge goal (total km) — FIXTURE. Coach OS has no challenge/goal table,
 * so this target is a placeholder. The PROGRESS (club km) is real; only the goal
 * is demo. Never present this as a real target. See docs/questions.md §4.
 */
export const CLUB_CHALLENGE_GOAL_KM_FIXTURE = 500;

/** How many "красавчики недели" rows to surface. */
export const CLUB_TOP_PERFORMERS_N = 5;

/** How many rows per extended top (volume / count / completion / streak). */
export const CLUB_EXTENDED_TOP_N = 5;

/**
 * Challenge goal source. Default `auto` (last completed week's club km * factor)
 * — honest and data-driven. `manual` reads a club_challenges row (migration file,
 * not applied). `fixture` is the last-resort demo value. Overridable via env
 * CLUB_CHALLENGE_GOAL_MODE.
 */
export type ClubChallengeGoalMode = "auto" | "manual" | "fixture";
export function resolveChallengeGoalMode(): ClubChallengeGoalMode {
  const raw = (process.env.CLUB_CHALLENGE_GOAL_MODE ?? "auto").toLowerCase();
  return raw === "manual" || raw === "fixture" ? raw : "auto";
}
/** Auto-goal = last week's club km * this factor, rounded up to a tidy step. */
export const CLUB_CHALLENGE_AUTO_FACTOR = 1.1;
export const CLUB_CHALLENGE_AUTO_ROUND_STEP = 10;

/**
 * Deterministic achievements derivable from cache alone (no XP). `kind` drives the
 * service evaluator; `stub: true` marks badges whose data does not exist yet — shown
 * only as demo cards under CLUB_STUBS_ENABLED, never as earned in prod.
 */
export type ClubAchievementRule = {
  code: string;
  title: string;
  hint: string;
  kind:
    | "first_distance" // first completed run at/over a distance
    | "month_volume" // >= N km in a calendar month
    | "streak" // >= N consecutive days with a run
    | "week_full_completion" // a week with 100% planned completion
    | "total_volume"; // cumulative >= N km
  param?: number;
  distanceKey?: "5k" | "10k" | "21k" | "42k";
  stub?: boolean;
};

export const CLUB_ACHIEVEMENT_RULES: ClubAchievementRule[] = [
  { code: "first_10k", title: "Первая десятка", hint: "Пробежать 10 км", kind: "first_distance", distanceKey: "10k" },
  { code: "first_21k", title: "Первый полумарафон", hint: "Пробежать 21.1 км", kind: "first_distance", distanceKey: "21k" },
  { code: "first_42k", title: "Первый марафон", hint: "Пробежать 42.2 км", kind: "first_distance", distanceKey: "42k" },
  { code: "month_100k", title: "100 км за месяц", hint: "Набрать 100 км в одном месяце", kind: "month_volume", param: 100 },
  { code: "month_200k", title: "200 км за месяц", hint: "Набрать 200 км в одном месяце", kind: "month_volume", param: 200 },
  { code: "streak_10", title: "10 дней подряд", hint: "10 дней подряд с пробежкой", kind: "streak", param: 10 },
  { code: "week_100pct", title: "Идеальная неделя", hint: "Неделя со 100% выполнением плана", kind: "week_full_completion" },
  { code: "total_1000k", title: "1000 км всего", hint: "1000 км суммарно", kind: "total_volume", param: 1000 },
];

export function isReactionsEnabled(): boolean {
  return process.env.CLUB_REACTIONS_ENABLED === "true";
}
export function isPrivacyEnabled(): boolean {
  return process.env.CLUB_PRIVACY_ENABLED === "true";
}
export function isStubsEnabled(): boolean {
  return process.env.CLUB_STUBS_ENABLED === "true";
}
