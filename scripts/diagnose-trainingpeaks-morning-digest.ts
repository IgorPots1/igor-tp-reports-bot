import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  MORNING_DIGEST_SECTION_TITLES,
  TELEGRAM_MESSAGE_HARD_LIMIT,
  TRAININGPEAKS_ATTENTION_DIGEST_CHUNK_LIMIT,
  buildTrainingPeaksAttentionDigestMessages,
  formatTrainingPeaksAttentionSnapshotMessage,
} from "@/features/trainingpeaks/attention-telegram";
import { getTrainingPeaksAttentionSnapshot } from "@/features/trainingpeaks/service";

const LOG_PREFIX = "[diagnose-trainingpeaks-morning-digest]";
const TITLE = "Утренний обзор TrainingPeaks";

const NOISE_PATTERNS = [
  "question_case",
  "question_to_coach",
  "вопрос тренеру",
  "вопросы тренеру",
  "самочувствие/боль за последние 48ч",
  "24ч",
  "48ч",
  "24–48",
  "24-48",
  "был вопрос",
];

const FORBIDDEN_SECTIONS = [
  "🚨 Срочно",
  "📌 Сегодня",
  "👀 Наблюдать",
  "ℹ️ Справочно",
  "🔁 Переносы",
];

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

function extractSectionTitles(message: string): string[] {
  const titles = Object.values(MORNING_DIGEST_SECTION_TITLES);
  return titles.filter((title) => message.includes(title));
}

function extractStudentsBySection(message: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const sectionOrder = Object.values(MORNING_DIGEST_SECTION_TITLES);
  const lines = message.split("\n");

  let currentSection: string | null = null;
  for (const line of lines) {
    const matchedSection = sectionOrder.find((title) => line.trim() === title);
    if (matchedSection) {
      currentSection = matchedSection;
      result[currentSection] = result[currentSection] ?? [];
      continue;
    }

    if (!currentSection) {
      continue;
    }

    const bulletMatch = line.match(/^•\s+(.+)$/u);
    if (bulletMatch?.[1]) {
      result[currentSection].push(bulletMatch[1].trim());
    }
  }

  return result;
}

function countNoise(message: string): Record<string, number> {
  const lower = message.toLowerCase();
  const counts: Record<string, number> = {};
  for (const pattern of NOISE_PATTERNS) {
    const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
    counts[pattern] = (lower.match(regex) ?? []).length;
  }
  return counts;
}

function findDuplicateStudentsAcrossSections(
  studentsBySection: Record<string, string[]>
): Array<{ student: string; sections: string[] }> {
  const sectionByStudent = new Map<string, Set<string>>();
  for (const [section, students] of Object.entries(studentsBySection)) {
    for (const student of students) {
      const bucket = sectionByStudent.get(student) ?? new Set<string>();
      bucket.add(section);
      sectionByStudent.set(student, bucket);
    }
  }

  return [...sectionByStudent.entries()]
    .filter(([, sections]) => sections.size > 1)
    .map(([student, sections]) => ({ student, sections: [...sections] }));
}

async function run(): Promise<void> {
  const startedAtMs = Date.now();

  const snapshotStartedAtMs = Date.now();
  const snapshot = await getTrainingPeaksAttentionSnapshot();
  const snapshotDurationMs = Date.now() - snapshotStartedAtMs;

  const formatStartedAtMs = Date.now();
  const message = formatTrainingPeaksAttentionSnapshotMessage(snapshot, TITLE);
  const chunks = buildTrainingPeaksAttentionDigestMessages(snapshot, TITLE);
  const formatDurationMs = Date.now() - formatStartedAtMs;

  const totalDurationMs = Date.now() - startedAtMs;
  const sectionTitles = extractSectionTitles(message);
  const studentsBySection = extractStudentsBySection(message);
  const duplicateStudents = findDuplicateStudentsAcrossSections(studentsBySection);
  const noiseCounts = countNoise(message);

  const reportDir = path.join(
    process.cwd(),
    "reports",
    "trainingpeaks-morning-digest-diagnostic",
    formatTimestampForReportDir(new Date())
  );
  fs.mkdirSync(reportDir, { recursive: true });

  const summary = {
    generatedAt: new Date().toISOString(),
    title: TITLE,
    timingMs: {
      total: totalDurationMs,
      snapshot: snapshotDurationMs,
      format: formatDurationMs,
    },
    chunkCount: chunks.length,
    chunkLengths: chunks.map((chunk) => chunk.length),
    chunkOver3500: chunks.filter((chunk) => chunk.length > TRAININGPEAKS_ATTENTION_DIGEST_CHUNK_LIMIT).length,
    chunkOver4096: chunks.filter((chunk) => chunk.length > TELEGRAM_MESSAGE_HARD_LIMIT).length,
    messageLength: message.length,
    sectionTitles,
    forbiddenSectionsPresent: FORBIDDEN_SECTIONS.filter((section) => message.includes(section)),
    rowsPerSection: Object.fromEntries(
      Object.entries(studentsBySection).map(([section, students]) => [section, students.length])
    ),
    duplicateStudentsAcrossSections: duplicateStudents,
    noiseCounts,
    snapshotCounts: {
      checkTodaySignals: snapshot.checkTodaySignals.length,
      followUpToday: snapshot.followUpToday.length,
      painDiscomfort: snapshot.painDiscomfort.length,
      planConstraintsToday: snapshot.planConstraintsToday.length,
      movesToday: snapshot.movesToday.length,
      missedWorkouts: snapshot.missedWorkouts.length,
      noContact5Days: snapshot.noContact5Days.length,
      legacyUrgent: snapshot.urgent.length,
      legacyToday: snapshot.today.length,
      legacyObserve: snapshot.observe.length,
      legacyFyi: snapshot.fyi.length,
    },
    timeoutRiskLikely: totalDurationMs >= 50_000,
  };

  fs.writeFileSync(path.join(reportDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(reportDir, "messages.txt"), `${chunks.join("\n\n---\n\n")}\n`, "utf8");
  fs.writeFileSync(path.join(reportDir, "sections.json"), `${JSON.stringify(studentsBySection, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    path.join(reportDir, "students.json"),
    `${JSON.stringify(
      {
        bySection: studentsBySection,
        duplicatesAcrossSections: duplicateStudents,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  fs.writeFileSync(path.join(reportDir, "noise.json"), `${JSON.stringify(noiseCounts, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    path.join(reportDir, "chunks.json"),
    `${JSON.stringify(
      chunks.map((chunk, index) => ({
        index,
        length: chunk.length,
        over3500: chunk.length > TRAININGPEAKS_ATTENTION_DIGEST_CHUNK_LIMIT,
        over4096: chunk.length > TELEGRAM_MESSAGE_HARD_LIMIT,
      })),
      null,
      2
    )}\n`,
    "utf8"
  );

  console.log(`${LOG_PREFIX} report_dir=${reportDir}`);
  console.log(`${LOG_PREFIX} chunks=${chunks.length} total_ms=${totalDurationMs} snapshot_ms=${snapshotDurationMs}`);
  console.log(`${LOG_PREFIX} sections=${sectionTitles.join(" | ") || "none"}`);
  if (summary.forbiddenSectionsPresent.length > 0) {
    console.log(`${LOG_PREFIX} forbidden_sections=${summary.forbiddenSectionsPresent.join(", ")}`);
  }
}

run().catch((error) => {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
