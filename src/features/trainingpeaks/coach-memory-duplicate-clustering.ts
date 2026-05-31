import type { TrainingPeaksStudentMemoryType } from "@/features/trainingpeaks/repository";

export type ParsedMemoryDuplicateSignals = {
  normalizedSummary: string;
  hasIllnessSignal: boolean;
  illnessSubtype: "upper_respiratory" | "general" | null;
  bodyPart: string | null;
  hasPainSignal: boolean;
  hasLoadFatigueSignal: boolean;
  scheduleAnchor: string | null;
  raceAnchor: string | null;
  raceDiscipline: string | null;
  hasSickLeaveSignal: boolean;
  hasUpperRespiratorySignal: boolean;
};

type MemoryItemLike = {
  id: string;
  memory_type: TrainingPeaksStudentMemoryType;
  summary_text: string;
};

export const ILLNESS_KEYWORD_STEMS = [
  "болезн",
  "болеет",
  "заболел",
  "заболела",
  "заболели",
  "горло",
  "перш",
  "заперш",
  "простуд",
  "температур",
  "орви",
  "больничн",
  "sick",
  "illness",
  "cold",
  "throat",
  "fever",
] as const;

export const UPPER_RESPIRATORY_KEYWORD_STEMS = [
  "горло",
  "перш",
  "заперш",
  "простуд",
  "орви",
  "throat",
  "cold",
] as const;

const BODY_PART_PATTERNS: Array<{ part: string; keywords: string[] }> = [
  { part: "knee", keywords: ["колено", "knee"] },
  { part: "achilles", keywords: ["ахилл", "achilles"] },
  { part: "shin", keywords: ["голень", "shin"] },
  { part: "foot", keywords: ["стопа", "foot"] },
  { part: "back", keywords: ["спина", "back"] },
  { part: "hip", keywords: ["бедро", "таз", "hip"] },
];

const PAIN_KEYWORDS = ["боль", "болит", "дискомфорт", "тянет", "ноет", "pain", "injury"];
const LOAD_FATIGUE_KEYWORDS = ["усталость", "нет сил", "перегруз", "fatigue", "overload"];
const SICK_LEAVE_KEYWORDS = ["больничный", "sick leave", "на больничном"];

export const HEALTH_MEMORY_TYPES = new Set<TrainingPeaksStudentMemoryType>([
  "health_status",
  "pain_or_injury",
]);

const RACE_DISCIPLINE_PATTERNS: Array<{ discipline: string; keywords: string[] }> = [
  { discipline: "half_marathon", keywords: ["полумарафон", "half marathon"] },
  { discipline: "marathon", keywords: ["марафон", "marathon"] },
  { discipline: "10k", keywords: ["10к", "10k"] },
  { discipline: "5k", keywords: ["5к", "5k"] },
];

export function normalizeMemoryDuplicateText(input: string): string {
  return input.toLowerCase().replace(/\s+/gu, " ").trim();
}

function containsAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

export function matchesIllnessSignal(text: string): boolean {
  const normalized = normalizeMemoryDuplicateText(text);
  return containsAny(normalized, ILLNESS_KEYWORD_STEMS);
}

export function matchesUpperRespiratorySignal(text: string): boolean {
  const normalized = normalizeMemoryDuplicateText(text);
  return containsAny(normalized, UPPER_RESPIRATORY_KEYWORD_STEMS);
}

function extractBodyPart(text: string): string | null {
  const matchedParts = BODY_PART_PATTERNS.filter((entry) => containsAny(text, entry.keywords)).map(
    (entry) => entry.part
  );
  if (matchedParts.length !== 1) {
    return null;
  }
  return matchedParts[0];
}

function extractRaceDiscipline(text: string): string | null {
  for (const pattern of RACE_DISCIPLINE_PATTERNS) {
    if (containsAny(text, pattern.keywords)) {
      return pattern.discipline;
    }
  }
  return null;
}

function extractScheduleAnchor(text: string): string | null {
  const isoMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/u);
  if (isoMatch?.[1]) {
    return isoMatch[1];
  }

  const ruDateMatch = text.match(/\b([0-3]?\d)\.([01]?\d)\.(20\d{2})\b/u);
  if (ruDateMatch) {
    const day = ruDateMatch[1].padStart(2, "0");
    const month = ruDateMatch[2].padStart(2, "0");
    const year = ruDateMatch[3];
    return `${year}-${month}-${day}`;
  }

  if (text.includes("послезавтра") || text.includes("day after tomorrow")) {
    return "relative:day_after_tomorrow";
  }
  if (text.includes("завтра") || text.includes("tomorrow")) {
    return "relative:tomorrow";
  }
  if (text.includes("сегодня") || text.includes("today")) {
    return "relative:today";
  }
  if (text.includes("выходные") || text.includes("weekend")) {
    return "relative:weekend";
  }
  if (text.includes("следующ") || text.includes("next week")) {
    return "relative:next_week";
  }
  return null;
}

function extractRaceAnchor(text: string): string | null {
  const isoMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/u);
  return isoMatch?.[1] ?? null;
}

export function parseMemoryDuplicateSignals(summaryText: string): ParsedMemoryDuplicateSignals {
  const normalizedSummary = normalizeMemoryDuplicateText(summaryText);
  const hasUpperRespiratorySignal = matchesUpperRespiratorySignal(normalizedSummary);
  const hasIllnessSignal = matchesIllnessSignal(normalizedSummary);
  const illnessSubtype = hasIllnessSignal
    ? hasUpperRespiratorySignal
      ? "upper_respiratory"
      : "general"
    : null;

  return {
    normalizedSummary,
    hasIllnessSignal,
    illnessSubtype,
    bodyPart: extractBodyPart(normalizedSummary),
    hasPainSignal: containsAny(normalizedSummary, PAIN_KEYWORDS),
    hasLoadFatigueSignal: containsAny(normalizedSummary, LOAD_FATIGUE_KEYWORDS),
    scheduleAnchor: extractScheduleAnchor(normalizedSummary),
    raceAnchor: extractRaceAnchor(normalizedSummary),
    raceDiscipline: extractRaceDiscipline(normalizedSummary),
    hasSickLeaveSignal: containsAny(normalizedSummary, SICK_LEAVE_KEYWORDS),
    hasUpperRespiratorySignal,
  };
}

export function isIllnessClusterCandidate(
  item: MemoryItemLike,
  signals: ParsedMemoryDuplicateSignals
): boolean {
  if (!HEALTH_MEMORY_TYPES.has(item.memory_type)) {
    return false;
  }
  return signals.hasIllnessSignal;
}

export function resolveIllnessEpisodeKey(
  signalsList: ParsedMemoryDuplicateSignals[]
): "health:illness:upper_respiratory" | "health:illness:general" {
  if (signalsList.some((signals) => signals.hasUpperRespiratorySignal)) {
    return "health:illness:upper_respiratory";
  }
  return "health:illness:general";
}

export function passesIllnessClusterFilter(items: MemoryItemLike[]): boolean {
  if (items.length < 2) {
    return false;
  }
  return items.some((item) => item.memory_type === "health_status");
}

export function buildIllnessMergedSummary(
  episodeKey: "health:illness:upper_respiratory" | "health:illness:general",
  signalsList: ParsedMemoryDuplicateSignals[]
): string {
  const hasSickLeave = signalsList.some((signals) => signals.hasSickLeaveSignal);
  const hasUpperRespiratory = signalsList.some((signals) => signals.hasUpperRespiratorySignal);

  if (episodeKey === "health:illness:upper_respiratory") {
    if (hasUpperRespiratory && hasSickLeave) {
      return "Болезнь / першение в горле, планирует взять больничный.";
    }
    if (hasSickLeave) {
      return "Болезнь, планирует взять больничный.";
    }
    return "Признаки болезни верхних дыхательных путей (простуда/горло).";
  }

  if (hasSickLeave) {
    return "Эпизод болезни, планирует взять больничный.";
  }
  return "Эпизод болезни: повторяющиеся сигналы о плохом самочувствии.";
}

export function collectIllnessClusterItems(
  studentItems: MemoryItemLike[]
): { items: MemoryItemLike[]; signalsById: Map<string, ParsedMemoryDuplicateSignals> } {
  const signalsById = new Map<string, ParsedMemoryDuplicateSignals>();
  const illnessItems: MemoryItemLike[] = [];

  for (const item of studentItems) {
    const signals = parseMemoryDuplicateSignals(item.summary_text);
    signalsById.set(item.id, signals);
    if (isIllnessClusterCandidate(item, signals)) {
      illnessItems.push(item);
    }
  }

  return { items: illnessItems, signalsById };
}
