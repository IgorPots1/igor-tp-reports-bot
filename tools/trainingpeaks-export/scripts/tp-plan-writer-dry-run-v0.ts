import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { buildRunningWorkoutCreatePlan } from "./lib/running-workout-create-plan.ts";
import { toolRoot } from "./lib/paths.ts";
import { buildSafeRunningWorkoutDefinition, type RunningWorkoutTemplateId } from "./lib/running-workout-safe-runner-v0.ts";

type DraftStatus = "draft_ready_for_coach_review" | "draft_invalid_needs_fix" | "draft_blocked_by_readiness";
type DraftWorkoutType = "easy_run" | "controlled_quality" | "long_easy_run";
type WriterStatus =
  | "writer_dry_run_ready_for_review"
  | "blocked_by_draft_readiness"
  | "blocked_by_draft_guardrails";

type CliArgs = {
  draftDir: string;
  athleteId: number | null;
  weekStart: string | null;
  json: boolean;
};

type DraftWorkout = {
  date: string;
  day_of_week: string;
  workout_type: DraftWorkoutType;
  title: string;
  duration_minutes: number;
  intensity_target: string;
  coach_notes: string;
  guardrail_notes: string;
};

type PlanDraftJson = {
  generated_at: string;
  mode: "draft-only";
  read_only: true;
  no_db_writes: true;
  no_trainingpeaks_mutations: true;
  no_telegram_sends: true;
  athlete: {
    name: string;
    athlete_id: number;
    student_id: string;
  };
  week: {
    week_start: string;
    week_end: string;
  };
  status: DraftStatus;
  readiness: {
    blocking_reasons: string[];
  };
  workouts: DraftWorkout[];
  planned: {
    run_count: number;
    weekly_minutes: number;
    quality_session_count: number;
  };
  guardrail_check: Record<
    string,
    {
      ok: boolean;
      value?: number;
      cap?: number | null;
      details?: string;
    }
  >;
};

type SafetyCheck = {
  name: string;
  ok: boolean;
  details: string;
};

type WorkoutPreviewRow = {
  index: number;
  date: string;
  draft_workout_type: DraftWorkoutType;
  template: RunningWorkoutTemplateId;
  writer_action: "preview_create" | "writer_preview_needs_manual_review";
  writer_review_reason: string | null;
  title: string;
  duration_minutes: number;
  total_time_planned_hours: number | null;
  primary_intensity_metric: string | null;
  repeat_block_count: number | null;
  description: string;
  coach_comments: string;
  safety_markers: string[];
  create_payload_candidate: ReturnType<typeof buildRunningWorkoutCreatePlan>["requestBodyCandidate"] | null;
};

type WriterDryRunJson = {
  generated_at: string;
  mode: "writer-dry-run-only";
  read_only: true;
  no_db_writes: true;
  no_trainingpeaks_mutations: true;
  no_telegram_sends: true;
  source_draft_dir: string;
  athlete: {
    name: string;
    athlete_id: number;
    student_id: string;
  };
  week: {
    week_start: string;
    week_end: string;
  };
  writer_status: WriterStatus;
  payload_count: number;
  payloads_needing_manual_review: number;
  safety_markers: string[];
  safety_checks: SafetyCheck[];
  workouts: WorkoutPreviewRow[];
  blocked_reasons: string[];
  controlled_quality_structure_v0: {
    warmup: string;
    main_set: string;
    cooldown: string;
    intensity: string;
  };
};

const EXPECTED_ATHLETE_ID = 5905779;
const EXPECTED_WEEK_START = "2026-06-08";
const CONTROLLED_QUALITY_DURATION_V0_MINUTES = 55;

function timestampForPath(date: Date): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function validateIsoDate(value: string, argName: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ${argName}. Expected YYYY-MM-DD.`);
  }
  return value;
}

function parseAthleteId(value: string, argName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${argName}. Expected positive integer.`);
  }
  return parsed;
}

function readRequiredNextArg(argv: string[], index: number, flag: string): string {
  const next = argv[index + 1];
  if (!next) {
    throw new Error(`Missing value after ${flag}`);
  }
  const trimmed = next.trim();
  if (!trimmed) {
    throw new Error(`Empty value after ${flag}`);
  }
  return trimmed;
}

function printHelp(): void {
  console.log("TrainingPeaks Plan Writer Dry Run v0");
  console.log("");
  console.log("Usage:");
  console.log(
    "  npx tsx tools/trainingpeaks-export/scripts/tp-plan-writer-dry-run-v0.ts --draft-dir reports/plan-draft-generator-v0/20260606-103144",
  );
  console.log("");
  console.log("Optional:");
  console.log("  --athlete-id 5905779");
  console.log("  --week-start 2026-06-08");
  console.log("  --json");
  console.log("");
  console.log("Safety:");
  console.log("  - no DB writes");
  console.log("  - no TrainingPeaks mutations");
  console.log("  - no Telegram sends");
  console.log("  - local payload preview only");
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    draftDir: "",
    athleteId: null,
    weekStart: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith("--draft-dir=")) {
      parsed.draftDir = arg.slice("--draft-dir=".length).trim();
      continue;
    }
    if (arg === "--draft-dir") {
      parsed.draftDir = readRequiredNextArg(argv, index, "--draft-dir");
      index += 1;
      continue;
    }
    if (arg.startsWith("--athlete-id=")) {
      parsed.athleteId = parseAthleteId(arg.slice("--athlete-id=".length).trim(), "--athlete-id");
      continue;
    }
    if (arg === "--athlete-id") {
      parsed.athleteId = parseAthleteId(readRequiredNextArg(argv, index, "--athlete-id"), "--athlete-id");
      index += 1;
      continue;
    }
    if (arg.startsWith("--week-start=")) {
      parsed.weekStart = validateIsoDate(arg.slice("--week-start=".length).trim(), "--week-start");
      continue;
    }
    if (arg === "--week-start") {
      parsed.weekStart = validateIsoDate(readRequiredNextArg(argv, index, "--week-start"), "--week-start");
      index += 1;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.draftDir) {
    throw new Error("Missing --draft-dir.");
  }
  return parsed;
}

function loadJson<T>(filePath: string): T {
  if (!existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function quoteCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function listToCsv(rows: string[][]): string {
  return `${rows.map((row) => row.map((cell) => quoteCsv(cell)).join(",")).join("\n")}\n`;
}

function allGuardrailsPass(guardrail: PlanDraftJson["guardrail_check"]): boolean {
  return Object.values(guardrail).every((entry) => entry.ok === true);
}

function buildSafetyMarkers(sourceDraftDir: string, athleteId: number): string[] {
  return [
    "PLAN_DRAFT_WRITER_DRY_RUN_V0",
    "NO_TP_WRITE",
    `SOURCE_DRAFT_DIR=${sourceDraftDir}`,
    `ATHLETE_ID=${athleteId}`,
  ];
}

function buildMappedWorkout(input: {
  workout: DraftWorkout;
  athleteId: number;
  safetyMarkers: string[];
}): WorkoutPreviewRow {
  const { workout, athleteId, safetyMarkers } = input;
  let template: RunningWorkoutTemplateId;
  let title: string;
  let description: string;
  let coachComments: string;
  let manualReview: string | null = null;

  if (workout.workout_type === "easy_run") {
    template = "easy-hr";
    title = `Легкий бег ${workout.duration_minutes} мин`;
    description = [
      "Спокойный аэробный бег.",
      "Ориентир: легко, без борьбы за темп.",
      "Если самочувствие хуже обычного — сократить или написать тренеру.",
      "",
      ...safetyMarkers,
      "DRAFT_WORKOUT_TYPE=easy_run",
    ].join("\n");
    coachComments = [
      "Спокойный аэробный бег.",
      "Ориентир: легко, без борьбы за темп.",
      "Если самочувствие хуже обычного — сократить или написать тренеру.",
      "",
      ...safetyMarkers,
      "DRAFT_WORKOUT_TYPE=easy_run",
    ].join("\n");
  } else if (workout.workout_type === "long_easy_run") {
    template = "easy-hr";
    title = `Длительный легкий бег ${workout.duration_minutes} мин`;
    description = [
      "Ровный легкий бег.",
      "Главная задача — объем без форсирования.",
      "Последние 10–15 минут не ускоряться, если нет отдельной команды тренера.",
      "",
      ...safetyMarkers,
      "DRAFT_WORKOUT_TYPE=long_easy_run",
    ].join("\n");
    coachComments = [
      "Ровный легкий бег.",
      "Главная задача — объем без форсирования.",
      "Последние 10–15 минут не ускоряться, если нет отдельной команды тренера.",
      "",
      ...safetyMarkers,
      "DRAFT_WORKOUT_TYPE=long_easy_run",
    ].join("\n");
  } else {
    template = "interval-hr";
    title = "Контрольная работа 3 x 6 мин";
    description = [
      "Разминка: 10 мин легко.",
      "Основная часть: 3 x 6 мин контролируемо, между отрезками 3 мин легко.",
      "Заминка: 10–12 мин легко.",
      "Интенсивность: controlled, RPE 6–7/10, без VO2 и без all-out.",
      "",
      ...safetyMarkers,
      "DRAFT_WORKOUT_TYPE=controlled_quality",
      "CONTROLLED_STRUCTURE=10EASY+3x6CONTROLLED/3EASY+10-12EASY",
    ].join("\n");
    coachComments = [
      "Разминка 10 мин легко.",
      "3 x 6 мин в контролируемом темпе, между ними 3 мин легко.",
      "Заминка 10–12 мин легко.",
      "RPE 6–7/10, не максимум, без VO2 и без all-out.",
      "",
      ...safetyMarkers,
      "DRAFT_WORKOUT_TYPE=controlled_quality",
      "CONTROLLED_STRUCTURE=10EASY+3x6CONTROLLED/3EASY+10-12EASY",
    ].join("\n");

    if (workout.duration_minutes !== CONTROLLED_QUALITY_DURATION_V0_MINUTES) {
      manualReview = `controlled_quality duration ${workout.duration_minutes} differs from conservative v0 structure target ${CONTROLLED_QUALITY_DURATION_V0_MINUTES}`;
    }
  }

  const definition = buildSafeRunningWorkoutDefinition({
    template,
    athleteId,
    workoutDay: workout.date,
    title,
    description,
    coachComments,
  });
  const createPlan = buildRunningWorkoutCreatePlan(definition);

  return {
    index: 0,
    date: workout.date,
    draft_workout_type: workout.workout_type,
    template,
    writer_action: manualReview ? "writer_preview_needs_manual_review" : "preview_create",
    writer_review_reason: manualReview,
    title,
    duration_minutes: workout.duration_minutes,
    total_time_planned_hours: createPlan.requestBodySummary.totalTimePlanned,
    primary_intensity_metric: createPlan.requestBodySummary.primaryIntensityMetric,
    repeat_block_count: createPlan.requestBodySummary.repeatBlockCount,
    description,
    coach_comments: coachComments,
    safety_markers: safetyMarkers,
    create_payload_candidate: createPlan.requestBodyCandidate,
  };
}

function buildMarkdown(report: WriterDryRunJson, sourceDraftDir: string): string {
  const lines: string[] = [];
  lines.push("# TP WRITER DRY RUN v0");
  lines.push("");
  lines.push("Dry-run writer preview only. No DB writes, no TrainingPeaks mutations, no Telegram sends.");
  lines.push("");
  lines.push("## 1. Source draft");
  lines.push(`- source_draft_dir: ${sourceDraftDir}`);
  lines.push("");
  lines.push("## 2. Athlete and week");
  lines.push(`- athlete: ${report.athlete.name}`);
  lines.push(`- athlete_id: ${report.athlete.athlete_id}`);
  lines.push(`- student_id: ${report.athlete.student_id}`);
  lines.push(`- week_start: ${report.week.week_start}`);
  lines.push(`- week_end: ${report.week.week_end}`);
  lines.push("");
  lines.push("## 3. Writer status");
  lines.push(`- writer_status: ${report.writer_status}`);
  lines.push(`- payload_count: ${report.payload_count}`);
  lines.push(`- payloads_needing_manual_review: ${report.payloads_needing_manual_review}`);
  if (report.blocked_reasons.length > 0) {
    lines.push(`- blocked_reasons: ${report.blocked_reasons.join(" | ")}`);
  }
  lines.push("");
  lines.push("## 4. Workout mapping table");
  if (report.workouts.length === 0) {
    lines.push("- no mapped workouts");
  } else {
    for (const workout of report.workouts) {
      lines.push(
        `- ${workout.date} | ${workout.draft_workout_type} -> ${workout.template} | action=${workout.writer_action} | title="${workout.title}" | minutes=${workout.duration_minutes}`,
      );
      if (workout.writer_review_reason) {
        lines.push(`  reason: ${workout.writer_review_reason}`);
      }
    }
  }
  lines.push("");
  lines.push("## 5. Payload preview");
  if (report.workouts.length === 0) {
    lines.push("- no payloads");
  } else {
    for (const workout of report.workouts) {
      lines.push(
        `- ${workout.date} ${workout.title} | metric=${workout.primary_intensity_metric ?? "unknown"} | repeat_blocks=${workout.repeat_block_count ?? "unknown"} | total_hours=${workout.total_time_planned_hours ?? "unknown"}`,
      );
    }
  }
  lines.push("");
  lines.push("## 6. Safety checks");
  for (const check of report.safety_checks) {
    lines.push(`- ${check.name}: ${check.ok} (${check.details})`);
  }
  lines.push("");
  lines.push("## 7. Manual review notes");
  if (report.payloads_needing_manual_review === 0) {
    lines.push("- no manual review blockers from mapping");
  } else {
    for (const workout of report.workouts.filter((item) => item.writer_action === "writer_preview_needs_manual_review")) {
      lines.push(`- ${workout.date}: ${workout.writer_review_reason ?? "manual review required"}`);
    }
  }
  lines.push("");
  lines.push("## 8. TP write confirmation");
  lines.push("- no POST/PUT/PATCH/DELETE requests executed");
  lines.push("- no workout create/move/delete/edit performed");
  lines.push("- local preview artifacts only");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildManualReviewNotes(report: WriterDryRunJson): string {
  const lines: string[] = [];
  lines.push("# Manual Review Notes");
  lines.push("");
  lines.push(`- writer_status: ${report.writer_status}`);
  lines.push(`- payload_count: ${report.payload_count}`);
  lines.push("");
  lines.push("## Controlled quality structure v0");
  lines.push(`- warmup: ${report.controlled_quality_structure_v0.warmup}`);
  lines.push(`- main_set: ${report.controlled_quality_structure_v0.main_set}`);
  lines.push(`- cooldown: ${report.controlled_quality_structure_v0.cooldown}`);
  lines.push(`- intensity: ${report.controlled_quality_structure_v0.intensity}`);
  lines.push("");
  lines.push("## Per-workout notes");
  if (report.workouts.length === 0) {
    lines.push("- no workouts");
  } else {
    for (const workout of report.workouts) {
      if (workout.writer_action === "preview_create") {
        lines.push(`- ${workout.date} ${workout.title}: ready for coach preview (dry-run only).`);
      } else {
        lines.push(`- ${workout.date} ${workout.title}: ${workout.writer_review_reason ?? "manual review required"}.`);
      }
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const sourceDraftDirAbsolute = path.resolve(repoRoot, args.draftDir);
  const sourceDraftDirRelative = path
    .relative(repoRoot, sourceDraftDirAbsolute)
    .split(path.sep)
    .join("/");
  const draftJsonPath = path.join(sourceDraftDirAbsolute, "plan-draft.json");
  const draft = loadJson<PlanDraftJson>(draftJsonPath);

  const athleteIdMismatchArg = args.athleteId !== null && args.athleteId !== draft.athlete.athlete_id;
  const weekStartMismatchArg = args.weekStart !== null && args.weekStart !== draft.week.week_start;
  const safetyMarkers = buildSafetyMarkers(sourceDraftDirRelative, draft.athlete.athlete_id);
  const guardrailsPass = allGuardrailsPass(draft.guardrail_check);
  const hasBlockedReadinessReasons = draft.readiness.blocking_reasons.length > 0;

  const safetyChecks: SafetyCheck[] = [
    {
      name: "draft_status_ready",
      ok: draft.status === "draft_ready_for_coach_review",
      details: `status=${draft.status}`,
    },
    {
      name: "draft_guardrails_passed",
      ok: guardrailsPass,
      details: `all_guardrails_ok=${guardrailsPass}`,
    },
    {
      name: "athlete_id_matches_anna",
      ok: draft.athlete.athlete_id === EXPECTED_ATHLETE_ID,
      details: `athlete_id=${draft.athlete.athlete_id}; expected=${EXPECTED_ATHLETE_ID}`,
    },
    {
      name: "week_start_matches_expected",
      ok: draft.week.week_start === EXPECTED_WEEK_START,
      details: `week_start=${draft.week.week_start}; expected=${EXPECTED_WEEK_START}`,
    },
    {
      name: "workout_count_is_three",
      ok: draft.workouts.length === 3,
      details: `workouts=${draft.workouts.length}`,
    },
    {
      name: "no_blocked_readiness_reasons",
      ok: !hasBlockedReadinessReasons,
      details: `blocking_reasons=${draft.readiness.blocking_reasons.join("|") || "none"}`,
    },
    {
      name: "arg_athlete_id_matches_draft_if_provided",
      ok: !athleteIdMismatchArg,
      details: athleteIdMismatchArg
        ? `arg_athlete_id=${args.athleteId}; draft_athlete_id=${draft.athlete.athlete_id}`
        : "ok",
    },
    {
      name: "arg_week_start_matches_draft_if_provided",
      ok: !weekStartMismatchArg,
      details: weekStartMismatchArg
        ? `arg_week_start=${args.weekStart}; draft_week_start=${draft.week.week_start}`
        : "ok",
    },
    {
      name: "no_trainingpeaks_mutations",
      ok: true,
      details: "script does not perform any network requests",
    },
    {
      name: "no_db_writes",
      ok: true,
      details: "script reads local files only",
    },
    {
      name: "no_telegram_sends",
      ok: true,
      details: "script does not invoke Telegram paths",
    },
  ];

  const blockedReasons = safetyChecks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.details}`);
  const readinessBlocked = draft.status === "draft_blocked_by_readiness";
  let writerStatus: WriterStatus;
  if (readinessBlocked) {
    writerStatus = "blocked_by_draft_readiness";
  } else if (blockedReasons.length > 0) {
    writerStatus = "blocked_by_draft_guardrails";
  } else {
    writerStatus = "writer_dry_run_ready_for_review";
  }

  const workouts: WorkoutPreviewRow[] =
    writerStatus === "writer_dry_run_ready_for_review"
      ? draft.workouts
          .map((workout) =>
            buildMappedWorkout({
              workout,
              athleteId: draft.athlete.athlete_id,
              safetyMarkers,
            }),
          )
          .map((item, index) => ({ ...item, index: index + 1 }))
      : [];

  const payloadCount = workouts.filter((row) => row.writer_action === "preview_create").length;
  const payloadsNeedingManualReview = workouts.filter(
    (row) => row.writer_action === "writer_preview_needs_manual_review",
  ).length;

  const outputDir = path.join(repoRoot, "reports", "tp-plan-writer-dry-run-v0", timestampForPath(new Date()));
  await mkdir(outputDir, { recursive: true });

  const reportJson: WriterDryRunJson = {
    generated_at: new Date().toISOString(),
    mode: "writer-dry-run-only",
    read_only: true,
    no_db_writes: true,
    no_trainingpeaks_mutations: true,
    no_telegram_sends: true,
    source_draft_dir: sourceDraftDirRelative,
    athlete: draft.athlete,
    week: draft.week,
    writer_status: writerStatus,
    payload_count: payloadCount,
    payloads_needing_manual_review: payloadsNeedingManualReview,
    safety_markers: safetyMarkers,
    safety_checks: safetyChecks,
    workouts,
    blocked_reasons: blockedReasons,
    controlled_quality_structure_v0: {
      warmup: "10 min easy warmup",
      main_set: "3 x 6 min controlled / 3 min easy recovery",
      cooldown: "10-12 min easy cooldown",
      intensity: "RPE 6-7/10, controlled, no VO2 and no all-out",
    },
  };

  const markdownPath = path.join(outputDir, "TP-WRITER-DRY-RUN.md");
  const reportJsonPath = path.join(outputDir, "tp-writer-dry-run.json");
  const payloadPreviewJsonPath = path.join(outputDir, "workout-create-preview.json");
  const payloadPreviewCsvPath = path.join(outputDir, "workout-create-preview.csv");
  const payloadSafetyPath = path.join(outputDir, "payload-safety-check.json");
  const manualReviewPath = path.join(outputDir, "manual-review-notes.md");

  const payloadPreview = workouts.map((row) => ({
    index: row.index,
    date: row.date,
    draft_workout_type: row.draft_workout_type,
    template: row.template,
    writer_action: row.writer_action,
    writer_review_reason: row.writer_review_reason,
    title: row.title,
    duration_minutes: row.duration_minutes,
    create_payload_candidate: row.create_payload_candidate,
  }));

  const csvRows: string[][] = [
    [
      "index",
      "date",
      "draft_workout_type",
      "template",
      "writer_action",
      "title",
      "duration_minutes",
      "primary_intensity_metric",
      "repeat_block_count",
      "safety_markers",
      "writer_review_reason",
    ],
    ...workouts.map((row) => [
      String(row.index),
      row.date,
      row.draft_workout_type,
      row.template,
      row.writer_action,
      row.title,
      String(row.duration_minutes),
      row.primary_intensity_metric ?? "",
      String(row.repeat_block_count ?? ""),
      row.safety_markers.join("|"),
      row.writer_review_reason ?? "",
    ]),
  ];

  await writeFile(markdownPath, buildMarkdown(reportJson, sourceDraftDirRelative), "utf8");
  await writeFile(reportJsonPath, `${JSON.stringify(reportJson, null, 2)}\n`, "utf8");
  await writeFile(payloadPreviewJsonPath, `${JSON.stringify(payloadPreview, null, 2)}\n`, "utf8");
  await writeFile(payloadPreviewCsvPath, listToCsv(csvRows), "utf8");
  await writeFile(payloadSafetyPath, `${JSON.stringify({ safety_checks: safetyChecks, blocked_reasons: blockedReasons }, null, 2)}\n`, "utf8");
  await writeFile(manualReviewPath, buildManualReviewNotes(reportJson), "utf8");

  if (args.json) {
    console.log(JSON.stringify(reportJson, null, 2));
    return;
  }

  console.log("[tp-plan-writer-dry-run-v0] mode=writer-dry-run-only");
  console.log("[tp-plan-writer-dry-run-v0] read_only=true");
  console.log("[tp-plan-writer-dry-run-v0] no_db_writes=true");
  console.log("[tp-plan-writer-dry-run-v0] no_trainingpeaks_mutations=true");
  console.log("[tp-plan-writer-dry-run-v0] no_telegram_sends=true");
  console.log(`source_draft_dir: ${sourceDraftDirRelative}`);
  console.log(`writer_status: ${writerStatus}`);
  console.log(`payload_count: ${payloadCount}`);
  console.log(`payloads_needing_manual_review: ${payloadsNeedingManualReview}`);
  console.log(`report_dir: ${outputDir}`);
}

main().catch((error: unknown) => {
  console.error("tp-plan-writer-dry-run-v0 failed.");
  console.error(error);
  process.exit(1);
});
