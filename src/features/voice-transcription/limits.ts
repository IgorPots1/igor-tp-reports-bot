// Shared between the manual queue (webhook.ts, voice_transcription_jobs) and the automatic
// queue (trainingpeaks/repository.ts, transcript_status on context observations) — one number,
// not two independently-tunable copies that could silently drift apart.
export function getMaxVoiceDurationSec(): number {
  const raw = process.env.VOICE_TRANSCRIPTION_MAX_DURATION_SEC?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1200; // 20 min default
}
