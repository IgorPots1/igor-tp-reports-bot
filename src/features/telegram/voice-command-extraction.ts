const OPENAI_CHAT_COMPLETIONS_URL =
  process.env.OPENAI_API_URL?.trim() || "https://api.openai.com/v1/chat/completions";
const OPENAI_VOICE_COMMAND_EXTRACTION_MODEL =
  process.env.OPENAI_VOICE_COMMAND_EXTRACTION_MODEL?.trim() || "gpt-5.5-medium";
const OPENAI_VOICE_COMMAND_EXTRACTION_FALLBACK_MODEL =
  process.env.OPENAI_VOICE_COMMAND_EXTRACTION_FALLBACK_MODEL?.trim() || "gpt-4o-mini";

export type ExtractedVoiceStudentMessage = {
  recipientQuery: string;
  messageText: string;
  confidence: number;
};

export type ExtractStudentMessagesFromVoiceTranscriptDetailedResult = {
  messages: ExtractedVoiceStudentMessage[];
  model: string;
};

type OpenAiChatCompletionsResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    } | null;
  }>;
};

function getOpenAiApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  return apiKey;
}

function normalizeExtractedVoiceStudentMessage(
  item: unknown
): ExtractedVoiceStudentMessage | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }

  const recipientQueryRaw = (item as { recipientQuery?: unknown }).recipientQuery;
  const messageTextRaw = (item as { messageText?: unknown }).messageText;
  const confidenceRaw = (item as { confidence?: unknown }).confidence;

  const recipientQuery = typeof recipientQueryRaw === "string" ? recipientQueryRaw.trim() : "";
  const messageText = typeof messageTextRaw === "string" ? messageTextRaw.trim() : "";
  const numericConfidence =
    typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw) ? confidenceRaw : 0;

  if (!recipientQuery || !messageText) {
    return null;
  }

  return {
    recipientQuery,
    messageText,
    confidence: Math.max(0, Math.min(1, numericConfidence)),
  };
}

function parseExtractedMessagesFromModel(rawContent: string): ExtractedVoiceStudentMessage[] {
  const trimmed = rawContent.trim();
  if (!trimmed) {
    return [];
  }

  const parseJsonArray = (value: string): unknown[] => {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      throw new Error("Voice extraction payload is not an array");
    }
    return parsed;
  };

  let parsedArray: unknown[];
  try {
    parsedArray = parseJsonArray(trimmed);
  } catch {
    const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
      throw new Error("Voice extraction payload is not valid JSON array");
    }
    parsedArray = parseJsonArray(arrayMatch[0]);
  }

  const normalized: ExtractedVoiceStudentMessage[] = [];
  for (const item of parsedArray) {
    const normalizedItem = normalizeExtractedVoiceStudentMessage(item);
    if (normalizedItem) {
      normalized.push(normalizedItem);
    }
  }
  return normalized;
}

async function requestVoiceCommandExtraction(input: {
  apiKey: string;
  transcript: string;
  model: string;
}): Promise<{ ok: true; messages: ExtractedVoiceStudentMessage[] } | { ok: false; status: number }> {
  const systemPrompt = [
    "Ты извлекаешь из русской расшифровки только прямые поручения тренера написать сообщение ученику.",
    "Верни строго JSON-массив. Без markdown и без пояснений.",
    "Каждый элемент: {\"recipientQuery\":\"...\",\"messageText\":\"...\",\"confidence\":0..1}.",
    "recipientQuery возвращай в именительном падеже, где это возможно.",
    "Примеры: «напиши Оле» -> recipientQuery «Ольга»; «напиши Ольге» -> «Ольга»; «напиши Маше» -> «Мария»; «напиши Кате» -> «Екатерина».",
    "messageText не переписывай без необходимости: сохраняй смысл и формулировку поручения.",
    "Если явных поручений нет, верни [].",
    "Не выдумывай получателей и текст сообщений.",
  ].join("\n");

  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            "Расшифровка голосового сообщения тренера:",
            input.transcript,
            "",
            "Извлеки сообщения ученикам по правилам выше.",
          ].join("\n"),
        },
      ],
    }),
  });

  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  const payload = (await response.json()) as OpenAiChatCompletionsResponse;
  const content = payload.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) {
    return { ok: true, messages: [] };
  }

  return {
    ok: true,
    messages: parseExtractedMessagesFromModel(content),
  };
}

export async function extractStudentMessagesFromVoiceTranscriptDetailed(input: {
  transcript: string;
}): Promise<ExtractStudentMessagesFromVoiceTranscriptDetailedResult> {
  const transcript = input.transcript.trim();
  if (!transcript) {
    return { messages: [], model: OPENAI_VOICE_COMMAND_EXTRACTION_MODEL };
  }

  const apiKey = getOpenAiApiKey();
  const preferredModel = OPENAI_VOICE_COMMAND_EXTRACTION_MODEL;
  const preferredResult = await requestVoiceCommandExtraction({
    apiKey,
    transcript,
    model: preferredModel,
  });

  if (preferredResult.ok) {
    return {
      messages: preferredResult.messages,
      model: preferredModel,
    };
  }

  const fallbackModel = OPENAI_VOICE_COMMAND_EXTRACTION_FALLBACK_MODEL;
  if (
    fallbackModel &&
    fallbackModel !== preferredModel &&
    (preferredResult.status === 400 || preferredResult.status === 404 || preferredResult.status === 422)
  ) {
    const fallbackResult = await requestVoiceCommandExtraction({
      apiKey,
      transcript,
      model: fallbackModel,
    });
    if (fallbackResult.ok) {
      return {
        messages: fallbackResult.messages,
        model: fallbackModel,
      };
    }
  }

  throw new Error("Voice command extraction request failed");
}

export async function extractStudentMessagesFromVoiceTranscript(input: {
  transcript: string;
}): Promise<ExtractedVoiceStudentMessage[]> {
  const result = await extractStudentMessagesFromVoiceTranscriptDetailed(input);
  return result.messages;
}

export function getVoiceCommandExtractionModel(): string {
  return OPENAI_VOICE_COMMAND_EXTRACTION_MODEL;
}
