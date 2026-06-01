import type {
  TrainingPeaksStudentMemoryItem,
  TrainingPeaksTelegramFormality,
} from "@/features/trainingpeaks/repository";

export type ResolvedCommunicationProfileTone = "warm" | "neutral" | "direct" | "formal";
export type ResolvedCommunicationProfileSource = "manual" | "communication_style_memory" | "unknown";

export type ResolvedStudentCommunicationProfile = {
  formality: TrainingPeaksTelegramFormality;
  formalitySource: ResolvedCommunicationProfileSource;
  tone: ResolvedCommunicationProfileTone | null;
  preferredGreeting: string | null;
  notes: string | null;
  conflictFlags: string[];
};

export function resolveStudentCommunicationProfile(input: {
  telegramFormality: TrainingPeaksTelegramFormality | null | undefined;
  telegramContextNotes?: string | null;
  activeMemoryItems: TrainingPeaksStudentMemoryItem[];
}): ResolvedStudentCommunicationProfile {
  const manualFormality = normalizeKnownFormality(input.telegramFormality);
  const communicationStyleMemory = pickLatestCommunicationStyleMemory(input.activeMemoryItems);
  const memoryFormality = normalizeKnownFormality(
    readStructuredString(communicationStyleMemory?.structured ?? {}, "formality")
  );
  const conflictFlags = new Set<string>();

  let formality: TrainingPeaksTelegramFormality = "unknown";
  let formalitySource: ResolvedCommunicationProfileSource = "unknown";

  if (manualFormality) {
    formality = manualFormality;
    formalitySource = "manual";
    if (memoryFormality && memoryFormality !== manualFormality) {
      conflictFlags.add("formality_mismatch_manual_vs_memory");
    }
  } else if (memoryFormality) {
    formality = memoryFormality;
    formalitySource = "communication_style_memory";
  }

  const tone = normalizeTone(readStructuredString(communicationStyleMemory?.structured ?? {}, "tone"));
  const preferredGreetingRaw = normalizeGreeting(
    readStructuredString(communicationStyleMemory?.structured ?? {}, "preferred_greeting")
  );
  const isGreetingUnsafe =
    formalitySource === "manual" && isPreferredGreetingUnsafeForFormality(preferredGreetingRaw, formality);
  const preferredGreeting = isGreetingUnsafe ? null : preferredGreetingRaw;
  if (isGreetingUnsafe) {
    conflictFlags.add("preferred_greeting_conflicts_with_manual_formality");
  }

  return {
    formality,
    formalitySource,
    tone,
    preferredGreeting,
    notes: normalizeNotes(input.telegramContextNotes ?? null),
    conflictFlags: [...conflictFlags],
  };
}

export function buildResolvedCommunicationProfilePromptLines(
  profile: ResolvedStudentCommunicationProfile
): string[] {
  const lines = [
    "Resolved communication profile:",
    `- formality: ${profile.formality}`,
    `- formality_source: ${profile.formalitySource}`,
  ];

  if (profile.tone) {
    lines.push(`- tone: ${profile.tone}`);
  }
  if (profile.preferredGreeting) {
    lines.push(`- preferred_greeting: ${profile.preferredGreeting}`);
  }
  if (profile.notes) {
    lines.push(`- notes: ${profile.notes}`);
  }
  if (profile.conflictFlags.length > 0) {
    lines.push(`- conflict_flags: ${profile.conflictFlags.join(", ")}`);
  }

  lines.push("Manual formality is authoritative. Do not override it with Coach Memory.");
  return lines;
}

function pickLatestCommunicationStyleMemory(
  items: TrainingPeaksStudentMemoryItem[]
): TrainingPeaksStudentMemoryItem | null {
  const candidates = items.filter((item) => item.memoryType === "communication_style");
  if (candidates.length === 0) {
    return null;
  }

  const sorted = [...candidates].sort((left, right) => {
    const leftTs = getMemoryPriorityTimestamp(left);
    const rightTs = getMemoryPriorityTimestamp(right);
    if (leftTs !== rightTs) {
      return rightTs - leftTs;
    }
    return right.id.localeCompare(left.id);
  });
  return sorted[0] ?? null;
}

function getMemoryPriorityTimestamp(item: TrainingPeaksStudentMemoryItem): number {
  const candidates = [item.lastSeenAt, item.updatedAt, item.createdAt];
  for (const value of candidates) {
    const ts = Date.parse(value);
    if (Number.isFinite(ts)) {
      return ts;
    }
  }
  return 0;
}

function normalizeKnownFormality(
  value: TrainingPeaksTelegramFormality | string | null | undefined
): Extract<TrainingPeaksTelegramFormality, "ty" | "vy"> | null {
  if (value === "ty" || value === "vy") {
    return value;
  }
  return null;
}

function normalizeTone(value: string | null): ResolvedCommunicationProfileTone | null {
  if (value === "warm" || value === "neutral" || value === "direct" || value === "formal") {
    return value;
  }
  return null;
}

function normalizeGreeting(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function normalizeNotes(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function readStructuredString(structured: Record<string, unknown>, key: string): string | null {
  const value = structured[key];
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function isPreferredGreetingUnsafeForFormality(
  greeting: string | null,
  formality: TrainingPeaksTelegramFormality
): boolean {
  if (!greeting || formality !== "vy") {
    return false;
  }
  const normalized = greeting.toLocaleLowerCase("ru").replace(/ё/g, "е");
  return normalized.includes("привет") || normalized.includes("здорова");
}
