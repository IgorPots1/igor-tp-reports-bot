// Reusable transcription core: (file_id) -> transcript. Runs ONLY on the local Mac runner
// (needs ffmpeg + whisper.cpp on disk) — never imported from a Vercel-side route, which is why
// this lives as a plain module rather than a Next.js API-adjacent feature file. The manual
// worker (Task 3 of the voice-transcribe naряд) and, later, the automatic incoming-voice
// pipeline (Задача 4 of the telegram-context-completeness naряд) both call this same function —
// do not fork a second copy for the automatic path.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { downloadTelegramFile } from "@/features/telegram/telegram-client";

const execFileAsync = promisify(execFile);

export type TranscriptionResult = {
  transcript: string;
  model: string;
  processingMs: number;
};

function getFfmpegPath(): string {
  return process.env.VOICE_TRANSCRIPTION_FFMPEG_PATH?.trim() || "ffmpeg";
}

function getWhisperCliPath(): string {
  return process.env.VOICE_TRANSCRIPTION_WHISPER_CLI_PATH?.trim() || "whisper-cli";
}

function getWhisperModelPath(): string {
  const configured = process.env.VOICE_TRANSCRIPTION_WHISPER_MODEL_PATH?.trim();
  if (!configured) {
    throw new Error(
      "VOICE_TRANSCRIPTION_WHISPER_MODEL_PATH is not set — point it at the ggml large-v3-turbo model file."
    );
  }
  return configured;
}

function getWhisperModelName(): string {
  return process.env.VOICE_TRANSCRIPTION_WHISPER_MODEL_NAME?.trim() || "large-v3-turbo";
}

function getExecTimeoutMs(): number {
  const raw = process.env.VOICE_TRANSCRIPTION_STEP_TIMEOUT_MS?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10 * 60 * 1000; // 10 min per step
}

// Telegram's language auto-detection is unreliable on short/noisy voice notes — the naряд calls
// for an explicit language, not autodetect. Hardcoded rather than a parameter: every caller today
// (manual test, later automatic student-voice pipeline) is Russian-language coaching traffic.
const WHISPER_LANGUAGE = "ru";

// (file_id) -> transcript. Downloads via the Bot API, converts to 16kHz mono WAV (whisper.cpp's
// expected input), runs whisper.cpp, and ALWAYS cleans up its temp directory — success or throw.
export async function transcribeTelegramFile(fileId: string): Promise<TranscriptionResult> {
  const startedAt = Date.now();
  const workDir = await mkdtemp(join(tmpdir(), "voice-transcribe-"));

  try {
    const audioBuffer = await downloadTelegramFile(fileId);
    const inputPath = join(workDir, "input.telegram-audio");
    const wavPath = join(workDir, "audio-16k-mono.wav");
    const txtBasePath = join(workDir, "transcript");

    await writeFile(inputPath, audioBuffer);

    await execFileAsync(
      getFfmpegPath(),
      ["-y", "-i", inputPath, "-ar", "16000", "-ac", "1", "-f", "wav", wavPath],
      { timeout: getExecTimeoutMs() }
    );

    await execFileAsync(
      getWhisperCliPath(),
      [
        "-m",
        getWhisperModelPath(),
        "-f",
        wavPath,
        "-l",
        WHISPER_LANGUAGE,
        "-nt", // no per-segment timestamps in the output text
        "-otxt",
        "-of",
        txtBasePath,
      ],
      { timeout: getExecTimeoutMs() }
    );

    const txtPath = `${txtBasePath}.txt`;
    await stat(txtPath); // throws a clear ENOENT if whisper.cpp did not produce the file
    const transcript = (await readFile(txtPath, "utf8")).trim();

    return {
      transcript,
      model: getWhisperModelName(),
      processingMs: Date.now() - startedAt,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {
      /* best-effort cleanup; a leftover temp dir is not worth failing the job over */
    });
  }
}
