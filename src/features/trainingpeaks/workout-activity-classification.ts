export type TrainingPeaksWorkoutActivityFamily =
  | "run"
  | "strength"
  | "bike"
  | "swim"
  | "walk_hike"
  | "paddle"
  | "row"
  | "ski"
  | "crosstrain"
  | "day_off"
  | "other"
  | "unknown";

export type TrainingPeaksWorkoutActivityClassificationConfidence = "high" | "medium" | "low";

export type ClassifyTrainingPeaksWorkoutActivityInput = {
  title?: string | null;
  sportOrTypeCode?: string | null;
  workoutTypeValueId?: number | null;
  workoutSubTypeId?: number | null;
  sourceSnapshot?: unknown;
};

export type TrainingPeaksWorkoutActivityClassificationResult = {
  family: TrainingPeaksWorkoutActivityFamily;
  isRunning: boolean;
  confidence: TrainingPeaksWorkoutActivityClassificationConfidence;
  reason: string;
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function includesAny(haystack: string, needles: string[]): string | null {
  for (const needle of needles) {
    if (haystack.includes(needle)) {
      return needle;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectSnapshotStrings(value: unknown, output: string[], depth = 0): void {
  if (depth > 2) {
    return;
  }
  if (typeof value === "string") {
    const normalized = normalizeText(value);
    if (normalized) {
      output.push(normalized);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSnapshotStrings(item, output, depth + 1);
    }
    return;
  }
  if (isRecord(value)) {
    for (const entry of Object.values(value)) {
      collectSnapshotStrings(entry, output, depth + 1);
    }
  }
}

function classifyByTitle(title: string): TrainingPeaksWorkoutActivityClassificationResult | null {
  const padelMatch = title.match(/(?:^|[^a-zа-яё])(padel|падел)(?:[^a-zа-яё]|$)/iu);
  if (padelMatch) {
    return {
      family: "crosstrain",
      isRunning: false,
      confidence: "high",
      reason: `title matched padel keyword "${padelMatch[1]}"`,
    };
  }

  const strongPaddleMatch = includesAny(title, [
    "stand up paddleboarding",
    "paddleboarding",
    "paddle board",
    "paddleboard",
    "sup",
    "падл",
    "paddle",
  ]);
  if (strongPaddleMatch) {
    return {
      family: "paddle",
      isRunning: false,
      confidence: "high",
      reason: `title override matched paddle keyword "${strongPaddleMatch}"`,
    };
  }

  const strengthMatch = includesAny(title, ["strength", "силовая", "gym", "тренажер", "зал"]);
  if (strengthMatch) {
    return {
      family: "strength",
      isRunning: false,
      confidence: "high",
      reason: `title matched strength keyword "${strengthMatch}"`,
    };
  }

  return null;
}

function classifyByOfficialType(input: {
  sportOrTypeCode: string;
  workoutTypeValueId: number | null;
  workoutSubTypeId: number | null;
  sourceSnapshot: unknown;
}): TrainingPeaksWorkoutActivityClassificationResult | null {
  const { sportOrTypeCode, workoutTypeValueId, workoutSubTypeId, sourceSnapshot } = input;

  // Confirmed from local cached samples: 3=Run, 9=Strength.
  if (workoutTypeValueId === 3) {
    return {
      family: "run",
      isRunning: true,
      confidence: "high",
      reason: "workoutTypeValueId=3 (confirmed run mapping)",
    };
  }
  if (workoutTypeValueId === 9) {
    return {
      family: "strength",
      isRunning: false,
      confidence: "high",
      reason: "workoutTypeValueId=9 (confirmed strength mapping)",
    };
  }

  const codeMatchers: Array<{ family: TrainingPeaksWorkoutActivityFamily; tokens: string[] }> = [
    { family: "run", tokens: ["run", "running"] },
    { family: "bike", tokens: ["bike", "cycling", "mtn bike", "mountain bike"] },
    { family: "swim", tokens: ["swim"] },
    { family: "crosstrain", tokens: ["crosstrain", "cross train", "brick"] },
    { family: "day_off", tokens: ["day off"] },
    { family: "strength", tokens: ["strength"] },
    { family: "ski", tokens: ["xc-ski", "xcski", "ski"] },
    { family: "row", tokens: ["row", "rowing"] },
    { family: "walk_hike", tokens: ["walk", "hike"] },
    { family: "other", tokens: ["other", "custom"] },
  ];

  for (const matcher of codeMatchers) {
    const token = includesAny(sportOrTypeCode, matcher.tokens);
    if (!token) {
      continue;
    }
    return {
      family: matcher.family,
      isRunning: matcher.family === "run",
      confidence: "medium",
      reason: `sport/type code matched "${token}"`,
    };
  }

  const snapshotStrings: string[] = [];
  collectSnapshotStrings(sourceSnapshot, snapshotStrings);
  const snapshotHaystack = snapshotStrings.join(" ");
  for (const matcher of codeMatchers) {
    const token = includesAny(snapshotHaystack, matcher.tokens);
    if (!token) {
      continue;
    }
    return {
      family: matcher.family,
      isRunning: matcher.family === "run",
      confidence: "medium",
      reason: `sourceSnapshot type hint matched "${token}"`,
    };
  }

  if (workoutTypeValueId !== null || workoutSubTypeId !== null || sportOrTypeCode) {
    return {
      family: "unknown",
      isRunning: false,
      confidence: "low",
      reason:
        `type fields present but unconfirmed mapping` +
        ` (sportOrTypeCode=${sportOrTypeCode || "null"}, workoutTypeValueId=${String(workoutTypeValueId)},` +
        ` workoutSubTypeId=${String(workoutSubTypeId)})`,
    };
  }

  return null;
}

function classifyBySportTitle(title: string): TrainingPeaksWorkoutActivityClassificationResult | null {
  const runningMatch = includesAny(title, [
    "бег",
    "run",
    "running",
    "tempo",
    "easy run",
    "interval",
    "интерв",
    "длительный",
    "фартлек",
    "темп",
  ]);
  if (runningMatch) {
    return {
      family: "run",
      isRunning: true,
      confidence: "medium",
      reason: `title matched running keyword "${runningMatch}"`,
    };
  }

  const otherMatchers: Array<{ family: TrainingPeaksWorkoutActivityFamily; tokens: string[] }> = [
    { family: "bike", tokens: ["bike", "cycling", "вело"] },
    { family: "swim", tokens: ["swim", "плав"] },
    { family: "walk_hike", tokens: ["walk", "ходьба", "hike", "hiking", "трейл прогулка"] },
    { family: "row", tokens: ["rowing", "row", "греб"] },
    { family: "ski", tokens: ["ski", "xc-ski", "лыжи"] },
    { family: "crosstrain", tokens: ["crosstrain", "cross train", "кросс"] },
    { family: "day_off", tokens: ["day off", "rest day", "отдых"] },
  ];

  for (const matcher of otherMatchers) {
    const token = includesAny(title, matcher.tokens);
    if (!token) {
      continue;
    }
    return {
      family: matcher.family,
      isRunning: false,
      confidence: "medium",
      reason: `title matched ${matcher.family} keyword "${token}"`,
    };
  }

  return null;
}

export function classifyTrainingPeaksWorkoutActivity(
  input: ClassifyTrainingPeaksWorkoutActivityInput
): TrainingPeaksWorkoutActivityClassificationResult {
  const title = normalizeText(input.title);
  const sportOrTypeCode = normalizeText(input.sportOrTypeCode);
  const workoutTypeValueId = input.workoutTypeValueId ?? null;
  const workoutSubTypeId = input.workoutSubTypeId ?? null;

  const titleOverride = classifyByTitle(title);
  if (titleOverride) {
    return titleOverride;
  }

  const typeClassification = classifyByOfficialType({
    sportOrTypeCode,
    workoutTypeValueId,
    workoutSubTypeId,
    sourceSnapshot: input.sourceSnapshot,
  });
  if (typeClassification && typeClassification.family !== "unknown") {
    return typeClassification;
  }

  const titleSportClassification = classifyBySportTitle(title);
  if (titleSportClassification) {
    return titleSportClassification;
  }

  if (typeClassification) {
    return typeClassification;
  }

  return {
    family: "unknown",
    isRunning: false,
    confidence: "low",
    reason: "no clear title or official type/code signal",
  };
}
