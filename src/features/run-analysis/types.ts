export type RunnerGoal = "health" | "5k" | "10k" | "half" | "marathon" | "speed";

export type RunnerProfile = {
  heightCm: number;
  weightKg: number;
  paceMinPerKm: string;
  goal: RunnerGoal;
};

export type FootStrikeType = "forefoot" | "midfoot" | "heel" | "unknown";

export type MetricSeverity = "ok" | "attention" | "important";

// Per-metric measurement reliability.
//  - "ok"          — trustworthy, show value as usual
//  - "low"         — noisy, show as an orientation (band/approximate)
//  - "unavailable" — cannot be measured from this video; do not show a value
export type MetricConfidence = "ok" | "low" | "unavailable";

// Machine-readable reason a metric is "low"/"unavailable"; UI maps to text.
export type MetricReason =
  | "few_contact_cycles"
  | "low_landmark_visibility"
  | "camera_motion"
  | "subject_too_small";

export type VerticalOscillationBand = "low" | "medium" | "high";

// A metric measured from video: value + how much we trust it.
export type MeasuredMetric<T> = {
  value: T | null; // null when confidence === "unavailable"
  confidence: MetricConfidence;
  reason: MetricReason | null;
};

export type VerticalOscillationMetric = MeasuredMetric<number> & {
  band: VerticalOscillationBand | null;
};

export type RunMetrics = {
  // measured from video (headline)
  kneeFlexionDeg: MeasuredMetric<number>;
  trunkLeanDeg: MeasuredMetric<number>;
  verticalOscillation: VerticalOscillationMetric;
  overstridePct: MeasuredMetric<number>;
  footStrike: MeasuredMetric<FootStrikeType>;
  // manual context (entered from a watch, NOT measured from video)
  cadenceFromWatchSpm: number | null;
  // meta
  framesAnalyzed: number;
  contactCyclesDetected: number;
  videoFps: number;
  videoDurationSec: number;
};

// Overall "is this video usable at all" gate — separate from per-metric status.
export type AnalysisQuality = {
  usable: boolean;
  reason: string | null; // machine reason when not usable
};

// Display-ready per-metric status for the report UI.
export type MetricStatus = {
  key: string;
  label: string;
  value: number | string | null;
  unit: string;
  normDescription: string;
  severity: MetricSeverity;
  confidence: MetricConfidence;
  reason: MetricReason | null;
  band?: VerticalOscillationBand | null;
};

// One metric as sent to the LLM. Unavailable metrics carry the string
// "не определено", never a fabricated number.
export type ApiMetric = {
  value: number | string; // number, foot-strike string, or "не определено"
  confidence: MetricConfidence;
  norm: string;
  // Severity computed by deterministic classifier before the LLM sees this data.
  // Absent when confidence === "unavailable". LLM must use this in headline_findings, not reassess.
  severity?: MetricSeverity;
  band?: VerticalOscillationBand;
  reason?: MetricReason;
};

// Payload to server — only metrics JSON, no video.
export type RunAnalysisApiPayload = {
  runner_profile: {
    height_cm: number;
    weight_kg: number;
    pace_min_per_km: string;
    goal: RunnerGoal;
  };
  computed_metrics: {
    knee_flexion_at_contact_deg: ApiMetric;
    trunk_lean_deg: ApiMetric;
    vertical_oscillation_pct: ApiMetric;
    overstride_pct: ApiMetric;
    foot_strike: ApiMetric;
    // manual context; null when not provided
    cadence_from_watch_spm: number | null;
    contact_cycles_detected: number;
    video_duration_sec: number;
  };
};

// LLM output contract §8
export type HeadlineFinding = {
  title: string;
  severity: "ok" | "attention" | "important";
  explanation: string;
};

export type MetricCommentary = {
  metric: string;
  verdict: string;
  note: string;
};

export type Recommendation = {
  issue: string;
  advice: string;
  drills: string[];
};

export type RunAnalysisReport = {
  headline_findings: HeadlineFinding[];
  metrics_commentary: MetricCommentary[];
  recommendations: Recommendation[];
  summary: string;
};

export type ParseRunAnalysisResult =
  | { ok: true; report: RunAnalysisReport }
  | { ok: false; error: string };

// Final combined result for report UI
export type RunAnalysisResult = {
  metrics: RunMetrics;
  metricStatuses: Record<string, MetricStatus>;
  report: RunAnalysisReport;
  heroFrameDataUrl: string | null;
  studentName?: string;
};
