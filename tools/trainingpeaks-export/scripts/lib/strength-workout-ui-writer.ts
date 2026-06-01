import path from "node:path";

export type StrengthWorkoutMetricType = "reps" | "duration";

export type StrengthWorkoutExerciseSpec = {
  name: string;
  sets: string;
  metricType: StrengthWorkoutMetricType;
  metricValue: string;
  notes?: string;
};

export type StrengthWorkoutBlockSpec = {
  name: string;
  exercises: StrengthWorkoutExerciseSpec[];
};

export type StrengthWorkoutTemplate = {
  id: string;
  title: string;
  workoutInstructions: string;
  blocks: StrengthWorkoutBlockSpec[];
};

export type WorkoutCatalogPreflight = {
  requestedNames: string[];
  presentNames: string[];
  missingNames: string[];
};

export type ExactVisibleResultDecision = {
  requestedName: string;
  exactVisibleMatches: string[];
  visibleTexts: string[];
  status: "exact" | "missing" | "ambiguous";
};

export type StrengthWorkoutRunSummary = {
  runAt: string;
  mode: "dry-run" | "apply";
  athleteUrlRedacted: string;
  targetDate: string;
  title: string;
  saveClicked: boolean;
  builderOpened: boolean;
  addBlockButtonFound: boolean;
  pickerSearchFound: boolean;
  localCatalogPreflight: WorkoutCatalogPreflight;
  attemptedExercises: Array<{
    blockName: string;
    name: string;
    sets: string;
    metricType: StrengthWorkoutMetricType;
    metricValue: string;
    notes?: string;
    selectionStatus: ExactVisibleResultDecision["status"] | "not_run";
    clicked: boolean;
    wouldClick?: boolean;
    added: boolean;
    visibleExactMatches: string[];
    visibleTextsSample: string[];
    inputValueAfterTyping?: string;
    candidateRows?: string[];
    fieldWrite: {
      sets: "yes" | "no" | "not_attempted";
      metric: "yes" | "no" | "not_attempted";
      notes: "yes" | "no" | "not_attempted";
    };
  }>;
  verification: {
    titleVisible: boolean;
    expectedExercisesVisible: string[];
    missingExercisesVisible: string[];
    visibleExerciseCount: number;
    unexpectedExerciseCheck: string;
    status: "passed" | "partial" | "failed" | "ready_for_apply";
  };
  screenshots: string[];
  warnings: string[];
  errors: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Fixture field "${fieldName}" must be a non-empty string.`);
  }
  return value.trim();
}

function parseExerciseSpec(value: unknown, index: number): StrengthWorkoutExerciseSpec {
  if (!isRecord(value)) {
    throw new Error(`Fixture exercise[${index}] must be an object.`);
  }

  const metricTypeRaw = requireNonEmptyString(value.metricType, `blocks[].exercises[${index}].metricType`);
  if (metricTypeRaw !== "reps" && metricTypeRaw !== "duration") {
    throw new Error(`Unsupported metricType "${metricTypeRaw}" in workout fixture.`);
  }

  const notesValue = value.notes;
  if (notesValue !== undefined && typeof notesValue !== "string") {
    throw new Error(`Fixture exercise notes at index ${index} must be a string when provided.`);
  }

  return {
    name: requireNonEmptyString(value.name, `blocks[].exercises[${index}].name`),
    sets: requireNonEmptyString(value.sets, `blocks[].exercises[${index}].sets`),
    metricType: metricTypeRaw,
    metricValue: requireNonEmptyString(value.metricValue, `blocks[].exercises[${index}].metricValue`),
    notes: typeof notesValue === "string" && notesValue.trim() ? notesValue.trim() : undefined,
  };
}

function parseBlockSpec(value: unknown, index: number): StrengthWorkoutBlockSpec {
  if (!isRecord(value)) {
    throw new Error(`Fixture block[${index}] must be an object.`);
  }
  const exercisesRaw = value.exercises;
  if (!Array.isArray(exercisesRaw) || exercisesRaw.length === 0) {
    throw new Error(`Fixture block[${index}] must include a non-empty exercises array.`);
  }

  return {
    name: requireNonEmptyString(value.name, `blocks[${index}].name`),
    exercises: exercisesRaw.map((exercise, exerciseIndex) => parseExerciseSpec(exercise, exerciseIndex)),
  };
}

export function parseStrengthWorkoutTemplate(payload: unknown): StrengthWorkoutTemplate {
  if (!isRecord(payload)) {
    throw new Error("Workout template fixture must be an object.");
  }

  const blocksRaw = payload.blocks;
  if (!Array.isArray(blocksRaw) || blocksRaw.length === 0) {
    throw new Error("Workout template fixture must include a non-empty blocks array.");
  }

  return {
    id: requireNonEmptyString(payload.id, "id"),
    title: requireNonEmptyString(payload.title, "title"),
    workoutInstructions: requireNonEmptyString(payload.workoutInstructions, "workoutInstructions"),
    blocks: blocksRaw.map((block, index) => parseBlockSpec(block, index)),
  };
}

export function flattenWorkoutExercises(template: StrengthWorkoutTemplate): Array<
  StrengthWorkoutExerciseSpec & { blockName: string }
> {
  return template.blocks.flatMap((block) =>
    block.exercises.map((exercise) => ({
      ...exercise,
      blockName: block.name,
    }))
  );
}

export function buildCatalogPreflight(
  template: StrengthWorkoutTemplate,
  renderedNames: readonly string[]
): WorkoutCatalogPreflight {
  const available = new Set(renderedNames.map((entry) => entry.trim()).filter(Boolean));
  const requestedNames = flattenWorkoutExercises(template).map((exercise) => exercise.name);
  const presentNames = requestedNames.filter((name) => available.has(name));
  const missingNames = requestedNames.filter((name) => !available.has(name));

  return {
    requestedNames,
    presentNames,
    missingNames,
  };
}

export function normalizeVisibleText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function decideExactVisibleResult(
  requestedName: string,
  visibleTexts: readonly string[]
): ExactVisibleResultDecision {
  const normalizedRequested = normalizeVisibleText(requestedName);
  const normalizedVisible = visibleTexts
    .map((entry) => normalizeVisibleText(entry))
    .filter(Boolean);

  const exactVisibleMatches = normalizedVisible.filter((entry) => entry === normalizedRequested);

  if (exactVisibleMatches.length === 1) {
    return {
      requestedName,
      exactVisibleMatches,
      visibleTexts: normalizedVisible,
      status: "exact",
    };
  }

  if (exactVisibleMatches.length > 1) {
    return {
      requestedName,
      exactVisibleMatches,
      visibleTexts: normalizedVisible,
      status: "ambiguous",
    };
  }

  return {
    requestedName,
    exactVisibleMatches: [],
    visibleTexts: normalizedVisible,
    status: "missing",
  };
}

export function sanitizeAthleteUrl(inputUrl: string): string {
  return inputUrl
    .replace(/\/athletes\/\d+/gi, "/athletes/<ATHLETE_ID>")
    .replace(/\bathleteId=\d+\b/gi, "athleteId=<ATHLETE_ID>")
    .replace(/\/workouts\/\d+/gi, "/workouts/<WORKOUT_ID>");
}

export function relativizeArtifactPath(repoRoot: string, absolutePath: string): string {
  const relative = path.relative(repoRoot, absolutePath);
  if (!relative || relative.startsWith("..")) {
    return absolutePath;
  }
  return relative;
}

export function buildStrengthWorkoutSummaryMarkdown(summary: StrengthWorkoutRunSummary): string {
  const lines: string[] = [];
  lines.push("# TrainingPeaks test strength workout probe");
  lines.push("");
  lines.push("## Run");
  lines.push(`- Run at: ${summary.runAt}`);
  lines.push(`- Mode: ${summary.mode}`);
  lines.push(`- Athlete: \`${summary.athleteUrlRedacted}\``);
  lines.push(`- Target date: ${summary.targetDate}`);
  lines.push(`- Title: ${summary.title}`);
  lines.push(`- Save clicked: ${summary.saveClicked ? "yes" : "no"}`);
  lines.push("");
  lines.push("## UI readiness");
  lines.push(`- Builder opened: ${summary.builderOpened ? "yes" : "no"}`);
  lines.push(`- Add Block found: ${summary.addBlockButtonFound ? "yes" : "no"}`);
  lines.push(`- Picker search found: ${summary.pickerSearchFound ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Local catalog preflight");
  lines.push(`- Requested exercises: ${summary.localCatalogPreflight.requestedNames.length}`);
  lines.push(`- Present in rendered catalog: ${summary.localCatalogPreflight.presentNames.length}`);
  lines.push(`- Missing in rendered catalog: ${summary.localCatalogPreflight.missingNames.length}`);
  if (summary.localCatalogPreflight.missingNames.length > 0) {
    for (const name of summary.localCatalogPreflight.missingNames) {
      lines.push(`- Missing local catalog exact name: ${name}`);
    }
  }
  lines.push("");
  lines.push("## Exercise attempts");
  for (const exercise of summary.attemptedExercises) {
    lines.push(
      `- [${exercise.blockName}] ${exercise.name}: selection=${exercise.selectionStatus}, clicked=${exercise.clicked ? "yes" : "no"}, added=${exercise.added ? "yes" : "no"}, sets=${exercise.fieldWrite.sets}, metric=${exercise.fieldWrite.metric}, notes=${exercise.fieldWrite.notes}`
    );
    if (exercise.inputValueAfterTyping) {
      lines.push(`  inputValueAfterTyping=${exercise.inputValueAfterTyping}`);
    }
    if (exercise.candidateRows && exercise.candidateRows.length > 0) {
      lines.push(`  candidateRows=${exercise.candidateRows.slice(0, 8).join(" | ")}`);
    }
  }
  lines.push("");
  lines.push("## Verification");
  lines.push(`- Status: ${summary.verification.status}`);
  lines.push(`- Title visible: ${summary.verification.titleVisible ? "yes" : "no"}`);
  lines.push(`- Visible expected exercises: ${summary.verification.expectedExercisesVisible.length}`);
  lines.push(`- Missing visible exercises: ${summary.verification.missingExercisesVisible.length}`);
  lines.push(`- Visible exercise count: ${summary.verification.visibleExerciseCount}`);
  lines.push(`- Unexpected exercise check: ${summary.verification.unexpectedExerciseCheck}`);
  if (summary.verification.missingExercisesVisible.length > 0) {
    for (const missing of summary.verification.missingExercisesVisible) {
      lines.push(`- Missing on verification: ${missing}`);
    }
  }
  if (summary.warnings.length > 0) {
    lines.push("");
    lines.push("## Warnings");
    for (const warning of summary.warnings) {
      lines.push(`- ${warning}`);
    }
  }
  if (summary.errors.length > 0) {
    lines.push("");
    lines.push("## Errors");
    for (const error of summary.errors) {
      lines.push(`- ${error}`);
    }
  }
  if (summary.screenshots.length > 0) {
    lines.push("");
    lines.push("## Screenshots");
    for (const screenshot of summary.screenshots) {
      lines.push(`- \`${screenshot}\``);
    }
  }
  return `${lines.join("\n")}\n`;
}
