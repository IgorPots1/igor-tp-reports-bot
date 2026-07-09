// Pure decision tree for the metadata/HR subset of a
// trainingpeaks_workout_derived_metrics row (design doc "fallback_level"
// table, section 6). Kept separate from tp-fit-ingest-scan.ts's network I/O
// so the degrade-gracefully contract — has_fit=false with every unknown
// field NULL (never 0/false as a stand-in for "we don't know") — is directly
// testable without a live browser session.

import type { HrQuality } from "./fit-hr-cleaning.ts";

export type FitIngestOutcome =
  | { kind: "no_details" }
  | { kind: "no_fit_file" }
  | {
      kind: "fit_parsed";
      sourceFitFileId: string;
      hrQuality: HrQuality | null;
      pctHrCleaned: number | null;
      avgHr: number | null;
    };

export type DerivedMetricsFitFields = {
  has_fit: boolean;
  fallback_level: "fit_full" | "details_only" | "summary_only";
  source_fit_file_id: string | null;
  match_confidence: number | null;
  hr_quality: HrQuality | null;
  pct_hr_cleaned: number | null;
  avg_hr: number | null;
};

export function buildDerivedMetricsFitFields(outcome: FitIngestOutcome): DerivedMetricsFitFields {
  switch (outcome.kind) {
    case "no_details":
      // /details itself failed — we don't even know if a FIT file exists.
      return {
        has_fit: false,
        fallback_level: "summary_only",
        source_fit_file_id: null,
        match_confidence: null,
        hr_quality: null,
        pct_hr_cleaned: null,
        avg_hr: null,
      };
    case "no_fit_file":
      // /details worked (mean-max curves are available for a future
      // details_only fallback stage) but no FIT file could be obtained.
      return {
        has_fit: false,
        fallback_level: "details_only",
        source_fit_file_id: null,
        match_confidence: null,
        hr_quality: null,
        pct_hr_cleaned: null,
        avg_hr: null,
      };
    case "fit_parsed":
      return {
        has_fit: true,
        fallback_level: "fit_full",
        // fileId came from this exact workout's own /details response — no
        // fuzzy date/duration matching, so confidence is deterministic.
        source_fit_file_id: outcome.sourceFitFileId,
        match_confidence: 1,
        hr_quality: outcome.hrQuality,
        pct_hr_cleaned: outcome.pctHrCleaned,
        avg_hr: outcome.avgHr,
      };
  }
}
