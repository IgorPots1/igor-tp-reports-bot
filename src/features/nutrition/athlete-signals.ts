export type NutritionAthleteReportSignalCategory =
  | "fatigue"
  | "gi"
  | "illness"
  | "cycle"
  | "injury"
  | "psych";

export type NutritionAthleteReportSignal = {
  category: NutritionAthleteReportSignalCategory;
  evidence: string;
  keyword: string;
  severity: "info" | "coach_review";
};

const COACH_REVIEW_CATEGORIES = new Set<NutritionAthleteReportSignalCategory>(["illness", "cycle", "injury"]);

const SIGNAL_KEYWORDS: Array<{
  category: NutritionAthleteReportSignalCategory;
  keywords: string[];
  severity: NutritionAthleteReportSignal["severity"];
}> = [
  {
    category: "fatigue",
    severity: "info",
    keywords: [
      "усталость",
      "устала",
      "устал",
      "тяжело",
      "выжата",
      "не восстановилась",
      "не восстановился",
      "разбита",
      "разбит",
      "сонливость",
    ],
  },
  {
    category: "gi",
    severity: "info",
    keywords: ["жкт", "желудок", "тошнота", "живот", "изжога", "диарея", "вздутие"],
  },
  {
    category: "illness",
    severity: "coach_review",
    keywords: ["заболела", "заболел", "простуда", "температура", "кашель", "горло", "насморк"],
  },
  {
    category: "cycle",
    severity: "coach_review",
    keywords: ["цикл", "менструация", "месячные", "пмс", "задержка"],
  },
  {
    category: "injury",
    severity: "coach_review",
    keywords: ["травма", "болит", "боль", "потянула", "потянул", "стопа", "колено", "голень"],
  },
  {
    category: "psych",
    severity: "info",
    keywords: ["апатия", "эмоционально тяжело", "стресс", "тревожно"],
  },
];

const MAX_EVIDENCE_LENGTH = 120;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildKeywordRegex(keyword: string): RegExp {
  const escaped = escapeRegExp(keyword);
  return new RegExp(`(?:^|[^\\p{L}\\d_])${escaped}(?:[^\\p{L}\\d_]|$)`, "iu");
}

function extractEvidence(text: string, matchIndex: number, keywordLength: number): string {
  const radius = 55;
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(text.length, matchIndex + keywordLength + radius);
  let snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) {
    snippet = `…${snippet}`;
  }
  if (end < text.length) {
    snippet = `${snippet}…`;
  }
  if (snippet.length > MAX_EVIDENCE_LENGTH) {
    return `${snippet.slice(0, MAX_EVIDENCE_LENGTH - 1)}…`;
  }
  return snippet;
}

export function collectNutritionAthleteReportSignalTexts(input: {
  reportComment?: string | null;
  manualMacroNotes?: Array<string | null | undefined>;
  nutritionContextNotes?: string[];
  profileToleranceNotes?: string | null;
}): string[] {
  const parts: string[] = [];
  if (input.reportComment?.trim()) {
    parts.push(input.reportComment.trim());
  }
  if (input.profileToleranceNotes?.trim()) {
    parts.push(input.profileToleranceNotes.trim());
  }
  for (const note of input.manualMacroNotes ?? []) {
    if (note?.trim()) {
      parts.push(note.trim());
    }
  }
  for (const note of input.nutritionContextNotes ?? []) {
    if (note.trim()) {
      parts.push(note.trim());
    }
  }
  return parts;
}

export function detectNutritionAthleteReportSignals(text: string): NutritionAthleteReportSignal[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const haystack = normalized.toLocaleLowerCase("ru");
  const found: NutritionAthleteReportSignal[] = [];
  const seen = new Set<string>();

  for (const group of SIGNAL_KEYWORDS) {
    for (const keyword of group.keywords) {
      const dedupeKey = `${group.category}:${keyword}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      const regex = buildKeywordRegex(keyword);
      const match = regex.exec(haystack);
      if (!match || match.index === undefined) {
        continue;
      }
      seen.add(dedupeKey);
      found.push({
        category: group.category,
        keyword,
        severity: group.severity,
        evidence: extractEvidence(normalized, match.index, keyword.length),
      });
    }
  }

  return found;
}

export function detectNutritionAthleteReportSignalsFromTexts(texts: string[]): NutritionAthleteReportSignal[] {
  const merged = new Map<string, NutritionAthleteReportSignal>();
  for (const text of texts) {
    for (const signal of detectNutritionAthleteReportSignals(text)) {
      const key = `${signal.category}:${signal.keyword}`;
      if (!merged.has(key)) {
        merged.set(key, signal);
      }
    }
  }
  return [...merged.values()];
}

export function nutritionAthleteReportSignalsRequireCoachReview(
  signals: NutritionAthleteReportSignal[]
): boolean {
  return signals.some(
    (signal) => signal.severity === "coach_review" && COACH_REVIEW_CATEGORIES.has(signal.category)
  );
}
