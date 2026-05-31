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
import {
  insertTrainingPeaksStudentMemoryItem,
  supersedeTrainingPeaksStudentMemoryItem,
  type TrainingPeaksStudentMemoryType,
} from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[merge-coach-memory-duplicates]";

type CliOptions = {
  studentQuery: string;
  episodeKey: string | null;
  clusterId: string | null;
  json: boolean;
  apply: boolean;
};

type StudentRow = {
  id: string;
  student_id: string;
  student_name: string;
};

type MemoryItemRow = {
  id: string;
  student_id: string;
  is_active: boolean;
  memory_type: TrainingPeaksStudentMemoryType;
  summary_text: string;
  confidence: number | null;
  valid_from: string | null;
  valid_until: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  structured: Record<string, unknown> | null;
};

type ClusterConfidence = "low" | "medium" | "high";

type ClusterTarget = {
  clusterId: string;
  studentId: string;
  studentSlug: string;
  studentName: string;
  episodeKey: string;
  confidenceRisk: ClusterConfidence;
  itemCount: number;
  items: MemoryItemRow[];
  memoryTypes: TrainingPeaksStudentMemoryType[];
  currentActiveSummaries: string[];
  proposedMergedSummary: string;
  proposedMergedMemoryType: TrainingPeaksStudentMemoryType;
  proposedStructuredAdditions: Record<string, unknown>;
  proposedSupersedeMetadata: {
    reason: "duplicate_cluster_merge";
    merge_cluster_id: string;
    new_merged_item_id: "<new_merged_item_id>";
    superseded_at: "<apply_timestamp>";
  };
  proposedSourceItemIds: string[];
  proposedDeactivateOperations: Array<{
    itemId: string;
    set_is_active: false;
    set_superseded_by: "<new_merged_item_id>";
    reason: "duplicate_cluster_merge";
  }>;
};

type JsonOutput = {
  mode: "dry-run";
  policy: "no_writes";
  write_status: "no DB writes were performed";
  student_scope: {
    query: string;
    matched_students: Array<{ id: string; slug: string; name: string }>;
  };
  selectedCluster: ClusterTarget;
  availableClusterCount: number;
  filters: {
    student: string;
    episodeKey: string | null;
    clusterId: string | null;
  };
  preferredTargeting: {
    recommended_cluster_id: string;
    recommended_cluster_command: string;
    apply_safety_note: string;
  };
  futureApplyPlan: string[];
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

function parseRequiredValue(argv: string[], index: number, flag: string): { value: string; consumed: number } {
  const next = argv[index + 1]?.trim();
  if (!next || next.startsWith("--")) {
    throw new Error(`${LOG_PREFIX} FAIL: missing value for ${flag}`);
  }
  return { value: next, consumed: 1 };
}

function parseCliOptions(argv: string[]): CliOptions {
  let studentQuery: string | null = null;
  let episodeKey: string | null = null;
  let clusterId: string | null = null;
  let json = false;
  let apply = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--apply") {
      apply = true;
      continue;
    }

    if (arg.startsWith("--student=")) {
      studentQuery = arg.slice("--student=".length).trim() || null;
      continue;
    }
    if (arg === "--student") {
      const parsed = parseRequiredValue(argv, index, "--student");
      studentQuery = parsed.value;
      index += parsed.consumed;
      continue;
    }

    if (arg.startsWith("--episode-key=")) {
      episodeKey = arg.slice("--episode-key=".length).trim() || null;
      continue;
    }
    if (arg === "--episode-key") {
      const parsed = parseRequiredValue(argv, index, "--episode-key");
      episodeKey = parsed.value;
      index += parsed.consumed;
      continue;
    }

    if (arg.startsWith("--cluster-id=")) {
      clusterId = arg.slice("--cluster-id=".length).trim() || null;
      continue;
    }
    if (arg === "--cluster-id") {
      const parsed = parseRequiredValue(argv, index, "--cluster-id");
      clusterId = parsed.value;
      index += parsed.consumed;
      continue;
    }
  }

  if (!studentQuery) {
    throw new Error(`${LOG_PREFIX} FAIL: --student is required`);
  }
  if (episodeKey && clusterId) {
    throw new Error(`${LOG_PREFIX} FAIL: pass only one targeting flag: --episode-key or --cluster-id`);
  }
  if (apply && episodeKey) {
    throw new Error(`${LOG_PREFIX} FAIL: --apply rejects --episode-key; use exact --cluster-id`);
  }
  if (apply && !clusterId) {
    throw new Error(`${LOG_PREFIX} FAIL: --apply requires --cluster-id`);
  }

  return {
    studentQuery,
    episodeKey,
    clusterId,
    json,
    apply,
  };
}

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/\s+/gu, " ").trim();
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

async function fetchStudents(): Promise<StudentRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.from("trainingpeaks_students").select("id, student_id, student_name").limit(5000);
  if (error) {
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_students: ${error.message}`);
  }
  return (data as StudentRow[] | null) ?? [];
}

function resolveStudentMatches(students: StudentRow[], query: string): StudentRow[] {
  const normalized = normalizeText(query);
  const exactMatches = students.filter((student) => {
    return (
      student.id.toLowerCase() === normalized ||
      student.student_id.toLowerCase() === normalized ||
      normalizeText(student.student_name) === normalized
    );
  });
  if (exactMatches.length > 0) {
    return exactMatches;
  }

  return students.filter((student) => {
    return (
      student.id.toLowerCase().startsWith(normalized) ||
      student.student_id.toLowerCase().includes(normalized) ||
      student.student_name.toLowerCase().includes(normalized)
    );
  });
}

function resolveStudentMatchesForApply(students: StudentRow[], query: string): StudentRow[] {
  const normalized = query.trim().toLowerCase();
  return students.filter((student) => student.student_id.toLowerCase() === normalized);
}

function confidenceToNumeric(confidence: ClusterConfidence): number {
  if (confidence === "high") {
    return 0.9;
  }
  if (confidence === "medium") {
    return 0.7;
  }
  return 0.5;
}

async function fetchActiveMemoryItems(studentId: string): Promise<MemoryItemRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_memory_items")
    .select(
      "id, student_id, is_active, memory_type, summary_text, confidence, valid_from, valid_until, first_seen_at, last_seen_at, created_at, updated_at, structured"
    )
    .eq("is_active", true)
    .eq("student_id", studentId)
    .order("memory_type", { ascending: true })
    .order("last_seen_at", { ascending: false })
    .limit(5000);

  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_student_memory_items: ${error.message}`);
  }
  return (data as MemoryItemRow[] | null) ?? [];
}

async function fetchMemoryItemsByIds(ids: readonly string[]): Promise<MemoryItemRow[]> {
  if (ids.length === 0) {
    return [];
  }
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_memory_items")
    .select(
      "id, student_id, is_active, memory_type, summary_text, confidence, valid_from, valid_until, first_seen_at, last_seen_at, created_at, updated_at, structured"
    )
    .in("id", [...ids])
    .limit(5000);

  if (error) {
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_student_memory_items by ids: ${error.message}`);
  }
  return (data as MemoryItemRow[] | null) ?? [];
}

function sortedIds(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => a.localeCompare(b));
}

function equalIdSets(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const sortedLeft = sortedIds(left);
  const sortedRight = sortedIds(right);
  return sortedLeft.every((id, index) => id === sortedRight[index]);
}

function readStructuredString(structured: Record<string, unknown> | null, key: string): string | null {
  const value = structured?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readStructuredNumber(structured: Record<string, unknown> | null, key: string): number | null {
  const value = structured?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function minIsoValue(values: Array<string | null>): string | undefined {
  const nonNull = values.filter((value): value is string => Boolean(value));
  if (nonNull.length === 0) {
    return undefined;
  }
  return nonNull.reduce((min, value) => (value < min ? value : min));
}

function maxIsoValue(values: Array<string | null>): string | undefined {
  const nonNull = values.filter((value): value is string => Boolean(value));
  if (nonNull.length === 0) {
    return undefined;
  }
  return nonNull.reduce((max, value) => (value > max ? value : max));
}

function sharedValidUntilOrNull(items: readonly MemoryItemRow[]): string | null {
  if (items.length === 0) {
    return null;
  }
  const first = items[0]?.valid_until ?? null;
  if (first === null) {
    return null;
  }
  return items.every((item) => item.valid_until === first) ? first : null;
}

async function runGuardedApply(options: CliOptions, selected: ClusterTarget): Promise<void> {
  if (!options.clusterId) {
    throw new Error(`${LOG_PREFIX} FAIL: --apply requires --cluster-id`);
  }

  if (selected.confidenceRisk === "low") {
    throw new Error(`${LOG_PREFIX} FAIL: confidence_risk=low; apply is blocked`);
  }

  const selectedSourceIds = sortedIds(selected.proposedSourceItemIds);
  const selectedStudent: StudentRow = {
    id: selected.studentId,
    student_id: selected.studentSlug,
    student_name: selected.studentName,
  };

  // Guard 1: recompute clusters from live DB right before write.
  const liveActiveItems = await fetchActiveMemoryItems(selected.studentId);
  const liveClusters = buildClusterTargets(selectedStudent, liveActiveItems);
  const liveMatches = liveClusters.filter((cluster) => cluster.clusterId === options.clusterId);
  if (liveMatches.length !== 1) {
    throw new Error(
      `${LOG_PREFIX} FAIL: live --cluster-id match_count=${liveMatches.length}; expected exactly 1 before apply`
    );
  }
  const liveCluster = liveMatches[0];
  const liveClusterSourceIds = sortedIds(liveCluster.proposedSourceItemIds);

  if (!equalIdSets(selectedSourceIds, liveClusterSourceIds)) {
    throw new Error(
      `${LOG_PREFIX} FAIL: cluster drift detected; live source IDs changed for cluster_id=${options.clusterId}`
    );
  }

  if (liveCluster.confidenceRisk === "low") {
    throw new Error(`${LOG_PREFIX} FAIL: live confidence_risk=low; apply is blocked`);
  }

  // Guard 7: idempotency - stop if merged active row already exists.
  const existingMerged = liveActiveItems.find(
    (item) => readStructuredString(item.structured, "merge_cluster_id") === options.clusterId
  );
  if (existingMerged) {
    throw new Error(
      `${LOG_PREFIX} FAIL: idempotency guard hit; active merged row already exists for cluster_id=${options.clusterId} (id=${existingMerged.id})`
    );
  }

  // Guards 3/4/5: reload source rows by ID and assert exact live set + ownership/activity.
  const sourceRows = await fetchMemoryItemsByIds(liveClusterSourceIds);
  const sourceRowIds = sourceRows.map((row) => row.id);
  if (!equalIdSets(liveClusterSourceIds, sourceRowIds)) {
    throw new Error(`${LOG_PREFIX} FAIL: source rows re-read mismatch; missing or extra IDs detected`);
  }
  for (const row of sourceRows) {
    if (!row.is_active) {
      throw new Error(`${LOG_PREFIX} FAIL: source row is not active: ${row.id}`);
    }
    if (row.student_id !== selected.studentId) {
      throw new Error(
        `${LOG_PREFIX} FAIL: source row belongs to different student: ${row.id} student_id=${row.student_id}`
      );
    }
  }

  // Guard 6: re-cluster current source rows must still resolve to same cluster + same IDs.
  const reClusterTargets = buildClusterTargets(selectedStudent, sourceRows);
  const reClusterMatch = reClusterTargets.filter((cluster) => cluster.clusterId === options.clusterId);
  if (reClusterMatch.length !== 1) {
    throw new Error(
      `${LOG_PREFIX} FAIL: source-row recluster mismatch for cluster_id=${options.clusterId}; match_count=${reClusterMatch.length}`
    );
  }
  if (!equalIdSets(reClusterMatch[0].proposedSourceItemIds, liveClusterSourceIds)) {
    throw new Error(`${LOG_PREFIX} FAIL: source-row recluster IDs drifted for selected cluster`);
  }

  const appliedAt = new Date().toISOString();
  const mergeStrategy = "coach_memory_duplicate_cluster_v1";
  const inserted = await insertTrainingPeaksStudentMemoryItem({
    studentId: selected.studentId,
    memoryType: liveCluster.proposedMergedMemoryType,
    summaryText: liveCluster.proposedMergedSummary,
    structured: liveCluster.proposedStructuredAdditions,
    source: "system",
    confidence: readStructuredNumber(liveCluster.proposedStructuredAdditions, "proposed_confidence"),
    validFrom: minIsoValue(sourceRows.map((row) => row.valid_from)) ?? null,
    validUntil: sharedValidUntilOrNull(sourceRows),
    firstSeenAt: minIsoValue(sourceRows.map((row) => row.first_seen_at)),
    lastSeenAt: maxIsoValue(sourceRows.map((row) => row.last_seen_at)),
    isActive: true,
    metadata: {
      applied_at: appliedAt,
      merge_cluster_id: options.clusterId,
      merge_strategy: mergeStrategy,
      source_item_ids: liveClusterSourceIds,
      apply_source: "merge-coach-memory-duplicates",
    },
  });

  const supersededIds: string[] = [];
  const failedSupersedes: Array<{ itemId: string; reason: string }> = [];
  for (const sourceId of liveClusterSourceIds) {
    try {
      const superseded = await supersedeTrainingPeaksStudentMemoryItem(sourceId, inserted.id);
      if (!superseded) {
        failedSupersedes.push({ itemId: sourceId, reason: "supersede returned null" });
        continue;
      }
      supersededIds.push(sourceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failedSupersedes.push({ itemId: sourceId, reason: message });
    }
  }

  console.log(`${LOG_PREFIX} mode=apply`);
  if (failedSupersedes.length === 0) {
    console.log(`${LOG_PREFIX} write_status=completed`);
  } else {
    console.log(`${LOG_PREFIX} write_status=partial_failure`);
  }
  console.log(`${LOG_PREFIX} new_merged_item_id=${inserted.id}`);
  for (const supersededId of supersededIds) {
    console.log(`${LOG_PREFIX} superseded_item_id=${supersededId}`);
  }
  console.log(`${LOG_PREFIX} no deletes performed`);

  if (failedSupersedes.length > 0) {
    console.error(`${LOG_PREFIX} WARNING partial supersede failure`);
    console.error(`${LOG_PREFIX} warning_new_merged_item_id=${inserted.id}`);
    console.error(
      `${LOG_PREFIX} warning_superseded_item_ids=${supersededIds.length > 0 ? supersededIds.join(",") : "<none>"}`
    );
    for (const failed of failedSupersedes) {
      console.error(`${LOG_PREFIX} warning_failed_source_item_id=${failed.itemId}`);
      console.error(`${LOG_PREFIX} warning_failed_reason=${JSON.stringify(failed.reason)}`);
    }
    console.error(`${LOG_PREFIX} warning_manual_cleanup=may_be_required`);
    process.exitCode = 1;
  }
}

function dedupeSummaries(items: MemoryItemRow[]): string[] {
  const unique = new Set<string>();
  for (const item of items) {
    const cleaned = item.summary_text.trim();
    if (cleaned) {
      unique.add(cleaned);
    }
  }
  return [...unique];
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
    const illnessEpisodeKey = occurrence === 1 ? illnessBaseKey : `${illnessBaseKey}:episode_${String(occurrence)}`;
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

function resolveProposedMergedMemoryType(episodeKey: string, items: MemoryItemRow[]): TrainingPeaksStudentMemoryType {
  if (episodeKey.startsWith("health:")) {
    return items.some((item) => item.memory_type === "health_status") ? "health_status" : "pain_or_injury";
  }
  if (episodeKey.startsWith("schedule:")) {
    if (items.some((item) => item.memory_type === "schedule_constraint")) {
      return "schedule_constraint";
    }
    if (items.some((item) => item.memory_type === "availability_preference")) {
      return "availability_preference";
    }
    return "planning_preference";
  }
  if (episodeKey.startsWith("race:")) {
    return "race_or_goal";
  }
  if (episodeKey === "load:fatigue") {
    return "load_tolerance";
  }

  const counts = new Map<TrainingPeaksStudentMemoryType, number>();
  for (const item of items) {
    counts.set(item.memory_type, (counts.get(item.memory_type) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return sorted[0]?.[0] ?? ALL_MEMORY_TYPES[0];
}

function buildClusterTargets(student: StudentRow, studentItems: MemoryItemRow[]): ClusterTarget[] {
  const clusters = buildClustersForStudent(studentItems);
  const signalsById = new Map(studentItems.map((item) => [item.id, parseMemoryDuplicateSignals(item.summary_text)]));
  const targets: ClusterTarget[] = [];

  for (const [episodeKey, clusterItems] of clusters.entries()) {
    if (clusterItems.length < 2) {
      continue;
    }
    const summaries = dedupeSummaries(clusterItems);
    if (summaries.length < 2) {
      continue;
    }
    const proposedMergedMemoryType = resolveProposedMergedMemoryType(episodeKey, clusterItems);
    const sourceIds = clusterItems.map((item) => item.id);
    const confidenceRisk = clusterConfidence(episodeKey, clusterItems, signalsById);
    const mergedClusterId = `${student.student_id}:${episodeKey}`;
    targets.push({
      clusterId: mergedClusterId,
      studentId: student.id,
      studentSlug: student.student_id,
      studentName: student.student_name,
      episodeKey,
      confidenceRisk,
      itemCount: clusterItems.length,
      items: clusterItems,
      memoryTypes: typesInCluster(clusterItems),
      currentActiveSummaries: summaries,
      proposedMergedSummary: buildMergedSummary(episodeKey, clusterItems, signalsById),
      proposedMergedMemoryType,
      proposedStructuredAdditions: {
        episode_key: episodeKey,
        merge_source: "duplicate_cluster_merge",
        merge_cluster_id: mergedClusterId,
        merge_confidence_risk: confidenceRisk,
        merge_source_item_ids: sourceIds,
        merge_strategy: "coach_memory_duplicate_cluster_v1",
        source_memory_types: typesInCluster(clusterItems),
        source_item_count: clusterItems.length,
        source_summary_count: summaries.length,
        proposed_confidence: confidenceToNumeric(confidenceRisk),
      },
      proposedSupersedeMetadata: {
        reason: "duplicate_cluster_merge",
        merge_cluster_id: mergedClusterId,
        new_merged_item_id: "<new_merged_item_id>",
        superseded_at: "<apply_timestamp>",
      },
      proposedSourceItemIds: sourceIds,
      proposedDeactivateOperations: sourceIds.map((itemId) => ({
        itemId,
        set_is_active: false as const,
        set_superseded_by: "<new_merged_item_id>" as const,
        reason: "duplicate_cluster_merge" as const,
      })),
    });
  }

  const confidenceOrder: Record<ClusterConfidence, number> = { high: 3, medium: 2, low: 1 };
  return targets.sort((a, b) => {
    const confidenceDiff = confidenceOrder[b.confidenceRisk] - confidenceOrder[a.confidenceRisk];
    if (confidenceDiff !== 0) {
      return confidenceDiff;
    }
    if (b.itemCount !== a.itemCount) {
      return b.itemCount - a.itemCount;
    }
    return a.episodeKey.localeCompare(b.episodeKey);
  });
}

function selectClusterOrFail(options: CliOptions, clusters: ClusterTarget[]): ClusterTarget {
  if (clusters.length === 0) {
    throw new Error(`${LOG_PREFIX} FAIL: no conservative duplicate clusters found for selected student`);
  }

  if (options.episodeKey) {
    const matched = clusters.filter((cluster) => cluster.episodeKey === options.episodeKey);
    if (matched.length !== 1) {
      const available = clusters.map((cluster) => cluster.clusterId).join(", ");
      throw new Error(
        `${LOG_PREFIX} FAIL: --episode-key match_count=${matched.length}; expected exactly 1 for selected student. ` +
          `Prefer exact --cluster-id targeting. available_cluster_ids=${available}`
      );
    }
    return matched[0];
  }

  if (options.clusterId) {
    const matched = clusters.filter((cluster) => cluster.clusterId === options.clusterId);
    if (matched.length !== 1) {
      throw new Error(
        `${LOG_PREFIX} FAIL: --cluster-id match_count=${matched.length}; expected exactly 1 for selected student`
      );
    }
    return matched[0];
  }

  if (clusters.length > 1) {
    const available = clusters.map((cluster) => cluster.clusterId).join(", ");
    throw new Error(
      `${LOG_PREFIX} FAIL: multiple clusters found (${clusters.length}); pass --episode-key or --cluster-id. available_cluster_ids=${available}`
    );
  }

  return clusters[0];
}

function printReadableOutput(result: JsonOutput): void {
  console.log(`${LOG_PREFIX} mode=${result.mode}`);
  console.log(`${LOG_PREFIX} policy=${result.policy}`);
  console.log(`${LOG_PREFIX} write_status=${result.write_status}`);
  console.log(`${LOG_PREFIX} student_query=${JSON.stringify(result.student_scope.query)}`);
  console.log(`${LOG_PREFIX} matched_students=${result.student_scope.matched_students.length}`);
  for (const student of result.student_scope.matched_students) {
    console.log(`${LOG_PREFIX} matched_student=${student.name} (${student.slug}; ${student.id.slice(0, 8)})`);
  }
  console.log(`${LOG_PREFIX} available_clusters=${result.availableClusterCount}`);
  console.log(`${LOG_PREFIX} selected_cluster_id=${result.selectedCluster.clusterId}`);
  console.log(
    `${LOG_PREFIX} selected_student=${result.selectedCluster.studentName} (${result.selectedCluster.studentSlug}; ${result.selectedCluster.studentId.slice(0, 8)})`
  );
  console.log(`${LOG_PREFIX} episode_key=${result.selectedCluster.episodeKey}`);
  console.log(`${LOG_PREFIX} confidence_risk=${result.selectedCluster.confidenceRisk}`);
  console.log(`${LOG_PREFIX} item_count=${result.selectedCluster.itemCount}`);
  console.log(`${LOG_PREFIX} current_cluster_memory_types=${result.selectedCluster.memoryTypes.join(",")}`);
  for (const summary of result.selectedCluster.currentActiveSummaries) {
    console.log(`${LOG_PREFIX} current_active_summary=${JSON.stringify(summary)}`);
  }
  console.log(`${LOG_PREFIX} proposed_merged_summary=${JSON.stringify(result.selectedCluster.proposedMergedSummary)}`);
  console.log(`${LOG_PREFIX} proposed_merged_memory_type=${result.selectedCluster.proposedMergedMemoryType}`);
  console.log(
    `${LOG_PREFIX} proposed_structured_additions=${JSON.stringify(result.selectedCluster.proposedStructuredAdditions)}`
  );
  console.log(
    `${LOG_PREFIX} proposed_supersede_metadata=${JSON.stringify(result.selectedCluster.proposedSupersedeMetadata)}`
  );
  console.log(`${LOG_PREFIX} proposed_source_item_ids=${result.selectedCluster.proposedSourceItemIds.join(",")}`);
  for (const operation of result.selectedCluster.proposedDeactivateOperations) {
    console.log(`${LOG_PREFIX} proposed_deactivate=${JSON.stringify(operation)}`);
  }
  console.log(`${LOG_PREFIX} preferred_targeting=cluster_id`);
  console.log(`${LOG_PREFIX} recommended_cluster_id=${result.preferredTargeting.recommended_cluster_id}`);
  console.log(`${LOG_PREFIX} recommended_cluster_command=${result.preferredTargeting.recommended_cluster_command}`);
  console.log(`${LOG_PREFIX} apply_safety_note=${JSON.stringify(result.preferredTargeting.apply_safety_note)}`);
  for (const planStep of result.futureApplyPlan) {
    console.log(`${LOG_PREFIX} future_apply_plan=${JSON.stringify(planStep)}`);
  }
  console.log(`${LOG_PREFIX} no DB writes were performed`);
}

function printAmbiguousStudentMatchAndFail(matches: StudentRow[], query: string): never {
  console.error(`${LOG_PREFIX} matched_students_count=${matches.length}`);
  for (const student of matches) {
    console.error(`${LOG_PREFIX} matched_student=${student.student_name} (${student.student_id}; ${student.id.slice(0, 8)})`);
  }
  console.error(`${LOG_PREFIX} error=ambiguous_student_match`);
  const firstSuggestion = matches[0]?.student_id ?? "<student-slug>";
  console.error(
    `${LOG_PREFIX} hint=Use a more specific student slug/id/full name, e.g. ${firstSuggestion}`
  );
  throw new Error(`${LOG_PREFIX} FAIL: ambiguous --student match for query=${JSON.stringify(query)}`);
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

  const students = await fetchStudents();
  const matches = options.apply
    ? resolveStudentMatchesForApply(students, options.studentQuery)
    : resolveStudentMatches(students, options.studentQuery);
  if (matches.length === 0) {
    if (options.apply) {
      throw new Error(
        `${LOG_PREFIX} FAIL: --apply requires exact student slug match via --student <exact-student-slug>`
      );
    }
    throw new Error(`${LOG_PREFIX} FAIL: no students match --student query`);
  }
  if (matches.length > 1) {
    printAmbiguousStudentMatchAndFail(matches, options.studentQuery);
  }
  const clusters: ClusterTarget[] = [];
  for (const student of matches) {
    const activeItems = await fetchActiveMemoryItems(student.id);
    clusters.push(...buildClusterTargets(student, activeItems));
  }
  const selected = selectClusterOrFail(options, clusters);

  if (options.apply) {
    await runGuardedApply(options, selected);
    return;
  }

  const result: JsonOutput = {
    mode: "dry-run",
    policy: "no_writes",
    write_status: "no DB writes were performed",
    student_scope: {
      query: options.studentQuery,
      matched_students: matches.map((student) => ({
        id: student.id,
        slug: student.student_id,
        name: student.student_name,
      })),
    },
    selectedCluster: selected,
    availableClusterCount: clusters.length,
    filters: {
      student: options.studentQuery,
      episodeKey: options.episodeKey,
      clusterId: options.clusterId,
    },
    preferredTargeting: {
      recommended_cluster_id: selected.clusterId,
      recommended_cluster_command:
        `npm run merge-coach-memory-duplicates -- --student ${selected.studentSlug} --cluster-id ${selected.clusterId}`,
      apply_safety_note:
        "Future --apply should always use exact --cluster-id after reviewing dry-run output.",
    },
    futureApplyPlan: [
      "insert one new active trainingpeaks_student_memory_items row for merged summary",
      "supersede old rows via supersedeTrainingPeaksStudentMemoryItem",
      "never delete source rows",
      "re-read source rows before write",
      "abort if any source row is inactive, belongs to another student, or no longer matches selected cluster",
    ],
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printReadableOutput(result);
  console.log(`${LOG_PREFIX} OK dry-run duplicate merge preview complete`);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
