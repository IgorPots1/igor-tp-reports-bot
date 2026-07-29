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
 * Coverage (from docs/tp-zone-formula.md + snapshot recovery, per workoutTypeId=0):
 *   speed  method 2  (105/113 athletes)  ✅ covered (7 zones, sentinel cap, zone1 min 0)
 *   speed  method 8  (7/113)             ✅ covered (5 zones, NO sentinel, zone1 min ~0.56×)
 *   HR     method 1  (74/113)            ✅ covered
 *   HR     method 2  (9/113)             ✅ covered
 *   speed  method 1  (1/113)             ❌ single athlete → not derivable — refuse
 *   HR     methods 24, 3, 0, 33          ❌ not derived — refuse
 *   power  (any)                         ⚠️ out of scope here (this CLI sets pace/HR only)
 *
 * The ratios below are each zone's `maximum` as a fraction of `threshold`. Per scheme:
 * `firstZoneMinRatio` sets zone 1's minimum (0, or ~0.56× for method 8); middles chain
 * off the previous maximum; `lastZoneIsCap` says whether the top zone is a preserved
 * sentinel (method 2 / HR) or formula-derived (method 8). All ratios verified to
 * reproduce stored zones within rounding across each method's roster athletes.
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
  /**
   * Is the LAST zone's maximum a fixed sentinel cap (preserve on recompute), or is it
   * formula-derived (ratios has an entry for it too)? Method-2 speed / HR schemes cap the
   * top zone with a sentinel (1000/1609/255) — ratios covers zones 1..N-1, last preserved.
   * Method-8 speed has NO sentinel: the top zone max is 1.20×threshold, so ratios covers
   * ALL N zones and the last is recomputed like the rest.
   */
  lastZoneIsCap: boolean;
  /** zone-1 minimum as a fraction of threshold. 0 for method-2/HR (zone 1 starts at 0);
   *  method-8 speed starts zone 1 at ~0.56×threshold (verified across its 7 athletes). */
  firstZoneMinRatio: number;
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
    lastZoneIsCap: true,
    firstZoneMinRatio: 0,
  },
  {
    // Speed method 8 (5-zone %threshold scheme). Recovered + verified from 7 roster
    // athletes' snapshots: max/threshold ratios reproduce stored zones within 0.01 m/s
    // for 6/7 (1 has a hand-edited zone, as method-2 also has exceptions). Threshold sits
    // BETWEEN zone 3 (0.97×) and zone 4 (1.02×); the top zone is 1.20×threshold, not a
    // sentinel — so every zone is formula-derived (lastZoneIsCap: false).
    type: "speed",
    method: 8,
    zoneCount: 5,
    ratios: [0.7198, 0.9102, 0.9698, 1.02, 1.2002],
    rounding: "float",
    minStep: 0,
    lastZoneIsCap: false,
    firstZoneMinRatio: 0.5602,
  },
  {
    type: "heartRate",
    method: 1,
    zoneCount: 7,
    ratios: [0.81, 0.88, 0.93, 0.993, 1.02, 1.05],
    rounding: "integer",
    minStep: 1,
    lastZoneIsCap: true,
    firstZoneMinRatio: 0,
  },
  {
    type: "heartRate",
    method: 2,
    zoneCount: 7,
    ratios: [0.844, 0.89, 0.942, 0.994, 1.023, 1.064],
    rounding: "integer",
    minStep: 1,
    lastZoneIsCap: true,
    firstZoneMinRatio: 0,
  },
];

/** All uncovered methods we have SEEN on the roster, so the refusal message can be specific. */
const KNOWN_UNCOVERED: Record<ZoneType, number[]> = {
  speed: [1], // method 8 now derived; method 1 speed has a single roster athlete → not derivable
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
    // maximum: recompute from ratios; the LAST zone is preserved ONLY when it's a sentinel
    // cap (lastZoneIsCap). When the top is formula-derived (method 8), recompute it too.
    const maximum = isLast && scheme.lastZoneIsCap ? existingZones[i].maximum : round(scheme.ratios[i] * newThresholdNative);
    // minimum: zone 1 = firstZoneMinRatio×threshold (0 for method-2/HR; ~0.56× for method 8);
    // later zones chain off the previous maximum.
    const minimum = i === 0 ? round(scheme.firstZoneMinRatio * newThresholdNative) : scheme.minStep === 1 ? out[i - 1].maximum + 1 : out[i - 1].maximum;
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
