import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  MORNING_DIGEST_SECTION_TITLES,
  formatTrainingPeaksAttentionSnapshotMessage,
} from "@/features/trainingpeaks/attention-telegram";
import { listRecentTrainingPeaksCoachCasesForAttention } from "@/features/trainingpeaks/repository";
import {
  TRAININGPEAKS_OPERATIONAL_SIGNALS_TELEGRAM_LIMIT,
  extractOperationalPainInjuryItemsFromSnapshot,
  getTrainingPeaksAttentionSnapshot,
  getTrainingPeaksOperationalSignalsSnapshot,
} from "@/features/trainingpeaks/service";
import { formatOperationalSignalTelegramLine } from "@/features/trainingpeaks/telegram-visual-ux";

const LOG_PREFIX = "[diagnose-trainingpeaks-morning-digest-signal-parity]";
const TITLE = "Утренний обзор TrainingPeaks";
const TP_SIGNALS_PAIN_SECTION_TITLE = "🦵 Травмы / боль / дискомфорт";

function loadLocalEnvFiles(): void {
  const repoRoot = path.resolve(process.cwd());
  const envPaths = [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")];
  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }
    const content = fs.readFileSync(envPath, "utf8");
    for (const rawLine of content.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      const key = line.slice(0, separatorIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }
      let value = line.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function formatTimestampForReportDir(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  const second = parts.find((part) => part.type === "second")?.value ?? "00";
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

type PainRowKey = string;

type PainRowRecord = {
  key: PainRowKey;
  studentName: string | null;
  studentId: string | null;
  reason: string;
  sourceType: string;
  lifecycleDisplayState?: string | null;
  followUpState?: string | null;
  signalType?: string | null;
  renderedText: string;
};

function painRowKey(studentName: string | null, reason: string): PainRowKey {
  const name = (studentName ?? "").trim().toLowerCase();
  const text = reason.trim().toLowerCase();
  return `${name}::${text}`;
}

function extractPainRowsFromMorningDigestMessage(message: string): PainRowRecord[] {
  const lines = message.split("\n");
  const painTitle = MORNING_DIGEST_SECTION_TITLES.pain;
  let inPainSection = false;
  let currentName: string | null = null;
  let currentReasonLines: string[] = [];
  const rows: PainRowRecord[] = [];

  const flush = () => {
    if (!currentName && currentReasonLines.length === 0) {
      return;
    }
    const reason = currentReasonLines.join("\n").trim();
    rows.push({
      key: painRowKey(currentName, reason),
      studentName: currentName,
      studentId: null,
      reason,
      sourceType: "morning_digest_rendered",
      renderedText: currentName
        ? `• ${currentName}${reason ? `\n  ${reason.replace(/\n/g, "\n  ")}` : ""}`
        : `• ${reason || "—"}`,
    });
    currentName = null;
    currentReasonLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === painTitle) {
      flush();
      inPainSection = true;
      continue;
    }
    if (!inPainSection) {
      continue;
    }
    if (Object.values(MORNING_DIGEST_SECTION_TITLES).includes(trimmed as (typeof MORNING_DIGEST_SECTION_TITLES)[keyof typeof MORNING_DIGEST_SECTION_TITLES]) && trimmed !== painTitle) {
      flush();
      inPainSection = false;
      continue;
    }
    const bulletMatch = trimmed.match(/^•\s+(.+)$/u);
    if (bulletMatch?.[1]) {
      flush();
      currentName = bulletMatch[1].trim();
      continue;
    }
    if (line.startsWith("  ") && currentName) {
      currentReasonLines.push(line.trim());
    }
  }
  flush();
  return rows;
}

async function run(): Promise<void> {
  loadLocalEnvFiles();

  const [attentionSnapshot, tpSignalsSnapshot, legacyPainCases] = await Promise.all([
    getTrainingPeaksAttentionSnapshot(),
    getTrainingPeaksOperationalSignalsSnapshot({
      scope: "all",
      limit: TRAININGPEAKS_OPERATIONAL_SIGNALS_TELEGRAM_LIMIT,
    }),
    listRecentTrainingPeaksCoachCasesForAttention({
      sinceHours: 48,
      caseKinds: ["pain_or_health_signal"],
      statuses: ["logged", "open", "needs_review"],
      limit: 300,
    }).catch(() => []),
  ]);

  const morningDigestMessage = formatTrainingPeaksAttentionSnapshotMessage(attentionSnapshot, TITLE);
  const morningDigestPainRowsRendered = extractPainRowsFromMorningDigestMessage(morningDigestMessage);
  const morningDigestPainRowsSnapshot = attentionSnapshot.painDiscomfort.map((signal) => ({
    key: painRowKey(signal.studentName ?? null, signal.reason),
    studentName: signal.studentName ?? null,
    studentId: signal.studentId ?? null,
    reason: signal.reason,
    sourceType: signal.signalKind ?? "unknown",
    renderedText: signal.studentName
      ? `• ${signal.studentName}\n  ${signal.reason.replace(/\n/g, "\n  ")}`
      : `• ${signal.reason}`,
  }));

  const tpSignalsPainItems = extractOperationalPainInjuryItemsFromSnapshot(tpSignalsSnapshot);
  const tpSignalsPainRows = tpSignalsPainItems.map((item) => ({
    key: painRowKey(item.studentName, item.text),
    studentName: item.studentName,
    studentId: item.studentId,
    reason: item.text,
    sourceType: "operational_signal",
    lifecycleDisplayState: item.lifecycleDisplayState,
    followUpState: item.followUpState,
    signalType: item.signalType,
    renderedText: formatOperationalSignalTelegramLine(item.studentName?.trim() || "Без ученика", item.text),
  }));

  const morningKeys = new Set(morningDigestPainRowsSnapshot.map((row) => row.key));
  const tpSignalsKeys = new Set(tpSignalsPainRows.map((row) => row.key));

  const onlyInMorningDigest = morningDigestPainRowsSnapshot.filter((row) => !tpSignalsKeys.has(row.key));
  const onlyInTpSignals = tpSignalsPainRows.filter((row) => !morningKeys.has(row.key));

  const legacyPainRows = legacyPainCases.map((caseRow) => ({
    studentId: caseRow.studentId,
    caseId: caseRow.id,
    status: caseRow.status,
    sourceType: "coach_case_pain_or_health_signal",
    createdAt: caseRow.createdAt,
  }));

  const reportDir = path.join(
    process.cwd(),
    "reports",
    "trainingpeaks-morning-digest-signal-parity",
    formatTimestampForReportDir(new Date())
  );
  fs.mkdirSync(reportDir, { recursive: true });

  const summary = {
    generatedAt: new Date().toISOString(),
    tpSignalsLimit: TRAININGPEAKS_OPERATIONAL_SIGNALS_TELEGRAM_LIMIT,
    counts: {
      morningDigestInjuryRows: morningDigestPainRowsSnapshot.length,
      tpSignalsInjuryRows: tpSignalsPainRows.length,
      legacyCoachPainCases: legacyPainRows.length,
      onlyInMorningDigest: onlyInMorningDigest.length,
      onlyInTpSignals: onlyInTpSignals.length,
    },
    morningDigestInjuryNames: morningDigestPainRowsSnapshot.map((row) => row.studentName).filter(Boolean),
    tpSignalsInjuryNames: tpSignalsPainRows.map((row) => row.studentName).filter(Boolean),
    onlyInMorningDigest,
    onlyInTpSignals,
    morningDigestPainRowsSnapshot,
    tpSignalsPainRows,
    morningDigestPainRowsRendered,
    legacyCoachPainCases: legacyPainRows,
    parityOk: onlyInMorningDigest.length === 0,
  };

  fs.writeFileSync(path.join(reportDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    path.join(reportDir, "morning-digest-pain-section.txt"),
    `${morningDigestMessage.split("\n").slice(
      morningDigestMessage.split("\n").findIndex((line) => line.trim() === MORNING_DIGEST_SECTION_TITLES.pain),
      morningDigestMessage.split("\n").length
    ).join("\n")}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(reportDir, "tp-signals-pain-section.txt"),
    `${[
      TP_SIGNALS_PAIN_SECTION_TITLE,
      "",
      ...tpSignalsPainRows.map((row) => row.renderedText),
    ].join("\n\n")}\n`,
    "utf8"
  );

  console.log(`${LOG_PREFIX} report_dir=${reportDir}`);
  console.log(
    `${LOG_PREFIX} morning=${summary.counts.morningDigestInjuryRows} tp_signals=${summary.counts.tpSignalsInjuryRows} legacy_cases=${summary.counts.legacyCoachPainCases}`
  );
  console.log(
    `${LOG_PREFIX} only_in_morning=${summary.counts.onlyInMorningDigest} only_in_tp_signals=${summary.counts.onlyInTpSignals} parity_ok=${summary.parityOk}`
  );
}

run().catch((error) => {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
