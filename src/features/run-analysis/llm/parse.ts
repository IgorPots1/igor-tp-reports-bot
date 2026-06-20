import type {
  HeadlineFinding,
  MetricCommentary,
  ParseRunAnalysisResult,
  Recommendation,
  RunAnalysisReport,
} from "@/features/run-analysis/types";

export function extractJsonOnly(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function parseHeadlineFinding(raw: unknown): HeadlineFinding | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r.title)) return null;
  if (!isNonEmptyString(r.explanation)) return null;
  const severity = r.severity;
  if (severity !== "ok" && severity !== "attention" && severity !== "important") return null;
  return { title: r.title.trim(), severity, explanation: r.explanation.trim() };
}

function parseMetricCommentary(raw: unknown): MetricCommentary | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r.metric)) return null;
  if (!isNonEmptyString(r.verdict)) return null;
  const note = isNonEmptyString(r.note) ? r.note.trim() : "";
  return { metric: r.metric.trim(), verdict: r.verdict.trim(), note };
}

function parseRecommendation(raw: unknown): Recommendation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r.issue)) return null;
  if (!isNonEmptyString(r.advice)) return null;
  const drills = Array.isArray(r.drills)
    ? r.drills.filter(isNonEmptyString).map((d: string) => d.trim())
    : [];
  return { issue: r.issue.trim(), advice: r.advice.trim(), drills };
}

export function parseRunAnalysisReport(raw: unknown): ParseRunAnalysisResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "invalid_json_object" };
  }

  const r = raw as Record<string, unknown>;

  if (!Array.isArray(r.headline_findings) || r.headline_findings.length === 0) {
    return { ok: false, error: "missing_headline_findings" };
  }

  const headlineFindings: HeadlineFinding[] = [];
  for (const item of r.headline_findings) {
    const parsed = parseHeadlineFinding(item);
    if (!parsed) return { ok: false, error: "invalid_headline_finding" };
    headlineFindings.push(parsed);
  }

  const metricsCommentary: MetricCommentary[] = [];
  if (Array.isArray(r.metrics_commentary)) {
    for (const item of r.metrics_commentary) {
      const parsed = parseMetricCommentary(item);
      if (parsed) metricsCommentary.push(parsed);
    }
  }

  const recommendations: Recommendation[] = [];
  if (Array.isArray(r.recommendations)) {
    for (const item of r.recommendations) {
      const parsed = parseRecommendation(item);
      if (parsed) recommendations.push(parsed);
    }
  }

  if (!isNonEmptyString(r.summary)) {
    return { ok: false, error: "missing_summary" };
  }

  const report: RunAnalysisReport = {
    headline_findings: headlineFindings,
    metrics_commentary: metricsCommentary,
    recommendations,
    summary: r.summary.trim(),
  };

  return { ok: true, report };
}
