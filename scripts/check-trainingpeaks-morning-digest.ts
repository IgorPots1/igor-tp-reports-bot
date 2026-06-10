import process from "node:process";

import {
  MORNING_DIGEST_SECTION_TITLES,
  TRAININGPEAKS_ATTENTION_DIGEST_CHUNK_LIMIT,
  TELEGRAM_MESSAGE_HARD_LIMIT,
  buildTrainingPeaksAttentionDigestMessages,
  formatTrainingPeaksAttentionSnapshotMessage,
} from "@/features/trainingpeaks/attention-telegram";
import type { TrainingPeaksAttentionSnapshot } from "@/features/trainingpeaks/service";

const LOG_PREFIX = "[check-trainingpeaks-morning-digest]";

const REQUIRED_SECTIONS = Object.values(MORNING_DIGEST_SECTION_TITLES);

const FORBIDDEN_SECTIONS = [
  "🚨 Срочно",
  "📌 Сегодня",
  "👀 Наблюдать",
  "ℹ️ Справочно",
  "🔁 Переносы",
  "📭 Нет контакта 3+ дня",
  "📭 Нет контакта 5+ дней",
];

const FORBIDDEN_SECTION_LINES = ["Проверить сегодня"];

const FORBIDDEN_NOISE = [
  "вопрос тренеру за последние 24ч",
  "вопросы тренеру",
  "question_to_coach",
  "question_case",
  "самочувствие/боль за последние 48ч",
  "самочувствие/боль:",
  "24–48",
  "24-48",
  "был вопрос",
];

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function buildRepresentativeSnapshot(): TrainingPeaksAttentionSnapshot {
  return {
    urgent: [
      {
        level: "urgent",
        studentName: "Legacy Urgent",
        reason: "legacy urgent should not render",
        signalKind: "legacy",
      },
    ],
    today: [
      {
        level: "today",
        studentName: "Legacy Today",
        reason: "legacy today should not render",
        signalKind: "legacy",
      },
    ],
    observe: [
      {
        level: "observe",
        studentName: null,
        reason: "legacy observe should not render",
        signalKind: "scan_failed",
      },
    ],
    fyi: [
      {
        level: "fyi",
        studentName: null,
        reason: "legacy fyi should not render",
        signalKind: "fyi",
      },
    ],
    checkTodaySignals: [
      {
        level: "today",
        studentName: "Ilya Bogdanov",
        studentId: "student-ilya",
        reason: "выполнение переноса завершилось с ошибкой",
        signalKind: "move_failed_action",
      },
    ],
    painDiscomfort: [
      {
        level: "today",
        studentName: "Elena Titskaia",
        studentId: "student-elena",
        reason: "боль в колене после вчерашней тренировки\nнаблюдать, уточнить если усилится",
        signalKind: "operational_pain_injury",
      },
    ],
    missedWorkouts: [
      {
        level: "today",
        studentName: "Athlete One",
        studentId: "student-one",
        reason: "вчера была беговая тренировка, выполнения не найдено",
        signalKind: "missed_workout",
      },
    ],
    noContact5Days: [
      {
        level: "fyi",
        studentName: "Silent Athlete",
        studentId: "student-silent",
        reason: "",
        signalKind: "no_contact",
      },
    ],
    followUpToday: [
      {
        level: "today",
        studentName: "Follow Up Athlete",
        studentId: "student-follow-up",
        reason: "болеет, температура",
        signalKind: "operational_follow_up",
      },
    ],
    followUpOverflowCount: 0,
    planConstraintsToday: [
      {
        level: "today",
        studentName: "Sofia Vlasova",
        studentId: "student-sofia",
        reason: "доступна: вт 02.06, чт 04.06; недоступна: 05.06—08.06",
        signalKind: "operational_schedule",
      },
      {
        level: "today",
        studentName: "Ilya Bogdanov",
        studentId: "student-ilya",
        reason: "перенос тренировки требует проверки",
        signalKind: "move_needs_review_case",
      },
    ],
    planConstraintsOverflowCount: 0,
    movesToday: [
      {
        level: "today",
        studentName: "Move Athlete",
        studentId: "student-move",
        reason: "кандидат переноса 05.06 → 04.06",
        signalKind: "operational_move",
      },
    ],
    movesOverflowCount: 0,
  };
}

function run(): void {
  const snapshot = buildRepresentativeSnapshot();
  const message = formatTrainingPeaksAttentionSnapshotMessage(snapshot, "Утренний обзор TrainingPeaks");
  const chunks = buildTrainingPeaksAttentionDigestMessages(snapshot, "Утренний обзор TrainingPeaks");
  const joined = chunks.join("\n");

  for (const section of REQUIRED_SECTIONS) {
    assert(message.includes(section), `Required section missing: ${section}`);
  }

  for (const section of FORBIDDEN_SECTIONS) {
    assert(!message.includes(section), `Forbidden section present: ${section}`);
  }

  const messageLines = message.split("\n").map((line) => line.trim());
  for (const sectionLine of FORBIDDEN_SECTION_LINES) {
    assert(!messageLines.includes(sectionLine), `Forbidden legacy section line present: ${sectionLine}`);
  }

  for (const noise of FORBIDDEN_NOISE) {
    assert(!joined.toLowerCase().includes(noise.toLowerCase()), `Forbidden noise present: ${noise}`);
  }

  assert(!joined.includes("Legacy Urgent"), "Legacy urgent bucket must not leak into morning digest.");
  assert(!joined.includes("Legacy Today"), "Legacy today bucket must not leak into morning digest.");
  assert(!joined.includes("legacy observe"), "Legacy observe bucket must not leak into morning digest.");
  assert(!joined.includes("legacy fyi"), "Legacy fyi bucket must not leak into morning digest.");
  assert(joined.includes("боль в колене"), "Pain section should keep concrete operational signal reason.");
  assert(!joined.includes("signalKind"), "Rendered output must not leak internal fields.");
  assert(
    snapshot.painDiscomfort.every((signal) => signal.signalKind !== "pain_case"),
    "Morning digest fixture must not use legacy pain_case source."
  );
  assert(joined.includes("Follow Up Athlete"), "Check-today section should include follow-up athlete.");
  assert(joined.includes("Move Athlete"), "Plan section should include move candidate.");
  assert(!joined.includes("undefined"), "Rendered output must not contain undefined.");
  assert(!joined.includes("null"), "Rendered output must not contain null.");
  assert(!joined.includes("NaN"), "Rendered output must not contain NaN.");

  assert(chunks.length >= 1, "Expected at least one digest chunk.");
  for (const chunk of chunks) {
    assert(chunk.trim().length > 0, "Digest chunk must not be empty.");
    assert(
      chunk.length <= TRAININGPEAKS_ATTENTION_DIGEST_CHUNK_LIMIT,
      `Chunk exceeds ${TRAININGPEAKS_ATTENTION_DIGEST_CHUNK_LIMIT} chars: ${chunk.length}`
    );
    assert(
      chunk.length <= TELEGRAM_MESSAGE_HARD_LIMIT,
      `Chunk exceeds Telegram hard limit ${TELEGRAM_MESSAGE_HARD_LIMIT}: ${chunk.length}`
    );
  }

  console.log(`${LOG_PREFIX} PASS`);
}

try {
  run();
} catch (error) {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error((error as Error).message);
  process.exit(1);
}
