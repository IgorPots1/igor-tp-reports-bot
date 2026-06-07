import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  PHASE_DETECTOR_SAFETY_MARKERS,
  type AthletePhaseSnapshot,
  type DetectedContext,
  type ReviewLevel,
} from "./lib/training-phase-detector-v0.ts";
import { toolRoot } from "./lib/paths.ts";

type CliArgs = {
  phaseReportDir: string;
  outputDir: string;
  json: boolean;
};

type PhaseSnapshotSummary = {
  generated_at: string;
  week_start: string;
  athlete_count: number;
  counts_by_review_level: Record<ReviewLevel, number>;
  race_context_summary: {
    athletes_with_upcoming_race: number;
    athletes_with_multiple_races: number;
    athletes_with_marathon_context: number;
    athletes_with_trail_context: number;
    athletes_needing_race_confirmation: number;
  };
  safety: typeof PHASE_DETECTOR_SAFETY_MARKERS;
  students: AthletePhaseSnapshot[];
};

type ReviewTableRow = Record<string, string>;

const REVIEW_LEVEL_ORDER: Record<ReviewLevel, number> = {
  hard_block: 0,
  coach_review: 1,
  info: 2,
  none: 3,
};

const DETECTED_CONTEXT_RU: Record<DetectedContext, string> = {
  vo2_block: "VO2-блок",
  threshold_or_controlled_block: "Порог / контролируемый блок",
  race_specific_context: "Старт-специфичный контекст",
  taper_context: "Подводка",
  post_race_recovery: "Восстановление после старта",
  return_after_illness: "Возврат после болезни",
  base_or_low_consistency: "База / низкая регулярность",
  general_development: "Общее развитие",
  schedule_constrained: "Ограничения по расписанию",
  manual_review_unknown: "Нужна ручная проверка",
};

const REVIEW_LEVEL_RU: Record<ReviewLevel, string> = {
  hard_block: "Блок (срочно)",
  coach_review: "Проверка тренера",
  info: "Инфо",
  none: "Ок",
};

const DATA_VISIBILITY_RU: Record<string, string> = {
  normal: "Норма",
  no_completed_data: "Нет завершённых данных",
  device_upload_issue_suspected: "Подозрение на проблему загрузки",
  unknown: "Неизвестно",
};

const RACE_COUNT = 5;

const COLUMN_ORDER: string[] = [
  "student_name",
  "student_id",
  "athlete_id",
  "manual_current_status",
  "manual_training_phase",
  "manual_cycle_note",
  "manual_race_anchor",
  "manual_general_note",
  "coach_action",
  "review_level",
  "review_level_ru",
  "detected_context",
  "detected_context_ru",
  "manual_review_required",
  "review_reasons",
  "ai_recommendation_summary",
  "ai_do_not_do",
  "ai_suggested_next_step",
  "confidence",
  "data_visibility_status",
  "data_visibility_status_ru",
  "evidence_short",
  "active_illness",
  "illness_return_week",
  "weeks_analyzed",
  "completed_runs",
  "completed_quality_sessions",
  "last_quality_date",
  "last_quality_type",
  "last_quality_key",
  "consecutive_quality_weeks",
  "recent_4w_frequency",
  "possible_deload_recommended",
  "quality_progression_known",
  "quality_progression_unknown",
  "upcoming_race_detected",
  "upcoming_races_count",
  "has_multiple_races",
  "next_race_date",
  "next_race_name",
  "next_race_distance",
  "next_race_type",
  "weeks_to_next_race",
  "race_confidence",
  "race_context_needs_confirmation",
  "marathon_specific_requires_review",
  "all_races_text",
  ...Array.from({ length: RACE_COUNT }, (_, index) => {
    const n = index + 1;
    return [
      `race_${n}_date`,
      `race_${n}_name`,
      `race_${n}_distance`,
      `race_${n}_type`,
      `race_${n}_weeks_to_race`,
      `race_${n}_ai_confidence`,
      `race_${n}_manual_priority`,
    ];
  }).flat(),
];

function timestampForPath(date: Date): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function loadJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function listToCsv(rows: string[][]): string {
  return `${rows
    .map((row) =>
      row
        .map((cell) => {
          const safe = cell ?? "";
          if (safe.includes(",") || safe.includes('"') || safe.includes("\n")) {
            return `"${safe.replaceAll('"', '""')}"`;
          }
          return safe;
        })
        .join(","),
    )
    .join("\n")}\n`;
}

function dashIfEmpty(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : "—";
}

function dashIfFalse(flag: boolean): string {
  return flag ? "да" : "—";
}

function joinCompact(items: string[], maxItems = 5): string {
  if (items.length === 0) return "—";
  return items.slice(0, maxItems).join("; ");
}

function weeksToRace(weekStart: string, raceDate: string): number {
  const start = new Date(`${weekStart}T00:00:00Z`);
  const race = new Date(`${raceDate}T00:00:00Z`);
  const diffMs = race.getTime() - start.getTime();
  return Math.max(0, Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000)));
}

function formatRaceText(
  races: AthletePhaseSnapshot["race_context"]["all_upcoming_races_preview"],
  weekStart: string,
): string {
  if (races.length === 0) return "—";
  return races
    .map((race) => {
      const weeks = weeksToRace(weekStart, race.date);
      return `${race.date} | ${race.name ?? "без названия"} | ${race.distance ?? "unknown"} | ${race.type ?? "unknown"} | ${weeks}н | ${race.confidence ?? "—"}`;
    })
    .join("; ");
}

function sortAthletes(athletes: AthletePhaseSnapshot[]): AthletePhaseSnapshot[] {
  return [...athletes].sort((left, right) => {
    const levelDiff = REVIEW_LEVEL_ORDER[left.review_level] - REVIEW_LEVEL_ORDER[right.review_level];
    if (levelDiff !== 0) return levelDiff;

    const leftHasRace = left.race_context.upcoming_race_detected ? 0 : 1;
    const rightHasRace = right.race_context.upcoming_race_detected ? 0 : 1;
    if (leftHasRace !== rightHasRace) return leftHasRace - rightHasRace;

    const leftMultiple = left.race_context.upcoming_races_count > 1 ? 0 : 1;
    const rightMultiple = right.race_context.upcoming_races_count > 1 ? 0 : 1;
    if (leftMultiple !== rightMultiple) return leftMultiple - rightMultiple;

    const leftWeeks = left.race_context.weeks_to_next_race;
    const rightWeeks = right.race_context.weeks_to_next_race;
    if (leftWeeks !== null && rightWeeks !== null && leftWeeks !== rightWeeks) {
      return leftWeeks - rightWeeks;
    }
    if (leftWeeks === null && rightWeeks !== null) return 1;
    if (leftWeeks !== null && rightWeeks === null) return -1;

    return left.name.localeCompare(right.name, "ru");
  });
}

function buildRow(athlete: AthletePhaseSnapshot, weekStart: string): ReviewTableRow {
  const training = athlete.recent_training_summary;
  const raceContext = athlete.race_context;
  const races = raceContext.all_upcoming_races_preview;

  const row: ReviewTableRow = {
    student_name: athlete.name,
    student_id: athlete.student_id ?? "",
    athlete_id: athlete.athlete_id === null ? "" : String(athlete.athlete_id),
    manual_current_status: "",
    manual_training_phase: "",
    manual_cycle_note: "",
    manual_race_anchor: "",
    manual_general_note: "",
    coach_action: "",
    review_level: athlete.review_level,
    review_level_ru: REVIEW_LEVEL_RU[athlete.review_level],
    detected_context: athlete.detected_context,
    detected_context_ru: DETECTED_CONTEXT_RU[athlete.detected_context],
    manual_review_required: athlete.flags.manual_review_required ? "да" : "—",
    review_reasons: joinCompact(athlete.review_reasons, 10),
    ai_recommendation_summary: dashIfEmpty(athlete.recommendation.summary),
    ai_do_not_do: joinCompact(athlete.recommendation.do_not_do, 10),
    ai_suggested_next_step: dashIfEmpty(athlete.recommendation.suggested_next_step),
    confidence: athlete.confidence,
    data_visibility_status: athlete.data_visibility_status,
    data_visibility_status_ru: DATA_VISIBILITY_RU[athlete.data_visibility_status] ?? athlete.data_visibility_status,
    evidence_short: joinCompact(athlete.evidence, 5),
    active_illness: dashIfFalse(athlete.flags.active_illness),
    illness_return_week: dashIfFalse(athlete.flags.illness_return_week),
    weeks_analyzed: String(training.weeks_analyzed),
    completed_runs: String(training.completed_runs),
    completed_quality_sessions: String(training.completed_quality_sessions),
    last_quality_date: dashIfEmpty(training.last_quality_date),
    last_quality_type: dashIfEmpty(training.last_quality_type),
    last_quality_key: dashIfEmpty(training.last_quality_key),
    consecutive_quality_weeks:
      training.consecutive_quality_weeks === null ? "—" : String(training.consecutive_quality_weeks),
    recent_4w_frequency: training.recent_4w_frequency === null ? "—" : String(training.recent_4w_frequency),
    possible_deload_recommended: athlete.flags.possible_deload_recommended ? "да" : "—",
    quality_progression_known: athlete.flags.quality_progression_known ? "да" : "—",
    quality_progression_unknown: athlete.flags.quality_progression_unknown ? "да" : "—",
    upcoming_race_detected: raceContext.upcoming_race_detected ? "да" : "—",
    upcoming_races_count: String(raceContext.upcoming_races_count),
    has_multiple_races: raceContext.upcoming_races_count > 1 ? "да" : "—",
    next_race_date: dashIfEmpty(raceContext.next_race_date),
    next_race_name: dashIfEmpty(raceContext.next_race_name),
    next_race_distance: dashIfEmpty(raceContext.next_race_distance),
    next_race_type: dashIfEmpty(raceContext.next_race_type),
    weeks_to_next_race:
      raceContext.weeks_to_next_race === null ? "—" : String(raceContext.weeks_to_next_race),
    race_confidence: dashIfEmpty(raceContext.race_confidence),
    race_context_needs_confirmation: raceContext.race_context_needs_confirmation ? "да" : "—",
    marathon_specific_requires_review: athlete.flags.marathon_specific_requires_review ? "да" : "—",
    all_races_text: formatRaceText(races, weekStart),
  };

  for (let index = 0; index < RACE_COUNT; index += 1) {
    const raceNumber = index + 1;
    const race = races[index];
    const prefix = `race_${raceNumber}`;
    if (!race) {
      row[`${prefix}_date`] = "—";
      row[`${prefix}_name`] = "—";
      row[`${prefix}_distance`] = "—";
      row[`${prefix}_type`] = "—";
      row[`${prefix}_weeks_to_race`] = "—";
      row[`${prefix}_ai_confidence`] = "—";
      row[`${prefix}_manual_priority`] = "";
      continue;
    }
    row[`${prefix}_date`] = race.date;
    row[`${prefix}_name`] = dashIfEmpty(race.name);
    row[`${prefix}_distance`] = dashIfEmpty(race.distance);
    row[`${prefix}_type`] = dashIfEmpty(race.type);
    row[`${prefix}_weeks_to_race`] = String(weeksToRace(weekStart, race.date));
    row[`${prefix}_ai_confidence`] = dashIfEmpty(race.confidence);
    row[`${prefix}_manual_priority`] = "";
  }

  return row;
}

function buildRussianReadme(input: {
  outputDir: string;
  phaseReportDir: string;
  summary: PhaseSnapshotSummary;
  rowCount: number;
  columnCount: number;
}): string {
  const lines: string[] = [];
  lines.push("# Таблица ручной проверки фаз и стартов v0");
  lines.push("");
  lines.push("Только чтение. Без записи в TrainingPeaks, Supabase, Telegram и без автогенерации планов.");
  lines.push("");
  lines.push("## Назначение");
  lines.push("");
  lines.push(
    "Одна большая таблица для ручной проверки всех активных учеников после AI-диагностики фазы и скана стартов.",
  );
  lines.push("Сначала проверьте таблицу вручную, затем калибруйте автоматику на основе ваших правок.");
  lines.push("");
  lines.push("## Рекомендуемый порядок работы");
  lines.push("");
  lines.push("1. Попросите учеников актуализировать старты в TrainingPeaks.");
  lines.push("2. Откройте `coach-master-review.csv` в Numbers / Excel / Google Sheets.");
  lines.push("3. Пройдите строки сверху вниз (сначала блоки, потом проверки тренера).");
  lines.push("4. Заполните ручные колонки: статус, фаза, цикл, главный старт, приоритеты A/B/C.");
  lines.push("5. Зафиксируйте `coach_action` и общие комментарии.");
  lines.push("6. Сохраните отредактированный файл для следующего калибровочного прохода.");
  lines.push("");
  lines.push("## Файлы");
  lines.push("");
  lines.push("- `coach-master-review.csv` — основная таблица для редактирования");
  lines.push("- `coach-master-review.md` — краткий обзор и подсказки на русском");
  lines.push("- `README.md` — этот файл");
  lines.push("");
  lines.push("## Источник данных");
  lines.push("");
  lines.push(`- phase snapshot: \`${input.phaseReportDir}\``);
  lines.push(`- generated_at snapshot: ${input.summary.generated_at}`);
  lines.push(`- week_start: ${input.summary.week_start}`);
  lines.push(`- строк в таблице: ${input.rowCount}`);
  lines.push(`- колонок: ${input.columnCount}`);
  lines.push("");
  lines.push("## Сортировка");
  lines.push("");
  lines.push("1. `hard_block` → `coach_review` → `info` → `none`");
  lines.push("2. внутри группы: сначала со стартами, потом с несколькими стартами, потом по ближайшему старту");
  lines.push("3. затем по имени ученика");
  lines.push("");
  lines.push("## Ручные колонки (оставьте пустыми до проверки)");
  lines.push("");
  lines.push("| Колонка | Подпись | Допустимые значения |");
  lines.push("|---|---|---|");
  lines.push("| `manual_current_status` | Новый статус вручную | ok; needs_review; blocked; data_issue; illness_return; race_context_review; other |");
  lines.push("| `manual_training_phase` | Фаза вручную | general_development; base_or_low_consistency; vo2_block; threshold_or_controlled_block; race_specific_context; taper_context; post_race_recovery; return_after_illness; manual_review_unknown; other |");
  lines.push("| `manual_cycle_note` | Комментарий по циклу | свободный текст |");
  lines.push("| `manual_race_anchor` | Главный старт вручную | дата или название старта |");
  lines.push("| `manual_general_note` | Общий комментарий | свободный текст |");
  lines.push("| `coach_action` | Действие тренера | —; update_tp_start; ask_athlete; fix_phase; fix_data_sync; plan_manually; ok |");
  lines.push("| `race_N_manual_priority` | Приоритет старта N | A; B; C; ignore; done; unknown |");
  lines.push("");
  lines.push("### Приоритеты стартов");
  lines.push("");
  lines.push("- **A** — главный старт");
  lines.push("- **B** — важный, но не главный");
  lines.push("- **C** — тренировочный / второстепенный");
  lines.push("- **ignore** — не учитывать в планировании");
  lines.push("- **done** — старт уже прошёл / закрыт");
  lines.push("- **unknown** — пока непонятно");
  lines.push("");
  lines.push("Колонки `race_N_manual_priority` намеренно пустые — не заполняйте A/B/C автоматически.");
  lines.push("");
  lines.push("## Символ `—`");
  lines.push("");
  lines.push("В полях без отдельного замечания используется `—` (всё ок / нет отдельного замечания).");
  lines.push("");
  lines.push("## Сводка по review_level");
  lines.push("");
  for (const [level, count] of Object.entries(input.summary.counts_by_review_level)) {
    lines.push(`- ${level} (${REVIEW_LEVEL_RU[level as ReviewLevel]}): ${count}`);
  }
  lines.push("");
  lines.push("## Сводка по стартам");
  lines.push("");
  const raceSummary = input.summary.race_context_summary;
  lines.push(`- учеников с предстоящими стартами: ${raceSummary.athletes_with_upcoming_race}`);
  lines.push(`- учеников с несколькими стартами: ${raceSummary.athletes_with_multiple_races}`);
  lines.push(`- марафонских контекстов: ${raceSummary.athletes_with_marathon_context}`);
  lines.push(`- трейловых контекстов: ${raceSummary.athletes_with_trail_context}`);
  lines.push(`- нуждаются в подтверждении стартов: ${raceSummary.athletes_needing_race_confirmation}`);
  lines.push("");
  lines.push("## Выпадающие списки в Google Sheets / Numbers");
  lines.push("");
  lines.push("XLSX в v0 не генерируется (нет зависимости). Добавьте dropdown вручную:");
  lines.push("- `manual_current_status`");
  lines.push("- `manual_training_phase`");
  lines.push("- `race_N_manual_priority`");
  lines.push("- `coach_action`");
  lines.push("");
  lines.push("## Безопасность");
  lines.push("");
  lines.push("- mode: read_only");
  lines.push("- no TrainingPeaks mutations");
  lines.push("- no DB writes");
  lines.push("- no Telegram sends");
  lines.push("- no plan generation");
  lines.push("");
  lines.push(`Output directory: ${input.outputDir}`);
  return `${lines.join("\n")}\n`;
}

function buildCoachMarkdown(input: {
  summary: PhaseSnapshotSummary;
  rows: ReviewTableRow[];
  outputDir: string;
}): string {
  const lines: string[] = [];
  lines.push("# Coach Master Review — ручная проверка фаз и стартов");
  lines.push("");
  lines.push("Откройте `coach-master-review.csv` для полной таблицы. Ниже — краткий обзор и подсказки.");
  lines.push("");
  lines.push(`- week_start: ${input.summary.week_start}`);
  lines.push(`- учеников: ${input.rows.length}`);
  lines.push(`- hard_block: ${input.summary.counts_by_review_level.hard_block}`);
  lines.push(`- coach_review: ${input.summary.counts_by_review_level.coach_review}`);
  lines.push(`- со стартами: ${input.summary.race_context_summary.athletes_with_upcoming_race}`);
  lines.push("");
  lines.push("## Что заполнять вручную");
  lines.push("");
  lines.push("1. `manual_current_status` — итоговый статус после вашей проверки");
  lines.push("2. `manual_training_phase` — фаза, если AI ошибся");
  lines.push("3. `manual_race_anchor` + `race_N_manual_priority` — главный и второстепенные старты");
  lines.push("4. `manual_cycle_note` / `manual_general_note` — заметки по циклу и общие");
  lines.push("5. `coach_action` — что делать дальше (спросить ученика, поправить TP, планировать вручную)");
  lines.push("");
  lines.push("## Приоритетные группы (первые строки CSV)");
  lines.push("");
  const preview = input.rows.slice(0, 15);
  lines.push("| Ученик | Уровень | AI-контекст | Старты | Ближайший старт |");
  lines.push("|---|---|---|---|---|");
  for (const row of preview) {
    const nextRace =
      row.next_race_date === "—"
        ? "—"
        : `${row.next_race_date} ${row.next_race_name !== "—" ? row.next_race_name : ""}`.trim();
    lines.push(
      `| ${row.student_name} | ${row.review_level_ru} | ${row.detected_context_ru} | ${row.upcoming_races_count} | ${nextRace} |`,
    );
  }
  lines.push("");
  lines.push("## Колонки AI → русские подписи");
  lines.push("");
  lines.push("| Техническое имя | Подпись |");
  lines.push("|---|---|");
  lines.push("| student_name | Ученик |");
  lines.push("| detected_context / detected_context_ru | AI-контекст |");
  lines.push("| review_level / review_level_ru | Уровень проверки |");
  lines.push("| manual_current_status | Новый статус вручную |");
  lines.push("| manual_training_phase | Фаза вручную |");
  lines.push("| manual_cycle_note | Комментарий по циклу |");
  lines.push("| manual_race_anchor | Главный старт вручную |");
  lines.push("| manual_general_note | Общий комментарий |");
  lines.push("| coach_action | Действие тренера |");
  lines.push("| race_N_manual_priority | Приоритет старта N |");
  lines.push("");
  lines.push(`Полный CSV: \`${path.join(input.outputDir, "coach-master-review.csv")}\``);
  return `${lines.join("\n")}\n`;
}

function printHelp(): void {
  console.log("Coach-facing master phase/race review table v0 (read-only export)");
  console.log("");
  console.log("Usage:");
  console.log(
    "  npm run tp-athlete-phase-review-table-v0 -- --phase-report-dir reports/athlete-phase-snapshot-v0/<timestamp> --output-dir reports/athlete-phase-review-table-v0",
  );
  console.log("");
  console.log("Optional:");
  console.log("  --json");
}

function parseArgs(argv: string[]): CliArgs {
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const parsed: CliArgs = {
    phaseReportDir: path.join(repoRoot, "reports", "athlete-phase-snapshot-v0", "20260607-124744"),
    outputDir: path.join(repoRoot, "reports", "athlete-phase-review-table-v0"),
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith("--phase-report-dir=")) {
      parsed.phaseReportDir = path.resolve(arg.slice("--phase-report-dir=".length).trim());
      continue;
    }
    if (arg === "--phase-report-dir") {
      parsed.phaseReportDir = path.resolve((argv[index + 1] ?? "").trim());
      index += 1;
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      parsed.outputDir = path.resolve(arg.slice("--output-dir=".length).trim());
      continue;
    }
    if (arg === "--output-dir") {
      parsed.outputDir = path.resolve((argv[index + 1] ?? "").trim());
      index += 1;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const summaryPath = path.join(args.phaseReportDir, "summary.json");
  if (!existsSync(summaryPath)) {
    throw new Error(`Missing summary.json at ${summaryPath}`);
  }

  const summary = loadJson<PhaseSnapshotSummary>(summaryPath);
  if (!Array.isArray(summary.students) || summary.students.length === 0) {
    throw new Error("summary.json has no students array");
  }

  const sortedAthletes = sortAthletes(summary.students);
  const rows = sortedAthletes.map((athlete) => buildRow(athlete, summary.week_start));

  const timestamp = timestampForPath(new Date());
  const outputDir = path.join(args.outputDir, timestamp);
  await mkdir(outputDir, { recursive: true });

  const csvRows: string[][] = [COLUMN_ORDER, ...rows.map((row) => COLUMN_ORDER.map((column) => row[column] ?? ""))];
  await writeFile(path.join(outputDir, "coach-master-review.csv"), listToCsv(csvRows), "utf8");
  await writeFile(
    path.join(outputDir, "README.md"),
    buildRussianReadme({
      outputDir,
      phaseReportDir: args.phaseReportDir,
      summary,
      rowCount: rows.length,
      columnCount: COLUMN_ORDER.length,
    }),
    "utf8",
  );
  await writeFile(
    path.join(outputDir, "coach-master-review.md"),
    buildCoachMarkdown({ summary, rows, outputDir }),
    "utf8",
  );
  await writeFile(
    path.join(outputDir, "summary.json"),
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        phase_report_dir: args.phaseReportDir,
        week_start: summary.week_start,
        athlete_count: rows.length,
        column_count: COLUMN_ORDER.length,
        xlsx_generated: false,
        safety: PHASE_DETECTOR_SAFETY_MARKERS,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          output_dir: outputDir,
          athlete_count: rows.length,
          column_count: COLUMN_ORDER.length,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log("Coach master review table v0 export complete.");
  console.log(`Output directory: ${outputDir}`);
  console.log(`Rows: ${rows.length}`);
  console.log(`Columns: ${COLUMN_ORDER.length}`);
  console.log("Files: coach-master-review.csv, coach-master-review.md, README.md");
  console.log("Safety: read-only export, no TP/DB/Telegram/planning writes");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
