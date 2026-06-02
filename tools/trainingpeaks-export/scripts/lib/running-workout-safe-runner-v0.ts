import { type RunningWorkoutDefinition, type RunningWorkoutStep } from "./running-workout-renderer.ts";

export type RunningWorkoutTemplateId = "easy-pace" | "easy-hr" | "interval-pace" | "interval-hr";

export type RunningWorkoutVerificationSpec = {
  primaryMetric: "percentOfThresholdPace" | "percentOfThresholdHr";
  requireRepetition: boolean;
  repeatCount: number | null;
  requiredRanges: Array<{
    minValue: number;
    maxValue: number;
    matchName?: string;
    matchIntensityClass?: string;
  }>;
  requiredStepNames: string[];
  requiredStepNoteMarkers: string[];
};

export type RunningWorkoutTemplateSpec = {
  template: RunningWorkoutTemplateId;
  blocks: RunningWorkoutDefinition["blocks"];
  verification: RunningWorkoutVerificationSpec;
};

export const SAFE_RUNNING_WORKOUT_MARKER = "SAFE_RUN_WORKOUT_V0";
export const SAFE_RUNNING_WORKOUT_CONFIRM_PHRASE = "CREATE SAFE RUN WORKOUT";
export const SAFE_RUNNING_WORKOUT_ATHLETE_ID = 3102415;

const EASY_PACE_NOTE = `${SAFE_RUNNING_WORKOUT_MARKER}_STEP_NOTE_EASY_PACE`;
const EASY_HR_NOTE = `${SAFE_RUNNING_WORKOUT_MARKER}_STEP_NOTE_EASY_HR`;
const INTERVAL_PACE_WARMUP_NOTE = `${SAFE_RUNNING_WORKOUT_MARKER}_STEP_NOTE_INTERVAL_PACE_WARMUP`;
const INTERVAL_PACE_HARD_NOTE = `${SAFE_RUNNING_WORKOUT_MARKER}_STEP_NOTE_INTERVAL_PACE_HARD`;
const INTERVAL_PACE_EASY_NOTE = `${SAFE_RUNNING_WORKOUT_MARKER}_STEP_NOTE_INTERVAL_PACE_EASY`;
const INTERVAL_PACE_COOLDOWN_NOTE = `${SAFE_RUNNING_WORKOUT_MARKER}_STEP_NOTE_INTERVAL_PACE_COOLDOWN`;
const INTERVAL_HR_WARMUP_NOTE = `${SAFE_RUNNING_WORKOUT_MARKER}_STEP_NOTE_INTERVAL_HR_WARMUP`;
const INTERVAL_HR_HARD_NOTE = `${SAFE_RUNNING_WORKOUT_MARKER}_STEP_NOTE_INTERVAL_HR_HARD`;
const INTERVAL_HR_EASY_NOTE = `${SAFE_RUNNING_WORKOUT_MARKER}_STEP_NOTE_INTERVAL_HR_EASY`;
const INTERVAL_HR_COOLDOWN_NOTE = `${SAFE_RUNNING_WORKOUT_MARKER}_STEP_NOTE_INTERVAL_HR_COOLDOWN`;

export const SAFE_RUNNING_WORKOUT_TEMPLATES: Record<RunningWorkoutTemplateId, RunningWorkoutTemplateSpec> = {
  "easy-pace": {
    template: "easy-pace",
    blocks: [
      {
        kind: "step",
        label: "Active",
        durationSeconds: 1800,
        intensityClass: "active",
        target: {
          metric: "percentOfThresholdPace",
          minValue: 75,
          maxValue: 85,
        },
        notes: EASY_PACE_NOTE,
      },
    ],
    verification: {
      primaryMetric: "percentOfThresholdPace",
      requireRepetition: false,
      repeatCount: null,
      requiredRanges: [{ minValue: 75, maxValue: 85, matchName: "Active" }],
      requiredStepNames: ["Active"],
      requiredStepNoteMarkers: [EASY_PACE_NOTE],
    },
  },
  "easy-hr": {
    template: "easy-hr",
    blocks: [
      {
        kind: "step",
        label: "Active",
        durationSeconds: 1800,
        intensityClass: "active",
        target: {
          metric: "percentOfThresholdHr",
          minValue: 70,
          maxValue: 80,
        },
        notes: EASY_HR_NOTE,
      },
    ],
    verification: {
      primaryMetric: "percentOfThresholdHr",
      requireRepetition: false,
      repeatCount: null,
      requiredRanges: [{ minValue: 70, maxValue: 80, matchName: "Active" }],
      requiredStepNames: ["Active"],
      requiredStepNoteMarkers: [EASY_HR_NOTE],
    },
  },
  "interval-pace": {
    template: "interval-pace",
    blocks: [
      {
        kind: "step",
        label: "Warm up",
        durationSeconds: 600,
        intensityClass: "warmup",
        target: {
          metric: "percentOfThresholdPace",
          minValue: 75,
          maxValue: 85,
        },
        notes: INTERVAL_PACE_WARMUP_NOTE,
      },
      {
        kind: "repetition",
        repeatCount: 4,
        steps: [
          {
            kind: "step",
            label: "Hard",
            durationSeconds: 360,
            intensityClass: "active",
            target: {
              metric: "percentOfThresholdPace",
              minValue: 105,
              maxValue: 115,
            },
            notes: INTERVAL_PACE_HARD_NOTE,
          },
          {
            kind: "step",
            label: "Easy",
            durationSeconds: 180,
            intensityClass: "recovery",
            target: {
              metric: "percentOfThresholdPace",
              minValue: 75,
              maxValue: 85,
            },
            notes: INTERVAL_PACE_EASY_NOTE,
          },
        ],
      },
      {
        kind: "step",
        label: "Cool down",
        durationSeconds: 600,
        intensityClass: "cooldown",
        target: {
          metric: "percentOfThresholdPace",
          minValue: 75,
          maxValue: 85,
        },
        notes: INTERVAL_PACE_COOLDOWN_NOTE,
      },
    ],
    verification: {
      primaryMetric: "percentOfThresholdPace",
      requireRepetition: true,
      repeatCount: 4,
      requiredRanges: [
        { minValue: 105, maxValue: 115, matchName: "Hard" },
        { minValue: 75, maxValue: 85, matchName: "Warm up" },
        { minValue: 75, maxValue: 85, matchName: "Easy" },
        { minValue: 75, maxValue: 85, matchName: "Cool down" },
      ],
      requiredStepNames: ["Warm up", "Hard", "Easy", "Cool down"],
      requiredStepNoteMarkers: [
        INTERVAL_PACE_WARMUP_NOTE,
        INTERVAL_PACE_HARD_NOTE,
        INTERVAL_PACE_EASY_NOTE,
        INTERVAL_PACE_COOLDOWN_NOTE,
      ],
    },
  },
  "interval-hr": {
    template: "interval-hr",
    blocks: [
      {
        kind: "step",
        label: "Warm up",
        durationSeconds: 1200,
        intensityClass: "warmup",
        target: {
          metric: "percentOfThresholdHr",
          minValue: 70,
          maxValue: 80,
        },
        notes: INTERVAL_HR_WARMUP_NOTE,
      },
      {
        kind: "repetition",
        repeatCount: 4,
        steps: [
          {
            kind: "step",
            label: "Hard",
            durationSeconds: 300,
            intensityClass: "active",
            target: {
              metric: "percentOfThresholdHr",
              minValue: 90,
              maxValue: 95,
            },
            notes: INTERVAL_HR_HARD_NOTE,
          },
          {
            kind: "step",
            label: "Easy",
            durationSeconds: 180,
            intensityClass: "recovery",
            target: {
              metric: "percentOfThresholdHr",
              minValue: 70,
              maxValue: 80,
            },
            notes: INTERVAL_HR_EASY_NOTE,
          },
        ],
      },
      {
        kind: "step",
        label: "Cool down",
        durationSeconds: 600,
        intensityClass: "cooldown",
        target: {
          metric: "percentOfThresholdHr",
          minValue: 70,
          maxValue: 80,
        },
        notes: INTERVAL_HR_COOLDOWN_NOTE,
      },
    ],
    verification: {
      primaryMetric: "percentOfThresholdHr",
      requireRepetition: true,
      repeatCount: 4,
      requiredRanges: [
        { minValue: 90, maxValue: 95, matchName: "Hard" },
        { minValue: 70, maxValue: 80, matchName: "Warm up" },
        { minValue: 70, maxValue: 80, matchName: "Easy" },
        { minValue: 70, maxValue: 80, matchName: "Cool down" },
      ],
      requiredStepNames: ["Warm up", "Hard", "Easy", "Cool down"],
      requiredStepNoteMarkers: [
        INTERVAL_HR_WARMUP_NOTE,
        INTERVAL_HR_HARD_NOTE,
        INTERVAL_HR_EASY_NOTE,
        INTERVAL_HR_COOLDOWN_NOTE,
      ],
    },
  },
};

const TEMPLATE_IDS = Object.keys(SAFE_RUNNING_WORKOUT_TEMPLATES) as RunningWorkoutTemplateId[];

export function listSafeRunningWorkoutTemplates(): RunningWorkoutTemplateId[] {
  return TEMPLATE_IDS;
}

export function isRunningWorkoutTemplateId(value: string): value is RunningWorkoutTemplateId {
  return TEMPLATE_IDS.includes(value as RunningWorkoutTemplateId);
}

export function templateLabelForTitle(template: RunningWorkoutTemplateId): string {
  return template.replace(/-/g, " ").toUpperCase();
}

export function buildSafeRunnerDefaultContent(template: RunningWorkoutTemplateId): {
  title: string;
  description: string;
  coachComments: string;
} {
  const templateLabel = templateLabelForTitle(template);
  return {
    title: `SAFE RUN WORKOUT V0 - ${templateLabel} - DO NOT USE - ${SAFE_RUNNING_WORKOUT_MARKER}`,
    description: `${SAFE_RUNNING_WORKOUT_MARKER}\nTEMPLATE=${template}\nDO_NOT_USE`,
    coachComments: `${SAFE_RUNNING_WORKOUT_MARKER}\nTEMPLATE=${template}\nDO_NOT_USE`,
  };
}

export function buildSafeRunningWorkoutDefinition(input: {
  template: RunningWorkoutTemplateId;
  athleteId: number;
  workoutDay: string;
  title: string;
  description: string;
  coachComments: string;
}): RunningWorkoutDefinition {
  const spec = SAFE_RUNNING_WORKOUT_TEMPLATES[input.template];
  return {
    caseId: input.template,
    athleteId: input.athleteId,
    workoutDay: input.workoutDay,
    title: input.title,
    description: input.description,
    coachComments: input.coachComments,
    workoutTypeValueId: 3,
    workoutSubTypeId: null,
    blocks: spec.blocks,
  };
}

export function flattenStepNoteMarkers(blocks: RunningWorkoutDefinition["blocks"]): string[] {
  const notes: string[] = [];
  for (const block of blocks) {
    if (block.kind === "step") {
      pushIfString(notes, block.notes);
      continue;
    }
    for (const nestedStep of block.steps) {
      pushIfString(notes, nestedStep.notes);
    }
  }
  return notes;
}

function pushIfString(target: string[], value: RunningWorkoutStep["notes"]): void {
  if (typeof value === "string" && value.trim().length > 0) {
    target.push(value);
  }
}
