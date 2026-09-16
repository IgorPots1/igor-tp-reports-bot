// Shared between the manual queue (webhook.ts, voice_transcription_jobs) and the automatic
// queue (trainingpeaks/repository.ts, transcript_status on context observations) — one number,
// not two independently-tunable copies that could silently drift apart.
//
// 900s (15 min) per Igor, 2026-09-16: the main use case is a 5-7 minute voice note, and a lower
// effective ceiling was rejecting those on the manual path. If VOICE_TRANSCRIPTION_MAX_DURATION_SEC
// is set in .env.local to something below this, that override still wins below — this default
// only applies when the env var is absent.
export function getMaxVoiceDurationSec(): number {
  const raw = process.env.VOICE_TRANSCRIPTION_MAX_DURATION_SEC?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 900;
}
