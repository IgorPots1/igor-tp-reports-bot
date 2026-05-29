const OPENAI_AUDIO_TRANSCRIPTION_URL =
  process.env.OPENAI_API_URL?.trim() || "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_TRANSCRIPTION_MODEL = "whisper-1";

function getOpenAiApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  return apiKey;
}

function resolveAudioFileName(input: { mimeType?: string | null; fileName?: string }): string {
  const fromInput = input.fileName?.trim();
  if (fromInput) {
    return fromInput;
  }

  const mimeType = input.mimeType?.trim() ?? "";
  if (mimeType.includes("ogg")) {
    return "voice.ogg";
  }
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) {
    return "voice.mp3";
  }
  if (mimeType.includes("wav")) {
    return "voice.wav";
  }
  if (mimeType.includes("webm")) {
    return "voice.webm";
  }

  return "voice.ogg";
}

type OpenAiTranscriptionResponse = {
  text?: string;
};

export async function transcribeTelegramVoiceMessage(input: {
  audioBuffer: Buffer;
  mimeType?: string | null;
  fileName?: string;
}): Promise<string> {
  if (!Buffer.isBuffer(input.audioBuffer) || input.audioBuffer.length === 0) {
    throw new Error("Audio payload is empty");
  }

  const apiKey = getOpenAiApiKey();
  const audioMimeType = input.mimeType?.trim() || "audio/ogg";
  const audioArray = Uint8Array.from(input.audioBuffer);
  const blob = new Blob([audioArray.buffer], { type: audioMimeType });
  const formData = new FormData();
  formData.set("model", OPENAI_TRANSCRIPTION_MODEL);
  formData.set("file", blob, resolveAudioFileName(input));

  const response = await fetch(OPENAI_AUDIO_TRANSCRIPTION_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`OpenAI transcription failed (${response.status})`);
  }

  const payload = (await response.json()) as OpenAiTranscriptionResponse;
  const transcript = payload.text?.trim() ?? "";

  if (!transcript) {
    throw new Error("OpenAI transcription returned empty transcript");
  }

  return transcript;
}
