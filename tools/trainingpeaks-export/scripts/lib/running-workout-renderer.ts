export type RunningWorkoutIntensityMetric = "percentOfThresholdPace" | "percentOfThresholdHr";

export type RunningWorkoutTarget = {
  metric: RunningWorkoutIntensityMetric;
  minValue: number;
  maxValue: number;
};

export type RunningWorkoutStep = {
  kind: "step";
  label: string;
  durationSeconds: number;
  intensityClass: "active" | "warmup" | "cooldown" | "recovery";
  target: RunningWorkoutTarget;
  notes?: string;
};

export type RunningWorkoutRepetition = {
  kind: "repetition";
  repeatCount: number;
  steps: RunningWorkoutStep[];
};

export type RunningWorkoutCaseId = "easy-pace" | "easy-hr" | "interval-pace" | "interval-hr";

export type RunningWorkoutDefinition = {
  caseId: RunningWorkoutCaseId;
  title: string;
  description: string;
  athleteId: number;
  workoutDay: string;
  workoutTypeValueId: number;
  workoutSubTypeId?: number | null;
  coachComments?: string | null;
  distancePlanned?: number | null;
  blocks: Array<RunningWorkoutStep | RunningWorkoutRepetition>;
};

type TpLength = { value: number; unit: "second" | "repetition" };
type TpTarget = { minValue: number; maxValue: number };
type TpStepNode = {
  name: string;
  length: TpLength;
  targets: TpTarget[];
  intensityClass: "active" | "warmUp" | "coolDown" | "rest";
  openDuration: false;
  notes?: string;
};
type TpTopLevelStepNode = {
  type: "step";
  length: { value: 1; unit: "repetition" };
  steps: [TpStepNode];
  begin: number;
  end: number;
};
type TpRepetitionNode = {
  type: "repetition";
  length: { value: number; unit: "repetition" };
  steps: Array<TpStepNode & { type: "step" }>;
  begin: number;
  end: number;
};
type TpStructureNode = TpTopLevelStepNode | TpRepetitionNode;

export type RunningWorkoutRenderedStructure = {
  structure: TpStructureNode[];
  polyline: Array<[number, number]>;
  primaryLengthMetric: "duration";
  primaryIntensityMetric: RunningWorkoutIntensityMetric;
  primaryIntensityTargetOrRange: "range";
};

export type RunningWorkoutPayloadPreview = {
  athleteId: number;
  workoutDay: string;
  workoutId: 0;
  title: string;
  description: string;
  workoutTypeValueId: number;
  workoutSubTypeId: number | null;
  totalTimePlanned: number;
  distancePlanned: number | null;
  coachComments: string | null;
  structure: RunningWorkoutRenderedStructure;
  structureSerialized: string;
};

function mapIntensityClass(
  value: RunningWorkoutStep["intensityClass"]
): "active" | "warmUp" | "coolDown" | "rest" {
  if (value === "warmup") return "warmUp";
  if (value === "cooldown") return "coolDown";
  if (value === "recovery") return "rest";
  return "active";
}

function renderStep(step: RunningWorkoutStep): TpStepNode {
  return {
    name: step.label,
    length: { value: step.durationSeconds, unit: "second" },
    targets: [{ minValue: step.target.minValue, maxValue: step.target.maxValue }],
    intensityClass: mapIntensityClass(step.intensityClass),
    openDuration: false,
    notes: step.notes,
  };
}

function sumStepDurationsSeconds(steps: RunningWorkoutStep[]): number {
  return steps.reduce((acc, step) => acc + step.durationSeconds, 0);
}

function intensityHeight(step: TpStepNode): number {
  const target = step.targets[0];
  if (!target) return 0;
  const maxValue = target.maxValue;
  return Number((Math.min(1, maxValue / 115)).toFixed(3));
}

function buildPolyline(structure: TpStructureNode[]): Array<[number, number]> {
  const totalSeconds = structure.length === 0 ? 0 : structure[structure.length - 1].end;
  if (totalSeconds <= 0) {
    return [
      [0, 0],
      [1, 0],
    ];
  }

  const points: Array<[number, number]> = [[0, 0]];
  for (const block of structure) {
    if (block.type === "step") {
      const step = block.steps[0];
      const start = Number((block.begin / totalSeconds).toFixed(3));
      const end = Number((block.end / totalSeconds).toFixed(3));
      const y = intensityHeight(step);
      points.push([start, y], [end, y], [end, 0]);
      continue;
    }

    const blockDuration = block.end - block.begin;
    const singleRepeatSeconds =
      block.length.value > 0 ? blockDuration / block.length.value : sumStepDurationsSeconds(block.steps);
    let cursor = block.begin;
    for (let repeatIndex = 0; repeatIndex < block.length.value; repeatIndex += 1) {
      for (const step of block.steps) {
        const start = Number((cursor / totalSeconds).toFixed(3));
        const end = Number(((cursor + step.length.value) / totalSeconds).toFixed(3));
        const y = intensityHeight(step);
        points.push([start, y], [end, y], [end, 0]);
        cursor += step.length.value;
      }
      if (singleRepeatSeconds > 0 && cursor < block.begin + (repeatIndex + 1) * singleRepeatSeconds) {
        cursor = block.begin + (repeatIndex + 1) * singleRepeatSeconds;
      }
    }
  }
  return points;
}

export function renderRunningWorkoutPayloadPreview(definition: RunningWorkoutDefinition): RunningWorkoutPayloadPreview {
  if (definition.blocks.length === 0) {
    throw new Error(`Workout ${definition.caseId} has no blocks.`);
  }

  let secondsCursor = 0;
  let primaryMetric: RunningWorkoutIntensityMetric | null = null;
  const structure: TpStructureNode[] = [];

  for (const block of definition.blocks) {
    if (block.kind === "step") {
      const renderedStep = renderStep(block);
      primaryMetric ??= block.target.metric;
      if (primaryMetric !== block.target.metric) {
        throw new Error(`Mixed intensity metrics in workout ${definition.caseId} are not supported.`);
      }
      const begin = secondsCursor;
      const end = begin + block.durationSeconds;
      structure.push({
        type: "step",
        length: { value: 1, unit: "repetition" },
        steps: [renderedStep],
        begin,
        end,
      });
      secondsCursor = end;
      continue;
    }

    if (block.repeatCount <= 0) {
      throw new Error(`Repetition block in ${definition.caseId} must have repeatCount > 0.`);
    }
    if (block.steps.length === 0) {
      throw new Error(`Repetition block in ${definition.caseId} must have at least one step.`);
    }

    const renderedSteps = block.steps.map((step) => {
      primaryMetric ??= step.target.metric;
      if (primaryMetric !== step.target.metric) {
        throw new Error(`Mixed intensity metrics in workout ${definition.caseId} are not supported.`);
      }
      return { ...renderStep(step), type: "step" as const };
    });

    const oneRepeatSeconds = sumStepDurationsSeconds(block.steps);
    const begin = secondsCursor;
    const end = begin + oneRepeatSeconds * block.repeatCount;
    structure.push({
      type: "repetition",
      length: { value: block.repeatCount, unit: "repetition" },
      steps: renderedSteps,
      begin,
      end,
    });
    secondsCursor = end;
  }

  if (!primaryMetric) {
    throw new Error(`Workout ${definition.caseId} has no intensity metric.`);
  }

  const renderedStructure: RunningWorkoutRenderedStructure = {
    structure,
    polyline: buildPolyline(structure),
    primaryLengthMetric: "duration",
    primaryIntensityMetric: primaryMetric,
    primaryIntensityTargetOrRange: "range",
  };

  return {
    athleteId: definition.athleteId,
    workoutDay: definition.workoutDay,
    workoutId: 0,
    title: definition.title,
    description: definition.description,
    workoutTypeValueId: definition.workoutTypeValueId,
    workoutSubTypeId: definition.workoutSubTypeId ?? null,
    totalTimePlanned: secondsCursor / 3600,
    distancePlanned: definition.distancePlanned ?? null,
    coachComments: definition.coachComments ?? null,
    structure: renderedStructure,
    structureSerialized: JSON.stringify(renderedStructure),
  };
}

export function buildRunningWorkoutFixtureAlignedDefinitions(): RunningWorkoutDefinition[] {
  return [
    {
      caseId: "easy-pace",
      title: "API STRUCTURE TEST EASY PACE DO NOT USE",
      description: "DESC_MARKER_EASY_PACE",
      athleteId: 3102415,
      workoutDay: "2026-06-03",
      workoutTypeValueId: 3,
      workoutSubTypeId: null,
      blocks: [
        {
          kind: "step",
          label: "Active",
          durationSeconds: 1800,
          intensityClass: "active",
          target: { metric: "percentOfThresholdPace", minValue: 75, maxValue: 85 },
          notes: "STEP_NOTE_EASY_PACE",
        },
      ],
    },
    {
      caseId: "easy-hr",
      title: "API STRUCTURE TEST EASY HR DO NOT USE",
      description: "DESC_MARKER_EASY_HR",
      athleteId: 3102415,
      workoutDay: "2026-06-08",
      workoutTypeValueId: 3,
      workoutSubTypeId: null,
      blocks: [
        {
          kind: "step",
          label: "Active",
          durationSeconds: 1800,
          intensityClass: "active",
          target: { metric: "percentOfThresholdHr", minValue: 70, maxValue: 80 },
          notes: "STEP_NOTE_EASY_HR",
        },
      ],
    },
    {
      caseId: "interval-pace",
      title: "API STRUCTURE TEST INTERVAL PACE DO NOT USE",
      description: "DESC_MARKER_INTERVAL_PACE",
      athleteId: 3102415,
      workoutDay: "2026-06-03",
      workoutTypeValueId: 3,
      workoutSubTypeId: null,
      blocks: [
        {
          kind: "step",
          label: "Warm up",
          durationSeconds: 600,
          intensityClass: "warmup",
          target: { metric: "percentOfThresholdPace", minValue: 75, maxValue: 85 },
          notes: "STEP_NOTE_WARMUP_PACE",
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
              target: { metric: "percentOfThresholdPace", minValue: 105, maxValue: 115 },
              notes: "STEP_NOTE_WORK_PACE",
            },
            {
              kind: "step",
              label: "Easy",
              durationSeconds: 180,
              intensityClass: "recovery",
              target: { metric: "percentOfThresholdPace", minValue: 75, maxValue: 85 },
              notes: "STEP_NOTE_RECOVERY_PACE",
            },
          ],
        },
        {
          kind: "step",
          label: "Cool down",
          durationSeconds: 600,
          intensityClass: "cooldown",
          target: { metric: "percentOfThresholdPace", minValue: 75, maxValue: 85 },
          notes: "STEP_NOTE_COOLDOWN_PACE",
        },
      ],
    },
    {
      caseId: "interval-hr",
      title: "API STRUCTURE TEST INTERVAL HR DO NOT USE",
      description: "DESC_MARKER_INTERVAL_HR",
      athleteId: 3102415,
      workoutDay: "2026-06-02",
      workoutTypeValueId: 3,
      workoutSubTypeId: null,
      blocks: [
        {
          kind: "step",
          label: "Warm up",
          durationSeconds: 1200,
          intensityClass: "warmup",
          target: { metric: "percentOfThresholdHr", minValue: 70, maxValue: 80 },
          notes: "STEP_NOTE_WARMUP_HR",
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
              target: { metric: "percentOfThresholdHr", minValue: 90, maxValue: 95 },
              notes: "STEP_NOTE_WORK_HR",
            },
            {
              kind: "step",
              label: "Easy",
              durationSeconds: 180,
              intensityClass: "recovery",
              target: { metric: "percentOfThresholdHr", minValue: 70, maxValue: 80 },
              notes: "STEP_NOTE_RECOVERY_HR",
            },
          ],
        },
        {
          kind: "step",
          label: "Cool down",
          durationSeconds: 600,
          intensityClass: "cooldown",
          target: { metric: "percentOfThresholdHr", minValue: 70, maxValue: 80 },
          notes: "STEP_NOTE_COOLDOWN_HR",
        },
      ],
    },
  ];
}
