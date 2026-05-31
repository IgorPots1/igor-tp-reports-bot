import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { PostgrestError } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/features/supabase/server";
import {
  buildIllnessMergedSummary,
  collectIllnessClusterEpisodes,
  HEALTH_MEMORY_TYPES,
  parseMemoryDuplicateSignals,
  passesIllnessClusterFilter,
  resolveIllnessEpisodeKey,
  type ParsedMemoryDuplicateSignals,
} from "@/features/trainingpeaks/coach-memory-duplicate-clustering";
import type { TrainingPeaksStudentMemoryType } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[diagnose-coach-memory-health]";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const RECENT_OBSERVATION_DAYS = 30;
const SUMMARY_TRUNCATE = 160;
const TOP_CLUSTERS_LIMIT = 5;

type CliOptions = {
  json: boolean;
  limit: number;
  studentQuery: string | null;
};

type StudentRow = {
  id: string;
  student_id: string;
  student_name: string;
  is_active: boolean;
};

type MemoryItemRow = {
  id: string;
  student_id: string;
  is_active: boolean;
  superseded_by: string | null;
  memory_type: TrainingPeaksStudentMemoryType;
  source: string;
  summary_text: string;
  confidence: number | null;
  created_at: string;
  updated_at: string;
  structured: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

type ObservationRow = {
  id: string;
  student_id: string | null;
  observed_at: string;
  source_type: string | null;
};

type ClusterConfidence = "low" | "medium" | "high";

type DuplicateClusterSummary = {
  cluster_id: string;
  student_id: string;
  student_slug: string;
  student_name: string;
  episode_key: string;
  confidence_risk: ClusterConfidence;
  item_count: number;
  memory_types: TrainingPeaksStudentMemoryType[];
  summary_count: number;
  suggested_merged_summary: string;
};

type SuspiciousSignal = {
  issue: string;
  count: number;
  sample_ids: string[];
};

type RecentMemoryItem = {
  id: string;
  student_slug: string;
  student_name: string;
  memory_type: TrainingPeaksStudentMemoryType;
  source: string;
  confidence: number | null;
  summary_text: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
};

type HealthReport = {
  mode: "read-only";
  query_policy: "select_only";
  filters: {
    student: string | null;
    limit: number;
  };
  status: {
    memory_status: "healthy" | "needs_review" | "empty" | "risky";
    duplicates_status: "ok" | "clusters_found";
    merge_health_status: "ok" | "partial_failure_suspected";
    coverage_status: "ok" | "low_coverage" | "no_recent_data";
  };
  totals: {
    active_students_count: number;
    total_memory_items: number;
    active_memory_items: number;
    inactive_or_superseded_memory_items: number;
    students_with_active_memory: number;
    students_without_active_memory: number;
  };
  memory_by_type: {
    active: Array<{ memory_type: string; count: number }>;
    total: Array<{ memory_type: string; count: number }>;
  };
  memory_by_source: {
    active: Array<{ source: string; count: number }>;
    total: Array<{ source: string; count: number }>;
  };
  recent_memory_activity: {
    last_created: RecentMemoryItem[];
    last_updated: RecentMemoryItem[];
  };
  duplicate_status: {
    clusters_found: number;
    top_clusters: DuplicateClusterSummary[];
  };
  merge_health: {
    status: "ok" | "partial_failure_suspected";
    suspicious_signals: SuspiciousSignal[];
  };
  coverage_hints: {
    recent_observation_days: number;
    observations_recent_count: number;
    students_with_recent_observations: number;
    students_with_recent_observations_no_active_memory: Array<{
      student_id: string;
      student_slug: string;
      student_name: string;
      observation_count: number;
      last_observed_at: string;
    }>;
  };
};

const ALL_MEMORY_TYPES: TrainingPeaksStudentMemoryType[] = [
  "communication_style",
  "schedule_constraint",
  "availability_preference",
  "pain_or_injury",
  "health_status",
  "emotional_state",
  "load_tolerance",
  "planning_preference",
  "race_or_goal",
  "travel_or_life_event",
  "equipment_or_device_note",
];

const SCHEDULE_TYPES = new Set<TrainingPeaksStudentMemoryType>([
  "schedule_constraint",
  "availability_preference",
  "planning_preference",
]);

const MEMORY_ITEM_SELECT =
  "id, student_id, is_active, superseded_by, memory_type, source, summary_text, confidence, created_at, updated_at, structured, metadata";

function loadLocalEnvFiles(): void {
  const repoRoot = path.resolve(process.cwd());
  const envPaths = [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")];

  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }
    const content = fs.readFileSync(envPath, "utf8");
    for (const rawLine of content.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      const key = line.slice(0, separatorIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }

      let value = line.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function isMissingRelationError(error: PostgrestError): boolean {
  const code = (error.code ?? "").toUpperCase();
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find the table")
  );
}

function parsePositiveInt(rawValue: string, flag: string): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid ${flag} value: ${rawValue}`);
  }
  return Math.floor(parsed);
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    limit: DEFAULT_LIMIT,
    studentQuery: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      options.limit = Math.min(parsePositiveInt(arg.slice("--limit=".length), "--limit"), MAX_LIMIT);
      continue;
    }
    if (arg === "--limit") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --limit`);
      }
      options.limit = Math.min(parsePositiveInt(next, "--limit"), MAX_LIMIT);
      index += 1;
      continue;
    }

    if (arg.startsWith("--student=")) {
      const value = arg.slice("--student=".length).trim();
      options.studentQuery = value || null;
      continue;
    }
    if (arg === "--student") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --student`);
      }
      options.studentQuery = next;
      index += 1;
      continue;
    }
  }

  return options;
}

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/\s+/gu, " ").trim();
}

function truncateSummary(value: string, maxLen: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLen) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function readStructuredString(structured: Record<string, unknown> | null, key: string): string | null {
  const value = structured?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readStructuredStringArray(structured: Record<string, unknown> | null, key: string): string[] {
  const value = structured?.[key];
  if (!Array.isArray(value)) {
    return [];
  }
  const output: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim().length > 0) {
      output.push(item);
    }
  }
  return output;
}

function incrementCounter(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

function sortedCounterEntries(counter: Record<string, number>): Array<[string, number]> {
  return Object.entries(counter).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function confidenceScore(value: ClusterConfidence): number {
  if (value === "high") {
    return 3;
  }
  if (value === "medium") {
    return 2;
  }
  return 1;
}

async function fetchStudents(): Promise<StudentRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_id, student_name, is_active")
    .limit(5000);
  if (error) {
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_students: ${error.message}`);
  }
  return (data as StudentRow[] | null) ?? [];
}

function resolveScopedStudents(students: StudentRow[], query: string | null): StudentRow[] {
  if (!query) {
    return students;
  }
  const normalized = normalizeText(query);
  return students.filter((student) => {
    return (
      student.id.toLowerCase().startsWith(normalized) ||
      student.student_id.toLowerCase().includes(normalized) ||
      student.student_name.toLowerCase().includes(normalized)
    );
  });
}

async function fetchMemoryItemsByStudentIds(studentIds: readonly string[]): Promise<MemoryItemRow[]> {
  if (studentIds.length === 0) {
    return [];
  }
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_memory_items")
    .select(MEMORY_ITEM_SELECT)
    .in("student_id", [...studentIds])
    .limit(10000);
  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: memory items: ${error.message}`);
  }
  return (data as MemoryItemRow[] | null) ?? [];
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function fetchRecentObservationsByStudentIds(studentIds: readonly string[], sinceIso: string): Promise<ObservationRow[]> {
  if (studentIds.length === 0) {
    return [];
  }
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_context_observations")
    .select("id, student_id, observed_at, source_type")
    .in("student_id", [...studentIds])
    .gte("observed_at", sinceIso)
    .order("observed_at", { ascending: false })
    .limit(10000);
  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: observations: ${error.message}`);
  }
  return (data as ObservationRow[] | null) ?? [];
}

function dedupeSummaries(items: MemoryItemRow[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const cleaned = item.summary_text.trim();
    if (cleaned) {
      set.add(cleaned);
    }
  }
  return [...set];
}

function typesInCluster(items: MemoryItemRow[]): TrainingPeaksStudentMemoryType[] {
  return [...new Set(items.map((item) => item.memory_type))].sort();
}

function clusterConfidence(
  episodeKey: string,
  items: MemoryItemRow[],
  signalsById: Map<string, ParsedMemoryDuplicateSignals>
): ClusterConfidence {
  const count = items.length;
  if (episodeKey.startsWith("health:pain:")) {
    if (count >= 3) {
      return "high";
    }
    return "medium";
  }
  if (episodeKey.startsWith("health:illness:upper_respiratory")) {
    const hasStrongMarker = items.some((item) => {
      const signals = signalsById.get(item.id);
      return signals?.hasIllnessStrongMarker || signals?.hasSickLeaveSignal;
    });
    if (count >= 3 && hasStrongMarker) {
      return "high";
    }
    return "medium";
  }
  if (episodeKey.startsWith("health:illness:general")) {
    const hasMultipleStrongMarkers =
      items.filter((item) => {
        const signals = signalsById.get(item.id);
        return signals?.hasIllnessStrongMarker || signals?.hasSickLeaveSignal;
      }).length >= 2;
    if (count >= 4 && hasMultipleStrongMarkers) {
      return "high";
    }
    return count >= 3 && hasMultipleStrongMarkers ? "medium" : "low";
  }
  if (episodeKey.startsWith("schedule:")) {
    if (episodeKey.includes("relative:")) {
      return count >= 3 ? "medium" : "low";
    }
    return count >= 2 ? "high" : "medium";
  }
  if (episodeKey.startsWith("race:")) {
    return count >= 2 ? "high" : "medium";
  }
  if (episodeKey === "load:fatigue") {
    return count >= 3 ? "medium" : "low";
  }
  return "low";
}

function buildMergedSummary(
  episodeKey: string,
  items: MemoryItemRow[],
  signalsById: Map<string, ParsedMemoryDuplicateSignals>
): string {
  if (episodeKey.startsWith("health:illness:upper_respiratory") || episodeKey.startsWith("health:illness:general")) {
    const illnessBaseKey = episodeKey.startsWith("health:illness:upper_respiratory")
      ? "health:illness:upper_respiratory"
      : "health:illness:general";
    const signalsList = items
      .map((item) => signalsById.get(item.id))
      .filter((signals): signals is ParsedMemoryDuplicateSignals => Boolean(signals));
    return buildIllnessMergedSummary(illnessBaseKey, signalsList);
  }
  if (episodeKey.startsWith("health:pain:")) {
    const bodyPart = episodeKey.slice("health:pain:".length);
    return `Эпизод боли: устойчивые сигналы дискомфорта в зоне ${bodyPart}.`;
  }
  if (episodeKey === "load:fatigue") {
    return "Накопленная усталость / перегруз: повторяющиеся сигналы снижения переносимости нагрузки.";
  }
  if (episodeKey.startsWith("schedule:")) {
    const anchor = episodeKey.slice("schedule:".length);
    return `Ограничение по расписанию в одном контексте (${anchor}).`;
  }
  if (episodeKey.startsWith("race:")) {
    return "Контекст старта/цели в одном соревновательном эпизоде.";
  }
  const example = dedupeSummaries(items)[0] ?? "";
  return example ? `Объединенный эпизод: ${example}` : "Объединенный эпизод.";
}

function conservativeClusterFilter(episodeKey: string, items: MemoryItemRow[]): boolean {
  if (items.length < 2) {
    return false;
  }
  if (episodeKey.startsWith("health:pain:")) {
    const types = new Set(items.map((item) => item.memory_type));
    return [...types].every((type) => HEALTH_MEMORY_TYPES.has(type));
  }
  if (episodeKey.startsWith("schedule:")) {
    return items.every((item) => SCHEDULE_TYPES.has(item.memory_type));
  }
  if (episodeKey.startsWith("health:illness:")) {
    return passesIllnessClusterFilter(items);
  }
  if (episodeKey === "load:fatigue") {
    return items.every((item) => item.memory_type === "load_tolerance" || item.memory_type === "emotional_state");
  }
  if (episodeKey.startsWith("race:")) {
    return items.every((item) => item.memory_type === "race_or_goal");
  }
  return false;
}

function buildClustersForStudent(studentItems: MemoryItemRow[]): Map<string, MemoryItemRow[]> {
  const clusters = new Map<string, MemoryItemRow[]>();
  const illnessEpisodes = collectIllnessClusterEpisodes(studentItems);
  const illnessSignalsById = new Map<string, ParsedMemoryDuplicateSignals>();
  for (const item of studentItems) {
    illnessSignalsById.set(item.id, parseMemoryDuplicateSignals(item.summary_text));
  }

  const illnessKeyCounts = new Map<string, number>();
  for (const illnessEpisode of illnessEpisodes) {
    if (illnessEpisode.items.length < 2 || !passesIllnessClusterFilter(illnessEpisode.items)) {
      continue;
    }
    const illnessBaseKey = resolveIllnessEpisodeKey(illnessEpisode.signals);
    const occurrence = (illnessKeyCounts.get(illnessBaseKey) ?? 0) + 1;
    illnessKeyCounts.set(illnessBaseKey, occurrence);
    const illnessEpisodeKey =
      occurrence === 1 ? illnessBaseKey : `${illnessBaseKey}:episode_${String(occurrence)}`;
    clusters.set(illnessEpisodeKey, illnessEpisode.items as MemoryItemRow[]);
  }

  for (const item of studentItems) {
    const signals = illnessSignalsById.get(item.id) ?? parseMemoryDuplicateSignals(item.summary_text);

    if (HEALTH_MEMORY_TYPES.has(item.memory_type) && signals.hasPainSignal && signals.bodyPart) {
      const key = `health:pain:${signals.bodyPart}`;
      clusters.set(key, [...(clusters.get(key) ?? []), item]);
    }

    if ((item.memory_type === "load_tolerance" || item.memory_type === "emotional_state") && signals.hasLoadFatigueSignal) {
      const key = "load:fatigue";
      clusters.set(key, [...(clusters.get(key) ?? []), item]);
    }

    if (SCHEDULE_TYPES.has(item.memory_type) && signals.scheduleAnchor) {
      const key = `schedule:${signals.scheduleAnchor}`;
      clusters.set(key, [...(clusters.get(key) ?? []), item]);
    }

    if (item.memory_type === "race_or_goal" && signals.raceAnchor && signals.raceDiscipline) {
      const key = `race:${signals.raceAnchor}:${signals.raceDiscipline}`;
      clusters.set(key, [...(clusters.get(key) ?? []), item]);
    }
  }

  for (const [key, clusterItems] of [...clusters.entries()]) {
    if (!conservativeClusterFilter(key, clusterItems)) {
      clusters.delete(key);
    }
  }

  return clusters;
}

function summarizeDuplicateClusters(
  studentsById: Map<string, StudentRow>,
  activeItemsByStudent: Map<string, MemoryItemRow[]>
): DuplicateClusterSummary[] {
  const proposals: DuplicateClusterSummary[] = [];
  for (const [studentId, studentItems] of activeItemsByStudent.entries()) {
    if (studentItems.length < 2) {
      continue;
    }
    const student = studentsById.get(studentId);
    if (!student) {
      continue;
    }
    const clusters = buildClustersForStudent(studentItems);
    const signalsById = new Map(studentItems.map((item) => [item.id, parseMemoryDuplicateSignals(item.summary_text)]));
    for (const [episodeKey, clusterItems] of clusters.entries()) {
      if (clusterItems.length < 2) {
        continue;
      }
      const summaries = dedupeSummaries(clusterItems);
      if (summaries.length < 2) {
        continue;
      }
      const confidenceRisk = clusterConfidence(episodeKey, clusterItems, signalsById);
      proposals.push({
        cluster_id: `${student.student_id}:${episodeKey}`,
        student_id: student.id,
        student_slug: student.student_id,
        student_name: student.student_name,
        episode_key: episodeKey,
        confidence_risk: confidenceRisk,
        item_count: clusterItems.length,
        memory_types: typesInCluster(clusterItems),
        summary_count: summaries.length,
        suggested_merged_summary: truncateSummary(
          buildMergedSummary(episodeKey, clusterItems, signalsById),
          SUMMARY_TRUNCATE
        ),
      });
    }
  }

  return proposals.sort((a, b) => {
    const confidenceDiff = confidenceScore(b.confidence_risk) - confidenceScore(a.confidence_risk);
    if (confidenceDiff !== 0) {
      return confidenceDiff;
    }
    if (b.item_count !== a.item_count) {
      return b.item_count - a.item_count;
    }
    return a.cluster_id.localeCompare(b.cluster_id);
  });
}

function buildRecentMemoryItems(
  items: MemoryItemRow[],
  studentsById: Map<string, StudentRow>,
  limit: number,
  orderBy: "created_at" | "updated_at"
): RecentMemoryItem[] {
  return [...items]
    .sort((a, b) => b[orderBy].localeCompare(a[orderBy]))
    .slice(0, limit)
    .map((item) => {
      const student = studentsById.get(item.student_id);
      return {
        id: item.id,
        student_slug: student?.student_id ?? item.student_id,
        student_name: student?.student_name ?? "<unknown>",
        memory_type: item.memory_type,
        source: item.source,
        confidence: item.confidence,
        summary_text: truncateSummary(item.summary_text, SUMMARY_TRUNCATE),
        created_at: item.created_at,
        updated_at: item.updated_at,
        is_active: item.is_active,
      };
    });
}

function buildMergeHealthSignals(
  memoryItems: MemoryItemRow[],
  activeDuplicateClusters: DuplicateClusterSummary[]
): SuspiciousSignal[] {
  const byId = new Map(memoryItems.map((item) => [item.id, item]));

  const activeMergedWithActiveSource = new Set<string>();
  const missingSupersedeTarget = new Set<string>();
  const inactiveMergeOutputNoSupersededBy = new Set<string>();

  for (const item of memoryItems) {
    const mergeClusterId = readStructuredString(item.structured, "merge_cluster_id");
    const sourceIds = readStructuredStringArray(item.structured, "merge_source_item_ids");

    if (item.is_active && mergeClusterId && sourceIds.length > 0) {
      const hasActiveSource = sourceIds.some((sourceId) => byId.get(sourceId)?.is_active === true);
      if (hasActiveSource) {
        activeMergedWithActiveSource.add(item.id);
      }
    }

    if (item.superseded_by) {
      if (!byId.has(item.superseded_by)) {
        missingSupersedeTarget.add(item.id);
      }
    }

    if (!item.is_active && !item.superseded_by && mergeClusterId) {
      inactiveMergeOutputNoSupersededBy.add(item.id);
    }
  }

  const suspiciousSignals: SuspiciousSignal[] = [];
  if (activeMergedWithActiveSource.size > 0) {
    suspiciousSignals.push({
      issue: "active_merged_row_has_active_sources",
      count: activeMergedWithActiveSource.size,
      sample_ids: [...activeMergedWithActiveSource].slice(0, 10),
    });
  }
  if (missingSupersedeTarget.size > 0) {
    suspiciousSignals.push({
      issue: "source_rows_superseded_by_missing_target",
      count: missingSupersedeTarget.size,
      sample_ids: [...missingSupersedeTarget].slice(0, 10),
    });
  }
  if (inactiveMergeOutputNoSupersededBy.size > 0) {
    suspiciousSignals.push({
      issue: "inactive_merge_outputs_without_superseded_by",
      count: inactiveMergeOutputNoSupersededBy.size,
      sample_ids: [...inactiveMergeOutputNoSupersededBy].slice(0, 10),
    });
  }
  if (activeDuplicateClusters.length > 0) {
    suspiciousSignals.push({
      issue: "active_duplicate_clusters_remaining",
      count: activeDuplicateClusters.length,
      sample_ids: activeDuplicateClusters.slice(0, 10).map((cluster) => cluster.cluster_id),
    });
  }
  return suspiciousSignals;
}

function deriveStatus(input: {
  activeMemoryItems: number;
  totalMemoryItems: number;
  studentsWithActiveMemory: number;
  activeStudentsCount: number;
  duplicateClustersFound: number;
  mergeSignalsCount: number;
  observationsRecentCount: number;
  studentsRecentNoMemoryCount: number;
}): HealthReport["status"] {
  const duplicatesStatus = input.duplicateClustersFound > 0 ? "clusters_found" : "ok";
  const mergeHealthStatus = input.mergeSignalsCount > 0 ? "partial_failure_suspected" : "ok";

  let coverageStatus: "ok" | "low_coverage" | "no_recent_data" = "ok";
  if (input.observationsRecentCount === 0) {
    coverageStatus = "no_recent_data";
  } else {
    const lowCoverageByStudents =
      input.activeStudentsCount > 0 && input.studentsWithActiveMemory / input.activeStudentsCount < 0.35;
    const recentNoMemoryRisk = input.studentsRecentNoMemoryCount >= 3;
    if (lowCoverageByStudents || recentNoMemoryRisk) {
      coverageStatus = "low_coverage";
    }
  }

  let memoryStatus: "healthy" | "needs_review" | "empty" | "risky" = "healthy";
  if (input.totalMemoryItems === 0 || input.activeMemoryItems === 0) {
    memoryStatus = "empty";
  } else if (mergeHealthStatus === "partial_failure_suspected") {
    memoryStatus = "risky";
  } else if (duplicatesStatus === "clusters_found" || coverageStatus === "low_coverage") {
    memoryStatus = "needs_review";
  }

  return {
    memory_status: memoryStatus,
    duplicates_status: duplicatesStatus,
    merge_health_status: mergeHealthStatus,
    coverage_status: coverageStatus,
  };
}

function printReadableOutput(report: HealthReport): void {
  const status = report.status;
  console.log(`${LOG_PREFIX} mode=read-only`);
  console.log(`${LOG_PREFIX} query_policy=select_only`);
  console.log(`${LOG_PREFIX} memory_status=${status.memory_status}`);
  console.log(`${LOG_PREFIX} duplicates_status=${status.duplicates_status}`);
  console.log(`${LOG_PREFIX} merge_health_status=${status.merge_health_status}`);
  console.log(`${LOG_PREFIX} coverage_status=${status.coverage_status}`);

  console.log("");
  console.log(`${LOG_PREFIX} [basic_totals]`);
  console.log(`${LOG_PREFIX} active_students_count=${report.totals.active_students_count}`);
  console.log(`${LOG_PREFIX} total_memory_items=${report.totals.total_memory_items}`);
  console.log(`${LOG_PREFIX} active_memory_items=${report.totals.active_memory_items}`);
  console.log(
    `${LOG_PREFIX} inactive_or_superseded_memory_items=${report.totals.inactive_or_superseded_memory_items}`
  );
  console.log(`${LOG_PREFIX} students_with_active_memory=${report.totals.students_with_active_memory}`);
  console.log(`${LOG_PREFIX} students_without_active_memory=${report.totals.students_without_active_memory}`);

  console.log("");
  console.log(`${LOG_PREFIX} [memory_by_type_active]`);
  for (const row of report.memory_by_type.active) {
    console.log(`${LOG_PREFIX} memory_type=${row.memory_type} active_count=${row.count}`);
  }
  console.log(`${LOG_PREFIX} [memory_by_type_total]`);
  for (const row of report.memory_by_type.total) {
    console.log(`${LOG_PREFIX} memory_type=${row.memory_type} total_count=${row.count}`);
  }

  console.log("");
  console.log(`${LOG_PREFIX} [memory_by_source_active]`);
  for (const row of report.memory_by_source.active) {
    console.log(`${LOG_PREFIX} source=${row.source} active_count=${row.count}`);
  }
  console.log(`${LOG_PREFIX} [memory_by_source_total]`);
  for (const row of report.memory_by_source.total) {
    console.log(`${LOG_PREFIX} source=${row.source} total_count=${row.count}`);
  }

  console.log("");
  console.log(`${LOG_PREFIX} [recent_memory_created]`);
  for (const row of report.recent_memory_activity.last_created) {
    console.log(
      `${LOG_PREFIX} created id=${row.id} student=${row.student_name}(${row.student_slug}) type=${row.memory_type} source=${row.source} confidence=${row.confidence ?? "null"} created_at=${row.created_at} updated_at=${row.updated_at} summary=${JSON.stringify(row.summary_text)}`
    );
  }
  console.log(`${LOG_PREFIX} [recent_memory_updated]`);
  for (const row of report.recent_memory_activity.last_updated) {
    console.log(
      `${LOG_PREFIX} updated id=${row.id} student=${row.student_name}(${row.student_slug}) type=${row.memory_type} source=${row.source} confidence=${row.confidence ?? "null"} created_at=${row.created_at} updated_at=${row.updated_at} summary=${JSON.stringify(row.summary_text)}`
    );
  }

  console.log("");
  console.log(`${LOG_PREFIX} [duplicate_status]`);
  console.log(`${LOG_PREFIX} clusters_found=${report.duplicate_status.clusters_found}`);
  for (const cluster of report.duplicate_status.top_clusters) {
    console.log(
      `${LOG_PREFIX} cluster_id=${cluster.cluster_id} student=${cluster.student_name}(${cluster.student_slug}) confidence_risk=${cluster.confidence_risk} item_count=${cluster.item_count} summary_count=${cluster.summary_count} episode_key=${cluster.episode_key} memory_types=${cluster.memory_types.join(",")} merged_summary=${JSON.stringify(cluster.suggested_merged_summary)}`
    );
  }

  console.log("");
  console.log(`${LOG_PREFIX} [merge_health]`);
  console.log(`${LOG_PREFIX} merge_health_status=${report.merge_health.status}`);
  if (report.merge_health.suspicious_signals.length === 0) {
    console.log(`${LOG_PREFIX} suspicious_signals=none`);
  } else {
    for (const signal of report.merge_health.suspicious_signals) {
      console.log(
        `${LOG_PREFIX} issue=${signal.issue} count=${signal.count} sample_ids=${signal.sample_ids.length > 0 ? signal.sample_ids.join(",") : "<none>"}`
      );
    }
  }

  console.log("");
  console.log(`${LOG_PREFIX} [coverage_hints]`);
  console.log(`${LOG_PREFIX} recent_observation_days=${report.coverage_hints.recent_observation_days}`);
  console.log(`${LOG_PREFIX} observations_recent_count=${report.coverage_hints.observations_recent_count}`);
  console.log(
    `${LOG_PREFIX} students_with_recent_observations=${report.coverage_hints.students_with_recent_observations}`
  );
  for (const row of report.coverage_hints.students_with_recent_observations_no_active_memory) {
    console.log(
      `${LOG_PREFIX} student_with_observations_no_memory=${row.student_name}(${row.student_slug}) observation_count=${row.observation_count} last_observed_at=${row.last_observed_at}`
    );
  }

  console.log("");
  console.log(`${LOG_PREFIX} OK read-only health diagnostic complete`);
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    console.log(`${LOG_PREFIX} SKIP: missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
    return;
  }
  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = supabaseUrl;
  }

  const allStudents = await fetchStudents();
  const scopedStudents = resolveScopedStudents(allStudents, options.studentQuery);
  if (scopedStudents.length === 0) {
    console.log(`${LOG_PREFIX} student_filter=no_matches`);
    console.log(`${LOG_PREFIX} student_query=${JSON.stringify(options.studentQuery)}`);
    return;
  }

  const studentIds = scopedStudents.map((student) => student.id);
  const studentsById = new Map(scopedStudents.map((student) => [student.id, student]));
  const activeStudentsCount = scopedStudents.filter((student) => student.is_active).length;

  const [memoryItems, recentObservations] = await Promise.all([
    fetchMemoryItemsByStudentIds(studentIds),
    fetchRecentObservationsByStudentIds(studentIds, isoDaysAgo(RECENT_OBSERVATION_DAYS)),
  ]);

  const activeItems = memoryItems.filter((item) => item.is_active);
  const inactiveItems = memoryItems.filter((item) => !item.is_active);

  const activeByTypeCounter: Record<string, number> = {};
  const totalByTypeCounter: Record<string, number> = {};
  const activeBySourceCounter: Record<string, number> = {};
  const totalBySourceCounter: Record<string, number> = {};
  const activeMemoryStudentIds = new Set<string>();
  const activeItemsByStudent = new Map<string, MemoryItemRow[]>();

  for (const item of memoryItems) {
    incrementCounter(totalByTypeCounter, item.memory_type);
    incrementCounter(totalBySourceCounter, item.source || "unknown");
    if (item.is_active) {
      incrementCounter(activeByTypeCounter, item.memory_type);
      incrementCounter(activeBySourceCounter, item.source || "unknown");
      activeMemoryStudentIds.add(item.student_id);
      activeItemsByStudent.set(item.student_id, [...(activeItemsByStudent.get(item.student_id) ?? []), item]);
    }
  }

  for (const memoryType of ALL_MEMORY_TYPES) {
    if (!totalByTypeCounter[memoryType]) {
      totalByTypeCounter[memoryType] = 0;
    }
    if (!activeByTypeCounter[memoryType]) {
      activeByTypeCounter[memoryType] = 0;
    }
  }

  const recentObservationByStudent = new Map<
    string,
    { count: number; lastObservedAt: string; sourceTypeCounts: Record<string, number> }
  >();
  for (const row of recentObservations) {
    if (!row.student_id) {
      continue;
    }
    const prev = recentObservationByStudent.get(row.student_id) ?? {
      count: 0,
      lastObservedAt: row.observed_at,
      sourceTypeCounts: {},
    };
    prev.count += 1;
    if (row.observed_at > prev.lastObservedAt) {
      prev.lastObservedAt = row.observed_at;
    }
    incrementCounter(prev.sourceTypeCounts, row.source_type ?? "unknown");
    recentObservationByStudent.set(row.student_id, prev);
  }

  const duplicateClusters = summarizeDuplicateClusters(studentsById, activeItemsByStudent);
  const topClusters = duplicateClusters.slice(0, Math.max(1, Math.min(options.limit, TOP_CLUSTERS_LIMIT)));
  const mergeHealthSignals = buildMergeHealthSignals(memoryItems, duplicateClusters);

  const studentsWithRecentObservationsNoActiveMemory = [...recentObservationByStudent.entries()]
    .filter(([studentId]) => !activeMemoryStudentIds.has(studentId))
    .map(([studentId, stats]) => {
      const student = studentsById.get(studentId);
      return {
        student_id: studentId,
        student_slug: student?.student_id ?? studentId,
        student_name: student?.student_name ?? "<unknown>",
        observation_count: stats.count,
        last_observed_at: stats.lastObservedAt,
      };
    })
    .sort((a, b) => b.observation_count - a.observation_count || b.last_observed_at.localeCompare(a.last_observed_at))
    .slice(0, options.limit);

  const status = deriveStatus({
    activeMemoryItems: activeItems.length,
    totalMemoryItems: memoryItems.length,
    studentsWithActiveMemory: activeMemoryStudentIds.size,
    activeStudentsCount,
    duplicateClustersFound: duplicateClusters.length,
    mergeSignalsCount: mergeHealthSignals.length,
    observationsRecentCount: recentObservations.length,
    studentsRecentNoMemoryCount: studentsWithRecentObservationsNoActiveMemory.length,
  });

  const report: HealthReport = {
    mode: "read-only",
    query_policy: "select_only",
    filters: {
      student: options.studentQuery,
      limit: options.limit,
    },
    status,
    totals: {
      active_students_count: activeStudentsCount,
      total_memory_items: memoryItems.length,
      active_memory_items: activeItems.length,
      inactive_or_superseded_memory_items: inactiveItems.length,
      students_with_active_memory: activeMemoryStudentIds.size,
      students_without_active_memory: Math.max(0, activeStudentsCount - activeMemoryStudentIds.size),
    },
    memory_by_type: {
      active: sortedCounterEntries(activeByTypeCounter).map(([memory_type, count]) => ({ memory_type, count })),
      total: sortedCounterEntries(totalByTypeCounter).map(([memory_type, count]) => ({ memory_type, count })),
    },
    memory_by_source: {
      active: sortedCounterEntries(activeBySourceCounter).map(([source, count]) => ({ source, count })),
      total: sortedCounterEntries(totalBySourceCounter).map(([source, count]) => ({ source, count })),
    },
    recent_memory_activity: {
      last_created: buildRecentMemoryItems(memoryItems, studentsById, options.limit, "created_at"),
      last_updated: buildRecentMemoryItems(memoryItems, studentsById, options.limit, "updated_at"),
    },
    duplicate_status: {
      clusters_found: duplicateClusters.length,
      top_clusters: topClusters,
    },
    merge_health: {
      status: mergeHealthSignals.length > 0 ? "partial_failure_suspected" : "ok",
      suspicious_signals: mergeHealthSignals,
    },
    coverage_hints: {
      recent_observation_days: RECENT_OBSERVATION_DAYS,
      observations_recent_count: recentObservations.length,
      students_with_recent_observations: recentObservationByStudent.size,
      students_with_recent_observations_no_active_memory: studentsWithRecentObservationsNoActiveMemory,
    },
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printReadableOutput(report);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
