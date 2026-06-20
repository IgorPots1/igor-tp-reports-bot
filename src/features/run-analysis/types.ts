export type RunnerGoal = "health" | "5k" | "10k" | "half" | "marathon" | "speed";

export type RunnerProfile = {
  heightCm: number;
  weightKg: number;
  paceMinPerKm: string;
  goal: RunnerGoal;
};

export type FootStrikeType = "forefoot" | "midfoot" | "heel" | "unknown";

export type RunMetrics = {
  cadenceSpm: number | null;
  kneeAngleDeg: number | null;
  trunkLeanDeg: number | null;
  verticalOscillationPct: number | null;
  overstridePct: number | null;
  footStrike: FootStrikeType;
  framesAnalyzed: number;
  gaitCyclesDetected: number;
  videoFps: number;
  videoDurationSec: number;
};

export type MetricSeverity = "ok" | "attention" | "important";

export type MetricStatus = {
  value: number | string | null;
  unit: string;
  severity: MetricSeverity;
  label: string;
  normDescription: string;
};

// Payload to server — only metrics JSON, no video
export type RunAnalysisApiPayload = {
  runner_profile: {
    height_cm: number;
    weight_kg: number;
    pace_min_per_km: string;
    goal: RunnerGoal;
  };
  computed_metrics: {
    cadence_spm: number | null;
    knee_angle_at_contact_deg: number | null;
    trunk_lean_deg: number | null;
    vertical_oscillation_pct: number | null;
    overstride_pct: number | null;
    foot_strike: FootStrikeType;
    gait_cycles_detected: number;
    video_duration_sec: number;
  };
  metric_statuses: Record<string, { value: number | string | null; severity: MetricSeverity; norm: string }>;
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
