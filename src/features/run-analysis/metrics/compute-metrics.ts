import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type {
  AnalysisQuality,
  FootStrikeType,
  MeasuredMetric,
  MetricConfidence,
  MetricReason,
  MetricSeverity,
  MetricStatus,
  RunMetrics,
  VerticalOscillationMetric,
} from "@/features/run-analysis/types";
import {
  classifyFootStrike,
  classifyKneeAngle,
  classifyOverstride,
  classifyTrunkLean,
  classifyVerticalOscillation,
  classifyVerticalOscillationBand,
  CONFIDENCE_CONFIG as CFG,
  NORM_DESCRIPTIONS,
  SHOULDER_ANKLE_HEIGHT_FRACTION,
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
  const cosA = -vec.y / mag; // dot with (0, -1)
  return Math.acos(Math.max(-1, Math.min(1, cosA))) * (180 / Math.PI);
}

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

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// Ground-contact frames ≈ local maxima of ankle y-position (lowest point on screen).
// These are MID-STANCE peaks — use for oscillation cycle timing.
// For foot-strike / overstride / knee metrics, use findContactOnsets() instead.
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

// Find the initial-contact (first-touch) frame for each mid-stance peak.
// Strategy: scan backward from the peak. The contact plateau starts where ankle.y
// first rises into the "ground zone" (within groundProximity of the nadir).
// One frame before that is still in swing → onset = that frame + 1.
function findContactOnsets(ankleY: number[], peaks: number[], fps: number): number[] {
  const maxLookback = Math.round(fps * CFG.contactOnsetLookbackSec);
  const proximity = CFG.contactOnsetGroundProximity;
  return peaks.map((peak) => {
    const yPeak = ankleY[peak] ?? 0;
    for (let i = peak - 1; i >= Math.max(0, peak - maxLookback); i--) {
      if ((ankleY[i] ?? 0) < yPeak - proximity) {
        return i + 1; // frame i was in swing; i+1 is first contact
      }
    }
    // Fallback: no clear swing-to-ground transition found; use ~50ms before peak
    return Math.max(0, peak - Math.max(1, Math.round(fps * 0.05)));
  });
}

// Least-squares linear detrend; returns detrended series (NaN preserved) and the
// total linear drift across the clip (the "camera-motion / pan" signal).
function linearDetrend(values: number[]): { detrended: number[]; trendAmplitude: number } {
  const pts: [number, number][] = [];
  values.forEach((v, i) => {
    if (Number.isFinite(v)) pts.push([i, v]);
  });
  const n = pts.length;
  if (n < 2) return { detrended: values.slice(), trendAmplitude: 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of pts) {
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  const slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
  const intercept = (sy - slope * sx) / n;
  const detrended = values.map((v, i) => (Number.isFinite(v) ? v - (slope * i + intercept) : NaN));
  const trendAmplitude = Math.abs(slope) * (values.length - 1);
  return { detrended, trendAmplitude };
}

// Per-cycle peak-to-trough amplitude of (detrended) hip y between adjacent contacts.
function perCycleAmplitude(detrended: number[], contacts: number[]): number[] {
  const amps: number[] = [];
  for (let i = 0; i < contacts.length - 1; i++) {
    const a = contacts[i] ?? 0;
    const b = contacts[i + 1] ?? 0;
    let mn = Infinity, mx = -Infinity;
    for (let j = a; j <= b; j++) {
      const v = detrended[j];
      if (Number.isFinite(v)) {
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    if (mx > mn) amps.push(mx - mn);
  }
  return amps;
}

// Mean visibility of a set of landmark indices across frames.
function meanVisibility(frames: NormalizedLandmark[][], indices: number[]): number {
  const vis: number[] = [];
  for (const frame of frames) {
    for (const id of indices) {
      vis.push(frame[id]?.visibility ?? 0);
    }
  }
  return mean(vis);
}

// Grade a contact-based metric (knee / overstride / foot strike).
function gradeContactMetric(contactCount: number, visAvg: number): { confidence: MetricConfidence; reason: MetricReason | null } {
  if (contactCount < CFG.minContactsLow || visAvg <= 0) return { confidence: "unavailable", reason: "few_contact_cycles" };
  if (visAvg < CFG.visibilityUnavailable) return { confidence: "unavailable", reason: "low_landmark_visibility" };
  if (contactCount < CFG.minContactsOk) return { confidence: "low", reason: "few_contact_cycles" };
  if (visAvg < CFG.visibilityOk) return { confidence: "low", reason: "low_landmark_visibility" };
  return { confidence: "ok", reason: null };
}

// Grade a per-frame metric that does not need contacts (trunk lean).
function gradeFrameMetric(sampleCount: number, visAvg: number): { confidence: MetricConfidence; reason: MetricReason | null } {
  if (sampleCount < 5 || visAvg < CFG.visibilityUnavailable) return { confidence: "unavailable", reason: "low_landmark_visibility" };
  if (visAvg < CFG.visibilityOk) return { confidence: "low", reason: "low_landmark_visibility" };
  return { confidence: "ok", reason: null };
}

// A too-small subject downgrades an otherwise-ok metric to "low".
function applySubjectSize<T>(metric: MeasuredMetric<T>, subjectTooSmall: boolean): MeasuredMetric<T> {
  if (subjectTooSmall && metric.confidence === "ok") {
    return { ...metric, confidence: "low", reason: "subject_too_small" };
  }
  return metric;
}

export type ComputeMetricsInput = {
  frames: NormalizedLandmark[][];
  fps: number;
  durationSec: number;
  cadenceFromWatchSpm?: number | null;
};

export type ComputeMetricsOutput = {
  metrics: RunMetrics;
  metricStatuses: Record<string, MetricStatus>;
  quality: AnalysisQuality;
  // Initial-contact (first-touch) frames — one per detected contact cycle.
  // Used by RunAnalysisTool to render diagnostic skeleton overlays.
  onsetFrameIndices: number[];
  side: "left" | "right"; // which body side was used for measurement
};

export function computeMetrics({ frames, fps, durationSec, cadenceFromWatchSpm = null }: ComputeMetricsInput): ComputeMetricsOutput {
  if (frames.length === 0) {
    const m = emptyMetrics(fps, durationSec, cadenceFromWatchSpm);
    return { metrics: m, metricStatuses: buildStatuses(m), quality: { usable: false, reason: "no_frames" }, onsetFrameIndices: [], side: "left" };
  }

  const side = chooseSide(frames[Math.floor(frames.length / 2)] ?? []);
  const idx = sideIdx(side);

  // ── Ground contacts (drive knee / overstride / foot strike / oscillation cycles)
  const ankleY = frames.map((f) => f[idx.ankle]?.y ?? 0);
  const minGapFrames = Math.max(3, Math.round(fps * 0.2)); // ~200 ms min between contacts
  const contacts = findLocalMaxima(ankleY, minGapFrames); // mid-stance peaks → oscillation timing
  const contactCycles = contacts.length > 1 ? contacts.length - 1 : 0;
  // Initial-contact frames (first-touch, ~50–150ms before mid-stance peak).
  // Used for knee / overstride / foot-strike — measuring at mid-stance gives wrong results.
  const onsets = findContactOnsets(ankleY, contacts, fps);

  // ── Subject size: full body height (normalized) via shoulder→ankle + calibration
  const torsoSpans: number[] = [];
  for (const frame of frames) {
    const sh = frame[idx.shoulder];
    const an = frame[idx.ankle];
    if ((sh?.visibility ?? 0) > 0.5 && (an?.visibility ?? 0) > 0.5) {
      torsoSpans.push(Math.abs(sh!.y - an!.y));
    }
  }
  const avgTorso = mean(torsoSpans);
  const fullHeightNorm = avgTorso > 0 ? avgTorso / SHOULDER_ANKLE_HEIGHT_FRACTION : 0;
  const subjectTooSmall = fullHeightNorm > 0 && fullHeightNorm < CFG.minSubjectHeightNorm;

  // ── Trunk lean (per-frame, no contacts needed)
  const trunkAngles: number[] = [];
  for (const frame of frames) {
    const sh = frame[idx.shoulder];
    const hp = frame[idx.hip];
    if ((sh?.visibility ?? 0) > 0.5 && (hp?.visibility ?? 0) > 0.5) {
      trunkAngles.push(trunkLeanDeg(sh!, hp!));
    }
  }
  const trunkVis = meanVisibility(frames, [idx.shoulder, idx.hip]);
  let trunkLean: MeasuredMetric<number> = (() => {
    const g = gradeFrameMetric(trunkAngles.length, trunkVis);
    if (g.confidence === "unavailable") return { value: null, confidence: "unavailable", reason: g.reason };
    return { value: Math.round(median(trunkAngles) * 10) / 10, confidence: g.confidence, reason: g.reason };
  })();
  trunkLean = applySubjectSize(trunkLean, subjectTooSmall);

  // ── Vertical oscillation: per-cycle amplitude of detrended hip.y, normalized by height
  const hipYByFrame = frames.map((f) => {
    const hp = f[idx.hip];
    return (hp?.visibility ?? 0) > 0.4 ? hp!.y : NaN;
  });
  const { detrended, trendAmplitude } = linearDetrend(hipYByFrame);
  const cycleAmps = perCycleAmplitude(detrended, contacts);
  const cycleAmp = cycleAmps.length > 0 ? median(cycleAmps) : 0;
  const cameraMotionRatio = cycleAmp > 0 ? trendAmplitude / cycleAmp : Infinity;

  // Horizontal pan detection: static camera → runner crosses frame → large hip.x range.
  // Panning camera → runner stays centered → small hip.x range despite gait cycles present.
  let hipXMin = Infinity, hipXMax = -Infinity;
  for (const frame of frames) {
    const hp = frame[idx.hip];
    if ((hp?.visibility ?? 0) > 0.4) {
      if (hp!.x < hipXMin) hipXMin = hp!.x;
      if (hp!.x > hipXMax) hipXMax = hp!.x;
    }
  }
  const hipXRange = hipXMin < hipXMax ? hipXMax - hipXMin : 0;

  const verticalOscillation: VerticalOscillationMetric = buildVerticalOscillation({
    cycleAmps,
    cycleAmp,
    fullHeightNorm,
    cameraMotionRatio,
    hipXRange,
    subjectTooSmall,
  });

  // ── Knee flexion at initial contact (0° = straight leg → 180 − interior hip-knee-ankle)
  const kneeFlexions: number[] = [];
  for (const peakIdx of onsets) {
    const frame = frames[peakIdx];
    if (!frame) continue;
    const hp = frame[idx.hip];
    const kn = frame[idx.knee];
    const an = frame[idx.ankle];
    if ((hp?.visibility ?? 0) > 0.5 && (kn?.visibility ?? 0) > 0.5 && (an?.visibility ?? 0) > 0.5) {
      kneeFlexions.push(180 - angleDeg(hp!, kn!, an!));
    }
  }
  const kneeVis = meanVisibility(frames, [idx.hip, idx.knee, idx.ankle]);
  let kneeFlexion: MeasuredMetric<number> = (() => {
    const g = gradeContactMetric(kneeFlexions.length, kneeVis);
    if (g.confidence === "unavailable" || kneeFlexions.length === 0) {
      return { value: null, confidence: "unavailable", reason: g.reason ?? "few_contact_cycles" };
    }
    return { value: Math.round(median(kneeFlexions) * 10) / 10, confidence: g.confidence, reason: g.reason };
  })();
  kneeFlexion = applySubjectSize(kneeFlexion, subjectTooSmall);

  // ── Overstride: foot ahead of hip at initial contact, normalized by leg length
  const overstrideVals: number[] = [];
  for (const peakIdx of onsets) {
    const frame = frames[peakIdx];
    if (!frame) continue;
    const hp = frame[idx.hip];
    const an = frame[idx.ankle];
    const kn = frame[idx.knee];
    if ((hp?.visibility ?? 0) > 0.5 && (an?.visibility ?? 0) > 0.5 && (kn?.visibility ?? 0) > 0.5) {
      const legLen = Math.hypot(hp!.x - an!.x, hp!.y - an!.y);
      if (legLen > 0) overstrideVals.push(((an!.x - hp!.x) / legLen) * 100);
    }
  }
  let overstride: MeasuredMetric<number> = (() => {
    const g = gradeContactMetric(overstrideVals.length, kneeVis);
    if (g.confidence === "unavailable" || overstrideVals.length === 0) {
      return { value: null, confidence: "unavailable", reason: g.reason ?? "few_contact_cycles" };
    }
    return { value: Math.round(median(overstrideVals) * 10) / 10, confidence: g.confidence, reason: g.reason };
  })();
  overstride = applySubjectSize(overstride, subjectTooSmall);

  // ── Foot strike type at initial contact: heel vs ball-of-foot y
  const footStrikeVotes: FootStrikeType[] = [];
  for (const peakIdx of onsets) {
    const frame = frames[peakIdx];
    if (!frame) continue;
    const heel = frame[idx.heel];
    const ball = frame[idx.foot];
    if ((heel?.visibility ?? 0) > 0.4 && (ball?.visibility ?? 0) > 0.4) {
      const diff = heel!.y - ball!.y; // positive = heel lower = heel strikes first
      if (diff > 0.02) footStrikeVotes.push("heel");
      else if (diff < -0.02) footStrikeVotes.push("forefoot");
      else footStrikeVotes.push("midfoot");
    }
  }
  const footVis = meanVisibility(frames, [idx.heel, idx.foot]);
  let footStrike: MeasuredMetric<FootStrikeType> = (() => {
    const g = gradeContactMetric(footStrikeVotes.length, footVis);
    if (g.confidence === "unavailable" || footStrikeVotes.length === 0) {
      return { value: null, confidence: "unavailable", reason: g.reason ?? "few_contact_cycles" };
    }
    return { value: majorityVote(footStrikeVotes), confidence: g.confidence, reason: g.reason };
  })();
  footStrike = applySubjectSize(footStrike, subjectTooSmall);

  const metrics: RunMetrics = {
    kneeFlexionDeg: kneeFlexion,
    trunkLeanDeg: trunkLean,
    verticalOscillation,
    overstridePct: overstride,
    footStrike,
    cadenceFromWatchSpm,
    framesAnalyzed: frames.length,
    contactCyclesDetected: contactCycles,
    videoFps: fps,
    videoDurationSec: durationSec,
  };

  return { metrics, metricStatuses: buildStatuses(metrics), quality: assessQuality(metrics), onsetFrameIndices: onsets, side };
}

function buildVerticalOscillation(args: {
  cycleAmps: number[];
  cycleAmp: number;
  fullHeightNorm: number;
  cameraMotionRatio: number;
  hipXRange: number;
  subjectTooSmall: boolean;
}): VerticalOscillationMetric {
  const { cycleAmps, cycleAmp, fullHeightNorm, cameraMotionRatio, hipXRange, subjectTooSmall } = args;

  if (cycleAmps.length < CFG.oscMinCyclesLow || cycleAmp <= 0 || fullHeightNorm <= 0) {
    return { value: null, band: null, confidence: "unavailable", reason: "few_contact_cycles" };
  }
  if (cameraMotionRatio > CFG.oscCameraMotionUnavailable) {
    return { value: null, band: null, confidence: "unavailable", reason: "camera_motion" };
  }
  // Horizontal pan: runner stays centered → camera follows → oscillation unreliable.
  // hipXRange large = runner crossed frame = static camera = ok to measure.
  if (hipXRange < CFG.oscHorizRangeUnavailable) {
    return { value: null, band: null, confidence: "unavailable", reason: "camera_motion" };
  }

  const pct = Math.round((cycleAmp / fullHeightNorm) * 100 * 10) / 10;
  const band = classifyVerticalOscillationBand(pct);

  let confidence: MetricConfidence = "ok";
  let reason: MetricReason | null = null;
  if (cameraMotionRatio > CFG.oscCameraMotionLow) {
    confidence = "low";
    reason = "camera_motion";
  } else if (hipXRange < CFG.oscHorizRangeLow) {
    // Possible horizontal pan (runner doesn't cross much of the frame)
    confidence = "low";
    reason = "camera_motion";
  } else if (cycleAmps.length < CFG.oscMinCyclesOk) {
    confidence = "low";
    reason = "few_contact_cycles";
  } else if (subjectTooSmall) {
    confidence = "low";
    reason = "subject_too_small";
  }
  return { value: pct, band, confidence, reason };
}

// Overall "video usable" gate: enough measured metrics must be available.
function assessQuality(m: RunMetrics): AnalysisQuality {
  const measured: MetricConfidence[] = [
    m.kneeFlexionDeg.confidence,
    m.trunkLeanDeg.confidence,
    m.verticalOscillation.confidence,
    m.overstridePct.confidence,
    m.footStrike.confidence,
  ];
  const available = measured.filter((c) => c !== "unavailable").length;
  if (available < CFG.minAvailableMetricsForReport) {
    return { usable: false, reason: "most_metrics_unavailable" };
  }
  return { usable: true, reason: null };
}

function majorityVote(votes: FootStrikeType[]): FootStrikeType {
  if (votes.length === 0) return "unknown";
  const counts: Record<string, number> = {};
  for (const v of votes) counts[v] = (counts[v] ?? 0) + 1;
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] as FootStrikeType) ?? "unknown";
}

function emptyMetrics(fps: number, durationSec: number, cadenceFromWatchSpm: number | null): RunMetrics {
  const unavail = <T>(): MeasuredMetric<T> => ({ value: null, confidence: "unavailable", reason: "low_landmark_visibility" });
  return {
    kneeFlexionDeg: unavail<number>(),
    trunkLeanDeg: unavail<number>(),
    verticalOscillation: { value: null, band: null, confidence: "unavailable", reason: "low_landmark_visibility" },
    overstridePct: unavail<number>(),
    footStrike: unavail<FootStrikeType>(),
    cadenceFromWatchSpm,
    framesAnalyzed: 0,
    contactCyclesDetected: 0,
    videoFps: fps,
    videoDurationSec: durationSec,
  };
}

function buildStatuses(m: RunMetrics): Record<string, MetricStatus> {
  function status(
    key: string,
    label: string,
    metric: { value: number | string | null; confidence: MetricConfidence; reason: MetricReason | null },
    unit: string,
    normDescription: string,
    severity: MetricSeverity,
    band?: MetricStatus["band"]
  ): MetricStatus {
    return { key, label, value: metric.value, unit, normDescription, severity, confidence: metric.confidence, reason: metric.reason, band };
  }

  const kneeSev: MetricSeverity = m.kneeFlexionDeg.value != null ? classifyKneeAngle(m.kneeFlexionDeg.value) : "attention";
  const trunkSev: MetricSeverity = m.trunkLeanDeg.value != null ? classifyTrunkLean(m.trunkLeanDeg.value) : "attention";
  const vertSev: MetricSeverity = m.verticalOscillation.value != null ? classifyVerticalOscillation(m.verticalOscillation.value) : "attention";
  const overSev: MetricSeverity = m.overstridePct.value != null ? classifyOverstride(m.overstridePct.value) : "attention";
  const fsSev: MetricSeverity = m.footStrike.value != null ? classifyFootStrike(m.footStrike.value) : "attention";

  return {
    kneeFlexion: status("kneeFlexion", "Сгиб колена при опоре", m.kneeFlexionDeg, "°", NORM_DESCRIPTIONS.kneeAngle, kneeSev),
    trunkLean: status("trunkLean", "Наклон корпуса вперёд", m.trunkLeanDeg, "°", NORM_DESCRIPTIONS.trunkLean, trunkSev),
    verticalOscillation: status("verticalOscillation", "Вертикальные колебания", m.verticalOscillation, "% роста", NORM_DESCRIPTIONS.verticalOscillation, vertSev, m.verticalOscillation.band),
    overstride: status("overstride", "Оверстрайд (вынос стопы)", m.overstridePct, "%", NORM_DESCRIPTIONS.overstride, overSev),
    footStrike: status("footStrike", "Тип приземления", m.footStrike, "", NORM_DESCRIPTIONS.footStrike, fsSev),
  };
}
