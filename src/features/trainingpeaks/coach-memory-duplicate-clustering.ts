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
  hasIllnessStrongMarker: boolean;
  hasExplicitRespiratoryIllnessSignal: boolean;
};

type MemoryItemLike = {
  id: string;
  memory_type: TrainingPeaksStudentMemoryType;
  summary_text: string;
  valid_from?: string | null;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export const ILLNESS_KEYWORD_STEMS = [
  "болезн",
  "простуд",
  "кашл",
  "насморк",
  "температур",
  "орви",
  "грипп",
  "вирус",
  "ангин",
  "sick",
  "illness",
  "cold",
  "fever",
  "flu",
] as const;

export const UPPER_RESPIRATORY_KEYWORD_STEMS = [
  "горло",
  "перш",
  "заперш",
  "кашл",
  "насморк",
  "простуд",
  "орви",
  "ангин",
  "throat",
  "cold",
] as const;

const ILLNESS_STRONG_MARKER_STEMS = [
  "больничн",
  "температур",
  "орви",
  "грипп",
  "вирус",
  "ангин",
  "fever",
  "flu",
  "sick leave",
] as const;

const THROAT_CONTEXT_STEMS = ["горло", "throat"] as const;
const RESPIRATORY_DISEASE_STEMS = ["простуд", "орви", "грипп", "flu", "cold"] as const;
const RESPIRATORY_SYMPTOM_STEMS = ["перш", "заперш", "кашл", "насморк"] as const;
const THROAT_PAIN_PATTERNS = [/\bбол(?:ь|ит)\s+в\s+горл/u, /\bболь\s+горл/u, /\bsore throat\b/u];
const ILLNESS_EPISODE_MAX_GAP_DAYS = 21;
const DAY_MS = 24 * 60 * 60 * 1000;

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

function matchesThroatPainPattern(text: string): boolean {
  return THROAT_PAIN_PATTERNS.some((pattern) => pattern.test(text));
}

function hasExplicitRespiratoryIllnessSignal(text: string): boolean {
  const hasUpperRespKeywords = containsAny(text, UPPER_RESPIRATORY_KEYWORD_STEMS);
  const hasThroatContext = containsAny(text, THROAT_CONTEXT_STEMS);
  const hasRespiratoryDiseaseMarker = containsAny(text, RESPIRATORY_DISEASE_STEMS);
  const hasRespiratorySymptom = containsAny(text, RESPIRATORY_SYMPTOM_STEMS);
  const hasIllnessCore = containsAny(text, ILLNESS_KEYWORD_STEMS);
  const hasStrongMarkers = containsAny(text, ILLNESS_STRONG_MARKER_STEMS);
  const hasThroatPain = matchesThroatPainPattern(text);

  if (hasThroatPain) {
    return true;
  }
  if (hasRespiratoryDiseaseMarker) {
    return true;
  }
  if (hasThroatContext && hasRespiratorySymptom) {
    return true;
  }
  if (hasUpperRespKeywords && hasRespiratorySymptom) {
    return true;
  }
  if (hasUpperRespKeywords && (hasIllnessCore || hasStrongMarkers)) {
    return true;
  }
  if (hasThroatContext && (hasIllnessCore || hasStrongMarkers)) {
    return true;
  }
  return false;
}

function hasMusculoskeletalPainContext(text: string): boolean {
  const bodyPartMatched = BODY_PART_PATTERNS.some((entry) => containsAny(text, entry.keywords));
  if (!bodyPartMatched) {
    return false;
  }
  return /\b(болит|болело|заболело|ноет|тянет|pain|injury)\b/u.test(text);
}

export function matchesIllnessSignal(text: string): boolean {
  const normalized = normalizeMemoryDuplicateText(text);
  const hasIllnessCore = containsAny(normalized, ILLNESS_KEYWORD_STEMS);
  const hasStrongMarkers = containsAny(normalized, ILLNESS_STRONG_MARKER_STEMS);
  const respiratoryIllness = hasExplicitRespiratoryIllnessSignal(normalized);
  if (!respiratoryIllness && !hasStrongMarkers && hasMusculoskeletalPainContext(normalized)) {
    return false;
  }
  return hasIllnessCore || hasStrongMarkers || respiratoryIllness;
}

export function matchesUpperRespiratorySignal(text: string): boolean {
  const normalized = normalizeMemoryDuplicateText(text);
  return hasExplicitRespiratoryIllnessSignal(normalized);
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
  const explicitRespiratoryIllness = hasExplicitRespiratoryIllnessSignal(normalizedSummary);
  const hasIllnessStrongMarker = containsAny(normalizedSummary, ILLNESS_STRONG_MARKER_STEMS);
  const hasUpperRespiratorySignal = explicitRespiratoryIllness;
  const hasIllnessSignal =
    containsAny(normalizedSummary, ILLNESS_KEYWORD_STEMS) ||
    hasIllnessStrongMarker ||
    hasUpperRespiratorySignal;
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
    hasIllnessStrongMarker,
    hasExplicitRespiratoryIllnessSignal: explicitRespiratoryIllness,
  };
}

export function isIllnessClusterCandidate(
  item: MemoryItemLike,
  signals: ParsedMemoryDuplicateSignals
): boolean {
  if (!HEALTH_MEMORY_TYPES.has(item.memory_type)) {
    return false;
  }
  if (item.memory_type === "pain_or_injury") {
    return signals.hasExplicitRespiratoryIllnessSignal;
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

function parseTimestampToMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

export function bestAvailableTimestampMs(item: MemoryItemLike): number | null {
  return (
    parseTimestampToMs(item.valid_from) ??
    parseTimestampToMs(item.first_seen_at) ??
    parseTimestampToMs(item.last_seen_at) ??
    parseTimestampToMs(item.updated_at) ??
    parseTimestampToMs(item.created_at)
  );
}

export type IllnessEpisodeCluster = {
  items: MemoryItemLike[];
  signals: ParsedMemoryDuplicateSignals[];
};

export function collectIllnessClusterEpisodes(studentItems: MemoryItemLike[]): IllnessEpisodeCluster[] {
  const { items, signalsById } = collectIllnessClusterItems(studentItems);
  if (items.length === 0) {
    return [];
  }

  const datedItems = items
    .map((item) => ({ item, timestampMs: bestAvailableTimestampMs(item) }))
    .filter((entry): entry is { item: MemoryItemLike; timestampMs: number } => entry.timestampMs !== null)
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const unknownTimeItems = items.filter((item) => bestAvailableTimestampMs(item) === null);
  const episodes: MemoryItemLike[][] = [];

  for (const entry of datedItems) {
    const current = episodes[episodes.length - 1];
    if (!current || current.length === 0) {
      episodes.push([entry.item]);
      continue;
    }

    const previousTimestamp = bestAvailableTimestampMs(current[current.length - 1]);
    if (previousTimestamp === null) {
      episodes.push([entry.item]);
      continue;
    }

    const gapDays = Math.abs(entry.timestampMs - previousTimestamp) / DAY_MS;
    if (gapDays > ILLNESS_EPISODE_MAX_GAP_DAYS) {
      episodes.push([entry.item]);
      continue;
    }

    current.push(entry.item);
  }

  const strongUnknownItems = unknownTimeItems.filter((item) => {
    const signals = signalsById.get(item.id);
    return Boolean(signals?.hasIllnessStrongMarker || signals?.hasSickLeaveSignal);
  });

  // Unknown timestamps are merged only with strong repeated evidence, otherwise kept isolated.
  if (unknownTimeItems.length >= 3 && strongUnknownItems.length >= 2) {
    episodes.push(unknownTimeItems);
  } else {
    for (const item of unknownTimeItems) {
      episodes.push([item]);
    }
  }

  return episodes.map((episodeItems) => ({
    items: episodeItems,
    signals: episodeItems
      .map((item) => signalsById.get(item.id))
      .filter((signals): signals is ParsedMemoryDuplicateSignals => Boolean(signals)),
  }));
}
