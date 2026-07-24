/**
 * TrainingPeaks zone-boundary formulas (threshold → zones), as a typed, guarded
 * module. Source of truth: docs/tp-zone-formula.md (recovered from a UI capture +
 * verified against the 113-athlete tp_zone_snapshots). See that doc for provenance.
 *
 * WHY THIS IS A HARD GATE, NOT A CONVENIENCE:
 * A zone set carries a `calculationMethod` that SELECTS the boundary scheme. Only a
 * few (type, method) pairs have a verified formula. For every other method the
 * boundaries are NOT derived — writing zones for them would be guessing. So this
 * module exposes `getCoveredScheme()` which returns null for any uncovered method,
 * and the caller MUST refuse to write when it is null. Never substitute another
 * method's ratios.
 *
 * Coverage (from docs/tp-zone-formula.md, per workoutTypeId=0):
 *   speed  method 2  (105/113 athletes)  ✅ covered
 *   HR     method 1  (74/113)            ✅ covered
 *   HR     method 2  (9/113)             ✅ covered
 *   speed  methods 8, 1                  ❌ not derived — refuse
 *   HR     methods 24, 3, 0, 33          ❌ not derived — refuse
 *   power  (any)                         ⚠️ out of scope here (this CLI sets pace/HR only)
 *
 * The ratios below are each zone's `maximum` as a fraction of `threshold`, for
 * zones 1..(N-1). Zone 1's `minimum` is 0; the LAST zone's `maximum` is a fixed
 * cap TP stores as a sentinel (not threshold-derived) — we PRESERVE the athlete's
 * existing last-zone maximum rather than invent it. Threshold pace/LTHR sits at
 * the Z4/Z5a boundary (ratio ≈ 1.000 at index 3).
 */

export type ZoneType = "speed" | "heartRate";

export type CoveredScheme = {
  type: ZoneType;
  method: number;
  /** number of zones this scheme describes (ratios.length + 1) */
  zoneCount: number;
  /** zone maxima as a fraction of threshold, for zones 1..(N-1). Last zone = preserved cap. */
  ratios: number[];
  /** how a boundary value is rounded: HR/power are integer bpm/W; speed stays m/s float */
  rounding: "integer" | "float";
  /** min of zone i (i>=1): speed = prev.max exactly; HR = prev.max + 1 */
  minStep: 0 | 1;
};

// docs/tp-zone-formula.md — verified ratio families (dominant clusters).
const COVERED_SCHEMES: CoveredScheme[] = [
  {
    type: "speed",
    method: 2,
    zoneCount: 7,
    ratios: [0.775, 0.878, 0.944, 1.0, 1.033, 1.114],
    rounding: "float",
    minStep: 0,
  },
  {
    type: "heartRate",
    method: 1,
    zoneCount: 7,
    ratios: [0.81, 0.88, 0.93, 0.993, 1.02, 1.05],
    rounding: "integer",
    minStep: 1,
  },
  {
    type: "heartRate",
    method: 2,
    zoneCount: 7,
    ratios: [0.844, 0.89, 0.942, 0.994, 1.023, 1.064],
    rounding: "integer",
    minStep: 1,
  },
];

/** All uncovered methods we have SEEN on the roster, so the refusal message can be specific. */
const KNOWN_UNCOVERED: Record<ZoneType, number[]> = {
  speed: [8, 1],
  heartRate: [24, 3, 0, 33],
};

/**
 * Returns the verified scheme for a (type, method) pair, or null if that method's
 * formula is NOT derived. A null return MUST cause the caller to refuse the write.
 */
export function getCoveredScheme(type: ZoneType, method: number): CoveredScheme | null {
  return COVERED_SCHEMES.find((s) => s.type === type && s.method === method) ?? null;
}

/** Human explanation of why a method is refused (does it merely lack a formula, or is it a known-uncovered one). */
export function describeUncovered(type: ZoneType, method: number): string {
  const known = KNOWN_UNCOVERED[type]?.includes(method);
  const covered = COVERED_SCHEMES.filter((s) => s.type === type).map((s) => s.method);
  return (
    `calculationMethod ${method} for ${type} zones is NOT covered by a verified formula ` +
    `(${known ? "known-uncovered on the roster" : "unseen method"}). ` +
    `Covered ${type} methods: ${covered.join(", ") || "none"}. ` +
    `docs/tp-zone-formula.md derives only these; writing any other method would be guessing. Refusing.`
  );
}

export type ZoneBoundary = { label?: string; minimum: number; maximum: number };

export type RecomputeResult = {
  zones: ZoneBoundary[];
  /** threshold echoed back in the set's native unit (m/s for speed, bpm for HR) */
  thresholdNative: number;
};

/**
 * Recompute a zone set's boundaries from a NEW threshold using the covered scheme.
 * Pure function — no I/O. Preserves: zone COUNT (must match the scheme, else it throws
 * — we never reshape an athlete's zone count), each zone's `label`, and the LAST zone's
 * `maximum` (the sentinel cap). Recomputes zones 1..(N-1) maxima from ratios and chains
 * the minimums.
 *
 * @param existingZones the athlete's current zones[] for this set (to preserve labels + cap)
 * @param newThresholdNative new threshold in the set's native unit (m/s for speed, bpm for HR)
 */
export function recomputeZones(
  scheme: CoveredScheme,
  existingZones: ZoneBoundary[],
  newThresholdNative: number,
): RecomputeResult {
  if (existingZones.length !== scheme.zoneCount) {
    throw new ZoneShapeMismatchError(
      `athlete's set has ${existingZones.length} zones but the verified ${scheme.type} ` +
        `method-${scheme.method} formula describes ${scheme.zoneCount}. Not reshaping — refuse and inspect manually.`,
    );
  }
  const round = (v: number): number => (scheme.rounding === "integer" ? Math.round(v) : v);

  const out: ZoneBoundary[] = [];
  for (let i = 0; i < scheme.zoneCount; i += 1) {
    const isLast = i === scheme.zoneCount - 1;
    const label = existingZones[i]?.label;
    // maximum: recompute for zones 1..(N-1); preserve the sentinel cap for the last zone.
    const maximum = isLast ? existingZones[i].maximum : round(scheme.ratios[i] * newThresholdNative);
    // minimum: zone 1 starts at 0; later zones chain off the previous maximum.
    const minimum = i === 0 ? 0 : scheme.minStep === 1 ? out[i - 1].maximum + 1 : out[i - 1].maximum;
    out.push(label !== undefined ? { label, minimum, maximum } : { minimum, maximum });
  }
  return { zones: out, thresholdNative: newThresholdNative };
}

export class ZoneShapeMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZoneShapeMismatchError";
  }
}
