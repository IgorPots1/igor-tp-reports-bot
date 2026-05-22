import {
  VDOT_STYLE_ZONE_ORDER_FASTEST_TO_SLOWEST,
  type VdotStyleZoneName,
} from "./constants.ts";
import type { TrainingZones } from "./zones.ts";

export type SegmentClassificationZone =
  | VdotStyleZoneName
  | "slower_than_easy"
  | "faster_than_repetition";

export type SegmentBoundaryLabel =
  | "repetition/interval"
  | "interval/threshold"
  | "threshold/marathon"
  | "marathon/easy";

export type SegmentClassification = {
  zone: SegmentClassificationZone;
  boundary_label?: SegmentBoundaryLabel;
  margin_to_zone_center_sec: number;
  nearest_zone: VdotStyleZoneName;
  distance_supported: string[];
  notes: string[];
};

type ZoneMeta = {
  zoneName: VdotStyleZoneName;
  centerPaceSec: number;
  minPaceSec: number;
  maxPaceSec: number;
};

const DISTANCE_SUPPORT_MAP: Record<
  SegmentClassificationZone | SegmentBoundaryLabel,
  string[]
> = {
  repetition: ["speed"],
  interval: ["5k", "10k"],
  threshold: ["10k", "half"],
  marathon: ["half", "marathon"],
  easy: [],
  faster_than_repetition: ["speed"],
  slower_than_easy: [],
  "repetition/interval": ["speed", "5k", "10k"],
  "interval/threshold": ["10k", "half"],
  "threshold/marathon": ["10k", "half", "marathon"],
  "marathon/easy": ["half", "marathon"],
};

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
}

function zoneCenterPaceSec(minPaceSec: number, maxPaceSec: number): number {
  return (minPaceSec + maxPaceSec) / 2;
}

function buildZoneMeta(zones: TrainingZones): ZoneMeta[] {
  return VDOT_STYLE_ZONE_ORDER_FASTEST_TO_SLOWEST.map((zoneName) => {
    const zone = zones[zoneName];
    return {
      zoneName,
      centerPaceSec: zoneCenterPaceSec(
        zone.min_pace_sec_per_km,
        zone.max_pace_sec_per_km,
      ),
      minPaceSec: zone.min_pace_sec_per_km,
      maxPaceSec: zone.max_pace_sec_per_km,
    };
  });
}

function nearestZoneForPace(
  paceSecondsPerKm: number,
  zoneMeta: ZoneMeta[],
): ZoneMeta {
  let best = zoneMeta[0]!;
  let bestDistance = Math.abs(paceSecondsPerKm - best.centerPaceSec);

  for (const candidate of zoneMeta.slice(1)) {
    const candidateDistance = Math.abs(paceSecondsPerKm - candidate.centerPaceSec);
    if (candidateDistance < bestDistance) {
      best = candidate;
      bestDistance = candidateDistance;
    }
  }

  return best;
}

function boundaryLabelBetween(
  fasterZone: VdotStyleZoneName,
  slowerZone: VdotStyleZoneName,
): SegmentBoundaryLabel {
  if (fasterZone === "repetition" && slowerZone === "interval") return "repetition/interval";
  if (fasterZone === "interval" && slowerZone === "threshold") return "interval/threshold";
  if (fasterZone === "threshold" && slowerZone === "marathon") return "threshold/marathon";
  if (fasterZone === "marathon" && slowerZone === "easy") return "marathon/easy";
  throw new Error(`Unsupported boundary between ${fasterZone} and ${slowerZone}.`);
}

function classificationNotes(
  paceSecondsPerKm: number,
  nearestZone: VdotStyleZoneName,
  zoneMeta: ZoneMeta[],
): string[] {
  const notes = [
    "Phase A classification uses equivalent 10K pace plus percentage-based pace bands.",
  ];

  const nearest = zoneMeta.find((zone) => zone.zoneName === nearestZone);
  if (!nearest) return notes;

  const delta = Math.round(paceSecondsPerKm - nearest.centerPaceSec);
  if (delta === 0) {
    notes.push(`Pace sits on the ${nearestZone} zone center.`);
  } else if (delta < 0) {
    notes.push(`Pace is ${Math.abs(delta)} s/km faster than the ${nearestZone} zone center.`);
  } else {
    notes.push(`Pace is ${delta} s/km slower than the ${nearestZone} zone center.`);
  }

  return notes;
}

export function classifySegmentPace(
  paceSecondsPerKm: number,
  zones: TrainingZones,
): SegmentClassification {
  assertPositiveFinite(paceSecondsPerKm, "paceSecondsPerKm");

  const zoneMeta = buildZoneMeta(zones);
  const nearest = nearestZoneForPace(paceSecondsPerKm, zoneMeta);

  const fastestZone = zoneMeta[0]!;
  if (paceSecondsPerKm < fastestZone.minPaceSec) {
    return {
      zone: "faster_than_repetition",
      margin_to_zone_center_sec: Math.round(paceSecondsPerKm - nearest.centerPaceSec),
      nearest_zone: nearest.zoneName,
      distance_supported: DISTANCE_SUPPORT_MAP.faster_than_repetition,
      notes: classificationNotes(paceSecondsPerKm, nearest.zoneName, zoneMeta),
    };
  }

  const slowestZone = zoneMeta[zoneMeta.length - 1]!;
  if (paceSecondsPerKm > slowestZone.maxPaceSec) {
    return {
      zone: "slower_than_easy",
      margin_to_zone_center_sec: Math.round(paceSecondsPerKm - nearest.centerPaceSec),
      nearest_zone: nearest.zoneName,
      distance_supported: DISTANCE_SUPPORT_MAP.slower_than_easy,
      notes: classificationNotes(paceSecondsPerKm, nearest.zoneName, zoneMeta),
    };
  }

  for (const zone of zoneMeta) {
    if (paceSecondsPerKm >= zone.minPaceSec && paceSecondsPerKm <= zone.maxPaceSec) {
      return {
        zone: zone.zoneName,
        margin_to_zone_center_sec: Math.round(paceSecondsPerKm - zone.centerPaceSec),
        nearest_zone: zone.zoneName,
        distance_supported: DISTANCE_SUPPORT_MAP[zone.zoneName],
        notes: classificationNotes(paceSecondsPerKm, zone.zoneName, zoneMeta),
      };
    }
  }

  for (let index = 0; index < zoneMeta.length - 1; index += 1) {
    const fasterZone = zoneMeta[index]!;
    const slowerZone = zoneMeta[index + 1]!;
    if (
      paceSecondsPerKm > fasterZone.maxPaceSec &&
      paceSecondsPerKm < slowerZone.minPaceSec
    ) {
      const boundary = boundaryLabelBetween(fasterZone.zoneName, slowerZone.zoneName);
      return {
        zone: nearest.zoneName,
        boundary_label: boundary,
        margin_to_zone_center_sec: Math.round(paceSecondsPerKm - nearest.centerPaceSec),
        nearest_zone: nearest.zoneName,
        distance_supported: DISTANCE_SUPPORT_MAP[boundary],
        notes: classificationNotes(paceSecondsPerKm, nearest.zoneName, zoneMeta),
      };
    }
  }

  throw new Error("Unable to classify pace against training zones.");
}
