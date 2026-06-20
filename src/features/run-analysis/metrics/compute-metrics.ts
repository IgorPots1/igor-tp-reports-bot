import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { FootStrikeType, MetricSeverity, MetricStatus, RunMetrics } from "@/features/run-analysis/types";
import {
  classifyCadence,
  classifyFootStrike,
  classifyKneeAngle,
  classifyOverstride,
  classifyTrunkLean,
  classifyVerticalOscillation,
  NORM_DESCRIPTIONS,
} from "@/features/run-analysis/metrics/reference-ranges";

// MediaPipe Pose Landmarker indices
const IDX = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

type Point = { x: number; y: number };

function angleDeg(a: Point, vertex: Point, b: Point): number {
  const va = { x: a.x - vertex.x, y: a.y - vertex.y };
  const vb = { x: b.x - vertex.x, y: b.y - vertex.y };
  const dot = va.x * vb.x + va.y * vb.y;
  const magA = Math.hypot(va.x, va.y);
  const magB = Math.hypot(vb.x, vb.y);
  if (magA === 0 || magB === 0) return 180;
  return Math.acos(Math.max(-1, Math.min(1, dot / (magA * magB)))) * (180 / Math.PI);
}

// In normalized coords, y increases downward. Vertical vector pointing up is (0, -1).
function trunkLeanDeg(shoulder: Point, hip: Point): number {
  const vec = { x: shoulder.x - hip.x, y: shoulder.y - hip.y };
  const mag = Math.hypot(vec.x, vec.y);
  if (mag === 0) return 0;
  // Angle between (shoulder-hip) and upward vertical (0, -1)
  const cosA = -vec.y / mag; // dot with (0, -1)
  return Math.acos(Math.max(-1, Math.min(1, cosA))) * (180 / Math.PI);
}

// Pick the side (left/right) with better combined landmark visibility
function chooseSide(frame: NormalizedLandmark[]): "left" | "right" {
  const lv =
    (frame[IDX.leftHip]?.visibility ?? 0) +
    (frame[IDX.leftKnee]?.visibility ?? 0) +
    (frame[IDX.leftAnkle]?.visibility ?? 0);
  const rv =
    (frame[IDX.rightHip]?.visibility ?? 0) +
    (frame[IDX.rightKnee]?.visibility ?? 0) +
    (frame[IDX.rightAnkle]?.visibility ?? 0);
  return lv >= rv ? "left" : "right";
}

function sideIdx(side: "left" | "right") {
  return side === "left"
    ? { shoulder: IDX.leftShoulder, hip: IDX.leftHip, knee: IDX.leftKnee, ankle: IDX.leftAnkle, heel: IDX.leftHeel, foot: IDX.leftFootIndex }
    : { shoulder: IDX.rightShoulder, hip: IDX.rightHip, knee: IDX.rightKnee, ankle: IDX.rightAnkle, heel: IDX.rightHeel, foot: IDX.rightFootIndex };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

// Simple local-minima detector for cadence (foot strikes = local maxima of y in normalized coords)
function findLocalMaxima(values: number[], minGap: number): number[] {
  const peaks: number[] = [];
  for (let i = minGap; i < values.length - minGap; i++) {
    const v = values[i] ?? 0;
    let isPeak = true;
    for (let j = i - minGap; j <= i + minGap; j++) {
      if (j !== i && (values[j] ?? 0) >= v) {
        isPeak = false;
        break;
      }
    }
    if (isPeak) peaks.push(i);
  }
  return peaks;
}

export type ComputeMetricsInput = {
  frames: NormalizedLandmark[][];
  fps: number;
  durationSec: number;
};

export type ComputeMetricsOutput = {
  metrics: RunMetrics;
  metricStatuses: Record<string, MetricStatus>;
};

export function computeMetrics({ frames, fps, durationSec }: ComputeMetricsInput): ComputeMetricsOutput {
  if (frames.length === 0) {
    return {
      metrics: emptyMetrics(fps, durationSec),
      metricStatuses: buildStatuses(emptyMetrics(fps, durationSec)),
    };
  }

  const side = chooseSide(frames[Math.floor(frames.length / 2)] ?? []);
  const idx = sideIdx(side);

  // ── Trunk lean: median across all frames with decent visibility
  const trunkAngles: number[] = [];
  for (const frame of frames) {
    const sh = frame[idx.shoulder];
    const hp = frame[idx.hip];
    if ((sh?.visibility ?? 0) > 0.5 && (hp?.visibility ?? 0) > 0.5) {
      trunkAngles.push(trunkLeanDeg(sh!, hp!));
    }
  }
  const trunkLeanDegValue = trunkAngles.length > 5 ? Math.round(median(trunkAngles) * 10) / 10 : null;

  // ── Vertical oscillation: range of hip y-position normalised by body height
  const hipYValues: number[] = [];
  const bodyHeights: number[] = [];
  for (const frame of frames) {
    const hp = frame[idx.hip];
    const sh = frame[idx.shoulder];
    const an = frame[idx.ankle];
    if ((hp?.visibility ?? 0) > 0.5) hipYValues.push(hp!.y);
    if ((sh?.visibility ?? 0) > 0.5 && (an?.visibility ?? 0) > 0.5) {
      bodyHeights.push(Math.abs(sh!.y - an!.y));
    }
  }
  let vertOscPct: number | null = null;
  if (hipYValues.length > 10 && bodyHeights.length > 5) {
    const hipRange = Math.max(...hipYValues) - Math.min(...hipYValues);
    const avgBodyH = bodyHeights.reduce((s, v) => s + v, 0) / bodyHeights.length;
    if (avgBodyH > 0) vertOscPct = Math.round((hipRange / avgBodyH) * 100 * 10) / 10;
  }

  // ── Cadence: count foot strikes via local maxima of ankle y-position
  const ankleY = frames.map((f) => f[idx.ankle]?.y ?? 0);
  const minGapFrames = Math.max(3, Math.round(fps * 0.2)); // ~200 ms min between strikes
  const strikePeaks = findLocalMaxima(ankleY, minGapFrames);
  // Two consecutive ankle peaks = one gait cycle
  const gaitCycles = strikePeaks.length > 1 ? strikePeaks.length - 1 : 0;
  const cadenceSpm =
    strikePeaks.length >= 2 && durationSec > 0
      ? Math.round((strikePeaks.length / durationSec) * 60)
      : null;

  // ── Knee angle at ground contact (peak ankle y frame = approximate ground contact)
  const kneeAngles: number[] = [];
  for (const peakIdx of strikePeaks) {
    const frame = frames[peakIdx];
    if (!frame) continue;
    const hp = frame[idx.hip];
    const kn = frame[idx.knee];
    const an = frame[idx.ankle];
    if ((hp?.visibility ?? 0) > 0.5 && (kn?.visibility ?? 0) > 0.5 && (an?.visibility ?? 0) > 0.5) {
      kneeAngles.push(angleDeg(hp!, kn!, an!));
    }
  }
  const kneeAngleDeg = kneeAngles.length > 0 ? Math.round(median(kneeAngles) * 10) / 10 : null;

  // ── Overstride: at ground contact, is foot ahead of hip (positive x-delta)?
  // Side facing camera determines sign convention.
  const overstrideVals: number[] = [];
  const legLengths: number[] = [];
  for (const peakIdx of strikePeaks) {
    const frame = frames[peakIdx];
    if (!frame) continue;
    const hp = frame[idx.hip];
    const an = frame[idx.ankle];
    const kn = frame[idx.knee];
    if ((hp?.visibility ?? 0) > 0.5 && (an?.visibility ?? 0) > 0.5 && (kn?.visibility ?? 0) > 0.5) {
      const legLen = Math.hypot(hp!.x - an!.x, hp!.y - an!.y);
      legLengths.push(legLen);
      // For running viewed from the right side, runner moves left-to-right; foot ahead = greater x.
      // We use signed delta: positive = foot in front of hip.
      const delta = an!.x - hp!.x;
      if (legLen > 0) overstrideVals.push((delta / legLen) * 100);
    }
  }
  const overstridePct = overstrideVals.length > 0 ? Math.round(median(overstrideVals) * 10) / 10 : null;

  // ── Foot strike type: at ground contact, compare heel vs ball-of-foot y
  const footStrikeVotes: FootStrikeType[] = [];
  for (const peakIdx of strikePeaks) {
    const frame = frames[peakIdx];
    if (!frame) continue;
    const heel = frame[idx.heel];
    const ball = frame[idx.foot];
    if ((heel?.visibility ?? 0) > 0.4 && (ball?.visibility ?? 0) > 0.4) {
      const heelY = heel!.y;
      const ballY = ball!.y;
      // In normalized coords y↑ = higher on screen. Lower number = higher up.
      // Ground contact: whichever has higher y (lower position) hits first.
      const diff = heelY - ballY; // positive = heel lower = heel strikes first
      if (diff > 0.02) footStrikeVotes.push("heel");
      else if (diff < -0.02) footStrikeVotes.push("forefoot");
      else footStrikeVotes.push("midfoot");
    }
  }
  const footStrike: FootStrikeType = majorityVote(footStrikeVotes);

  const metrics: RunMetrics = {
    cadenceSpm,
    kneeAngleDeg,
    trunkLeanDeg: trunkLeanDegValue,
    verticalOscillationPct: vertOscPct,
    overstridePct,
    footStrike,
    framesAnalyzed: frames.length,
    gaitCyclesDetected: gaitCycles,
    videoFps: fps,
    videoDurationSec: durationSec,
  };

  return { metrics, metricStatuses: buildStatuses(metrics) };
}

function majorityVote(votes: FootStrikeType[]): FootStrikeType {
  if (votes.length === 0) return "unknown";
  const counts: Record<string, number> = {};
  for (const v of votes) counts[v] = (counts[v] ?? 0) + 1;
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] as FootStrikeType) ?? "unknown";
}

function emptyMetrics(fps: number, durationSec: number): RunMetrics {
  return {
    cadenceSpm: null,
    kneeAngleDeg: null,
    trunkLeanDeg: null,
    verticalOscillationPct: null,
    overstridePct: null,
    footStrike: "unknown",
    framesAnalyzed: 0,
    gaitCyclesDetected: 0,
    videoFps: fps,
    videoDurationSec: durationSec,
  };
}

function buildStatuses(m: RunMetrics): Record<string, MetricStatus> {
  function status(
    value: number | string | null,
    unit: string,
    label: string,
    normDescription: string,
    severity: MetricSeverity
  ): MetricStatus {
    return { value, unit, severity, label, normDescription };
  }

  const cadSev: MetricSeverity = m.cadenceSpm != null ? classifyCadence(m.cadenceSpm) : "attention";
  const kneeSev: MetricSeverity = m.kneeAngleDeg != null ? classifyKneeAngle(m.kneeAngleDeg) : "attention";
  const trunkSev: MetricSeverity = m.trunkLeanDeg != null ? classifyTrunkLean(m.trunkLeanDeg) : "attention";
  const vertSev: MetricSeverity = m.verticalOscillationPct != null ? classifyVerticalOscillation(m.verticalOscillationPct) : "attention";
  const overSev: MetricSeverity = m.overstridePct != null ? classifyOverstride(m.overstridePct) : "attention";
  const fsSev: MetricSeverity = classifyFootStrike(m.footStrike);

  return {
    cadence: status(m.cadenceSpm, "шаг/мин", "Каденс", NORM_DESCRIPTIONS.cadence, cadSev),
    kneeAngle: status(m.kneeAngleDeg, "°", "Угол колена при опоре", NORM_DESCRIPTIONS.kneeAngle, kneeSev),
    trunkLean: status(m.trunkLeanDeg, "°", "Наклон корпуса вперёд", NORM_DESCRIPTIONS.trunkLean, trunkSev),
    verticalOscillation: status(m.verticalOscillationPct, "% роста", "Вертикальная осцилляция", NORM_DESCRIPTIONS.verticalOscillation, vertSev),
    overstride: status(m.overstridePct, "%", "Оверстрайд (вынос стопы)", NORM_DESCRIPTIONS.overstride, overSev),
    footStrike: status(m.footStrike, "", "Тип приземления", NORM_DESCRIPTIONS.footStrike, fsSev),
  };
}
