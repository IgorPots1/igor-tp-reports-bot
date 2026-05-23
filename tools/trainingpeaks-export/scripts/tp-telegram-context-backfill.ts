import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";

const PREVIEW_MAX_LENGTH = 120;

type CliArgs = {
  write: boolean;
};

type LinkedStudentRow = {
  id: string;
  student_id: string;
  student_name: string;
  telegram_chat_id: string;
};

type BusinessChatRow = {
  chat_id: string;
  last_text: string | null;
  last_seen_at: string;
};

type BackfillCandidate = {
  studentId: string;
  studentSlug: string;
  studentName: string;
  chatId: string;
  lastSeenAt: string;
  textSha256: string;
  textPreview: string | null;
  labels: string[];
};

function printHelp(): void {
  console.log(`Usage: npm run tp-telegram-context-backfill -- [options]

Seed TrainingPeaks telegram context observations from linked Business chats.
Default mode is dry-run (no Supabase writes).

Options:
  --write     Insert missing seed observations
  --help      Show this help

Safety:
  - Default: dry-run only
  - Stores text preview (<=120 chars) and sha256 only, never full raw text
  - Skips chat_id + text_sha256 pairs that already have an observation
`);
}

function readTextFileSyncSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function loadDotEnvFile(dotEnvPath: string): void {
  if (!existsSync(dotEnvPath)) {
    return;
  }

  const content = readTextFileSyncSafe(dotEnvPath);
  if (content === null) {
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function loadLocalEnv(): void {
  const repoRoot = path.resolve(toolRoot, "..", "..");
  for (const envPath of [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(toolRoot, ".env"),
  ]) {
    loadDotEnvFile(envPath);
  }
}

function getRequiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Set it in .env.local, .env, or tools/trainingpeaks-export/.env.`);
  }

  return value;
}

function parseArgs(argv: string[]): CliArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  return {
    write: argv.includes("--write"),
  };
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildTextPreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= PREVIEW_MAX_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, PREVIEW_MAX_LENGTH - 1)}…`;
}

function classifyLabels(text: string): string[] {
  const normalized = text
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
  const labels: string[] = [];

  if (!normalized) {
    return ["unknown"];
  }

  if (/^(ok|okay|ок|окей|спасибо|спс|thanks|thank you|done|сделал|сделано|принято|[👍👌🙏])$/iu.test(normalized)) {
    labels.push("ack_or_noise");
  }

  if (normalized.includes("?") || ["подскажи", "что думаешь", "как думаешь", "можно ли", "можно?", "тренер", "coach"].some((phrase) => normalized.includes(phrase))) {
    labels.push("question_to_coach");
  }

  if (normalized.length >= 24 && ["тренировка", "пробежка", "темп", "интервалы", "пульс", "hr", "км", "km", "workout", "run", "pace"].some((keyword) => normalized.includes(keyword))) {
    labels.push("report_like");
  }

  if (["боль", "болит", "колено", "спина", "ахилл", "устал", "заболел", "температура", "hurts", "pain", "sick", "injury"].some((keyword) => normalized.includes(keyword))) {
    labels.push("pain_or_health");
  }

  if (["марафон", "полумарафон", "старт", "race", "marathon", "half marathon", "10k", "5k", "соревнован", "забег"].some((keyword) => normalized.includes(keyword))) {
    labels.push("race_context");
  }

  if (["расписан", "перенес", "перенос", "сдвин", "завтра", "на неделе", "в выходные", "schedule", "reschedule", "calendar"].some((keyword) => normalized.includes(keyword))) {
    labels.push("schedule_context");
  }

  if (["перенес", "перенести", "перенос", "move workout", "move_workout"].some((keyword) => normalized.includes(keyword))) {
    labels.push("move_workout_candidate");
  }

  return labels.length > 0 ? labels : ["unknown"];
}

async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const supabase = createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: students, error: studentsError } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_id, student_name, telegram_chat_id")
    .not("telegram_chat_id", "is", null);

  if (studentsError) {
    throw new Error(`Failed to load linked students: ${studentsError.message}`);
  }

  const linkedStudents = ((students as LinkedStudentRow[] | null) ?? []).filter(
    (student) => student.telegram_chat_id.trim().length > 0
  );

  const chatIds = [...new Set(linkedStudents.map((student) => student.telegram_chat_id))];
  const businessChatByChatId = new Map<string, BusinessChatRow>();

  if (chatIds.length > 0) {
    const { data: businessChats, error: businessChatsError } = await supabase
      .from("trainingpeaks_telegram_business_chats")
      .select("chat_id, last_text, last_seen_at")
      .in("chat_id", chatIds);

    if (businessChatsError) {
      throw new Error(`Failed to load business chats: ${businessChatsError.message}`);
    }

    for (const chat of (businessChats as BusinessChatRow[] | null) ?? []) {
      const existing = businessChatByChatId.get(chat.chat_id);
      if (!existing || chat.last_seen_at > existing.last_seen_at) {
        businessChatByChatId.set(chat.chat_id, chat);
      }
    }
  }

  const candidates: BackfillCandidate[] = [];

  for (const student of linkedStudents) {
    const businessChat = businessChatByChatId.get(student.telegram_chat_id);
    const lastText = businessChat?.last_text?.trim();
    if (!lastText) {
      continue;
    }

    candidates.push({
      studentId: student.id,
      studentSlug: student.student_id,
      studentName: student.student_name,
      chatId: student.telegram_chat_id,
      lastSeenAt: businessChat.last_seen_at,
      textSha256: sha256Text(lastText),
      textPreview: buildTextPreview(lastText),
      labels: classifyLabels(lastText),
    });
  }

  let wouldInsert = 0;
  let inserted = 0;
  let skippedExisting = 0;
  const skippedNoText = linkedStudents.length - candidates.length;

  for (const candidate of candidates) {
    const { data: existing, error: existingError } = await supabase
      .from("trainingpeaks_telegram_context_observations")
      .select("id")
      .eq("chat_id", candidate.chatId)
      .eq("text_sha256", candidate.textSha256)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Failed to check existing observation dedupe: ${existingError.message}`);
    }

    if (existing) {
      skippedExisting += 1;
      continue;
    }

    wouldInsert += 1;

    if (!args.write) {
      console.log("[dry-run] would insert", {
        student: candidate.studentSlug,
        chatId: candidate.chatId,
        labels: candidate.labels,
        textPreview: candidate.textPreview,
      });
      continue;
    }

    const { error: insertError } = await supabase.from("trainingpeaks_telegram_context_observations").insert({
      student_id: candidate.studentId,
      source_type: "business_dm",
      chat_id: candidate.chatId,
      message_thread_id: null,
      message_id: null,
      observed_at: candidate.lastSeenAt,
      labels: candidate.labels,
      text_sha256: candidate.textSha256,
      text_preview: candidate.textPreview,
      metadata: {
        backfill: true,
        seedFromBusinessChat: true,
      },
    });

    if (insertError) {
      throw new Error(`Failed to insert observation for ${candidate.studentSlug}: ${insertError.message}`);
    }

    inserted += 1;
    console.log("[write] inserted", {
      student: candidate.studentSlug,
      chatId: candidate.chatId,
      labels: candidate.labels,
      textPreview: candidate.textPreview,
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: args.write ? "write" : "dry-run",
        linkedStudents: linkedStudents.length,
        candidates: candidates.length,
        skippedNoText,
        skippedExisting,
        wouldInsert,
        inserted,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
