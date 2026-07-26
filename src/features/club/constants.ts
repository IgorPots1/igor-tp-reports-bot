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

/**
 * Upper pace bound (sec/km): a "record" slower than this is walking / a mixed
 * activity, not a continuous running effort => hidden (not_running). Second layer
 * behind the derived workout_type check. 12:00/km is generous — real slow runners
 * stay under it, walks (e.g. "5k за 2:16" ≈ 27:00/km) are cut. */
export const CLUB_RECORD_PACE_CEILING_SEC_PER_KM = 720;

/** |sum(lap distance) - total| / total above this => broken record => hidden (lap_distance_mismatch). */
export const CLUB_RECORD_LAP_DISTANCE_TOLERANCE = 0.05;

/** Implied VDOT above the athlete's own other-distance VDOT by more than this => hidden (self_outlier). */
export const CLUB_RECORD_SELF_OUTLIER_VDOT_MARGIN = 8;

/**
 * Absolute VDOT plausibility ceiling for a RECONSTRUCTED training split, applied
 * ALWAYS — it is the backstop the relative self-outlier check cannot provide when
 * the athlete's OTHER distances are ALSO corrupt-fast (a 0:26/km "5k" makes the
 * reference VDOT itself garbage, defeating a relative comparison). A2 finding
 * (2026-07, restored 2026-07-27): a single member's 21k best-split read ~3:01/km
 * (implied VDOT ~76) from broken lap data and surfaced as a VERIFIED club record.
 * 65 sits far above this club's real training level (median paces 5:30–7:00/km) so
 * it cuts only broken data, never a genuine fast member. Coach-confirmed races
 * bypass reconstruction entirely and are unaffected. */
export const CLUB_RECORD_ABSOLUTE_VDOT_CEILING = 65;

/**
 * Physically-impossible VDOT — no human reaches it (world records sit ~85). A
 * candidate implying more than this is corrupt data (e.g. a 0:26/km "5k" from
 * broken lap distance). Such candidates are EXCLUDED from the athlete's reference
 * VDOT so they cannot poison the relative self-outlier check for other distances (A2). */
export const CLUB_RECORD_MAX_HUMAN_VDOT = 85;

/**
 * A1 — meaningfulness filter for TRAINING SPLITS (races / coach_confirmed exempt).
 * Diagnosis (2026-07): many surfaced "records" were within 5% of the athlete's usual
 * pace — a best segment barely faster than an easy run is not a result worth showing.
 * A training_split surfaces ONLY if its pace is at least this fraction FASTER (lower
 * sec/km) than the athlete's baseline; otherwise → "нет данных". BLOCKER for enabling
 * the tab on students. Applied at MATERIALIZE time (not read), so the tab stays fast.
 */
export const CLUB_RECORD_MEANINGFUL_SPLIT_MARGIN = 0.05;
/** Baseline = median whole-workout pace over completed runs ≥ this distance (km). */
export const CLUB_RECORD_BASELINE_MIN_KM = 2;
/** Need at least this many usable runs to trust a baseline; fewer → no baseline → split hidden. */
export const CLUB_RECORD_BASELINE_MIN_RUNS = 5;
/** Paces faster than this (sec/km) are broken data, excluded from the baseline. */
export const CLUB_RECORD_BASELINE_PACE_FLOOR_SEC_PER_KM = 150;
/** Meaningfulness filter switch. ON by default (only explicit "false" disables) — it is a SAFETY filter. */
export function isMeaningfulSplitFilterEnabled(): boolean {
  return process.env.CLUB_RECORDS_MEANINGFUL_FILTER !== "false";
}

/**
 * A3 — use TrainingPeaks device mean-max peaks (club_tp_peaks) as the training-split
 * source, with the lap best-split heuristic as fallback. OFF by default; inert until
 * the table is backfilled. The A1 filter + plausibility checks apply on top.
 */
export function isTpPeaksEnabled(): boolean {
  return process.env.CLUB_RECORDS_TP_PEAKS === "true";
}

/**
 * Best-continuous-split reconstruction (local analogue of Strava best_efforts).
 * ON by default. A recorded race is usually LONGER than the target distance
 * (warm-up / run-in in the same file) → timing the whole file underrates the
 * result. Instead we take the fastest contiguous lap-segment whose summed distance
 * covers the target. Falls back to whole-workout when laps are missing.
 */
export function isBestSplitEnabled(): boolean {
  // Default ON — only an explicit "false" disables it.
  return process.env.CLUB_RECORDS_BEST_SPLIT !== "false";
}
/** A lap-segment counts for a target if its summed distance is within this band above target. */
export const CLUB_SPLIT_OVER_TOLERANCE_M = 500;
/** …and may fall at most this far UNDER target (lap granularity slack). */
export const CLUB_SPLIT_UNDER_TOLERANCE_M = 60;

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
/**
 * Auto-goal anchor: a rolling average of club km over the last N COMPLETED weeks.
 * Averaging ACTUALS (not previous goals) means the bar self-corrects and never
 * compounds away from reality. The bar is nudged up by RAISE_STEP only when the
 * club actually beat its average last week — otherwise it holds at the average.
 */
export const CLUB_CHALLENGE_ROLLING_WEEKS = 4;
export const CLUB_CHALLENGE_RAISE_STEP = 0.1;
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
// Cabinet sections — all OFF by default (blind rollout).
export function isRacesEnabled(): boolean {
  return process.env.CLUB_RACES_ENABLED === "true";
}
export function isWishesEnabled(): boolean {
  return process.env.CLUB_WISHES_ENABLED === "true";
}
export function isBillingEnabled(): boolean {
  return process.env.CLUB_BILLING_ENABLED === "true";
}
export function isPredictionEnabled(): boolean {
  return process.env.CLUB_PREDICTION_ENABLED === "true";
}
export function isDayoffEnabled(): boolean {
  return process.env.CLUB_DAYOFF_ENABLED === "true";
}
/**
 * Phase 3 — executing approved club requests (starts / days off) INTO TrainingPeaks
 * via the existing assisted-write pipeline. OFF by default. The highest-risk flag:
 * it is the only path that turns a club request into a real TP mutation. Even ON,
 * every action still goes dry-run → coach confirm → local runner → verify → rollback;
 * nothing auto-applies. Keep OFF until the rollout explicitly enables it.
 */
export function isClubTpExecutionEnabled(): boolean {
  return process.env.CLUB_TP_EXECUTION_ENABLED === "true";
}
/** Phase 4 — coach-facing payment-reminder drafts screen. OFF by default. */
export function isClubBillingRemindersEnabled(): boolean {
  return process.env.CLUB_BILLING_REMINDERS_ENABLED === "true";
}
/**
 * Phase 4 — future auto-send of reminders WITHOUT coach confirmation. OFF, and
 * intentionally not wired to any sender. Placeholder for a later decision; today
 * every reminder is a draft the coach confirms. Do NOT enable.
 */
export function isClubBillingReminderAutosendEnabled(): boolean {
  return process.env.CLUB_BILLING_REMINDER_AUTOSEND_ENABLED === "true";
}
/** Days-before-due to start reminding (config, default 3). */
export function clubBillingReminderDaysBefore(): number {
  const raw = Number(process.env.CLUB_BILLING_REMINDER_DAYS_BEFORE ?? "3");
  return Number.isFinite(raw) && raw >= 0 ? raw : 3;
}
