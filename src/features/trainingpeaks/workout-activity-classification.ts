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

  // TP has no dedicated type id for the elliptical machine — it arrives as
  // workoutTypeValueId=100 ("Other"), same bucket as a literal "Other" title, so it fell
  // through every classifier all the way to "unknown" (confirmed empirically: Denisova,
  // 2026-04-03). Cross-training equipment, not run/bike/swim/strength.
  const ellipticalMatch = includesAny(title, ["elliptical", "эллипс"]);
  if (ellipticalMatch) {
    return {
      family: "crosstrain",
      isRunning: false,
      confidence: "high",
      reason: `title matched elliptical keyword "${ellipticalMatch}"`,
    };
  }

  // Same root cause as elliptical, same fix: TP sends these as workoutTypeValueId=100
  // ("Other") with no dedicated type id, so nothing recognised them and they fell to
  // "unknown" — confirmed empirically across the full workout cache (Task: unknown-
  // activity sweep, 2026-07-14). "other" is deliberately NOT one of these keywords: a
  // literal "Other"/"Track Me" title carries no real activity signal to classify from.
  const namedActivityMatch = includesAny(title, [
    "yoga",
    "йога",
    "pilates",
    "пилатес",
    "cardio",
    "кардио",
    "jump rope",
    "скакалк",
    "ice skating",
    "коньк",
    "volleyball",
    "волейбол",
  ]);
  if (namedActivityMatch) {
    return {
      family: "crosstrain",
      isRunning: false,
      confidence: "high",
      reason: `title matched named-activity keyword "${namedActivityMatch}"`,
    };
  }

  return null;
}

/**
 * TrainingPeaks' own workoutTypeValueId -> sport. This is the AUTHORITATIVE
 * signal and it beats every title heuristic: TP knows what sport the athlete
 * logged, a Russian workout title is just prose.
 *
 * Mapping read off the real cache (1199 completed workouts, 105 athletes), not
 * guessed:
 *   1  -> swim       "Lap Swimming", "Open Water Swimming", "1800 м", "2 x 1000"
 *   2  -> bike       "Cycling", "Indoor/Road Cycling", "Вел по мощности",
 *                    "Длительный вел", and bike intervals like "2 х 18 / 3 мин"
 *   3  -> run        every running title
 *   9  -> strength   "Strength", "Силовая"
 *   13 -> walk_hike  "Walking", "Indoor Walking", "Hiking"
 *
 * 100 is DELIBERATELY ABSENT: it is TP's catch-all "Other" bucket and holds a
 * grab-bag of unrelated activities (Yoga, Pilates, Tennis, Soccer, Padel, Stand
 * Up Paddleboarding, Elliptical, Jump Rope, Hiit, Cardio). Mapping it to any one
 * family would be a lie, so it falls through to the title heuristics, which
 * resolve those correctly.
 *
 * WHY the ordering matters: previously only 3 and 9 were mapped, so a ride
 * (type 2) fell through to the title heuristics -- where "длительный" is a
 * RUNNING keyword. "Длительный вел" (a long BIKE ride) was therefore classified
 * as a run, sailed through the sport gate, and polluted aerobic_ef with cycling
 * speeds (0.042-0.067 against a genuine-run ceiling of 0.025). 11 of 33 rides
 * were mislabelled. The type id is not a hint to be overridden -- it is the
 * answer.
 */
const AUTHORITATIVE_TYPE_ID_TO_FAMILY: Record<number, TrainingPeaksWorkoutActivityFamily> = {
  1: "swim",
  2: "bike",
  3: "run",
  9: "strength",
  13: "walk_hike",
};

function classifyByAuthoritativeTypeId(
  workoutTypeValueId: number | null
): TrainingPeaksWorkoutActivityClassificationResult | null {
  if (workoutTypeValueId === null) {
    return null;
  }
  const family = AUTHORITATIVE_TYPE_ID_TO_FAMILY[workoutTypeValueId];
  if (!family) {
    return null;
  }
  return {
    family,
    isRunning: family === "run",
    confidence: "high",
    reason: `workoutTypeValueId=${workoutTypeValueId} (authoritative TrainingPeaks sport)`,
  };
}

function classifyByOfficialType(input: {
  sportOrTypeCode: string;
  workoutTypeValueId: number | null;
  workoutSubTypeId: number | null;
  sourceSnapshot: unknown;
}): TrainingPeaksWorkoutActivityClassificationResult | null {
  const { sportOrTypeCode, workoutTypeValueId, workoutSubTypeId, sourceSnapshot } = input;

  const authoritative = classifyByAuthoritativeTypeId(workoutTypeValueId);
  if (authoritative) {
    return authoritative;
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

  // The authoritative TP sport id comes FIRST -- ahead of every title heuristic,
  // including the padel/paddle/strength overrides below. A title can only decide
  // the sport when TP itself did not say (type 100 "Other", or no type at all).
  // Letting prose outrank the type id is exactly how "Длительный вел" became a
  // run.
  const authoritative = classifyByAuthoritativeTypeId(workoutTypeValueId);
  if (authoritative) {
    return authoritative;
  }

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
