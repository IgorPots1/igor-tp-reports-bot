import { copyFile, mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import type { Locator, Page } from "playwright";
import { chromium } from "playwright";
import { exportsRoot, profileDir } from "./lib/paths.ts";
import { findStudentById, readStudentsConfig } from "./lib/students.ts";

const DEBUG = process.env.TP_DEBUG === "1";

function debugLog(...args: unknown[]): void {
  if (DEBUG) {
    console.log(...args);
  }
}

type CliArgs = {
  student: string;
  from: string;
  to: string;
};

type PageAssessment = {
  loginRequired: boolean;
  athletePageLikelyReachable: boolean;
  trainingPeaksContextLikely: boolean;
  hardAccessBlocked?: boolean;
  fallbackReason?: string;
};

type AutomationAttemptResult = {
  ok: boolean;
  reason?: string;
  visibleCandidates?: string[];
};

type WorkoutSummarySectionResolution = {
  section: Locator | null;
  candidates: string[];
  selectedCandidate?: string;
};

type WorkoutSummaryFormatInspection = {
  controls: string[];
  selectedFormatValue?: string;
  appliedSelection?: string;
  selectionError?: string;
};

type WorkoutSummaryPreClickDebug = {
  containerSummary: string;
  startDateCount: number;
  endDateCount: number;
  exportButtons: string[];
  selectedButtonText?: string;
  selectedButtonDisabled?: boolean;
  selectedButtonAriaDisabled?: string;
  selectedButtonClass?: string;
  selectedButtonFormInfo?: string;
  controls: string[];
  selectedFormatValue?: string;
  startDateValue: string;
  endDateValue: string;
};

type WorkoutSummaryClickDebug = WorkoutSummaryPreClickDebug & {
  validationMessagesAfterClick: string[];
  consoleErrors: string[];
  networkEvents: string[];
  popupOpened: boolean;
  clickMode: "normal" | "force";
  clickError?: string;
};

function usage(): string {
  return [
    "Usage:",
    "  npm run tp-export-one-student -- --student=nadezhda --from=2026-04-28 --to=2026-05-04"
  ].join("\n");
}

function parseArgs(argv: string[]): CliArgs {
  const values: Partial<CliArgs> = {};

  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, ...rest] = arg.slice(2).split("=");
    const value = rest.join("=");
    if (!value) {
      continue;
    }

    if (rawKey === "student" || rawKey === "from" || rawKey === "to") {
      values[rawKey] = value;
    }
  }

  if (!values.student || !values.from || !values.to) {
    throw new Error(`Missing required CLI args.\n\n${usage()}`);
  }

  const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDatePattern.test(values.from) || !isoDatePattern.test(values.to)) {
    throw new Error("`--from` and `--to` must use YYYY-MM-DD format.");
  }

  return values as CliArgs;
}

async function waitForEnter(message: string): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    await rl.question(`${message}\n`);
  } finally {
    rl.close();
  }
}

function normalizeExportName(filePath: string): string {
  return path
    .basename(filePath, path.extname(filePath))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isLikelyWorkoutSummaryZip(filePath: string): boolean {
  const normalized = normalizeExportName(filePath);
  return normalized.includes("workoutexport") || normalized.includes("workoutsummary");
}

function isLikelyWorkoutFilesZip(filePath: string): boolean {
  const normalized = normalizeExportName(filePath);
  return normalized.includes("workoutfileexport") || normalized.includes("workoutfiles");
}

type ExportAssessment = {
  summaryZip?: string;
  summaryCsv?: string;
  workoutFilesZip?: string;
};

function isLikelyWorkoutSummaryCsv(filePath: string): boolean {
  if (path.extname(filePath).toLowerCase() !== ".csv") {
    return false;
  }

  const lowerName = path.basename(filePath).toLowerCase();
  return /^workouts.*\.csv$/.test(lowerName) || (lowerName.includes("workout") && lowerName.endsWith(".csv"));
}

function assessExportFiles(summaryZipFiles: string[], summaryCsvFiles: string[], zipFiles: string[]): ExportAssessment {
  return {
    summaryZip: summaryZipFiles.find((filePath) => isLikelyWorkoutSummaryZip(filePath)),
    summaryCsv: summaryCsvFiles.find((filePath) => isLikelyWorkoutSummaryCsv(filePath)),
    workoutFilesZip: zipFiles.find((filePath) => isLikelyWorkoutFilesZip(filePath))
  };
}

type ExportDirSnapshot = {
  zipFiles: string[];
  csvFiles: string[];
  summaryZipFiles: string[];
  summaryZipEntries: ExportFileEntry[];
  summaryCsvFiles: string[];
  summaryCsvEntries: ExportFileEntry[];
  summaryTempFiles: string[];
};

type ExportFileEntry = {
  fileName: string;
  filePath: string;
  modifiedAtMs: number;
};

function isLikelyBrowserTempDownload(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return (
    lowerName.endsWith(".crdownload") ||
    lowerName.endsWith(".download") ||
    lowerName.endsWith(".part") ||
    lowerName.endsWith(".tmp")
  );
}

function isLikelyWorkoutSummaryArtifact(fileName: string): boolean {
  if (isLikelyWorkoutSummaryZip(fileName)) {
    return true;
  }

  if (isLikelyWorkoutSummaryCsv(fileName)) {
    return true;
  }

  return fileName.toLowerCase().includes("workout summary") || fileName.toLowerCase().includes("workout");
}

async function inspectExportDir(exportDir: string): Promise<ExportDirSnapshot> {
  const entries = await readdir(exportDir, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return [];
    }

    throw error;
  });
  const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const zipEntries = (
    await Promise.all(
      fileNames
        .filter((fileName) => path.extname(fileName).toLowerCase() === ".zip")
        .map(async (fileName) => {
          const filePath = path.join(exportDir, fileName);
          const fileStats = await stat(filePath).catch(() => null);
          if (!fileStats?.isFile()) {
            return null;
          }

          return {
            fileName,
            filePath,
            modifiedAtMs: fileStats.mtimeMs
          } satisfies ExportFileEntry;
        })
    )
  )
    .filter((entry): entry is ExportFileEntry => entry !== null)
    .sort((left, right) => {
      if (right.modifiedAtMs !== left.modifiedAtMs) {
        return right.modifiedAtMs - left.modifiedAtMs;
      }

      return left.fileName.localeCompare(right.fileName);
    });
  const zipFiles = zipEntries.map((entry) => entry.filePath);
  const summaryZipEntries = zipEntries.filter((entry) => isLikelyWorkoutSummaryArtifact(entry.fileName));
  const csvEntries = (
    await Promise.all(
      fileNames
        .filter((fileName) => path.extname(fileName).toLowerCase() === ".csv")
        .map(async (fileName) => {
          const filePath = path.join(exportDir, fileName);
          const fileStats = await stat(filePath).catch(() => null);
          if (!fileStats?.isFile()) {
            return null;
          }

          return {
            fileName,
            filePath,
            modifiedAtMs: fileStats.mtimeMs
          } satisfies ExportFileEntry;
        })
    )
  )
    .filter((entry): entry is ExportFileEntry => entry !== null)
    .sort((left, right) => {
      if (right.modifiedAtMs !== left.modifiedAtMs) {
        return right.modifiedAtMs - left.modifiedAtMs;
      }

      return left.fileName.localeCompare(right.fileName);
    });
  const csvFiles = csvEntries.map((entry) => entry.filePath);
  const summaryCsvEntries = csvEntries.filter((entry) => isLikelyWorkoutSummaryCsv(entry.fileName));

  return {
    zipFiles,
    csvFiles,
    summaryZipFiles: summaryZipEntries.map((entry) => entry.filePath),
    summaryZipEntries,
    summaryCsvFiles: summaryCsvEntries.map((entry) => entry.filePath),
    summaryCsvEntries,
    summaryTempFiles: fileNames.filter(
      (fileName) => isLikelyBrowserTempDownload(fileName) && isLikelyWorkoutSummaryArtifact(fileName)
    )
  };
}

function selectNewExportFile(
  candidates: ExportFileEntry[],
  knownFiles: Set<string>,
  minimumModifiedAtMs: number
): ExportFileEntry | undefined {
  return candidates.find(
    (candidate) => !knownFiles.has(candidate.filePath) && candidate.modifiedAtMs >= minimumModifiedAtMs
  );
}

async function uniquePathForFile(directory: string, fileName: string): Promise<string> {
  const parsed = path.parse(fileName);
  let suffix = 0;

  while (true) {
    const candidateName =
      suffix === 0 ? `${parsed.name}${parsed.ext}` : `${parsed.name} (${suffix})${parsed.ext}`;
    const candidatePath = path.join(directory, candidateName);
    const existingStats = await stat(candidatePath).catch(() => null);
    if (!existingStats) {
      return candidatePath;
    }

    suffix += 1;
  }
}

async function moveSummaryZipToExportDir(sourcePath: string, exportDir: string): Promise<string> {
  const destinationPath = await uniquePathForFile(exportDir, path.basename(sourcePath));

  try {
    await rename(sourcePath, destinationPath);
    return destinationPath;
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;
    if (fileError.code !== "EXDEV") {
      throw error;
    }
  }

  await copyFile(sourcePath, destinationPath);
  await unlink(sourcePath);
  return destinationPath;
}

async function uniquePathForSummaryCsv(directory: string, fileName: string): Promise<string> {
  const parsed = path.parse(fileName);
  let suffix = 0;

  while (true) {
    const candidateName = suffix === 0 ? `${parsed.name}${parsed.ext}` : `${parsed.name}-${suffix}${parsed.ext}`;
    const candidatePath = path.join(directory, candidateName);
    const existingStats = await stat(candidatePath).catch(() => null);
    if (!existingStats) {
      return candidatePath;
    }

    suffix += 1;
  }
}

async function moveSummaryCsvToExportDir(sourcePath: string, exportDir: string): Promise<string> {
  const destinationPath = await uniquePathForSummaryCsv(exportDir, path.basename(sourcePath));

  try {
    await rename(sourcePath, destinationPath);
    return destinationPath;
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;
    if (fileError.code !== "EXDEV") {
      throw error;
    }
  }

  await copyFile(sourcePath, destinationPath);
  await unlink(sourcePath);
  return destinationPath;
}

type SummaryArtifactKind = "zip" | "csv";

type SummaryArtifactDetectionResult = AutomationAttemptResult & {
  detectedIn?: "exportDir" | "downloads";
  summaryArtifact?: string;
  summaryKind?: SummaryArtifactKind;
};

type GeneratedDownloadLinkState = {
  exportCompleteVisible: boolean;
  downloadInstructionVisible: boolean;
  linkText?: string;
  linkHref?: string;
  candidateTexts?: string[];
  candidateLinks?: string[];
};

type GeneratedDownloadLinkWaitResult = AutomationAttemptResult & GeneratedDownloadLinkState;

type GeneratedDownloadLinkClickResult = AutomationAttemptResult & GeneratedDownloadLinkState & {
  clickMode: "normal" | "force";
  clickSucceeded: boolean;
  popupOpened: boolean;
  clickError?: string;
};

type ExportApiCaptureResult = {
  responseMatched: boolean;
  status?: number;
  contentType?: string;
  topLevelKeys: string[];
  bodyPreview?: string;
  downloadUrlFound: boolean;
  directBodyFound: boolean;
  asyncJobDetected: boolean;
  asyncPollAttempted: boolean;
  savedArtifactPath?: string;
  savedArtifactKind?: SummaryArtifactKind;
  savedVia?: "response-url" | "response-body" | "async-job";
  fallbackReason?: string;
};

type WorkoutSummaryClickAttemptResult = AutomationAttemptResult & {
  clickDebug?: WorkoutSummaryClickDebug;
  apiCapture?: ExportApiCaptureResult;
};

type AnalyzedExportApiPayload = {
  status: number;
  contentType: string;
  topLevelKeys: string[];
  bodyPreview: string;
  parsedJson?: unknown;
  downloadUrl?: string;
  asyncEndpointUrls: string[];
  asyncJobDetected: boolean;
  directBodyKind?: SummaryArtifactKind;
  embeddedBody?: Buffer;
  fileNameHint?: string;
};

function normalizeHeaderRecord(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function normalizeKeyForComparison(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKeyName(key: string): boolean {
  const normalized = normalizeKeyForComparison(key);
  return [
    "token",
    "accesstoken",
    "refreshtoken",
    "authtoken",
    "authorization",
    "cookie",
    "cookies",
    "session",
    "sessionid",
    "secret",
    "signature",
    "sig",
    "apikey"
  ].includes(normalized);
}

function sanitizeUrlForLog(rawUrl: string): string {
  return shortenUrl(rawUrl);
}

function sanitizeStringForLog(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return compact;
  }

  const redactedTokens = compact.replace(/(bearer\s+)[a-z0-9._-]+/gi, "$1[redacted]");
  const redactedUrls = redactedTokens.replace(/https?:\/\/[^\s"'`<>]+/gi, (match) => sanitizeUrlForLog(match));
  return truncateForLog(redactedUrls, 280);
}

function sanitizeJsonForLog(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (depth >= 4) {
    return "[truncated]";
  }

  if (typeof value === "string") {
    return sanitizeStringForLog(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 5).map((item) => sanitizeJsonForLog(item, depth + 1));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 20)
        .map(([key, entryValue]) => [
          key,
          isSensitiveKeyName(key) ? "[redacted]" : sanitizeJsonForLog(entryValue, depth + 1)
        ])
    );
  }

  return String(value);
}

function getTopLevelKeys(value: unknown): string[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>);
  }

  return [];
}

function getNestedValue(value: unknown, dottedPath: string): unknown {
  const parts = dottedPath.split(".");
  let current: unknown = value;

  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function resolveUrlCandidate(rawValue: unknown, baseUrl: string): string | undefined {
  if (typeof rawValue !== "string") {
    return undefined;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function extractUrlFromPayload(value: unknown, dottedPaths: string[], baseUrl: string): string | undefined {
  for (const dottedPath of dottedPaths) {
    const candidate = resolveUrlCandidate(getNestedValue(value, dottedPath), baseUrl);
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

function extractExplicitEndpointUrls(value: unknown, baseUrl: string): string[] {
  const dottedPaths = [
    "statusUrl",
    "status_url",
    "jobUrl",
    "job_url",
    "pollUrl",
    "poll_url",
    "statusEndpoint",
    "downloadEndpoint",
    "jobEndpoint",
    "data.statusUrl",
    "data.status_url",
    "data.jobUrl",
    "data.job_url",
    "data.pollUrl",
    "data.poll_url",
    "data.statusEndpoint",
    "data.downloadEndpoint",
    "data.jobEndpoint"
  ];

  const urls = dottedPaths
    .map((dottedPath) => resolveUrlCandidate(getNestedValue(value, dottedPath), baseUrl))
    .filter((entry): entry is string => Boolean(entry));

  return [...new Set(urls)];
}

function parseContentDispositionFileName(contentDisposition: string): string | undefined {
  const utf8Match = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return path.basename(decodeURIComponent(utf8Match[1]));
  }

  const plainMatch = contentDisposition.match(/filename\s*=\s*"([^"]+)"/i) ?? contentDisposition.match(/filename\s*=\s*([^;]+)/i);
  if (plainMatch?.[1]) {
    return path.basename(plainMatch[1].trim());
  }

  return undefined;
}

function inferSummaryArtifactKind(contentType: string): SummaryArtifactKind | undefined {
  const normalizedContentType = contentType.toLowerCase();
  if (normalizedContentType.includes("csv")) {
    return "csv";
  }

  if (
    normalizedContentType.includes("zip") ||
    normalizedContentType.includes("gzip") ||
    normalizedContentType.includes("octet-stream")
  ) {
    return "zip";
  }

  return undefined;
}

function looksLikeCsvText(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return false;
  }

  const lines = trimmed.split(/\r?\n/).slice(0, 4).filter(Boolean);
  if (lines.length < 2) {
    return false;
  }

  return lines.every((line) => line.includes(","));
}

function looksLikeBase64(value: string): boolean {
  const compact = value.replace(/\s+/g, "");
  return compact.length >= 16 && compact.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(compact);
}

function inferSummaryArtifactFileName(
  responseUrl: string,
  contentDisposition: string | undefined,
  fileNameHint: string | undefined,
  kind: SummaryArtifactKind,
  fallbackBaseName: string
): string {
  const contentDispositionName = contentDisposition ? parseContentDispositionFileName(contentDisposition) : undefined;
  const urlBaseName = (() => {
    try {
      const parsedUrl = new URL(responseUrl);
      const baseName = path.basename(parsedUrl.pathname);
      return baseName && baseName !== "/" ? baseName : undefined;
    } catch {
      return undefined;
    }
  })();
  const selectedName = fileNameHint || contentDispositionName || urlBaseName || `${fallbackBaseName}.${kind}`;
  const parsedName = path.parse(selectedName);

  if (parsedName.ext) {
    return selectedName;
  }

  return `${selectedName}.${kind}`;
}

async function saveSummaryArtifactFromBuffer(
  exportDir: string,
  responseUrl: string,
  contentDisposition: string | undefined,
  fileNameHint: string | undefined,
  body: Buffer,
  kind: SummaryArtifactKind,
  fallbackBaseName: string
): Promise<string> {
  const targetFileName = inferSummaryArtifactFileName(
    responseUrl,
    contentDisposition,
    fileNameHint,
    kind,
    fallbackBaseName
  );
  const destinationPath = await uniquePathForFile(exportDir, targetFileName);
  await writeFile(destinationPath, body);
  return destinationPath;
}

function analyzeExportApiPayload(params: {
  responseUrl: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}): AnalyzedExportApiPayload {
  const headers = normalizeHeaderRecord(params.headers);
  const contentType = headers["content-type"] ?? "";
  const normalizedContentType = contentType.toLowerCase();
  const directBodyKind = inferSummaryArtifactKind(contentType);
  const fileNameHint = parseContentDispositionFileName(headers["content-disposition"] ?? "");

  if (directBodyKind === "zip") {
    return {
      status: params.status,
      contentType,
      topLevelKeys: [],
      bodyPreview: `[binary zip body, ${params.body.length} bytes]`,
      directBodyKind,
      asyncEndpointUrls: [],
      asyncJobDetected: false,
      fileNameHint
    };
  }

  const decodedText = params.body.toString("utf8");
  if (directBodyKind === "csv" || normalizedContentType.includes("text/") || looksLikeCsvText(decodedText)) {
    return {
      status: params.status,
      contentType,
      topLevelKeys: [],
      bodyPreview: sanitizeStringForLog(decodedText.split(/\r?\n/).slice(0, 3).join(" | ")),
      directBodyKind: directBodyKind ?? (looksLikeCsvText(decodedText) ? "csv" : undefined),
      asyncEndpointUrls: [],
      asyncJobDetected: false,
      fileNameHint
    };
  }

  try {
    const parsedJson = JSON.parse(decodedText) as unknown;
    const topLevelKeys = getTopLevelKeys(parsedJson);
    const jsonRecord =
      parsedJson && typeof parsedJson === "object" && !Array.isArray(parsedJson)
        ? (parsedJson as Record<string, unknown>)
        : undefined;
    const embeddedContentType = typeof jsonRecord?.contentType === "string" ? jsonRecord.contentType : "";
    const embeddedData = typeof jsonRecord?.data === "string" ? jsonRecord.data : undefined;
    const embeddedFileName = typeof jsonRecord?.fileName === "string" ? path.basename(jsonRecord.fileName) : fileNameHint;
    const embeddedKind = embeddedContentType ? inferSummaryArtifactKind(embeddedContentType) : undefined;
    const downloadUrl = extractUrlFromPayload(
      parsedJson,
      [
        "url",
        "downloadUrl",
        "download_url",
        "fileUrl",
        "file_url",
        "href",
        "link",
        "location",
        "data.url",
        "data.downloadUrl"
      ],
      params.responseUrl
    ) ?? resolveUrlCandidate(headers.location, params.responseUrl);
    const asyncEndpointUrls = extractExplicitEndpointUrls(parsedJson, params.responseUrl);
    const asyncJobDetected =
      Boolean(parsedJson) &&
      typeof parsedJson === "object" &&
      !Array.isArray(parsedJson) &&
      topLevelKeys.some((key) =>
        ["status", "state", "job", "jobId", "jobStatus", "progress", "complete", "completed"].includes(key)
      );
    const embeddedBody = (() => {
      if (!embeddedKind || !embeddedData) {
        return undefined;
      }

      if (embeddedKind === "zip" && looksLikeBase64(embeddedData)) {
        const decoded = Buffer.from(embeddedData, "base64");
        return decoded.length > 0 ? decoded : undefined;
      }

      if (embeddedKind === "csv") {
        return Buffer.from(embeddedData, "utf8");
      }

      return undefined;
    })();

    return {
      status: params.status,
      contentType,
      topLevelKeys,
      bodyPreview: truncateForLog(JSON.stringify(sanitizeJsonForLog(parsedJson)), 280),
      parsedJson,
      downloadUrl,
      asyncEndpointUrls,
      asyncJobDetected,
      directBodyKind: embeddedBody ? embeddedKind : undefined,
      embeddedBody,
      fileNameHint: embeddedFileName
    };
  } catch {
    return {
      status: params.status,
      contentType,
      topLevelKeys: [],
      bodyPreview: sanitizeStringForLog(decodedText),
      asyncEndpointUrls: [],
      asyncJobDetected: false,
      fileNameHint
    };
  }
}

function logExportApiSummary(prefix: string, analysis: AnalyzedExportApiPayload): void {
  debugLog(
    `${prefix} ${JSON.stringify({
      status: analysis.status,
      contentType: analysis.contentType || "(none)",
      topLevelKeys: analysis.topLevelKeys,
      bodyPreview: analysis.bodyPreview
    })}`
  );
}

async function downloadWorkoutSummaryFromUrl(
  context: ReturnType<Page["context"]>,
  downloadUrl: string,
  exportDir: string,
  fallbackBaseName: string
): Promise<{ filePath: string; kind: SummaryArtifactKind }> {
  const response = await context.request.get(downloadUrl, { failOnStatusCode: false });
  const body = Buffer.from(await response.body());
  const headers = normalizeHeaderRecord(response.headers());
  const contentType = headers["content-type"] ?? "";
  const kind = inferSummaryArtifactKind(contentType) ?? (looksLikeCsvText(body.toString("utf8")) ? "csv" : "zip");
  const filePath = await saveSummaryArtifactFromBuffer(
    exportDir,
    downloadUrl,
    headers["content-disposition"],
    undefined,
    body,
    kind,
    fallbackBaseName
  );

  return { filePath, kind };
}

function extractAsyncStatusLabel(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const statusCandidate = record.status ?? record.state ?? record.jobStatus;
  return typeof statusCandidate === "string" ? statusCandidate : undefined;
}

async function pollExportApiAsyncJob(params: {
  context: ReturnType<Page["context"]>;
  endpointUrls: string[];
  exportDir: string;
  fallbackBaseName: string;
}): Promise<Pick<ExportApiCaptureResult, "savedArtifactKind" | "savedArtifactPath" | "savedVia" | "fallbackReason">> {
  const queue = [...new Set(params.endpointUrls)];
  const seenUrls = new Set<string>();

  while (queue.length > 0) {
    const endpointUrl = queue.shift();
    if (!endpointUrl || seenUrls.has(endpointUrl)) {
      continue;
    }
    seenUrls.add(endpointUrl);

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      debugLog(`Auto-export debug: polling export API async endpoint="${sanitizeUrlForLog(endpointUrl)}" attempt=${attempt}`);
      const response = await params.context.request.get(endpointUrl, { failOnStatusCode: false });
      const body = Buffer.from(await response.body());
      const responseHeaders = normalizeHeaderRecord(response.headers());
      const analysis = analyzeExportApiPayload({
        responseUrl: endpointUrl,
        status: response.status(),
        headers: responseHeaders,
        body
      });
      logExportApiSummary("Auto-export debug: export API async poll", analysis);

      if (analysis.downloadUrl) {
        const downloaded = await downloadWorkoutSummaryFromUrl(
          params.context,
          analysis.downloadUrl,
          params.exportDir,
          params.fallbackBaseName
        );
        return {
          savedArtifactKind: downloaded.kind,
          savedArtifactPath: downloaded.filePath,
          savedVia: "async-job"
        };
      }

      if (analysis.directBodyKind) {
        const savedPath = await saveSummaryArtifactFromBuffer(
          params.exportDir,
          endpointUrl,
          responseHeaders["content-disposition"],
          analysis.fileNameHint,
          analysis.embeddedBody ?? body,
          analysis.directBodyKind,
          params.fallbackBaseName
        );
        return {
          savedArtifactKind: analysis.directBodyKind,
          savedArtifactPath: savedPath,
          savedVia: "async-job"
        };
      }

      for (const discoveredUrl of analysis.asyncEndpointUrls) {
        if (!seenUrls.has(discoveredUrl) && !queue.includes(discoveredUrl)) {
          queue.push(discoveredUrl);
        }
      }

      const asyncStatus = extractAsyncStatusLabel(analysis.parsedJson);
      if (asyncStatus && /(failed|error|cancelled)/i.test(asyncStatus)) {
        return {
          fallbackReason: `export API async job reported status "${asyncStatus}".`
        };
      }

      if (!analysis.asyncJobDetected && analysis.asyncEndpointUrls.length === 0) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  return {
    fallbackReason: "export API async job did not produce a download URL or file body."
  };
}

async function captureAndMaybeSaveWorkoutSummaryExportResponse(params: {
  context: ReturnType<Page["context"]>;
  response: Awaited<ReturnType<Page["waitForResponse"]>>;
  exportDir: string;
  studentId: string;
  from: string;
  to: string;
}): Promise<ExportApiCaptureResult> {
  const headers = await params.response.allHeaders().catch(() => ({}));
  const body = Buffer.from(await params.response.body().catch(() => new Uint8Array()));
  const analysis = analyzeExportApiPayload({
    responseUrl: params.response.url(),
    status: params.response.status(),
    headers,
    body
  });
  logExportApiSummary("Auto-export debug: export API response", analysis);

  const fallbackBaseName = `WorkoutExport--${params.studentId}-${params.from}-${params.to}`;
  const result: ExportApiCaptureResult = {
    responseMatched: true,
    status: analysis.status,
    contentType: analysis.contentType,
    topLevelKeys: analysis.topLevelKeys,
    bodyPreview: analysis.bodyPreview,
    downloadUrlFound: Boolean(analysis.downloadUrl),
    directBodyFound: Boolean(analysis.directBodyKind),
    asyncJobDetected: analysis.asyncJobDetected,
    asyncPollAttempted: false
  };

  if (analysis.downloadUrl) {
    const downloaded = await downloadWorkoutSummaryFromUrl(
      params.context,
      analysis.downloadUrl,
      params.exportDir,
      fallbackBaseName
    );
    console.log("Auto-export: downloaded Workout Summary from API response URL");
    return {
      ...result,
      savedArtifactPath: downloaded.filePath,
      savedArtifactKind: downloaded.kind,
      savedVia: "response-url"
    };
  }

  if (analysis.directBodyKind) {
    const savedPath = await saveSummaryArtifactFromBuffer(
      params.exportDir,
      params.response.url(),
      normalizeHeaderRecord(headers)["content-disposition"],
      analysis.fileNameHint,
      analysis.embeddedBody ?? body,
      analysis.directBodyKind,
      fallbackBaseName
    );
    console.log("Auto-export: saved Workout Summary from API response body");
    return {
      ...result,
      savedArtifactPath: savedPath,
      savedArtifactKind: analysis.directBodyKind,
      savedVia: "response-body"
    };
  }

  if (analysis.asyncJobDetected || analysis.asyncEndpointUrls.length > 0) {
    debugLog(
      `Auto-export debug: export API async job detected top-level keys="${analysis.topLevelKeys.join(", ") || "(none)"}"`
    );
    if (analysis.asyncEndpointUrls.length > 0) {
      const polledResult = await pollExportApiAsyncJob({
        context: params.context,
        endpointUrls: analysis.asyncEndpointUrls,
        exportDir: params.exportDir,
        fallbackBaseName
      });
      return {
        ...result,
        asyncPollAttempted: true,
        savedArtifactPath: polledResult.savedArtifactPath,
        savedArtifactKind: polledResult.savedArtifactKind,
        savedVia: polledResult.savedVia,
        fallbackReason: polledResult.fallbackReason
      };
    }

    return {
      ...result,
      fallbackReason: "export API looked like an async job, but no explicit poll/download endpoint was provided."
    };
  }

  return {
    ...result,
    fallbackReason: "export API response did not include a download URL or direct file body."
  };
}

async function waitForWorkoutSummaryArtifact(
  exportDir: string,
  downloadsDir: string,
  knownSummaryZipFiles: string[],
  knownSummaryCsvFiles: string[],
  knownDownloadsSummaryZipFiles: string[],
  knownDownloadsSummaryCsvFiles: string[],
  minimumModifiedAtMs: number,
  timeoutMs = 90_000
): Promise<SummaryArtifactDetectionResult> {
  const knownSummaryZipSet = new Set(knownSummaryZipFiles);
  const knownSummaryCsvSet = new Set(knownSummaryCsvFiles);
  const knownDownloadsSummaryZipSet = new Set(knownDownloadsSummaryZipFiles);
  const knownDownloadsSummaryCsvSet = new Set(knownDownloadsSummaryCsvFiles);
  const startedAt = Date.now();
  let lastProgressLogAt = 0;

  while (Date.now() - startedAt <= timeoutMs) {
    const [exportSnapshot, downloadsSnapshot] = await Promise.all([
      inspectExportDir(exportDir),
      inspectExportDir(downloadsDir)
    ]);
    const newSummaryZipInExportDir = selectNewExportFile(
      exportSnapshot.summaryZipEntries,
      knownSummaryZipSet,
      minimumModifiedAtMs
    );
    if (newSummaryZipInExportDir) {
      debugLog(
        `Auto-export debug: detected Workout Summary ZIP in exportDir: ${path.basename(newSummaryZipInExportDir.filePath)}`
      );
      return {
        ok: true,
        summaryArtifact: newSummaryZipInExportDir.filePath,
        summaryKind: "zip",
        detectedIn: "exportDir"
      };
    }

    const newSummaryCsvInExportDir = selectNewExportFile(
      exportSnapshot.summaryCsvEntries,
      knownSummaryCsvSet,
      minimumModifiedAtMs
    );
    if (newSummaryCsvInExportDir) {
      debugLog(
        `Auto-export debug: detected Workout Summary CSV in exportDir: ${path.basename(newSummaryCsvInExportDir.filePath)}`
      );
      return {
        ok: true,
        summaryArtifact: newSummaryCsvInExportDir.filePath,
        summaryKind: "csv",
        detectedIn: "exportDir"
      };
    }

    const newSummaryZipInDownloads = selectNewExportFile(
      downloadsSnapshot.summaryZipEntries,
      knownDownloadsSummaryZipSet,
      minimumModifiedAtMs
    );
    if (newSummaryZipInDownloads) {
      debugLog(
        `Auto-export debug: detected Workout Summary ZIP in Downloads: ${path.basename(newSummaryZipInDownloads.filePath)}`
      );
      const movedSummaryZip = await moveSummaryZipToExportDir(newSummaryZipInDownloads.filePath, exportDir);
      return {
        ok: true,
        summaryArtifact: movedSummaryZip,
        summaryKind: "zip",
        detectedIn: "downloads"
      };
    }

    const newSummaryCsvInDownloads = selectNewExportFile(
      downloadsSnapshot.summaryCsvEntries,
      knownDownloadsSummaryCsvSet,
      minimumModifiedAtMs
    );
    if (newSummaryCsvInDownloads) {
      debugLog(
        `Auto-export debug: detected Workout Summary CSV in Downloads: ${path.basename(newSummaryCsvInDownloads.filePath)}`
      );
      const movedSummaryCsv = await moveSummaryCsvToExportDir(newSummaryCsvInDownloads.filePath, exportDir);
      return {
        ok: true,
        summaryArtifact: movedSummaryCsv,
        summaryKind: "csv",
        detectedIn: "downloads"
      };
    }

    const now = Date.now();
    if (now - lastProgressLogAt >= 5_000) {
      const elapsedSeconds = Math.floor((now - startedAt) / 1000);
      const tempFiles = [
        ...exportSnapshot.summaryTempFiles.map((fileName) => `${fileName} [exportDir]`),
        ...downloadsSnapshot.summaryTempFiles.map((fileName) => `${fileName} [Downloads]`)
      ];
      if (tempFiles.length > 0) {
        debugLog(
          `Auto-export: waiting for Workout Summary export (${elapsedSeconds}s elapsed, temporary files: ${tempFiles.join(", ")})`
        );
      } else {
        debugLog(`Auto-export: waiting for Workout Summary export (${elapsedSeconds}s elapsed)`);
      }
      lastProgressLogAt = now;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return {
    ok: false,
    reason: `did not detect a new Workout Summary ZIP or CSV in ${timeoutMs / 1000} seconds.`
  };
}

function logExportAssessment(assessment: ExportAssessment): void {
  if (assessment.summaryZip) {
    console.log("Workout Summary export found. Continuing.");
    console.log(`- ${assessment.summaryZip}`);
  } else if (assessment.summaryCsv) {
    console.log("Workout Summary CSV found. Continuing.");
    console.log(`- ${assessment.summaryCsv}`);
  } else {
    console.log("Workout Summary export was not found. This student cannot be parsed.");
  }

  if (assessment.workoutFilesZip) {
    console.log(`Workout Files export found: ${assessment.workoutFilesZip}`);
  } else {
    console.log("Workout Files export not found. Continuing because it is optional for weekly reports.");
  }
}

async function isVisible(locator: Locator, timeout = 700): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

async function anyVisible(locators: Locator[], timeout = 700): Promise<boolean> {
  for (const locator of locators) {
    if (await isVisible(locator, timeout)) {
      return true;
    }
  }

  return false;
}

async function getPageText(page: Page): Promise<string> {
  const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  return bodyText.replace(/\s+/g, " ").trim().toLowerCase();
}

async function assessTrainingPeaksPage(page: Page): Promise<PageAssessment> {
  await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});

  const [title, bodyText] = await Promise.all([page.title().catch(() => ""), getPageText(page)]);
  const combinedText = `${title} ${bodyText}`.trim().toLowerCase();
  const currentUrl = page.url();
  const trainingPeaksUrlDetected = currentUrl.toLowerCase().includes("trainingpeaks");

  const loginSignals = await Promise.all([
    isVisible(page.locator('input[type="password"]')),
    isVisible(page.locator('input[type="email"], input[name*="email" i], input[autocomplete="username"]')),
    anyVisible([
      page.getByRole("button", { name: /sign in|log in|login/i }),
      page.getByRole("link", { name: /sign in|log in|login/i }),
      page.getByText(/sign in|log in|login/i)
    ])
  ]);

  const loginTextDetected = /sign in|log in|login|password|forgot password|remember me/.test(combinedText);
  if (/(login|signin|sign-in|auth)/i.test(currentUrl) || loginSignals.some(Boolean) || loginTextDetected) {
    return {
      loginRequired: true,
      athletePageLikelyReachable: false,
      trainingPeaksContextLikely: trainingPeaksUrlDetected,
      fallbackReason: "login screen detected or session not ready."
    };
  }

  if (!combinedText) {
    return {
      loginRequired: false,
      athletePageLikelyReachable: false,
      trainingPeaksContextLikely: trainingPeaksUrlDetected,
      fallbackReason: "page content did not load clearly."
    };
  }

  const trainingPeaksShellVisible = await anyVisible([
    page.getByText(/trainingpeaks/i),
    page.getByRole("link", { name: /calendar|workouts|settings/i }),
    page.getByRole("button", { name: /calendar|workouts|settings/i }),
    page.getByText(/athlete account settings|export data/i)
  ]);

  const shellTextDetected = /trainingpeaks|calendar|workout|athlete|account settings|export data/.test(combinedText);
  const trainingPeaksContextLikely = trainingPeaksUrlDetected || trainingPeaksShellVisible || shellTextDetected;
  const hardAccessBlocked =
    /access denied|403|forbidden/.test(combinedText) && !trainingPeaksShellVisible && !shellTextDetected;
  if (hardAccessBlocked) {
    return {
      loginRequired: false,
      athletePageLikelyReachable: false,
      trainingPeaksContextLikely,
      hardAccessBlocked: true,
      fallbackReason: "access denied or forbidden page detected."
    };
  }

  if (!trainingPeaksContextLikely) {
    return {
      loginRequired: false,
      athletePageLikelyReachable: false,
      trainingPeaksContextLikely: false,
      fallbackReason: "could not confirm the TrainingPeaks page context."
    };
  }

  if (/something went wrong|404|not found|unavailable/.test(combinedText)) {
    return {
      loginRequired: false,
      athletePageLikelyReachable: false,
      trainingPeaksContextLikely,
      fallbackReason: "page state is still uncertain."
    };
  }

  return {
    loginRequired: false,
    athletePageLikelyReachable: true,
    trainingPeaksContextLikely
  };
}

function formatForTrainingPeaksDateInput(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map((part) => Number(part));
  return `${month}/${day}/${year}`;
}

async function clickFirstVisible(locators: Locator[], timeout = 500): Promise<boolean> {
  for (const locator of locators) {
    if (!(await isVisible(locator, timeout))) {
      continue;
    }

    try {
      await locator.first().click({ timeout: 2000 });
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

function normalizeCandidateLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateForLog(value: string, maxLength = 140): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatDebugList(title: string, values: string[]): void {
  debugLog(title);
  if (values.length === 0) {
    debugLog("- (none)");
    return;
  }

  for (const value of values) {
    debugLog(`- ${value}`);
  }
}

function summarizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return normalizeCandidateLabel(error.message);
  }

  return normalizeCandidateLabel(String(error));
}

function isActionabilityError(error: unknown): boolean {
  const message = summarizeErrorMessage(error).toLowerCase();
  return (
    message.includes("element is not visible") ||
    message.includes("element is outside of the viewport") ||
    message.includes("element is not attached") ||
    message.includes("element is not stable") ||
    message.includes("intercepts pointer events") ||
    message.includes("another element would receive the click") ||
    message.includes("not receiving pointer events") ||
    message.includes("timeout")
  );
}

function getSelectAllShortcut(): string {
  return process.platform === "darwin" ? "Meta+A" : "Control+A";
}

function shortenUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return rawUrl;
  }
}

async function listVisibleCandidateControls(page: Page): Promise<string[]> {
  const candidates = await page
    .locator('button, a, [role="button"], [role="link"], div')
    .evaluateAll((elements) => {
      const isVisible = (element: Element): boolean => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const normalizeWhitespace = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
      const compactClassName = (value: string): string => value.split(/\s+/).filter(Boolean).slice(0, 4).join(".");
      const keywordPattern = /(settings|athlete settings|athlete account|account settings|export data|\baccount\b|\bexport\b)/i;

      const labels = new Set<string>();
      for (const element of elements) {
        if (!isVisible(element)) {
          continue;
        }

        const tagName = element.tagName.toLowerCase();
        const role = element.getAttribute("role") ?? "";
        const ariaLabel = normalizeWhitespace(element.getAttribute("aria-label"));
        const title = normalizeWhitespace(element.getAttribute("title"));
        const text = normalizeWhitespace(element.textContent);
        const dataTooltip = normalizeWhitespace(element.getAttribute("data-tooltip"));
        const onclick = normalizeWhitespace(element.getAttribute("onclick"));
        const className = normalizeWhitespace(element.getAttribute("class"));
        const computedCursor = window.getComputedStyle(element).cursor;
        const accessibleLabel = normalizeWhitespace(ariaLabel || title || dataTooltip || text);
        const keywordMatch = keywordPattern.test(`${accessibleLabel} ${className}`);
        const exactMoreMatch = /^(more|⋯|…)$/.test(accessibleLabel);
        const isClickableDiv =
          tagName === "div" &&
          (
            Boolean(dataTooltip) ||
            Boolean(onclick) ||
            computedCursor === "pointer" ||
            keywordPattern.test(className)
          );

        if (tagName === "div" && !isClickableDiv) {
          continue;
        }

        if (
          !exactMoreMatch &&
          !keywordMatch &&
          !keywordPattern.test(dataTooltip) &&
          !keywordPattern.test(onclick) &&
          !/openathletesettingsbutton/i.test(className)
        ) {
          continue;
        }

        if (
          accessibleLabel.length > 80 ||
          /^\d+\s+more\b/i.test(accessibleLabel)
        ) {
          continue;
        }

        const descriptionParts = [role || tagName];
        if (className) {
          descriptionParts.push(`class=.${compactClassName(className)}`);
        }
        if (dataTooltip) {
          descriptionParts.push(`tooltip="${dataTooltip}"`);
        }
        if (accessibleLabel) {
          descriptionParts.push(`label="${accessibleLabel}"`);
        }
        if (onclick) {
          descriptionParts.push("onclick");
        }
        if (computedCursor === "pointer") {
          descriptionParts.push("cursor:pointer");
        }

        labels.add(descriptionParts.join(" "));
        if (labels.size >= 12) {
          break;
        }
      }

      return [...labels];
    })
    .catch(() => []);

  return [...new Set(candidates.map(normalizeCandidateLabel))].slice(0, 12);
}

function logVisibleCandidateControls(candidates: string[]): void {
  debugLog("Visible candidate controls:");
  if (candidates.length === 0) {
    debugLog("- (none detected)");
    return;
  }

  for (const candidate of candidates) {
    debugLog(`- ${candidate}`);
  }
}

function athleteAccountSettingsHeadingLocator(page: Page): Locator {
  return page.locator("h2").filter({ hasText: /^Athlete Account Settings$/i }).first();
}

function athleteSettingsModalLocator(page: Page): Locator {
  return page.locator("div.tabbedSettings.userSettings.overlayBox.modal").first();
}

function settingsTriggerRoleLocators(page: Page, name: RegExp): Locator[] {
  return [
    page.getByRole("button", { name }).first(),
    page.getByRole("link", { name }).first()
  ];
}

function settingsTriggerAttributeLocators(page: Page, label: string): Locator[] {
  return [
    page.locator(`button[aria-label="${label}" i], a[aria-label="${label}" i], [role="button"][aria-label="${label}" i]`).first(),
    page.locator(`button[title="${label}" i], a[title="${label}" i], [role="button"][title="${label}" i]`).first(),
    page.locator(`button[data-tooltip="${label}" i], a[data-tooltip="${label}" i], [role="button"][data-tooltip="${label}" i]`).first()
  ];
}

function primaryAthleteSettingsTriggerLocators(page: Page): Locator[] {
  return [
    page.locator('div.groupAndAthleteSelector [data-tooltip*="Athlete Settings"]').first(),
    page.locator("div.groupAndAthleteSelector div.openAthleteSettingsButton").first()
  ];
}

function broaderAthleteSettingsTriggerLocators(page: Page): Locator[] {
  return [
    page.locator('[data-tooltip*="Athlete Settings"]').first(),
    page.locator(".openAthleteSettingsButton").first(),
    ...settingsTriggerRoleLocators(page, /^Athlete Settings$/i),
    ...settingsTriggerRoleLocators(page, /^Athlete Account Settings$/i),
    ...settingsTriggerAttributeLocators(page, "Athlete Settings"),
    ...settingsTriggerAttributeLocators(page, "Athlete Account Settings"),
    ...settingsTriggerRoleLocators(page, /^Account Settings$/i),
    ...settingsTriggerAttributeLocators(page, "Account Settings")
  ];
}

async function waitForAthleteShellOrSettingsTrigger(page: Page): Promise<boolean> {
  const timeout = 4000;
  const waiters = [
    page.locator("div.groupAndAthleteSelector").first(),
    ...primaryAthleteSettingsTriggerLocators(page),
    ...broaderAthleteSettingsTriggerLocators(page)
  ].map((locator) =>
    locator
      .waitFor({ state: "visible", timeout })
      .then(() => true)
  );

  try {
    await Promise.any(waiters);
    return true;
  } catch {
    return false;
  }
}

function exportInstructionsLocator(scope: Page | Locator): Locator {
  return scope.getByText(/use the fields below to download your workout or metrics data to your computer\./i);
}

async function exportDataSectionReady(page: Page): Promise<boolean> {
  const settingsModal = athleteSettingsModalLocator(page);
  return anyVisible([
    page.getByRole("heading", { name: /^export data$/i }),
    exportInstructionsLocator(settingsModal),
    exportInstructionsLocator(page)
  ], 700);
}

async function waitForSettingsModal(page: Page): Promise<boolean> {
  if (!(await isVisible(athleteAccountSettingsHeadingLocator(page), 4000))) {
    return false;
  }

  return isVisible(athleteSettingsModalLocator(page), 4000);
}

async function locateSettingsScope(page: Page): Promise<Locator> {
  const dialog = athleteSettingsModalLocator(page);

  if (await isVisible(dialog, 700)) {
    return dialog.first();
  }

  return page.locator("body");
}

async function locateWorkoutSummarySection(page: Page): Promise<WorkoutSummarySectionResolution> {
  const markerAttribute = "data-tp-workout-summary-container";
  const markerValue = `selected-${Date.now()}`;
  await page
    .locator(`[${markerAttribute}]`)
    .evaluateAll((elements, attributeName) => {
      for (const element of elements) {
        element.removeAttribute(attributeName as string);
      }
    }, markerAttribute)
    .catch(() => {});

  const resolution = await page.evaluate(
    ({ markerAttributeName, markerAttributeValue }) => {
      const normalize = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
      const isVisible = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const exactTextMatches = (root: ParentNode, text: string): HTMLElement[] =>
        Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6, [role='heading'], div, span, p, strong, label"))
          .filter(isVisible)
          .filter((element) => normalize(element.textContent) === text);
      const visibleDateInputs = (root: ParentNode, name: string): HTMLElement[] =>
        Array.from(root.querySelectorAll(`input[name="${name}"]`)).filter(isVisible);
      const visibleExportButtons = (root: ParentNode): HTMLElement[] =>
        Array.from(root.querySelectorAll("button, a, [role='button']"))
          .filter(isVisible)
          .filter((element) => normalize(element.textContent || element.getAttribute("aria-label")) === "Export");
      const describeElement = (element: HTMLElement): string => {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : "";
        const classes = normalize(element.className)
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 4)
          .map((className) => `.${className}`)
          .join("");
        return `${tagName}${id}${classes}`;
      };
      const collectHeadingTexts = (root: ParentNode): string[] =>
        [...new Set(exactTextMatches(root, "Workout Summary").map((element) => normalize(element.textContent)).filter(Boolean))];
      const getDepth = (element: HTMLElement): number => {
        let depth = 0;
        let current: HTMLElement | null = element;
        while (current) {
          depth += 1;
          current = current.parentElement;
        }

        return depth;
      };

      const headingElements = exactTextMatches(document, "Workout Summary");
      const seen = new Set<HTMLElement>();
      const candidates: Array<{
        element: HTMLElement;
        summary: string;
        containsWorkoutFilesHeading: boolean;
        exportButtonCount: number;
        area: number;
        descendants: number;
        depth: number;
      }> = [];

      for (const heading of headingElements) {
        let current = heading.parentElement;
        while (current && current !== document.body) {
          if (!isVisible(current)) {
            current = current.parentElement;
            continue;
          }

          const tagName = current.tagName.toLowerCase();
          if (!["div", "section", "form", "article", "fieldset", "li"].includes(tagName)) {
            current = current.parentElement;
            continue;
          }

          if (seen.has(current)) {
            current = current.parentElement;
            continue;
          }
          seen.add(current);

          const startDateInputs = visibleDateInputs(current, "startDate");
          const endDateInputs = visibleDateInputs(current, "endDate");
          const exportButtons = visibleExportButtons(current);
          const containsWorkoutSummaryHeading = collectHeadingTexts(current).includes("Workout Summary");
          const containsWorkoutFilesHeading = exactTextMatches(current, "Workout Files").length > 0;
          if (!containsWorkoutSummaryHeading || startDateInputs.length === 0 || endDateInputs.length === 0 || exportButtons.length === 0) {
            current = current.parentElement;
            continue;
          }

          const rect = current.getBoundingClientRect();
          const area = Math.max(1, Math.round(rect.width * rect.height));
          const descendants = current.querySelectorAll("*").length;
          const summary = [
            describeElement(current),
            `startDate=${startDateInputs.length}`,
            `endDate=${endDateInputs.length}`,
            `export=${exportButtons.length}`,
            `containsWorkoutFiles=${containsWorkoutFilesHeading ? "yes" : "no"}`,
            `area=${area}`,
            `descendants=${descendants}`
          ].join(" ");
          candidates.push({
            element: current,
            summary,
            containsWorkoutFilesHeading,
            exportButtonCount: exportButtons.length,
            area,
            descendants,
            depth: getDepth(current)
          });
          current = current.parentElement;
        }
      }

      candidates.sort((left, right) => {
        if (left.containsWorkoutFilesHeading !== right.containsWorkoutFilesHeading) {
          return Number(left.containsWorkoutFilesHeading) - Number(right.containsWorkoutFilesHeading);
        }
        if ((left.exportButtonCount === 1) !== (right.exportButtonCount === 1)) {
          return Number(right.exportButtonCount === 1) - Number(left.exportButtonCount === 1);
        }
        if (left.area !== right.area) {
          return left.area - right.area;
        }
        if (left.descendants !== right.descendants) {
          return left.descendants - right.descendants;
        }

        return right.depth - left.depth;
      });

      const selected = candidates[0];
      if (selected) {
        selected.element.setAttribute(markerAttributeName, markerAttributeValue);
      }

      return {
        candidates: candidates.slice(0, 6).map((candidate) => candidate.summary),
        selectedCandidate: selected?.summary
      };
    },
    { markerAttributeName: markerAttribute, markerAttributeValue: markerValue }
  );

  const section = resolution.selectedCandidate
    ? page.locator(`[${markerAttribute}="${markerValue}"]`).first()
    : null;

  return {
    section,
    candidates: resolution.candidates,
    selectedCandidate: resolution.selectedCandidate
  };
}

async function commitWorkoutSummaryDateInput(input: Locator, value: string): Promise<boolean> {
  const selectAllShortcut = getSelectAllShortcut();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await input.scrollIntoViewIfNeeded().catch(() => {});
      await input.click({ timeout: 2000 });
      await input.press(selectAllShortcut).catch(() => {});
      await input.press("Delete").catch(() => {});
      await input.fill("").catch(() => {});
      await input.type(value, { delay: 35 }).catch(async () => {
        await input.fill(value);
      });
      await input
        .evaluate((element) => {
          const target = element as HTMLInputElement;
          target.dispatchEvent(new Event("input", { bubbles: true }));
          target.dispatchEvent(new Event("change", { bubbles: true }));
          target.blur();
        })
        .catch(() => {});
      await input.press("Tab").catch(() => {});

      if ((await input.inputValue().catch(() => "")) === value) {
        return true;
      }
    } catch {
      // Retry once with the same sequence; TrainingPeaks date inputs can be finicky.
    }
  }

  try {
    await input.fill(value);
    await input.press("Tab").catch(() => {});
    return (await input.inputValue().catch(() => "")) === value;
  } catch {
    return false;
  }
}

async function inspectAndMaybeSelectWorkoutSummaryFormat(section: Locator): Promise<WorkoutSummaryFormatInspection> {
  const markerAttribute = "data-tp-workout-summary-format-target";
  const markerValue = `format-${Date.now()}`;
  await section
    .locator(`[${markerAttribute}]`)
    .evaluateAll((elements, attributeName) => {
      for (const element of elements) {
        element.removeAttribute(attributeName as string);
      }
    }, markerAttribute)
    .catch(() => {});

  const initialInspection = await section.evaluate(
    (root, { markerAttributeName, markerAttributeValue }) => {
      const normalize = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
      const truncate = (value: string, maxLength = 160): string =>
        value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
      const isVisible = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const labelForControl = (control: HTMLElement): string => {
        if (control instanceof HTMLInputElement && control.labels?.length) {
          return normalize(control.labels[0]?.textContent);
        }

        const closestLabel = control.closest("label");
        if (closestLabel) {
          return normalize(closestLabel.textContent);
        }

        const controlId = control.getAttribute("id");
        if (controlId) {
          const explicitLabel = root.querySelector(`label[for="${controlId}"]`);
          if (explicitLabel) {
            return normalize(explicitLabel.textContent);
          }
        }

        return "";
      };
      const describeControl = (control: HTMLElement): string => {
        const tagName = control.tagName.toLowerCase();
        const type = control.getAttribute("type") ?? "";
        const name = control.getAttribute("name") ?? "";
        const label = labelForControl(control);
        const disabled = control.hasAttribute("disabled") || control.getAttribute("aria-disabled") === "true";
        let state = "";

        if (control instanceof HTMLInputElement) {
          state = control.type === "radio" || control.type === "checkbox"
            ? `checked=${control.checked ? "yes" : "no"}`
            : `value="${normalize(control.value)}"`;
        } else if (control instanceof HTMLSelectElement) {
          state = `value="${normalize(control.value)}"`;
        }

        return truncate(
          [tagName, type && `type=${type}`, name && `name=${name}`, label && `label="${label}"`, state, disabled && "disabled"]
            .filter(Boolean)
            .join(" "),
          160
        );
      };
      const controls = Array.from(root.querySelectorAll('input[type="radio"], input[type="checkbox"], select'))
        .filter(isVisible)
        .map((control) => control as HTMLElement);
      const controlSummaries = controls.slice(0, 10).map(describeControl);
      const formatControls = controls.filter((control) => {
        const text = [
          normalize(control.getAttribute("name")),
          normalize(control.getAttribute("value")),
          labelForControl(control)
        ].join(" ");
        if (control instanceof HTMLSelectElement) {
          const optionText = Array.from(control.options)
            .map((option) => `${normalize(option.textContent)} ${normalize(option.value)}`)
            .join(" ");
          return /\b(format|csv|zip)\b/i.test(`${text} ${optionText}`);
        }

        return /\b(format|csv|zip)\b/i.test(text);
      });

      const selectedFormatControl = formatControls.find((control) => {
        if (control instanceof HTMLInputElement) {
          return control.checked;
        }
        if (control instanceof HTMLSelectElement) {
          return Boolean(normalize(control.value));
        }

        return false;
      });
      const selectedFormatValue = selectedFormatControl
        ? normalize(
            selectedFormatControl instanceof HTMLSelectElement
              ? selectedFormatControl.selectedOptions[0]?.textContent || selectedFormatControl.value
              : labelForControl(selectedFormatControl) || selectedFormatControl.getAttribute("value")
          )
        : undefined;

      if (!selectedFormatControl) {
        const csvSelect = formatControls.find(
          (control) =>
            control instanceof HTMLSelectElement &&
            Array.from(control.options).some(
              (option) => /\bcsv\b/i.test(`${normalize(option.textContent)} ${normalize(option.value)}`)
            )
        ) as HTMLSelectElement | undefined;
        if (csvSelect && !normalize(csvSelect.value)) {
          csvSelect.setAttribute(markerAttributeName, markerAttributeValue);
          const csvOption = Array.from(csvSelect.options).find(
            (option) => /\bcsv\b/i.test(`${normalize(option.textContent)} ${normalize(option.value)}`)
          );
          return {
            controls: controlSummaries,
            action: { type: "select", csvValue: csvOption?.value ?? "" }
          };
        }

        const csvInput = formatControls.find(
          (control) =>
            control instanceof HTMLInputElement &&
            /\bcsv\b/i.test(
              `${normalize(control.getAttribute("value"))} ${labelForControl(control)} ${normalize(control.getAttribute("name"))}`
            )
        ) as HTMLInputElement | undefined;
        if (csvInput && !csvInput.checked) {
          csvInput.setAttribute(markerAttributeName, markerAttributeValue);
          return {
            controls: controlSummaries,
            action: { type: "click" }
          };
        }
      }

      return {
        controls: controlSummaries,
        selectedFormatValue
      };
    },
    { markerAttributeName: markerAttribute, markerAttributeValue: markerValue }
  );

  let appliedSelection: string | undefined;
  let selectionError: string | undefined;
  const targetLocator = section.locator(`[${markerAttribute}="${markerValue}"]`).first();

  if (initialInspection.action?.type === "select") {
    try {
      await targetLocator.selectOption(initialInspection.action.csvValue);
      appliedSelection = "selected CSV in Workout Summary format control";
    } catch (error) {
      selectionError = `could not select CSV format: ${summarizeErrorMessage(error)}`;
    }
  } else if (initialInspection.action?.type === "click") {
    try {
      await targetLocator.evaluate((element) => {
        if (element instanceof HTMLInputElement || element instanceof HTMLElement) {
          element.click();
        }
      });
      appliedSelection = "selected CSV in Workout Summary format control";
    } catch (error) {
      selectionError = `could not select CSV format: ${summarizeErrorMessage(error)}`;
    }
  }

  const finalInspection = await section.evaluate((root) => {
    const normalize = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
    const isVisible = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const labelForControl = (control: HTMLElement): string => {
      if (control instanceof HTMLInputElement && control.labels?.length) {
        return normalize(control.labels[0]?.textContent);
      }

      const closestLabel = control.closest("label");
      if (closestLabel) {
        return normalize(closestLabel.textContent);
      }

      const controlId = control.getAttribute("id");
      if (controlId) {
        const explicitLabel = root.querySelector(`label[for="${controlId}"]`);
        if (explicitLabel) {
          return normalize(explicitLabel.textContent);
        }
      }

      return "";
    };
    const controls = Array.from(root.querySelectorAll('input[type="radio"], input[type="checkbox"], select'))
      .filter(isVisible)
      .slice(0, 10)
      .map((control) => {
        const element = control as HTMLElement;
        const tagName = element.tagName.toLowerCase();
        const type = element.getAttribute("type") ?? "";
        const name = element.getAttribute("name") ?? "";
        const label = labelForControl(element);
        const state =
          control instanceof HTMLInputElement
            ? control.type === "radio" || control.type === "checkbox"
              ? `checked=${control.checked ? "yes" : "no"}`
              : `value="${normalize(control.value)}"`
            : `value="${normalize((control as HTMLSelectElement).value)}"`;
        return [tagName, type && `type=${type}`, name && `name=${name}`, label && `label="${label}"`, state]
          .filter(Boolean)
          .join(" ");
      });
    const selectedFormatControl = Array.from(root.querySelectorAll('input[type="radio"], input[type="checkbox"], select'))
      .filter(isVisible)
      .find((control) => {
        if (control instanceof HTMLInputElement) {
          return control.checked && /\b(format|csv|zip)\b/i.test(
            `${normalize(control.getAttribute("name"))} ${normalize(control.getAttribute("value"))} ${labelForControl(control)}`
          );
        }
        if (control instanceof HTMLSelectElement) {
          const selectedText = normalize(control.selectedOptions[0]?.textContent);
          return Boolean(control.value) && /\b(format|csv|zip)\b/i.test(`${normalize(control.name)} ${selectedText} ${normalize(control.value)}`);
        }

        return false;
      });
    return {
      controls,
      selectedFormatValue: selectedFormatControl
        ? normalize(
            selectedFormatControl instanceof HTMLSelectElement
              ? selectedFormatControl.selectedOptions[0]?.textContent || selectedFormatControl.value
              : labelForControl(selectedFormatControl) || selectedFormatControl.getAttribute("value")
          )
        : undefined
    };
  });

  return {
    controls: finalInspection.controls,
    selectedFormatValue: finalInspection.selectedFormatValue,
    appliedSelection,
    selectionError
  };
}

async function collectWorkoutSummaryPreClickDebug(
  section: Locator,
  selectedFormatValue?: string
): Promise<WorkoutSummaryPreClickDebug> {
  return section.evaluate((root, selectedFormat) => {
    const normalize = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
    const isVisible = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const describeElement = (element: HTMLElement): string => {
      const tagName = element.tagName.toLowerCase();
      const id = element.id ? `#${element.id}` : "";
      const classes = normalize(element.className)
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 4)
        .map((className) => `.${className}`)
        .join("");
      return `${tagName}${id}${classes}`;
    };
    const labelForControl = (control: HTMLElement): string => {
      if (control instanceof HTMLInputElement && control.labels?.length) {
        return normalize(control.labels[0]?.textContent);
      }

      const closestLabel = control.closest("label");
      if (closestLabel) {
        return normalize(closestLabel.textContent);
      }

      const controlId = control.getAttribute("id");
      if (controlId) {
        const explicitLabel = root.querySelector(`label[for="${controlId}"]`);
        if (explicitLabel) {
          return normalize(explicitLabel.textContent);
        }
      }

      return "";
    };
    const exportButtons = Array.from(root.querySelectorAll("button, a, [role='button']"))
      .filter(isVisible)
      .filter((element) => normalize(element.textContent || element.getAttribute("aria-label")) === "Export")
      .map((element) => element as HTMLElement);
    const selectedButton =
      exportButtons.find(
        (button) =>
          !(button instanceof HTMLButtonElement && button.disabled) &&
          button.getAttribute("aria-disabled") !== "true" &&
          !/\bdisabled\b/i.test(normalize(button.className))
      ) ?? exportButtons[0];
    const startInput = root.querySelector('input[name="startDate"]') as HTMLInputElement | null;
    const endInput = root.querySelector('input[name="endDate"]') as HTMLInputElement | null;
    const controls = Array.from(root.querySelectorAll('input[type="radio"], input[type="checkbox"], select'))
      .filter(isVisible)
      .slice(0, 10)
      .map((control) => {
        const element = control as HTMLElement;
        const tagName = element.tagName.toLowerCase();
        const type = element.getAttribute("type") ?? "";
        const name = element.getAttribute("name") ?? "";
        const label = labelForControl(element);
        const state =
          control instanceof HTMLInputElement
            ? `checked=${control.checked ? "yes" : "no"}`
            : `value="${normalize((control as HTMLSelectElement).value)}"`;
        return [tagName, type && `type=${type}`, name && `name=${name}`, label && `label="${label}"`, state]
          .filter(Boolean)
          .join(" ");
      });
    const buttonSummaries = exportButtons.map((button, index) => {
      const label = normalize(button.textContent || button.getAttribute("aria-label")) || "Export";
      const disabled =
        (button instanceof HTMLButtonElement && button.disabled) ||
        button.getAttribute("aria-disabled") === "true" ||
        /\bdisabled\b/i.test(normalize(button.className));
      return `${index === exportButtons.indexOf(selectedButton) ? "*" : ""}${describeElement(button)} text="${label}" disabled=${disabled ? "yes" : "no"}`;
    });
    const closestForm = selectedButton?.closest("form");

    return {
      containerSummary: [
        describeElement(root as HTMLElement),
        `visibleExportButtons=${exportButtons.length}`,
        `visibleControls=${controls.length}`,
        `text="${normalize((root as HTMLElement).innerText).slice(0, 120)}"`
      ].join(" "),
      startDateCount: Array.from(root.querySelectorAll('input[name="startDate"]')).filter(isVisible).length,
      endDateCount: Array.from(root.querySelectorAll('input[name="endDate"]')).filter(isVisible).length,
      exportButtons: buttonSummaries,
      selectedButtonText: selectedButton ? normalize(selectedButton.textContent || selectedButton.getAttribute("aria-label")) || "Export" : undefined,
      selectedButtonDisabled: selectedButton
        ? (selectedButton instanceof HTMLButtonElement && selectedButton.disabled) ||
          selectedButton.getAttribute("aria-disabled") === "true" ||
          /\bdisabled\b/i.test(normalize(selectedButton.className))
        : undefined,
      selectedButtonAriaDisabled: selectedButton?.getAttribute("aria-disabled") ?? undefined,
      selectedButtonClass: normalize(selectedButton?.className) || undefined,
      selectedButtonFormInfo: closestForm
        ? [
            describeElement(closestForm),
            closestForm.getAttribute("action") && `action="${normalize(closestForm.getAttribute("action"))}"`,
            closestForm.getAttribute("method") && `method="${normalize(closestForm.getAttribute("method"))}"`
          ]
            .filter(Boolean)
            .join(" ")
        : "(no ancestor form)",
      controls,
      selectedFormatValue: selectedFormat ?? undefined,
      startDateValue: normalize(startInput?.value),
      endDateValue: normalize(endInput?.value)
    };
  }, selectedFormatValue);
}

async function collectVisibleExportFeedback(page: Page, section: Locator): Promise<string[]> {
  const sectionMessages = await section
    .locator('.error, .errors, .validation, .validation-error, .error-message, [role="alert"], .toast, .toast-message')
    .evaluateAll((elements) => {
      const normalize = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
      const isVisible = (element: Element): boolean => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      return elements
        .filter(isVisible)
        .map((element) => normalize(element.textContent))
        .filter(Boolean)
        .slice(0, 6);
    })
    .catch(() => []);
  const pageMessages = await page
    .locator('[role="alert"], .toast, .toast-message, .notification, .alert, .validation-error, .error-message')
    .evaluateAll((elements) => {
      const normalize = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
      const isVisible = (element: Element): boolean => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      return elements
        .filter(isVisible)
        .map((element) => normalize(element.textContent))
        .filter(Boolean)
        .slice(0, 8);
    })
    .catch(() => []);

  return [...new Set([...sectionMessages, ...pageMessages].filter(Boolean).map((value) => truncateForLog(value, 180)))].slice(0, 8);
}

async function tryOpenAthleteAccountSettings(page: Page): Promise<AutomationAttemptResult> {
  if (await waitForSettingsModal(page)) {
    return { ok: true };
  }

  await waitForAthleteShellOrSettingsTrigger(page);

  for (const trigger of primaryAthleteSettingsTriggerLocators(page)) {
    if (!(await isVisible(trigger, 700))) {
      continue;
    }

    try {
      await trigger.click({ timeout: 2000 });
    } catch {
      continue;
    }

    if (await waitForSettingsModal(page)) {
      return { ok: true };
    }
  }

  console.log("Auto-export: settings control not found in primary location, trying broader search");

  for (const trigger of broaderAthleteSettingsTriggerLocators(page)) {
    if (!(await isVisible(trigger, 500))) {
      continue;
    }

    try {
      await trigger.click({ timeout: 2000 });
    } catch {
      continue;
    }

    if (await waitForSettingsModal(page)) {
      return { ok: true };
    }
  }

  return {
    ok: false,
    reason: "could not find Athlete Account Settings control.",
    visibleCandidates: await listVisibleCandidateControls(page)
  };
}

async function tryOpenExportData(page: Page): Promise<AutomationAttemptResult> {
  if (await exportDataSectionReady(page)) {
    return { ok: true };
  }

  const settingsVisible = await waitForSettingsModal(page);
  if (!settingsVisible) {
    const openedSettings = await tryOpenAthleteAccountSettings(page);
    if (!openedSettings.ok) {
      return openedSettings;
    }

    if (!(await waitForSettingsModal(page))) {
      return { ok: false, reason: 'clicked a likely settings control, but "Athlete Account Settings" did not appear.' };
    }
  }

  if (await exportDataSectionReady(page)) {
    return { ok: true };
  }

  const settingsScope = await locateSettingsScope(page);
  const openedExport = await clickFirstVisible([
    settingsScope.locator("li").filter({ hasText: /^export data$/i }),
    settingsScope.getByRole("tab", { name: /^export data$/i }),
    settingsScope.getByRole("link", { name: /^export data$/i }),
    settingsScope.getByRole("button", { name: /^export data$/i }),
    settingsScope.getByText(/^export data$/i)
  ], 700);

  if (!openedExport) {
    return { ok: false, reason: 'could not find the "Export Data" item inside Athlete Account Settings.' };
  }

  await page.waitForTimeout(500);

  if (!(await anyVisible([
    exportInstructionsLocator(settingsScope),
    exportInstructionsLocator(page)
  ], 1500))) {
    return { ok: false, reason: 'the "Export Data" section did not become ready after opening it.' };
  }

  return { ok: true };
}

async function tryFillWorkoutSummaryDateRange(
  page: Page,
  fromIso: string,
  toIso: string
): Promise<AutomationAttemptResult> {
  if (!(await exportDataSectionReady(page))) {
    return { ok: false, reason: 'the "Export Data" section was not ready for date entry.' };
  }

  const from = formatForTrainingPeaksDateInput(fromIso);
  const to = formatForTrainingPeaksDateInput(toIso);
  const sectionResolution = await locateWorkoutSummarySection(page);
  if (sectionResolution.candidates.length > 0) {
    formatDebugList("Auto-export debug: Workout Summary locator candidates", sectionResolution.candidates);
  }
  if (!sectionResolution.section) {
    return { ok: false, reason: 'could not find the "Workout Summary" export subsection.' };
  }

  if (sectionResolution.selectedCandidate) {
    debugLog(`Auto-export debug: selected Workout Summary container="${sectionResolution.selectedCandidate}"`);
  }

  const startInput = sectionResolution.section.locator('input[name="startDate"]').first();
  const endInput = sectionResolution.section.locator('input[name="endDate"]').first();

  if (!(await commitWorkoutSummaryDateInput(startInput, from))) {
    return { ok: false, reason: 'could not verify the "Workout Summary" From date input.' };
  }

  if (!(await commitWorkoutSummaryDateInput(endInput, to))) {
    return { ok: false, reason: 'could not verify the "Workout Summary" To date input.' };
  }

  return { ok: true };
}

async function tryClickWorkoutSummaryExport(
  page: Page,
  exportDir: string,
  studentId: string,
  from: string,
  to: string
): Promise<WorkoutSummaryClickAttemptResult> {
  const sectionResolution = await locateWorkoutSummarySection(page);
  if (sectionResolution.candidates.length > 0) {
    formatDebugList("Auto-export debug: Workout Summary locator candidates", sectionResolution.candidates);
  }
  const section = sectionResolution.section;
  if (!section) {
    return { ok: false, reason: 'could not find the "Workout Summary" export subsection.' };
  }

  const formatInspection = await inspectAndMaybeSelectWorkoutSummaryFormat(section);
  if (formatInspection.appliedSelection) {
    debugLog(`Auto-export debug: ${formatInspection.appliedSelection}`);
  }
  if (formatInspection.selectionError) {
    debugLog(`Auto-export debug: ${formatInspection.selectionError}`);
  }

  const preClickDebug = await collectWorkoutSummaryPreClickDebug(section, formatInspection.selectedFormatValue);
  debugLog(`Auto-export debug: Workout Summary container="${truncateForLog(preClickDebug.containerSummary, 220)}"`);
  debugLog(
    `Auto-export debug: Workout Summary inputs startDate=${preClickDebug.startDateCount} endDate=${preClickDebug.endDateCount}`
  );
  formatDebugList("Auto-export debug: Workout Summary Export buttons", preClickDebug.exportButtons);
  formatDebugList("Auto-export debug: Workout Summary controls", preClickDebug.controls);
  if (preClickDebug.selectedFormatValue) {
    debugLog(`Auto-export debug: Workout Summary selected format="${preClickDebug.selectedFormatValue}"`);
  } else {
    debugLog("Auto-export debug: Workout Summary selected format=(none detected)");
  }
  if (preClickDebug.selectedButtonText) {
    debugLog(`Auto-export debug: selected button text="${preClickDebug.selectedButtonText}"`);
    debugLog(
      `Auto-export debug: selected button disabled=${preClickDebug.selectedButtonDisabled ? "yes" : "no"} aria-disabled="${preClickDebug.selectedButtonAriaDisabled ?? ""}" class="${preClickDebug.selectedButtonClass ?? ""}"`
    );
    debugLog(`Auto-export debug: selected button closest form=${preClickDebug.selectedButtonFormInfo ?? "(unknown)"}`);
  }
  debugLog(
    `Auto-export debug: Workout Summary startDate="${preClickDebug.startDateValue}" endDate="${preClickDebug.endDateValue}"`
  );

  const buttonLocators = [
    section.getByRole("button", { name: /^export$/i }).filter({ hasNot: section.getByText(/^Workout Files$/i) }),
    section.getByRole("link", { name: /^export$/i }),
    section.locator("button").filter({ hasText: /^export$/i }),
    section.locator('[role="button"]').filter({ hasText: /^export$/i })
  ];

  let button: Locator | null = null;
  for (const candidate of buttonLocators) {
    if (await isVisible(candidate, 700)) {
      button = candidate.first();
      break;
    }
  }

  if (!button) {
    return { ok: false, reason: 'could not find the "Export" button inside "Workout Summary".' };
  }

  if (preClickDebug.selectedButtonDisabled) {
    return {
      ok: false,
      reason: `the "Workout Summary" Export button is disabled (aria-disabled="${preClickDebug.selectedButtonAriaDisabled ?? ""}", class="${preClickDebug.selectedButtonClass ?? ""}").`
    };
  }

  const consoleErrors: string[] = [];
  const networkEvents: string[] = [];
  let popupOpened = false;
  const context = page.context();
  const pushLimited = (bucket: string[], value: string, limit: number): void => {
    if (!value || bucket.includes(value) || bucket.length >= limit) {
      return;
    }
    bucket.push(value);
  };
  const onConsole = (message: { type(): string; text(): string }): void => {
    if (message.type() === "error") {
      pushLimited(consoleErrors, truncateForLog(normalizeCandidateLabel(message.text()), 220), 8);
    }
  };
  const onPageError = (error: Error): void => {
    pushLimited(consoleErrors, truncateForLog(normalizeCandidateLabel(error.message), 220), 8);
  };
  const onRequest = (request: { method(): string; url(): string }): void => {
    const shortUrl = shortenUrl(request.url());
    if (/\b(export|download|csv|zip|workout)\b/i.test(shortUrl)) {
      pushLimited(networkEvents, `request ${request.method()} ${shortUrl}`, 10);
    }
  };
  const onResponse = async (response: {
    status(): number;
    url(): string;
    allHeaders(): Promise<Record<string, string>>;
  }): Promise<void> => {
    const shortUrl = shortenUrl(response.url());
    const headers = await response.allHeaders().catch(() => ({}));
    const contentDisposition = headers["content-disposition"] ?? "";
    const contentType = headers["content-type"] ?? "";
    if (/\b(export|download|csv|zip|workout)\b/i.test(`${shortUrl} ${contentDisposition} ${contentType}`)) {
      const detailParts = [`response ${response.status()} ${shortUrl}`];
      if (contentDisposition) {
        detailParts.push(`content-disposition="${truncateForLog(contentDisposition, 80)}"`);
      }
      if (contentType) {
        detailParts.push(`content-type="${truncateForLog(contentType, 60)}"`);
      }
      pushLimited(networkEvents, detailParts.join(" "), 10);
    }
  };
  const onContextPage = (): void => {
    popupOpened = true;
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("request", onRequest);
  page.on("response", onResponse);
  context.on("page", onContextPage);

  let clickMode: "normal" | "force" = "normal";
  let clickError: string | undefined;
  const popupPromise = page.waitForEvent("popup", { timeout: 2000 }).then(() => true).catch(() => false);
  const exportApiResponsePromise = page
    .waitForResponse(
      (response) => response.url().includes("/fitness/v1/export/") && response.url().includes("/workouts/"),
      { timeout: 15_000 }
    )
    .catch(() => null);

  try {
    try {
      await button.click({ timeout: 2500 });
    } catch (error) {
      if (!isActionabilityError(error)) {
        throw error;
      }

      clickMode = "force";
      await button.click({ timeout: 2500, force: true });
    }

    await page.waitForTimeout(2000);
    popupOpened = popupOpened || (await popupPromise);
  } catch (error) {
    clickError = summarizeErrorMessage(error);
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("request", onRequest);
    page.off("response", onResponse);
    context.off("page", onContextPage);
  }

  const matchedExportApiResponse = await exportApiResponsePromise;
  const apiCapture = matchedExportApiResponse
    ? await captureAndMaybeSaveWorkoutSummaryExportResponse({
        context,
        response: matchedExportApiResponse,
        exportDir,
        studentId,
        from,
        to
      })
    : {
        responseMatched: false,
        topLevelKeys: [],
        downloadUrlFound: false,
        directBodyFound: false,
        asyncJobDetected: false,
        asyncPollAttempted: false,
        fallbackReason: "did not observe the Workout Summary export API response after clicking Export."
      } satisfies ExportApiCaptureResult;

  const validationMessagesAfterClick = await collectVisibleExportFeedback(page, section);
  const clickDebug: WorkoutSummaryClickDebug = {
    ...preClickDebug,
    validationMessagesAfterClick,
    consoleErrors,
    networkEvents,
    popupOpened,
    clickMode,
    clickError
  };

  if (clickError) {
    return {
      ok: false,
      reason: clickError,
      clickDebug,
      apiCapture
    };
  }

  return {
    ok: true,
    clickDebug,
    apiCapture
  };
}

function logManualFallbackInstructions(): void {
  console.log("Manual fallback:");
  console.log("1. Open Athlete Account Settings -> Export Data");
  console.log("2. Set date range manually");
  console.log("3. Download Workout Summary");
  console.log("4. Wait until the ZIP file finishes downloading");
  console.log("5. Return to terminal and press Enter");
  console.log("");
  console.log("Optional:");
  console.log("Workout Files can be downloaded too, but it is not required for the current weekly report.");
}

function logWorkoutSummaryClickDebug(debug: WorkoutSummaryClickDebug): void {
  debugLog(`Auto-export debug: click mode=${debug.clickMode}`);
  if (debug.clickError) {
    debugLog(`Auto-export debug: click error="${debug.clickError}"`);
  }
  if (debug.validationMessagesAfterClick.length > 0) {
    debugLog(`Auto-export debug: visible feedback="${debug.validationMessagesAfterClick.join(" | ")}"`);
  } else {
    debugLog("Auto-export debug: visible feedback=(none)");
  }
  if (debug.consoleErrors.length > 0) {
    debugLog(`Auto-export debug: console errors="${debug.consoleErrors.join(" | ")}"`);
  } else {
    debugLog("Auto-export debug: console errors=(none)");
  }
  if (debug.networkEvents.length > 0) {
    debugLog(`Auto-export debug: network events="${debug.networkEvents.join(" | ")}"`);
  } else {
    debugLog("Auto-export debug: network events=(none)");
  }
  debugLog(`Auto-export debug: popup/new page appeared=${debug.popupOpened ? "yes" : "no"}`);
}

async function readGeneratedWorkoutSummaryDownloadLinkState(page: Page): Promise<GeneratedDownloadLinkState> {
  const markerAttribute = "data-tp-generated-download-link";
  const modalScope = athleteSettingsModalLocator(page);
  const scope = (await isVisible(modalScope, 500)) ? modalScope : page.locator("body");
  await page
    .locator(`[${markerAttribute}]`)
    .evaluateAll((elements, attributeName) => {
      for (const element of elements) {
        element.removeAttribute(attributeName as string);
      }
    }, markerAttribute)
    .catch(() => {});

  return scope.evaluate((root, markerAttributeName) => {
    const normalize = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
    const truncate = (value: string, maxLength = 180): string =>
      value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
    const isVisible = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const zipPattern = /WorkoutExport.*\.zip|Workout.*Export.*\.zip/i;
    const debugPattern = /export complete|click on the link below to download|workoutexport|workout.*export|\.zip|download/i;
    const exportCompletePattern = /export complete/i;
    const downloadInstructionPattern = /click on the link below to download/i;
    const describeElement = (element: HTMLElement): string => {
      const tagName = element.tagName.toLowerCase();
      const role = normalize(element.getAttribute("role"));
      const href = normalize(element.getAttribute("href"));
      const text = normalize(
        element.textContent ||
        element.getAttribute("aria-label") ||
        element.getAttribute("title")
      );
      return truncate(
        [
          role ? `${tagName}[role="${role}"]` : tagName,
          href && `href="${href}"`,
          text && `text="${text}"`
        ]
          .filter(Boolean)
          .join(" "),
        220
      );
    };

    const allVisibleElements = [root, ...Array.from(root.querySelectorAll("*"))]
      .filter(isVisible)
      .map((element) => element as HTMLElement);
    const candidateTexts = allVisibleElements
      .map((element) => ({ element, text: normalize(element.textContent) }))
      .filter(({ text }) => Boolean(text) && debugPattern.test(text))
      .map(({ element }) => describeElement(element))
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 8);
    const interactiveElements = allVisibleElements.filter((element) => {
      const tagName = element.tagName.toLowerCase();
      const role = normalize(element.getAttribute("role"));
      return tagName === "a" || tagName === "button" || role === "link" || role === "button";
    });
    const candidateLinks = interactiveElements
      .map((element) => {
        const href = normalize(element.getAttribute("href"));
        const text = normalize(
          element.textContent ||
          element.getAttribute("aria-label") ||
          element.getAttribute("title")
        );
        return { element, searchable: `${text} ${href}`.trim() };
      })
      .filter(({ searchable }) => Boolean(searchable) && debugPattern.test(searchable))
      .map(({ element }) => describeElement(element))
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 8);

    const selectedInteractive = interactiveElements.find((element) => {
      const href = normalize(element.getAttribute("href"));
      const text = normalize(
        element.textContent ||
        element.getAttribute("aria-label") ||
        element.getAttribute("title")
      );
      return zipPattern.test(`${text} ${href}`);
    });
    const selectedFromText = allVisibleElements.find((element) => {
      const text = normalize(element.textContent);
      return Boolean(text) && zipPattern.test(text);
    });
    const selectedFromTextAncestor = selectedFromText?.closest(
      'a, button, [role="link"], [role="button"]'
    );
    const selectedElement = selectedInteractive ?? (
      selectedFromTextAncestor instanceof HTMLElement &&
      isVisible(selectedFromTextAncestor)
        ? selectedFromTextAncestor
        : undefined
    );

    if (selectedElement) {
      selectedElement.setAttribute(markerAttributeName as string, "selected");
    }

    const exportCompleteVisible = allVisibleElements.some((element) =>
      exportCompletePattern.test(normalize(element.textContent))
    );
    const downloadInstructionVisible = allVisibleElements.some((element) =>
      downloadInstructionPattern.test(normalize(element.textContent))
    );
    const linkText = normalize(
      selectedElement?.textContent ||
      selectedElement?.getAttribute("aria-label") ||
      selectedElement?.getAttribute("title")
    ) || undefined;
    const linkHref = normalize(selectedElement?.getAttribute("href")) || undefined;

    return {
      exportCompleteVisible,
      downloadInstructionVisible,
      linkText,
      linkHref,
      candidateTexts,
      candidateLinks
    };
  }, markerAttribute);
}

async function waitForGeneratedWorkoutSummaryDownloadLink(
  page: Page,
  timeoutMs = 90_000
): Promise<GeneratedDownloadLinkWaitResult> {
  const startedAt = Date.now();
  let lastSeenState: GeneratedDownloadLinkState = {
    exportCompleteVisible: false,
    downloadInstructionVisible: false
  };
  let lastProgressLogAt = 0;

  while (Date.now() - startedAt <= timeoutMs) {
    const currentState = await readGeneratedWorkoutSummaryDownloadLinkState(page);
    lastSeenState = {
      exportCompleteVisible: currentState.exportCompleteVisible,
      downloadInstructionVisible: currentState.downloadInstructionVisible,
      linkText: currentState.linkText,
      linkHref: currentState.linkHref,
      candidateTexts: currentState.candidateTexts,
      candidateLinks: currentState.candidateLinks
    };

    if (currentState.linkText || currentState.linkHref) {
      return {
        ok: true,
        ...lastSeenState
      };
    }

    const now = Date.now();
    if (now - lastProgressLogAt >= 5_000) {
      const elapsedSeconds = Math.floor((now - startedAt) / 1000);
      console.log(
        `Auto-export: waiting for Export Complete download link (${elapsedSeconds}s elapsed, exportComplete=${currentState.exportCompleteVisible ? "yes" : "no"}, instruction=${currentState.downloadInstructionVisible ? "yes" : "no"})`
      );
      lastProgressLogAt = now;
    }

    await page.waitForTimeout(500);
  }

  return {
    ok: false,
    reason: "Export Complete download link did not appear.",
    ...lastSeenState
  };
}

async function clickGeneratedWorkoutSummaryDownloadLink(page: Page): Promise<GeneratedDownloadLinkClickResult> {
  const currentState = await readGeneratedWorkoutSummaryDownloadLinkState(page);
  const visibleLink = page.locator('[data-tp-generated-download-link="selected"]').first();

  if (!(await isVisible(visibleLink, 700))) {
    return {
      ok: false,
      reason: "generated Workout Summary download link was not visible.",
      exportCompleteVisible: currentState.exportCompleteVisible,
      downloadInstructionVisible: currentState.downloadInstructionVisible,
      linkText: currentState.linkText,
      linkHref: currentState.linkHref,
      candidateTexts: currentState.candidateTexts,
      candidateLinks: currentState.candidateLinks,
      clickMode: "normal",
      clickSucceeded: false,
      popupOpened: false
    };
  }

  const context = page.context();
  let popupOpened = false;
  const onContextPage = (): void => {
    popupOpened = true;
  };
  context.on("page", onContextPage);

  let clickMode: "normal" | "force" = "normal";
  let clickError: string | undefined;
  const popupPromise = page.waitForEvent("popup", { timeout: 3000 }).then(() => true).catch(() => false);

  try {
    try {
      await visibleLink.click({ timeout: 3000 });
    } catch (error) {
      if (!isActionabilityError(error)) {
        throw error;
      }

      clickMode = "force";
      await visibleLink.click({ timeout: 3000, force: true });
    }

    await page.waitForTimeout(1500);
    popupOpened = popupOpened || (await popupPromise);
  } catch (error) {
    clickError = summarizeErrorMessage(error);
  } finally {
    context.off("page", onContextPage);
  }

  return {
    ok: !clickError,
    reason: clickError,
    exportCompleteVisible: currentState.exportCompleteVisible,
    downloadInstructionVisible: currentState.downloadInstructionVisible,
    linkText: currentState.linkText,
    linkHref: currentState.linkHref,
    candidateTexts: currentState.candidateTexts,
    candidateLinks: currentState.candidateLinks,
    clickMode,
    clickSucceeded: !clickError,
    popupOpened,
    clickError
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const students = await readStudentsConfig();
  const student = findStudentById(students, args.student);

  if (!student) {
    const knownStudents = students.map((entry) => entry.student_id).join(", ") || "(none)";
    throw new Error(`Student "${args.student}" was not found in config/students.json. Known ids: ${knownStudents}`);
  }

  const exportDir = path.join(exportsRoot, student.student_id, `${args.from}_${args.to}`);
  const downloadsDir = path.join(os.homedir(), "Downloads");
  await mkdir(exportDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });

  console.log(`Export started: student=${student.student_id} week=${args.from}..${args.to}`);

  const existingExportDirSnapshot = await inspectExportDir(exportDir);
  const existingExportAssessment = assessExportFiles(
    existingExportDirSnapshot.summaryZipFiles,
    existingExportDirSnapshot.summaryCsvFiles,
    existingExportDirSnapshot.zipFiles
  );
  if (existingExportAssessment.summaryZip || existingExportAssessment.summaryCsv) {
    if (existingExportAssessment.summaryZip) {
      console.log("Existing Workout Summary ZIP already present. Reusing export folder.");
    } else {
      console.log("Existing Workout Summary CSV already present. Reusing export folder.");
    }
    logExportAssessment(existingExportAssessment);
    return;
  }

  console.log(`Using persistent browser profile: ${profileDir}`);
  console.log(`Export folder: ${exportDir}`);
  console.log(`Opening TrainingPeaks for student: ${student.student_id}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null,
    acceptDownloads: true,
    downloadsPath: exportDir
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    await page.goto(student.trainingpeaks_athlete_url, { waitUntil: "domcontentloaded" });
    await page.bringToFront();

    console.log(`Auto-export: opening TrainingPeaks for ${student.student_id}`);
    console.log("Auto-export: verifying login/page state");

    let pageAssessment = await assessTrainingPeaksPage(page);
    if (pageAssessment.loginRequired) {
      console.log("TrainingPeaks login is required. Please sign in in the opened browser, then press Enter to continue.");
      await waitForEnter("Press Enter after the TrainingPeaks login is complete.");
      await page.goto(student.trainingpeaks_athlete_url, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.bringToFront();
      pageAssessment = await assessTrainingPeaksPage(page);
    }

    if (!pageAssessment.athletePageLikelyReachable) {
      console.log(`Auto-export fallback: ${pageAssessment.fallbackReason ?? "athlete page was not reachable automatically."}`);
    }

    let exportDataOpened = false;
    let datesAutoFilled = false;
    let automaticSummaryExportCompleted = false;

    const shouldAttemptExportData =
      !pageAssessment.loginRequired &&
      !pageAssessment.hardAccessBlocked &&
      pageAssessment.trainingPeaksContextLikely;

    if (shouldAttemptExportData) {
      console.log("Auto-export: attempting to open Athlete Account Settings -> Export Data");
      if (!pageAssessment.athletePageLikelyReachable) {
        console.log("Auto-export: page state uncertain, trying Export Data automation anyway");
      }
      const exportOpenResult = await tryOpenExportData(page);
      if (exportOpenResult.ok) {
        exportDataOpened = true;
        console.log("Auto-export: Export Data opened");
      } else {
        console.log(`Auto-export fallback: ${exportOpenResult.reason ?? 'could not open "Export Data" automatically.'}`);
        if (exportOpenResult.visibleCandidates) {
          logVisibleCandidateControls(exportOpenResult.visibleCandidates);
        }
      }
    }

    if (exportDataOpened) {
      const fillDatesResult = await tryFillWorkoutSummaryDateRange(page, args.from, args.to);
      if (fillDatesResult.ok) {
        datesAutoFilled = true;
        console.log("Auto-export: Summary date range filled");
      } else {
        console.log(`Auto-export fallback: ${fillDatesResult.reason ?? "could not fill export date fields automatically."}`);
      }
    }

    if (exportDataOpened && datesAutoFilled) {
      const [exportDirSnapshotBeforeClick, downloadsSnapshotBeforeClick] = await Promise.all([
        inspectExportDir(exportDir),
        inspectExportDir(downloadsDir)
      ]);
      console.log("Auto-export: clicking Workout Summary Export");
      const clickResult = await tryClickWorkoutSummaryExport(page, exportDir, student.student_id, args.from, args.to);
      const clickDebug = clickResult.clickDebug;
      if (clickDebug) {
        logWorkoutSummaryClickDebug(clickDebug);
      }
      if (!clickResult.ok) {
        console.log(
          `Auto-export fallback: ${clickDebug?.clickError ?? clickResult.reason ?? 'could not click "Workout Summary" export.'}`
        );
      } else {
        if (clickDebug?.selectedButtonText) {
          debugLog(`Auto-export debug: clicked button text="${clickDebug.selectedButtonText}"`);
        }
        debugLog(
          `Auto-export debug: Workout Summary startDate="${clickDebug?.startDateValue ?? ""}" endDate="${clickDebug?.endDateValue ?? ""}"`
        );
        const apiCapture = clickResult.apiCapture;
        if (apiCapture) {
          debugLog(
            `Auto-export debug: export API matched=${apiCapture.responseMatched ? "yes" : "no"} downloadUrlFound=${apiCapture.downloadUrlFound ? "yes" : "no"} directBodyFound=${apiCapture.directBodyFound ? "yes" : "no"} asyncJobDetected=${apiCapture.asyncJobDetected ? "yes" : "no"}`
          );
          if (apiCapture.fallbackReason) {
            debugLog(`Auto-export debug: export API fallback reason="${apiCapture.fallbackReason}"`);
          }
        }

        if (apiCapture?.savedArtifactPath && apiCapture.savedArtifactKind) {
          automaticSummaryExportCompleted = true;
          console.log(
            `Auto-export: Workout Summary ${apiCapture.savedArtifactKind.toUpperCase()} saved automatically: ${path.basename(apiCapture.savedArtifactPath)}`
          );
        } else {
          console.log("Auto-export: waiting for Export Complete download link");
          const exportCompleteResult = await waitForGeneratedWorkoutSummaryDownloadLink(page);
          debugLog(
            `Auto-export debug: Export Complete visible=${exportCompleteResult.exportCompleteVisible ? "yes" : "no"} instruction visible=${exportCompleteResult.downloadInstructionVisible ? "yes" : "no"}`
          );
          if (exportCompleteResult.candidateTexts && exportCompleteResult.candidateTexts.length > 0) {
            debugLog(`Auto-export debug: Export Complete candidates="${exportCompleteResult.candidateTexts.join(" | ")}"`);
          } else {
            debugLog("Auto-export debug: Export Complete candidates=(none)");
          }
          if (exportCompleteResult.candidateLinks && exportCompleteResult.candidateLinks.length > 0) {
            debugLog(`Auto-export debug: generated link candidates="${exportCompleteResult.candidateLinks.join(" | ")}"`);
          } else {
            debugLog("Auto-export debug: generated link candidates=(none)");
          }
          if (!exportCompleteResult.ok || (!exportCompleteResult.linkText && !exportCompleteResult.linkHref)) {
            console.log("Auto-export fallback: Export Complete download link did not appear.");
          } else {
            console.log("Auto-export: Export Complete link appeared");
            debugLog(`Auto-export debug: generated link text="${exportCompleteResult.linkText ?? ""}"`);
            if (exportCompleteResult.linkHref) {
              debugLog(`Auto-export debug: generated link href="${exportCompleteResult.linkHref}"`);
            }
            console.log("Auto-export: clicking generated Workout Summary download link");
            const generatedLinkClickResult = await clickGeneratedWorkoutSummaryDownloadLink(page);
            debugLog(
              `Auto-export debug: generated link click mode=${generatedLinkClickResult.clickMode} succeeded=${generatedLinkClickResult.clickSucceeded ? "yes" : "no"}`
            );
            debugLog(
              `Auto-export debug: generated link popup/new page appeared=${generatedLinkClickResult.popupOpened ? "yes" : "no"}`
            );
            if (generatedLinkClickResult.candidateLinks && generatedLinkClickResult.candidateLinks.length > 0) {
              debugLog(`Auto-export debug: clicked generated link candidates="${generatedLinkClickResult.candidateLinks.join(" | ")}"`);
            }
            if (!generatedLinkClickResult.ok) {
              console.log(
                `Auto-export fallback: ${generatedLinkClickResult.clickError ?? "could not click the generated Workout Summary download link."}`
              );
            } else {
              const clickCompletedAt = Date.now();
              console.log("Auto-export: waiting for Workout Summary ZIP or CSV");
              const waitForArtifactResult = await waitForWorkoutSummaryArtifact(
                exportDir,
                downloadsDir,
                exportDirSnapshotBeforeClick.summaryZipFiles,
                exportDirSnapshotBeforeClick.summaryCsvFiles,
                downloadsSnapshotBeforeClick.summaryZipFiles,
                downloadsSnapshotBeforeClick.summaryCsvFiles,
                clickCompletedAt
              );
              if (waitForArtifactResult.ok && waitForArtifactResult.summaryArtifact && waitForArtifactResult.summaryKind) {
                automaticSummaryExportCompleted = true;
                if (waitForArtifactResult.summaryKind === "zip" && waitForArtifactResult.detectedIn === "downloads") {
                  console.log(
                    `Auto-export: Summary ZIP found in Downloads and moved to export folder: ${path.basename(waitForArtifactResult.summaryArtifact)}`
                  );
                } else if (waitForArtifactResult.summaryKind === "csv" && waitForArtifactResult.detectedIn === "downloads") {
                  console.log(
                    `Auto-export: Summary CSV found in Downloads and moved to export folder: ${path.basename(waitForArtifactResult.summaryArtifact)}`
                  );
                } else if (waitForArtifactResult.summaryKind === "csv") {
                  console.log(
                    `Auto-export: Summary CSV detected in export folder: ${path.basename(waitForArtifactResult.summaryArtifact)}`
                  );
                } else {
                  console.log(`Auto-export: Summary ZIP detected: ${path.basename(waitForArtifactResult.summaryArtifact)}`);
                }
                console.log("Workout Summary export downloaded automatically.");
              } else {
                console.log("Auto-export did not detect Workout Summary ZIP or CSV. Switching to manual fallback.");
                console.log(
                  `Auto-export fallback: ${waitForArtifactResult.reason ?? "did not detect Workout Summary ZIP or CSV after clicking Export."}`
                );
              }
            }
          }
        }

        if (!automaticSummaryExportCompleted && apiCapture?.responseMatched && !apiCapture.savedArtifactPath && apiCapture.fallbackReason) {
          console.log(`Auto-export fallback: ${apiCapture.fallbackReason}`);
        }
      }
    }

    console.log("");
    if (!automaticSummaryExportCompleted) {
      logManualFallbackInstructions();
      console.log("If no files are downloaded and no existing ZIPs are found, this student will be skipped and the batch will continue.");
      console.log("");

      await waitForEnter("Press Enter here after you finish the manual export flow.");
    }

    const exportDirSnapshot = await inspectExportDir(exportDir);
    const exportAssessment = assessExportFiles(
      exportDirSnapshot.summaryZipFiles,
      exportDirSnapshot.summaryCsvFiles,
      exportDirSnapshot.zipFiles
    );
    logExportAssessment(exportAssessment);

    if (!exportAssessment.summaryZip && !exportAssessment.summaryCsv) {
      if (exportDirSnapshot.zipFiles.length === 0 && exportDirSnapshot.csvFiles.length === 0) {
        console.log("Status: no export files available.");
        throw new Error("No Workout Summary ZIP or CSV was found after automatic export attempt and manual fallback.");
      }

      console.log("Existing export files found:");
      for (const filePath of exportDirSnapshot.zipFiles) {
        console.log(`- ${filePath}`);
      }
      for (const filePath of exportDirSnapshot.csvFiles) {
        console.log(`- ${filePath}`);
      }

      throw new Error("Workout Summary export was not found after the export step.");
    }
  } finally {
    await context.close();
    console.log("Browser closed.");
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
