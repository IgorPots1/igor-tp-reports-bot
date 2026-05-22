export const VDOT_STYLE_CONFIG_VERSION = "vdot-style.v1";

export const VDOT_STYLE_DEFAULT_RIEGEL_EXPONENT = 1.06;

export const VDOT_STYLE_STANDARD_DISTANCES = {
  "5k": 5000,
  "10k": 10000,
  "15k": 15000,
  half: 21097.5,
  marathon: 42195,
} as const;

export type VdotStyleDistanceKey = keyof typeof VDOT_STYLE_STANDARD_DISTANCES;

export type VdotStyleDistancePairKey =
  `${VdotStyleDistanceKey}->${VdotStyleDistanceKey}`;

export type VdotStyleDistancePairOverrideMap = Partial<
  Record<VdotStyleDistancePairKey, number>
>;

export const VDOT_STYLE_DISTANCE_PAIR_OVERRIDES: VdotStyleDistancePairOverrideMap =
  {};

export const VDOT_STYLE_TEN_K_PACE_MULTIPLIERS = {
  easy: { min_pct: 1.25, max_pct: 1.4 },
  marathon: { min_pct: 1.08, max_pct: 1.12 },
  threshold: { min_pct: 1.02, max_pct: 1.06 },
  interval: { min_pct: 0.95, max_pct: 0.99 },
  repetition: { min_pct: 0.88, max_pct: 0.93 },
} as const;

export type VdotStyleZoneName = keyof typeof VDOT_STYLE_TEN_K_PACE_MULTIPLIERS;

export const VDOT_STYLE_ZONE_ORDER_FASTEST_TO_SLOWEST = [
  "repetition",
  "interval",
  "threshold",
  "marathon",
  "easy",
] as const satisfies readonly VdotStyleZoneName[];

export const VDOT_STYLE_VERDICT_THRESHOLDS = {
  agree_max_pct: 0.02,
  mild_disagree_max_pct: 0.05,
} as const;

export const VDOT_STYLE_STALENESS_THRESHOLD_DAYS = 120;
