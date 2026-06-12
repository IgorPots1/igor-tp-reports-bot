import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { getNutritionAdminStudentCard } from "../src/features/nutrition/admin";
import { pickDefaultNutritionReport } from "../src/features/nutrition/admin-labels";
import {
  compareNutritionReportDateRanges,
  countDatesOverlappingWeek,
  countWeekRangeOverlapDays,
  formatNutritionReportDateMismatchCardNotice,
} from "../src/features/nutrition/report-date-coverage";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

type CliOptions = {
  studentName?: string;
  studentId?: string;
  weekFrom?: string;
  weekTo?: string;
  reportId?: string;
};

type StudentRow = {
  id: string;
  student_id: string;
  student_name: string;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === "--student-name" || arg === "--student") && next) {
      options.studentName = next;
      i += 1;
    } else if (arg === "--student-id" && next) {
      options.studentId = next;
      i += 1;
    } else if (arg === "--week-from" && next) {
      options.weekFrom = next;
      i += 1;
    } else if (arg === "--week-to" && next) {
      options.weekTo = next;
      i += 1;
    } else if (arg === "--report-id" && next) {
      options.reportId = next;
      i += 1;
    }
  }
  return options;
}

function requireIsoDate(value: string | undefined, name: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Missing or invalid ${name}; expected YYYY-MM-DD.`);
  }
  return value;
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

async function resolveStudent(options: CliOptions, supabase: ReturnType<typeof createClient>): Promise<StudentRow> {
  let query = supabase.from("trainingpeaks_students").select("id,student_id,student_name").limit(5);
  if (options.studentId) {
    query = query.eq("id", options.studentId);
  } else if (options.studentName) {
    query = query.ilike("student_name", `%${options.studentName}%`);
  } else {
    throw new Error("Provide --student-id or --student-name.");
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load student: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error("Student not found.");
  }
  if (data.length > 1) {
    throw new Error(
      `Student selector matched multiple candidates:\n${data.map((item) => `  - ${item.student_name} (${item.id})`).join("\n")}\nUse --student-id.`
    );
  }
  return data[0] as StudentRow;
}

function buildRecommendation(input: {
  reportWeekFrom: string;
  reportWeekTo: string;
  parsedDates: string[];
  uiWeekFrom: string;
  uiWeekTo: string;
  dataQuality: Record<string, unknown>;
}): string {
  const reportMacroOverlap = countDatesOverlappingWeek(
    input.parsedDates,
    input.reportWeekFrom,
    input.reportWeekTo
  );
  const uiMacroOverlap = countDatesOverlappingWeek(input.parsedDates, input.uiWeekFrom, input.uiWeekTo);
  const dateRangeSource =
    typeof input.dataQuality.date_range_source === "string" ? input.dataQuality.date_range_source : "unknown";

  if (input.parsedDates.length === 0) {
    return "No parsed macro dates found. Re-upload PDF or add manual macros.";
  }
  if (reportMacroOverlap === input.parsedDates.length && dateRangeSource === "parsed_pdf") {
    return "Report week and daily macros align. Safe to regenerate review for this report week.";
  }
  if (reportMacroOverlap === 0) {
    return "Report week and daily macros do not overlap. Re-upload/re-save PDF so report week follows parsed dates, then regenerate review.";
  }
  if (uiMacroOverlap === 0 && reportMacroOverlap > 0) {
    return "UI week differs from report week, but report week matches macros. Open the report week in UI and regenerate review there.";
  }
  return "Partial overlap detected. Verify report week, UI week, and parsed macro dates before regenerating review.";
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const weekFrom = requireIsoDate(options.weekFrom, "--week-from");
  const weekTo = requireIsoDate(options.weekTo, "--week-to");

  loadScriptEnv();
  const env = resolveSupabaseEnv();
  if (!env) {
    throw new Error("Missing Supabase env; cannot run read-only diagnostic.");
  }
  const supabase = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const student = await resolveStudent(options, supabase);

  const card = await getNutritionAdminStudentCard({
    studentId: student.id,
    weekFrom,
    weekTo,
  });
  const selectedReportId = pickDefaultNutritionReport(card.reports, options.reportId ?? null);
  const selectedReport = card.reports.find((report) => report.id === selectedReportId) ?? null;
  if (!selectedReport) {
    throw new Error("No selected report for this student/week.");
  }

  const { data: reportWithMacrosRows, error: reportError } = await supabase
    .from("nutrition_reports")
    .select("id,week_from,week_to,source_type,data_quality,file_refs,created_at")
    .eq("id", selectedReport.id)
    .limit(1);
  if (reportError) {
    throw new Error(`Failed to load report details: ${reportError.message}`);
  }
  const reportRow = (reportWithMacrosRows?.[0] ?? null) as
    | {
        id: string;
        week_from: string;
        week_to: string;
        source_type: string;
        data_quality: unknown;
        file_refs: unknown;
        created_at: string;
      }
    | null;
  if (!reportRow) {
    throw new Error(`Report ${selectedReport.id} not found.`);
  }

  const { data: macroRows, error: macroError } = await supabase
    .from("nutrition_daily_macros")
    .select("day,kcal,protein_g,fat_g,carbs_g,confidence,notes,source")
    .eq("report_id", selectedReport.id)
    .order("day", { ascending: true });
  if (macroError) {
    throw new Error(`Failed to load macro rows: ${macroError.message}`);
  }

  const parsedDates = ((macroRows ?? []) as Array<{ day: string }>).map((row) => row.day);
  const minParsedDate = parsedDates[0] ?? null;
  const maxParsedDate = parsedDates[parsedDates.length - 1] ?? null;
  const dataQuality = toObject(reportRow.data_quality);
  const fileRefs = toObject(reportRow.file_refs);
  const extractionWarnings = asStringArray(fileRefs.extraction_warnings);
  const qualityFlags = asStringArray(dataQuality.qualityFlags);
  const uiWeekComparison = compareNutritionReportDateRanges({
    uiWeekFrom: weekFrom,
    uiWeekTo: weekTo,
    parsedWeekFrom: minParsedDate,
    parsedWeekTo: maxParsedDate,
  });
  const reportWeekMacroOverlap = countDatesOverlappingWeek(
    parsedDates,
    reportRow.week_from,
    reportRow.week_to
  );
  const uiWeekMacroOverlap = countDatesOverlappingWeek(parsedDates, weekFrom, weekTo);
  const reportUiOverlapDays = countWeekRangeOverlapDays({
    leftFrom: reportRow.week_from,
    leftTo: reportRow.week_to,
    rightFrom: weekFrom,
    rightTo: weekTo,
  });
  const cardNotice = formatNutritionReportDateMismatchCardNotice(dataQuality);
  const recommendation = buildRecommendation({
    reportWeekFrom: reportRow.week_from,
    reportWeekTo: reportRow.week_to,
    parsedDates,
    uiWeekFrom: weekFrom,
    uiWeekTo: weekTo,
    dataQuality,
  });

  console.log("Nutrition report date coverage diagnostic (read-only)");
  console.log("");
  console.log("Student:");
  console.log(`- id: ${student.id}`);
  console.log(`- slug: ${student.student_id}`);
  console.log(`- name: ${student.student_name}`);
  console.log("");
  console.log("Selection:");
  console.log(`- selected UI week: ${weekFrom}..${weekTo}`);
  console.log(`- selected report id: ${selectedReport.id}`);
  console.log("");
  console.log("Report week:");
  console.log(`- report.week_from/week_to: ${reportRow.week_from}..${reportRow.week_to}`);
  console.log(`- created_at: ${reportRow.created_at}`);
  console.log(`- source_type: ${reportRow.source_type}`);
  console.log("");
  console.log("Daily macro coverage:");
  console.log(`- parsed daily row count: ${parsedDates.length}`);
  console.log(`- parsed daily dates: ${parsedDates.join(", ") || "none"}`);
  console.log(`- parsed daily min/max: ${minParsedDate ?? "none"} .. ${maxParsedDate ?? "none"}`);
  console.log(`- overlap days report week vs daily rows: ${reportWeekMacroOverlap}`);
  console.log(`- overlap days UI week vs daily rows: ${uiWeekMacroOverlap}`);
  console.log(`- overlap days report week vs UI week: ${reportUiOverlapDays}`);
  console.log("");
  console.log("Date source metadata:");
  console.log(`- date_range_source: ${String(dataQuality.date_range_source ?? "n/a")}`);
  console.log(`- date_range_mismatch: ${yesNo(dataQuality.date_range_mismatch === true)}`);
  console.log(`- parsed_week_from/to: ${String(dataQuality.parsed_week_from ?? minParsedDate ?? "n/a")} .. ${String(dataQuality.parsed_week_to ?? maxParsedDate ?? "n/a")}`);
  console.log(`- ui_week_from/to: ${String(dataQuality.ui_week_from ?? "n/a")} .. ${String(dataQuality.ui_week_to ?? "n/a")}`);
  console.log(`- date_range_overlap_days: ${String(dataQuality.date_range_overlap_days ?? uiWeekComparison.overlapDays)}`);
  console.log(`- date_range_mismatch_reason: ${String(dataQuality.date_range_mismatch_reason ?? uiWeekComparison.message ?? "none")}`);
  console.log(`- coach notice: ${cardNotice ?? "none"}`);
  console.log("");
  console.log("Source quality/meta:");
  console.log(`- data quality flags: ${qualityFlags.join(", ") || "none"}`);
  console.log(
    `- parser confidence summary: parsedDays=${String(dataQuality.parsedDays ?? dataQuality.parsed_days ?? "n/a")} lowConfidenceDays=${String(
      dataQuality.lowConfidenceDays ?? dataQuality.low_confidence_days ?? "n/a"
    )} hasResolvedDates=${String(dataQuality.hasResolvedDates ?? "n/a")}`
  );
  console.log(`- extraction warnings: ${extractionWarnings.join(" | ") || "none"}`);
  console.log("");
  console.log("Recommendation:");
  console.log(`- ${recommendation}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`diagnose-nutrition-report-date-coverage failed: ${message}`);
  process.exitCode = 1;
});
