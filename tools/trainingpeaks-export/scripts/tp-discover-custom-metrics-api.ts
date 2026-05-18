import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";
import { normalizeTrainingPeaksCustomMetricsPayload } from "./lib/trainingpeaks-custom-metrics-normalization.ts";
import { captureSessionAuth, redactUnknown } from "./lib/trainingpeaks-api-move.ts";

const TP_API_HOST = "https://tpapi.trainingpeaks.com";
const APP_HOST = "https://app.trainingpeaks.com";
const ARTIFACTS_ROOT = path.join(toolRoot, "debug", "custom-metrics-api");
const SAMPLE_LIMIT = 12;

type CliArgs = {
  athleteId: number;
  from: string;
  to: string;
  headless: boolean;
};

type JsonSummary = {
  topLevelType: string;
  topLevelKeys: string[];
  totalItems: number | null;
  metricNames: string[];
  metricTypeFieldCandidates: string[];
  sampleDates: string[];
  dateRangeAppearsHonored: boolean | "ambiguous";
  sourceOrVendorFieldsPresent: boolean;
};

type CsvSummary = {
  header: string[];
  totalRows: number;
  metricNames: string[];
  sampleDates: string[];
  dateRangeAppearsHonored: boolean | "ambiguous";
};

type ResponseKind = "json" | "csv" | "text" | "binary-or-unknown";

type DiscoverySummary = {
  endpoint: string;
  statusCode: number | null;
  ok: boolean;
  contentType: string | null;
  responseKind: ResponseKind;
  topLevelKeys: string[];
  totalRowsOrItems: number | null;
  detectedMetricNamesOrTypes: string[];
  sampleDates: string[];
  dateRangeAppearsHonored: boolean | "ambiguous";
  sourceOrVendorFieldsPresent: boolean;
  normalizedRowCount: number;
  normalizedMetricKeys: string[];
  normalizedCoverageByMetricKey: Record<string, number>;
  normalizedSampleRows: unknown[];
  normalizationWarnings: string[];
  hadAggregateValueRows: boolean;
  failureMessage: string | null;
  nextStepSuggestion: string | null;
  artifactDir: string;
  rawResponsePath: string | null;
  redactedJsonPath: string | null;
  summaryPath: string;
};

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    athleteId: 0,
    from: "",
    to: "",
    headless: false,
  };

  for (const arg of argv) {
    if (arg.startsWith("--athlete-id=")) {
      const value = Number(arg.slice("--athlete-id=".length).trim());
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid --athlete-id value "${arg}".`);
      }
      parsed.athleteId = value;
      continue;
    }
    if (arg.startsWith("--from=")) {
      parsed.from = arg.slice("--from=".length).trim();
      continue;
    }
    if (arg.startsWith("--to=")) {
      parsed.to = arg.slice("--to=".length).trim();
      continue;
    }
    if (arg === "--headless") {
      parsed.headless = true;
      continue;
    }
    if (arg === "--headed") {
      parsed.headless = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.athleteId) {
    throw new Error("Missing required argument: --athlete-id=<id>");
  }
  if (!isIsoDate(parsed.from)) {
    throw new Error(`Invalid --from date "${parsed.from}". Expected YYYY-MM-DD.`);
  }
  if (!isIsoDate(parsed.to)) {
    throw new Error(`Invalid --to date "${parsed.to}". Expected YYYY-MM-DD.`);
  }
  if (parsed.from > parsed.to) {
    throw new Error(`Invalid range: --from (${parsed.from}) is after --to (${parsed.to}).`);
  }
  return parsed;
}

function topLevelJsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return typeof value;
}

function asIsoDatePart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/);
  return match?.[1] ?? null;
}

function assessDateRangeHonor(from: string, to: string, dates: string[]): boolean | "ambiguous" {
  if (dates.length === 0) return "ambiguous";
  let inside = 0;
  let outside = 0;
  for (const day of dates) {
    if (day >= from && day <= to) {
      inside += 1;
    } else {
      outside += 1;
    }
  }
  if (inside === 0) return false;
  const outsideRatio = outside / (inside + outside);
  if (outsideRatio === 0) return true;
  if (outsideRatio > 0.2) return false;
  return "ambiguous";
}

function summarizeJsonBody(input: { body: unknown; from: string; to: string }): JsonSummary {
  const metricNames = new Set<string>();
  const metricTypeFieldCandidates = new Set<string>();
  const sampleDates = new Set<string>();
  let sourceOrVendorFieldsPresent = false;
  let totalItems: number | null = null;
  const topLevelType = topLevelJsonType(input.body);
  const topLevelKeys =
    input.body && typeof input.body === "object" && !Array.isArray(input.body) ? Object.keys(input.body).slice(0, 120) : [];

  const lowerIncludesAny = (value: string, tokens: string[]): boolean => {
    const normalized = value.toLowerCase().replace(/[^a-z]/g, "");
    return tokens.some((token) => normalized.includes(token));
  };

  const stack: unknown[] = [input.body];
  let arrayCounter = 0;
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      arrayCounter += node.length;
      for (const item of node) stack.push(item);
      continue;
    }
    if (!node || typeof node !== "object") {
      const asDate = asIsoDatePart(node);
      if (asDate && sampleDates.size < SAMPLE_LIMIT) sampleDates.add(asDate);
      continue;
    }

    for (const [key, value] of Object.entries(node)) {
      const keyLower = key.toLowerCase();
      if (lowerIncludesAny(keyLower, ["source", "vendor", "provider", "origin", "device", "connector", "client", "upload"])) {
        sourceOrVendorFieldsPresent = true;
      }
      if (lowerIncludesAny(keyLower, ["type", "metric"])) {
        metricTypeFieldCandidates.add(key);
      }
      if (lowerIncludesAny(keyLower, ["type", "metric", "name"]) && typeof value === "string" && value.trim()) {
        metricNames.add(value.trim());
      }
      const datePart = asIsoDatePart(value);
      if (datePart && sampleDates.size < SAMPLE_LIMIT) {
        sampleDates.add(datePart);
      }
      stack.push(value);
    }
  }

  if (Array.isArray(input.body)) {
    totalItems = input.body.length;
  } else if (arrayCounter > 0) {
    totalItems = arrayCounter;
  }

  const sampleDatesList = [...sampleDates].sort().slice(0, SAMPLE_LIMIT);
  return {
    topLevelType,
    topLevelKeys,
    totalItems,
    metricNames: [...metricNames].slice(0, 100),
    metricTypeFieldCandidates: [...metricTypeFieldCandidates].slice(0, 40),
    sampleDates: sampleDatesList,
    dateRangeAppearsHonored: assessDateRangeHonor(input.from, input.to, sampleDatesList),
    sourceOrVendorFieldsPresent,
  };
}

function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { header: [], rows: [] };
  const splitSimple = (line: string): string[] => line.split(",").map((cell) => cell.trim());
  const header = splitSimple(lines[0]);
  const rows = lines.slice(1).map(splitSimple);
  return { header, rows };
}

function summarizeCsv(input: { csvText: string; from: string; to: string }): CsvSummary {
  const parsed = parseCsv(input.csvText);
  const metricNames = new Set<string>();
  const sampleDates = new Set<string>();

  const typeIdx = parsed.header.findIndex((h) => h.toLowerCase() === "type");
  const tsIdx = parsed.header.findIndex((h) => h.toLowerCase() === "timestamp");

  for (const row of parsed.rows) {
    if (typeIdx >= 0 && typeIdx < row.length && row[typeIdx]) metricNames.add(row[typeIdx]);
    if (tsIdx >= 0 && tsIdx < row.length) {
      const datePart = asIsoDatePart(row[tsIdx]);
      if (datePart && sampleDates.size < SAMPLE_LIMIT) sampleDates.add(datePart);
    }
  }

  const sampleDatesList = [...sampleDates].sort().slice(0, SAMPLE_LIMIT);
  return {
    header: parsed.header,
    totalRows: parsed.rows.length,
    metricNames: [...metricNames].slice(0, 100),
    sampleDates: sampleDatesList,
    dateRangeAppearsHonored: assessDateRangeHonor(input.from, input.to, sampleDatesList),
  };
}

function detectResponseKind(contentType: string, text: string): ResponseKind {
  const lowered = contentType.toLowerCase();
  const trimmed = text.trim();
  if (lowered.includes("application/json") || trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (lowered.includes("text/csv") || lowered.includes("application/csv")) return "csv";
  if (lowered.includes("text/")) {
    if (/^timestamp\s*,\s*type\s*,\s*value\b/i.test(trimmed.split(/\r?\n/, 1)[0] ?? "")) return "csv";
    return "text";
  }
  if (/^timestamp\s*,\s*type\s*,\s*value\b/i.test(trimmed.split(/\r?\n/, 1)[0] ?? "")) return "csv";
  return "binary-or-unknown";
}

function createSummaryMarkdown(summary: DiscoverySummary): string {
  return [
    "# TrainingPeaks Custom Metrics API Discovery",
    "",
    `- endpoint: \`${summary.endpoint}\``,
    `- status_code: **${summary.statusCode ?? "unknown"}**`,
    `- ok: **${summary.ok ? "true" : "false"}**`,
    `- content_type: \`${summary.contentType ?? "unknown"}\``,
    `- response_kind: \`${summary.responseKind}\``,
    `- top_level_keys: ${summary.topLevelKeys.length ? summary.topLevelKeys.map((k) => `\`${k}\``).join(", ") : "none"}`,
    `- total_rows_or_items: **${summary.totalRowsOrItems ?? "unknown"}**`,
    `- detected_metric_names_or_types: ${
      summary.detectedMetricNamesOrTypes.length
        ? summary.detectedMetricNamesOrTypes.map((v) => `\`${v}\``).join(", ")
        : "none"
    }`,
    `- sample_dates: ${summary.sampleDates.length ? summary.sampleDates.map((d) => `\`${d}\``).join(", ") : "none"}`,
    `- date_range_appears_honored: **${String(summary.dateRangeAppearsHonored)}**`,
    `- source_or_vendor_fields_present: **${summary.sourceOrVendorFieldsPresent ? "yes" : "no"}**`,
    `- normalized_row_count: **${summary.normalizedRowCount}**`,
    `- normalized_metric_keys: ${
      summary.normalizedMetricKeys.length ? summary.normalizedMetricKeys.map((k) => `\`${k}\``).join(", ") : "none"
    }`,
    `- normalized_coverage_by_metric_key: \`${JSON.stringify(summary.normalizedCoverageByMetricKey)}\``,
    `- normalization_warnings: ${
      summary.normalizationWarnings.length ? summary.normalizationWarnings.map((w) => `\`${w}\``).join(", ") : "none"
    }`,
    `- had_aggregate_value_rows: **${summary.hadAggregateValueRows ? "yes" : "no"}**`,
    `- failure_message: ${summary.failureMessage ? `\`${summary.failureMessage}\`` : "none"}`,
    `- next_step_suggestion: ${summary.nextStepSuggestion ? summary.nextStepSuggestion : "none"}`,
    `- raw_response_artifact: \`${summary.rawResponsePath ?? "none"}\``,
    `- redacted_json_artifact: \`${summary.redactedJsonPath ?? "none"}\``,
    `- artifact_dir: \`${summary.artifactDir}\``,
    "",
    "## Safety",
    "- Read-only direct GET only (no POST/PUT/PATCH/DELETE).",
    "- Session headers are reused from local authenticated browser context.",
    "- Secrets/tokens/cookies are redacted from saved JSON artifacts.",
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const endpoint = `${TP_API_HOST}/metrics/v3/athletes/${args.athleteId}/consolidatedtimedmetrics/${args.from}/${args.to}`;
  const artifactDir = path.join(ARTIFACTS_ROOT, timestampForPath(new Date()));
  const rawResponsePath = path.join(artifactDir, "direct-get-response.raw.txt");
  const redactedJsonPath = path.join(artifactDir, "direct-get-response.redacted.json");
  const summaryJsonPath = path.join(artifactDir, "discovery-summary.json");
  const summaryMdPath = path.join(artifactDir, "discovery-summary.md");
  const requestMetaPath = path.join(artifactDir, "request-meta.json");

  await mkdir(profileDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });

  console.log("[tp-discover-custom-metrics-api] read-only direct GET discovery started.");
  console.log(`[tp-discover-custom-metrics-api] athleteId=${args.athleteId}`);
  console.log(`[tp-discover-custom-metrics-api] from=${args.from} to=${args.to}`);
  console.log(`[tp-discover-custom-metrics-api] endpoint=${endpoint}`);
  console.log(`[tp-discover-custom-metrics-api] artifactDir=${artifactDir}`);

  const summary: DiscoverySummary = {
    endpoint,
    statusCode: null,
    ok: false,
    contentType: null,
    responseKind: "binary-or-unknown",
    topLevelKeys: [],
    totalRowsOrItems: null,
    detectedMetricNamesOrTypes: [],
    sampleDates: [],
    dateRangeAppearsHonored: "ambiguous",
    sourceOrVendorFieldsPresent: false,
    normalizedRowCount: 0,
    normalizedMetricKeys: [],
    normalizedCoverageByMetricKey: {},
    normalizedSampleRows: [],
    normalizationWarnings: [],
    hadAggregateValueRows: false,
    failureMessage: null,
    nextStepSuggestion: null,
    artifactDir,
    rawResponsePath: null,
    redactedJsonPath: null,
    summaryPath: summaryMdPath,
  };

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: args.headless,
    viewport: null,
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const auth = await captureSessionAuth({
      context,
      page,
      athleteId: args.athleteId,
    });

    const headers: Record<string, string> = {
      accept: "application/json, text/csv, text/plain, */*",
      "x-requested-with": "XMLHttpRequest",
    };
    if (auth.authorizationHeader) {
      headers.authorization = auth.authorizationHeader;
    }
    const referer = auth.sampleHeaders.referer;
    if (typeof referer === "string" && referer.trim()) {
      headers.referer = referer;
    } else {
      headers.referer = `${APP_HOST}/#calendar/athletes/${args.athleteId}`;
    }
    const origin = auth.sampleHeaders.origin;
    if (typeof origin === "string" && origin.trim()) {
      headers.origin = origin;
    } else {
      headers.origin = APP_HOST;
    }

    await writeFile(
      requestMetaPath,
      `${JSON.stringify(
        {
          runAt: new Date().toISOString(),
          endpoint,
          method: "GET",
          athleteId: args.athleteId,
          from: args.from,
          to: args.to,
          headers: redactUnknown(headers),
          hadAuthorizationHeader: Boolean(auth.authorizationHeader),
          sampleRequestUrl: auth.sampleRequestUrl ?? null,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const response = await page.request.fetch(endpoint, {
      method: "GET",
      headers,
      failOnStatusCode: false,
    });
    const contentType = response.headers()["content-type"] ?? null;
    const bodyText = await response.text();
    await writeFile(rawResponsePath, bodyText, "utf8");

    const responseKind = detectResponseKind(contentType ?? "", bodyText);
    summary.statusCode = response.status();
    summary.ok = response.ok();
    summary.contentType = contentType;
    summary.responseKind = responseKind;
    summary.rawResponsePath = rawResponsePath;

    if (responseKind === "json") {
      try {
        const parsed = JSON.parse(bodyText);
        const redacted = redactUnknown(parsed);
        const jsonSummary = summarizeJsonBody({ body: redacted, from: args.from, to: args.to });
        const normalizedRows = normalizeTrainingPeaksCustomMetricsPayload(parsed);
        const coverageByMetricKey: Record<string, number> = {};
        const warningSet = new Set<string>();
        let hadAggregateValueRows = false;
        for (const row of normalizedRows) {
          coverageByMetricKey[row.metricKey] = (coverageByMetricKey[row.metricKey] ?? 0) + 1;
          if (
            row.valueMinNumeric !== null ||
            row.valueMaxNumeric !== null ||
            row.valueAvgNumeric !== null ||
            (row.rawValueText !== null && row.rawValueText.trim().startsWith("["))
          ) {
            hadAggregateValueRows = true;
          }
          for (const warning of row.normalizationWarnings) {
            warningSet.add(warning);
          }
        }
        await writeFile(redactedJsonPath, `${JSON.stringify(redacted, null, 2)}\n`, "utf8");

        summary.topLevelKeys = jsonSummary.topLevelKeys;
        summary.totalRowsOrItems = jsonSummary.totalItems;
        summary.detectedMetricNamesOrTypes =
          jsonSummary.metricNames.length > 0 ? jsonSummary.metricNames : jsonSummary.metricTypeFieldCandidates;
        summary.sampleDates = jsonSummary.sampleDates;
        summary.dateRangeAppearsHonored = jsonSummary.dateRangeAppearsHonored;
        summary.sourceOrVendorFieldsPresent = jsonSummary.sourceOrVendorFieldsPresent;
        summary.normalizedRowCount = normalizedRows.length;
        summary.normalizedCoverageByMetricKey = coverageByMetricKey;
        summary.normalizedMetricKeys = Object.keys(coverageByMetricKey).sort((a, b) => a.localeCompare(b));
        summary.normalizedSampleRows = normalizedRows.slice(0, 8);
        summary.normalizationWarnings = [...warningSet].sort((a, b) => a.localeCompare(b));
        summary.hadAggregateValueRows = hadAggregateValueRows;
        summary.redactedJsonPath = redactedJsonPath;
      } catch (error) {
        summary.failureMessage = `JSON parse failed: ${(error as Error).message}`;
      }
    } else if (responseKind === "csv") {
      const csvSummary = summarizeCsv({ csvText: bodyText, from: args.from, to: args.to });
      summary.topLevelKeys = csvSummary.header;
      summary.totalRowsOrItems = csvSummary.totalRows;
      summary.detectedMetricNamesOrTypes = csvSummary.metricNames;
      summary.sampleDates = csvSummary.sampleDates;
      summary.dateRangeAppearsHonored = csvSummary.dateRangeAppearsHonored;
    } else if (responseKind === "text") {
      const lines = bodyText.split(/\r?\n/).filter(Boolean);
      summary.totalRowsOrItems = lines.length;
      summary.sampleDates = lines.map((line) => asIsoDatePart(line)).filter((d): d is string => Boolean(d)).slice(0, SAMPLE_LIMIT);
      summary.dateRangeAppearsHonored = assessDateRangeHonor(args.from, args.to, summary.sampleDates);
    }

    if (!response.ok()) {
      summary.failureMessage = summary.failureMessage ?? `Direct GET failed with status ${response.status()}.`;
      summary.nextStepSuggestion =
        "Capture network requests while opening the health metrics screen for this athlete/date range to confirm required headers or alternate endpoint shape before any UI export automation.";
    } else if (summary.detectedMetricNamesOrTypes.length === 0) {
      summary.nextStepSuggestion =
        "Direct GET succeeded but metric names were not obvious; inspect saved raw/redacted payload to map metric type fields and validate expected health metrics coverage.";
    }
  } finally {
    await context.close().catch(() => {});
  }

  await writeFile(`${summaryJsonPath}`, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(summaryMdPath, `${createSummaryMarkdown(summary)}\n`, "utf8");

  console.log("");
  console.log("[tp-discover-custom-metrics-api] Summary");
  console.log(`status_code: ${summary.statusCode ?? "unknown"}`);
  console.log(`content_type: ${summary.contentType ?? "unknown"}`);
  console.log(`response_kind: ${summary.responseKind}`);
  console.log(`top_level_keys: ${summary.topLevelKeys.length ? summary.topLevelKeys.join(", ") : "none"}`);
  console.log(`total_rows_or_items: ${summary.totalRowsOrItems ?? "unknown"}`);
  console.log(
    `detected_metric_names_or_types: ${
      summary.detectedMetricNamesOrTypes.length ? summary.detectedMetricNamesOrTypes.join(" | ") : "none"
    }`,
  );
  console.log(`sample_dates: ${summary.sampleDates.length ? summary.sampleDates.join(", ") : "none"}`);
  console.log(`date_range_appears_honored: ${String(summary.dateRangeAppearsHonored)}`);
  console.log(`source_or_vendor_fields_present: ${summary.sourceOrVendorFieldsPresent ? "yes" : "no"}`);
  console.log(`normalized_row_count: ${summary.normalizedRowCount}`);
  console.log(`metric_keys_found: ${summary.normalizedMetricKeys.length ? summary.normalizedMetricKeys.join(", ") : "none"}`);
  console.log(`coverage_by_metric_key: ${JSON.stringify(summary.normalizedCoverageByMetricKey)}`);
  console.log(
    `warnings_observed: ${summary.normalizationWarnings.length ? summary.normalizationWarnings.join(" | ") : "none"}`,
  );
  console.log(`had_aggregate_value_rows: ${summary.hadAggregateValueRows ? "yes" : "no"}`);
  console.log(`sample_normalized_rows: ${JSON.stringify(summary.normalizedSampleRows, null, 2)}`);
  if (summary.failureMessage) {
    console.log(`failure_message: ${summary.failureMessage}`);
  }
  if (summary.nextStepSuggestion) {
    console.log(`next_step_suggestion: ${summary.nextStepSuggestion}`);
  }
  console.log(`raw_response_artifact: ${summary.rawResponsePath ?? "none"}`);
  console.log(`redacted_json_artifact: ${summary.redactedJsonPath ?? "none"}`);
  console.log(`summary_artifact: ${summary.summaryPath}`);
}

main().catch((error: unknown) => {
  console.error("tp-discover-custom-metrics-api failed.");
  console.error(error);
  process.exit(1);
});
