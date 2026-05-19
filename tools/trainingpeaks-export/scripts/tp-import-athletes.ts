import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { normalizeTrainingPeaksStudentId } from "./lib/trainingpeaks-student-id.ts";
import { toolRoot } from "./lib/paths.ts";

const ROSTER_BASENAME = "athletes.users-v3.normalized.json";
const ARTIFACTS_ROOT = path.join(toolRoot, "debug", "athletes-import");
const SAMPLE_WOULD_INSERT_LIMIT = 15;

type CliArgs = {
  fromDiscovery: string;
  apply: boolean;
};

type DiscoveredAthlete = {
  athleteId: number;
  displayName: string;
  trainingpeaksAthleteUrl: string;
  source: string;
};

type DiscoveryFile = {
  athletes: DiscoveredAthlete[];
};

type ExistingStudentRow = {
  id: string;
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_url: string;
  is_active: boolean;
  weekly_report_enabled: boolean;
  archived_at: string | null;
  telegram_chat_id: string | null;
  telegram_username: string | null;
  telegram_profile_url: string | null;
  telegram_delivery_enabled: boolean;
  data_quality_status: string | null;
  notes: string | null;
};

type WouldInsertRow = {
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_url: string;
  athlete_id: number;
  base_slug: string;
  slug_suffix: number | null;
};

type AlreadyExistsRow = {
  athlete_id: number;
  display_name: string;
  trainingpeaks_athlete_url: string;
  existing_student_id: string;
  existing_student_name: string;
  match_by: "athlete_id" | "trainingpeaks_athlete_url" | "student_id";
  archived: boolean;
};

type ArchivedExistingRow = AlreadyExistsRow;

type SlugCollisionRow = {
  athlete_id: number;
  display_name: string;
  base_slug: string;
  resolved_student_id: string;
  conflicting_existing_student_id: string;
};

type NameWarningRow = {
  athlete_id: number;
  display_name: string;
  existing_student_id: string;
  existing_student_name: string;
  existing_athlete_id: number | null;
};

type SupabaseNotInTpRow = {
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_url: string;
  athlete_id: number | null;
  archived: boolean;
};

type ImportReport = {
  run_at: string;
  mode: "dry-run" | "apply";
  discovery_file: string;
  summary: {
    discovered_total: number;
    existing_total: number;
    already_exists: number;
    would_insert: number;
    slug_collisions: number;
    name_warnings: number;
    archived_existing: number;
    supabase_not_in_tp: number;
    inserted?: number;
    insert_errors?: number;
  };
  already_exists: AlreadyExistsRow[];
  archived_existing: ArchivedExistingRow[];
  would_insert: WouldInsertRow[];
  slug_collisions: SlugCollisionRow[];
  name_warnings: NameWarningRow[];
  supabase_not_in_tp: SupabaseNotInTpRow[];
  would_insert_sample: WouldInsertRow[];
  apply_results?: Array<{ student_id: string; ok: boolean; error?: string }>;
  output_paths: {
    report_json: string;
    report_md: string;
  };
};

function printHelp(): void {
  console.log(`Usage: npm run tp-import-athletes -- --from-discovery=<path> [options]

Compare TrainingPeaks users/v3/user roster against Supabase students.
Default mode is dry-run (no Supabase writes).

Options:
  --from-discovery=<path>   Path to athletes.users-v3.normalized.json (required)
  --apply                   Insert new students only (never updates existing rows)
  --help                    Show this help

Safety:
  - Default: dry-run only
  - Never mutates TrainingPeaks
  - Never updates existing Supabase rows
  - weekly_report_enabled=false for all imports
  - Skips archived existing students by default
`);
}

function readTextFileSyncSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function loadDotEnvFile(dotEnvPath: string): void {
  if (!existsSync(dotEnvPath)) {
    return;
  }

  const content = readTextFileSyncSafe(dotEnvPath);
  if (content === null) {
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function loadLocalEnv(): void {
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const envPaths = [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(toolRoot, ".env"),
  ];

  for (const envPath of envPaths) {
    loadDotEnvFile(envPath);
  }
}

function getRequiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Set it in .env.local, .env, or tools/trainingpeaks-export/.env.`);
  }

  return value;
}

function parseArgs(argv: string[]): CliArgs {
  let fromDiscovery: string | null = null;
  let apply = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg.startsWith("--from-discovery=")) {
      fromDiscovery = arg.slice("--from-discovery=".length).trim();
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!fromDiscovery) {
    throw new Error("Missing required --from-discovery=<path>. Run with --help for usage.");
  }

  return { fromDiscovery, apply };
}

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function parseAthleteIdFromUrl(value: string): number | null {
  const match = value.match(/\/athletes\/(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function normalizeDisplayName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildBaseSlug(displayName: string, athleteId: number): string {
  const slug = normalizeTrainingPeaksStudentId(displayName);
  if (slug) return slug;
  return `athlete-${athleteId}`;
}

type SlugOwner = {
  athleteId: number;
  studentId: string;
  source: "existing" | "planned";
};

function resolveUniqueSlug(
  baseSlug: string,
  athleteId: number,
  displayName: string,
  takenSlugs: Map<string, SlugOwner>,
): { studentId: string; suffix: number | null; collision: SlugCollisionRow | null } {
  const owner = takenSlugs.get(baseSlug);
  if (!owner || owner.athleteId === athleteId) {
    return { studentId: baseSlug, suffix: null, collision: null };
  }

  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${baseSlug}-${suffix}`;
    const candidateOwner = takenSlugs.get(candidate);
    if (!candidateOwner || candidateOwner.athleteId === athleteId) {
      return {
        studentId: candidate,
        suffix,
        collision: {
          athlete_id: athleteId,
          display_name: displayName,
          base_slug: baseSlug,
          resolved_student_id: candidate,
          conflicting_existing_student_id: owner.studentId,
        },
      };
    }
    suffix += 1;
  }

  throw new Error(`Could not resolve unique slug for athlete ${athleteId} (base: ${baseSlug})`);
}

function findExistingMatch(
  athlete: DiscoveredAthlete,
  indexes: {
    byAthleteId: Map<number, ExistingStudentRow>;
    byUrl: Map<string, ExistingStudentRow>;
    byStudentId: Map<string, ExistingStudentRow>;
  },
): { row: ExistingStudentRow; matchBy: AlreadyExistsRow["match_by"] } | null {
  const byId = indexes.byAthleteId.get(athlete.athleteId);
  if (byId) {
    return { row: byId, matchBy: "athlete_id" };
  }

  const byUrl = indexes.byUrl.get(normalizeUrl(athlete.trainingpeaksAthleteUrl));
  if (byUrl) {
    return { row: byUrl, matchBy: "trainingpeaks_athlete_url" };
  }

  const baseSlug = buildBaseSlug(athlete.displayName, athlete.athleteId);
  const bySlug = indexes.byStudentId.get(baseSlug);
  if (bySlug) {
    return { row: bySlug, matchBy: "student_id" };
  }

  return null;
}

function loadDiscoveryFile(filePath: string): DiscoveredAthlete[] {
  const resolved = path.resolve(filePath);
  if (path.basename(resolved) !== ROSTER_BASENAME) {
    throw new Error(
      `Discovery file must be ${ROSTER_BASENAME} (users/v3/user roster). Got: ${path.basename(resolved)}`,
    );
  }
  if (!existsSync(resolved)) {
    throw new Error(`Discovery file not found: ${resolved}`);
  }

  const parsed = JSON.parse(readFileSync(resolved, "utf8")) as DiscoveryFile;
  if (!Array.isArray(parsed.athletes)) {
    throw new Error(`Invalid discovery file: missing athletes[] in ${resolved}`);
  }

  return parsed.athletes
    .filter(
      (row) =>
        Number.isInteger(row.athleteId) &&
        row.athleteId > 0 &&
        typeof row.displayName === "string" &&
        typeof row.trainingpeaksAthleteUrl === "string",
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.athleteId - b.athleteId);
}

function buildExistingIndexes(rows: ExistingStudentRow[]): {
  byAthleteId: Map<number, ExistingStudentRow>;
  byUrl: Map<string, ExistingStudentRow>;
  byStudentId: Map<string, ExistingStudentRow>;
  byNormalizedName: Map<string, ExistingStudentRow[]>;
} {
  const byAthleteId = new Map<number, ExistingStudentRow>();
  const byUrl = new Map<string, ExistingStudentRow>();
  const byStudentId = new Map<string, ExistingStudentRow>();
  const byNormalizedName = new Map<string, ExistingStudentRow[]>();

  for (const row of rows) {
    const athleteId = parseAthleteIdFromUrl(row.trainingpeaks_athlete_url);
    if (athleteId) {
      byAthleteId.set(athleteId, row);
    }
    byUrl.set(normalizeUrl(row.trainingpeaks_athlete_url), row);
    byStudentId.set(row.student_id, row);

    const normalizedName = normalizeDisplayName(row.student_name);
    const bucket = byNormalizedName.get(normalizedName) ?? [];
    bucket.push(row);
    byNormalizedName.set(normalizedName, bucket);
  }

  return { byAthleteId, byUrl, byStudentId, byNormalizedName };
}

function buildImportPlan(
  discovered: DiscoveredAthlete[],
  existing: ExistingStudentRow[],
): Omit<ImportReport, "run_at" | "mode" | "discovery_file" | "output_paths" | "apply_results"> {
  const indexes = buildExistingIndexes(existing);
  const matchedExistingIds = new Set<string>();

  const alreadyExists: AlreadyExistsRow[] = [];
  const archivedExisting: ArchivedExistingRow[] = [];
  const wouldInsert: WouldInsertRow[] = [];
  const slugCollisions: SlugCollisionRow[] = [];
  const nameWarnings: NameWarningRow[] = [];

  const takenSlugs = new Map<string, SlugOwner>();
  for (const row of existing) {
    const athleteId = parseAthleteIdFromUrl(row.trainingpeaks_athlete_url);
    if (!athleteId) continue;
    takenSlugs.set(row.student_id, { athleteId, studentId: row.student_id, source: "existing" });
  }

  for (const athlete of discovered) {
    const match = findExistingMatch(athlete, indexes);
    if (match) {
      matchedExistingIds.add(match.row.id);
      const entry: AlreadyExistsRow = {
        athlete_id: athlete.athleteId,
        display_name: athlete.displayName,
        trainingpeaks_athlete_url: athlete.trainingpeaksAthleteUrl,
        existing_student_id: match.row.student_id,
        existing_student_name: match.row.student_name,
        match_by: match.matchBy,
        archived: Boolean(match.row.archived_at),
      };

      if (match.row.archived_at) {
        archivedExisting.push(entry);
      } else {
        alreadyExists.push(entry);
      }
      continue;
    }

    const baseSlug = buildBaseSlug(athlete.displayName, athlete.athleteId);
    const resolved = resolveUniqueSlug(baseSlug, athlete.athleteId, athlete.displayName, takenSlugs);
    if (resolved.collision) {
      slugCollisions.push(resolved.collision);
    }

    const normalizedName = normalizeDisplayName(athlete.displayName);
    const sameNameRows = indexes.byNormalizedName.get(normalizedName) ?? [];
    for (const row of sameNameRows) {
      const existingAthleteId = parseAthleteIdFromUrl(row.trainingpeaks_athlete_url);
      if (existingAthleteId === athlete.athleteId) continue;
      nameWarnings.push({
        athlete_id: athlete.athleteId,
        display_name: athlete.displayName,
        existing_student_id: row.student_id,
        existing_student_name: row.student_name,
        existing_athlete_id: existingAthleteId,
      });
    }

    takenSlugs.set(resolved.studentId, {
      athleteId: athlete.athleteId,
      studentId: resolved.studentId,
      source: "planned",
    });
    wouldInsert.push({
      student_id: resolved.studentId,
      student_name: athlete.displayName,
      trainingpeaks_athlete_url: athlete.trainingpeaksAthleteUrl,
      athlete_id: athlete.athleteId,
      base_slug: baseSlug,
      slug_suffix: resolved.suffix,
    });
  }

  const discoveredAthleteIds = new Set(discovered.map((row) => row.athleteId));
  const supabaseNotInTp: SupabaseNotInTpRow[] = [];

  for (const row of existing) {
    if (matchedExistingIds.has(row.id)) continue;

    const athleteId = parseAthleteIdFromUrl(row.trainingpeaks_athlete_url);
    if (athleteId && discoveredAthleteIds.has(athleteId)) {
      matchedExistingIds.add(row.id);
      continue;
    }

    supabaseNotInTp.push({
      student_id: row.student_id,
      student_name: row.student_name,
      trainingpeaks_athlete_url: row.trainingpeaks_athlete_url,
      athlete_id: athleteId,
      archived: Boolean(row.archived_at),
    });
  }

  return {
    summary: {
      discovered_total: discovered.length,
      existing_total: existing.length,
      already_exists: alreadyExists.length,
      would_insert: wouldInsert.length,
      slug_collisions: slugCollisions.length,
      name_warnings: nameWarnings.length,
      archived_existing: archivedExisting.length,
      supabase_not_in_tp: supabaseNotInTp.length,
    },
    already_exists: alreadyExists,
    archived_existing: archivedExisting,
    would_insert: wouldInsert,
    slug_collisions: slugCollisions,
    name_warnings: nameWarnings,
    supabase_not_in_tp: supabaseNotInTp,
    would_insert_sample: wouldInsert.slice(0, SAMPLE_WOULD_INSERT_LIMIT),
  };
}

function buildMarkdownReport(report: ImportReport): string {
  const lines = [
    "# TrainingPeaks athlete import",
    "",
    `- run_at: \`${report.run_at}\``,
    `- mode: **${report.mode}**`,
    `- discovery_file: \`${report.discovery_file}\``,
    "",
    "## Summary",
    "",
    `| metric | count |`,
    `| --- | ---: |`,
    `| discovered_total | ${report.summary.discovered_total} |`,
    `| existing_total | ${report.summary.existing_total} |`,
    `| already_exists | ${report.summary.already_exists} |`,
    `| archived_existing | ${report.summary.archived_existing} |`,
    `| would_insert | ${report.summary.would_insert} |`,
    `| slug_collisions | ${report.summary.slug_collisions} |`,
    `| name_warnings | ${report.summary.name_warnings} |`,
    `| supabase_not_in_tp | ${report.summary.supabase_not_in_tp} |`,
  ];

  if (report.mode === "apply") {
    lines.push(
      `| inserted | ${report.summary.inserted ?? 0} |`,
      `| insert_errors | ${report.summary.insert_errors ?? 0} |`,
    );
  }

  lines.push(
    "",
    "## Sample would_insert",
    "",
    ...(report.would_insert_sample.length
      ? report.would_insert_sample.map(
          (row) =>
            `- \`${row.student_id}\` | ${row.student_name} | athlete ${row.athlete_id} | ${row.trainingpeaks_athlete_url}`,
        )
      : ["- none"]),
    "",
    "## Safety",
    "- Dry-run by default; Supabase writes only with `--apply`.",
    "- Inserts only; never updates existing students or Telegram bindings.",
    "- `weekly_report_enabled=false` for all imported students.",
    "",
    "## Artifacts",
    `- report_json: \`${report.output_paths.report_json}\``,
    `- report_md: \`${report.output_paths.report_md}\``,
  );

  return `${lines.join("\n")}\n`;
}

async function fetchAllStudents(): Promise<ExistingStudentRow[]> {
  const supabase = createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select(
      "id, student_id, student_name, trainingpeaks_athlete_url, is_active, weekly_report_enabled, archived_at, telegram_chat_id, telegram_username, telegram_profile_url, telegram_delivery_enabled, data_quality_status, notes",
    )
    .order("student_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch trainingpeaks_students: ${error.message}`);
  }

  return (data as ExistingStudentRow[]) ?? [];
}

async function applyInserts(
  rows: WouldInsertRow[],
): Promise<Array<{ student_id: string; ok: boolean; error?: string }>> {
  const supabase = createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

  const results: Array<{ student_id: string; ok: boolean; error?: string }> = [];

  for (const row of rows) {
    const { error } = await supabase.from("trainingpeaks_students").insert({
      student_id: row.student_id,
      student_name: row.student_name,
      trainingpeaks_athlete_url: row.trainingpeaks_athlete_url,
      is_active: true,
      weekly_report_enabled: false,
      telegram_delivery_enabled: false,
      data_quality_status: "ok",
      notes: null,
    });

    if (error) {
      results.push({ student_id: row.student_id, ok: false, error: error.message });
    } else {
      results.push({ student_id: row.student_id, ok: true });
    }
  }

  return results;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadLocalEnv();

  const discoveryPath = path.resolve(args.fromDiscovery);
  const discovered = loadDiscoveryFile(discoveryPath);
  const existing = await fetchAllStudents();
  const plan = buildImportPlan(discovered, existing);

  const artifactDir = path.join(ARTIFACTS_ROOT, timestampForPath(new Date()));
  const reportJsonPath = path.join(artifactDir, "import-report.json");
  const reportMdPath = path.join(artifactDir, "import-report.md");

  await mkdir(artifactDir, { recursive: true });

  const report: ImportReport = {
    run_at: new Date().toISOString(),
    mode: args.apply ? "apply" : "dry-run",
    discovery_file: discoveryPath,
    ...plan,
    output_paths: {
      report_json: reportJsonPath,
      report_md: reportMdPath,
    },
  };

  if (args.apply) {
    const applyResults = await applyInserts(plan.would_insert);
    const inserted = applyResults.filter((row) => row.ok).length;
    const insertErrors = applyResults.filter((row) => !row.ok).length;
    report.apply_results = applyResults;
    report.summary.inserted = inserted;
    report.summary.insert_errors = insertErrors;
  }

  await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(reportMdPath, buildMarkdownReport(report), "utf8");

  console.log("");
  console.log(`[tp-import-athletes] mode=${report.mode}`);
  console.log(`[tp-import-athletes] discovery=${discoveryPath}`);
  console.log("");
  console.log("summary:");
  console.log(`  discovered_total: ${report.summary.discovered_total}`);
  console.log(`  existing_total: ${report.summary.existing_total}`);
  console.log(`  already_exists: ${report.summary.already_exists}`);
  console.log(`  archived_existing: ${report.summary.archived_existing}`);
  console.log(`  would_insert: ${report.summary.would_insert}`);
  console.log(`  slug_collisions: ${report.summary.slug_collisions}`);
  console.log(`  name_warnings: ${report.summary.name_warnings}`);
  console.log(`  supabase_not_in_tp: ${report.summary.supabase_not_in_tp}`);

  if (report.slug_collisions.length) {
    console.log("");
    console.log("slug_collisions (resolved with suffix):");
    for (const row of report.slug_collisions.slice(0, 10)) {
      console.log(
        `  - ${row.display_name} (${row.athlete_id}): ${row.base_slug} -> ${row.resolved_student_id} (conflicts with ${row.conflicting_existing_student_id})`,
      );
    }
    if (report.slug_collisions.length > 10) {
      console.log(`  ... and ${report.slug_collisions.length - 10} more`);
    }
  }

  if (report.name_warnings.length) {
    console.log("");
    console.log("name_warnings:");
    for (const row of report.name_warnings.slice(0, 10)) {
      console.log(
        `  - TP ${row.display_name} (${row.athlete_id}) vs existing ${row.existing_student_name} (${row.existing_student_id})`,
      );
    }
    if (report.name_warnings.length > 10) {
      console.log(`  ... and ${report.name_warnings.length - 10} more`);
    }
  }

  console.log("");
  console.log("would_insert_sample:");
  for (const row of report.would_insert_sample) {
    const suffixNote = row.slug_suffix ? ` (slug suffix -${row.slug_suffix})` : "";
    console.log(
      `  - ${row.student_id}${suffixNote} | ${row.student_name} | ${row.trainingpeaks_athlete_url}`,
    );
  }

  console.log("");
  console.log("artifact_paths:");
  console.log(`  - ${reportJsonPath}`);
  console.log(`  - ${reportMdPath}`);

  if (!args.apply) {
    console.log("");
    console.log("dry-run complete; pass --apply to insert new students only.");
  }
}

main().catch((error: unknown) => {
  console.error("tp-import-athletes failed.");
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
