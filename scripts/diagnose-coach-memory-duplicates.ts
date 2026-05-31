import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { PostgrestError } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/features/supabase/server";
import {
  buildIllnessMergedSummary,
  collectIllnessClusterItems,
  HEALTH_MEMORY_TYPES,
  parseMemoryDuplicateSignals,
  passesIllnessClusterFilter,
  resolveIllnessEpisodeKey,
  type ParsedMemoryDuplicateSignals,
} from "@/features/trainingpeaks/coach-memory-duplicate-clustering";
import type { TrainingPeaksStudentMemoryType } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[diagnose-coach-memory-duplicates]";
const DEFAULT_LIMIT = 30;

type CliOptions = {
  studentQuery: string | null;
  limit: number;
  memoryType: TrainingPeaksStudentMemoryType | null;
  json: boolean;
};

type StudentRow = {
  id: string;
  student_id: string;
  student_name: string;
};

type MemoryItemRow = {
  id: string;
  student_id: string;
  memory_type: TrainingPeaksStudentMemoryType;
  summary_text: string;
  confidence: number | null;
  valid_from: string | null;
  valid_until: string | null;
  last_seen_at: string;
};

type ClusterConfidence = "low" | "medium" | "high";

type ClusterProposal = {
  studentId: string;
  studentSlug: string;
  studentName: string;
  episodeKey: string;
  confidenceRisk: ClusterConfidence;
  itemCount: number;
  memoryTypes: TrainingPeaksStudentMemoryType[];
  summaries: string[];
  suggestedMergedSummary: string;
};

type JsonOutput = {
  mode: "read-only";
  policy: "select_only";
  filters: {
    student: string | null;
    limit: number;
    type: TrainingPeaksStudentMemoryType | null;
  };
  studentsScanned: number;
  activeItemsScanned: number;
  proposals: ClusterProposal[];
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

function parsePositiveInt(rawValue: string, flag: string): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid ${flag} value: ${rawValue}`);
  }
  return Math.floor(parsed);
}

function parseMemoryType(rawValue: string): TrainingPeaksStudentMemoryType {
  const normalized = rawValue.trim() as TrainingPeaksStudentMemoryType;
  if (!ALL_MEMORY_TYPES.includes(normalized)) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid --type value: ${rawValue}`);
  }
  return normalized;
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    studentQuery: null,
    limit: DEFAULT_LIMIT,
    memoryType: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      options.json = true;
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

    if (arg.startsWith("--limit=")) {
      options.limit = parsePositiveInt(arg.slice("--limit=".length).trim(), "--limit");
      continue;
    }
    if (arg === "--limit") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --limit`);
      }
      options.limit = parsePositiveInt(next, "--limit");
      index += 1;
      continue;
    }

    if (arg.startsWith("--type=")) {
      options.memoryType = parseMemoryType(arg.slice("--type=".length));
      continue;
    }
    if (arg === "--type") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --type`);
      }
      options.memoryType = parseMemoryType(next);
      index += 1;
      continue;
    }
  }

  return options;
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
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_id, student_name")
    .limit(5000);
  if (error) {
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_students: ${error.message}`);
  }
  return (data as StudentRow[] | null) ?? [];
}

function resolveStudentFilter(students: StudentRow[], query: string): StudentRow[] {
  const normalized = normalizeText(query);
  return students.filter((student) => {
    return (
      student.id.toLowerCase().startsWith(normalized) ||
      student.student_id.toLowerCase().includes(normalized) ||
      student.student_name.toLowerCase().includes(normalized)
    );
  });
}

async function fetchActiveMemoryItems(
  studentIds: string[] | null,
  memoryType: TrainingPeaksStudentMemoryType | null
): Promise<MemoryItemRow[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("trainingpeaks_student_memory_items")
    .select("id, student_id, memory_type, summary_text, confidence, valid_from, valid_until, last_seen_at")
    .eq("is_active", true)
    .order("student_id", { ascending: true })
    .order("memory_type", { ascending: true })
    .order("last_seen_at", { ascending: false })
    .limit(5000);

  if (memoryType) {
    query = query.eq("memory_type", memoryType);
  }
  if (studentIds && studentIds.length > 0) {
    query = query.in("student_id", studentIds);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_student_memory_items: ${error.message}`);
  }
  return (data as MemoryItemRow[] | null) ?? [];
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
  if (episodeKey === "health:illness:upper_respiratory") {
    const hasSickLeave = items.some((item) => signalsById.get(item.id)?.hasSickLeaveSignal);
    if (hasSickLeave || count >= 3) {
      return "high";
    }
    return "medium";
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
  if (episodeKey === "health:illness:upper_respiratory" || episodeKey === "health:illness:general") {
    const signalsList = items
      .map((item) => signalsById.get(item.id))
      .filter((signals): signals is ParsedMemoryDuplicateSignals => Boolean(signals));
    return buildIllnessMergedSummary(episodeKey, signalsList);
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
  const { items: illnessItems, signalsById: illnessSignalsById } = collectIllnessClusterItems(studentItems);

  if (illnessItems.length >= 2) {
    const illnessSignals = illnessItems
      .map((item) => illnessSignalsById.get(item.id))
      .filter((signals): signals is ParsedMemoryDuplicateSignals => Boolean(signals));
    const illnessEpisodeKey = resolveIllnessEpisodeKey(illnessSignals);
    clusters.set(illnessEpisodeKey, illnessItems);
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

function buildProposals(students: StudentRow[], items: MemoryItemRow[]): ClusterProposal[] {
  const studentById = new Map(students.map((student) => [student.id, student]));
  const itemsByStudent = new Map<string, MemoryItemRow[]>();

  for (const item of items) {
    itemsByStudent.set(item.student_id, [...(itemsByStudent.get(item.student_id) ?? []), item]);
  }

  const proposals: ClusterProposal[] = [];
  for (const [studentId, studentItems] of itemsByStudent.entries()) {
    if (studentItems.length < 2) {
      continue;
    }
    const student = studentById.get(studentId);
    if (!student) {
      continue;
    }

    const clusters = buildClustersForStudent(studentItems);
    const signalsById = new Map(
      studentItems.map((item) => [item.id, parseMemoryDuplicateSignals(item.summary_text)])
    );

    for (const [episodeKey, clusterItems] of clusters.entries()) {
      if (clusterItems.length < 2) {
        continue;
      }
      const summaries = dedupeSummaries(clusterItems);
      if (summaries.length < 2) {
        continue;
      }

      proposals.push({
        studentId: student.id,
        studentSlug: student.student_id,
        studentName: student.student_name,
        episodeKey,
        confidenceRisk: clusterConfidence(episodeKey, clusterItems, signalsById),
        itemCount: clusterItems.length,
        memoryTypes: typesInCluster(clusterItems),
        summaries,
        suggestedMergedSummary: buildMergedSummary(episodeKey, clusterItems, signalsById),
      });
    }
  }

  const confidenceOrder: Record<ClusterConfidence, number> = { high: 3, medium: 2, low: 1 };
  return proposals.sort((a, b) => {
    const confidenceDiff = confidenceOrder[b.confidenceRisk] - confidenceOrder[a.confidenceRisk];
    if (confidenceDiff !== 0) {
      return confidenceDiff;
    }
    if (b.itemCount !== a.itemCount) {
      return b.itemCount - a.itemCount;
    }
    return a.studentName.localeCompare(b.studentName);
  });
}

function printReadableOutput(result: JsonOutput): void {
  console.log(`${LOG_PREFIX} mode=read-only`);
  console.log(`${LOG_PREFIX} query_policy=select_only`);
  console.log(`${LOG_PREFIX} students_scanned=${result.studentsScanned}`);
  console.log(`${LOG_PREFIX} active_items_scanned=${result.activeItemsScanned}`);
  console.log(`${LOG_PREFIX} clusters_found=${result.proposals.length}`);

  if (result.proposals.length === 0) {
    console.log(`${LOG_PREFIX} no conservative duplicate clusters found`);
    return;
  }

  for (const [index, proposal] of result.proposals.entries()) {
    console.log("");
    console.log(`${LOG_PREFIX} cluster_${index + 1}`);
    console.log(
      `${LOG_PREFIX} student=${proposal.studentName} (${proposal.studentSlug}; ${proposal.studentId.slice(0, 8)})`
    );
    console.log(`${LOG_PREFIX} confidence_risk=${proposal.confidenceRisk}`);
    console.log(`${LOG_PREFIX} episode_key=${proposal.episodeKey}`);
    console.log(`${LOG_PREFIX} memory_types=${proposal.memoryTypes.join(",")}`);
    console.log(`${LOG_PREFIX} item_count=${proposal.itemCount}`);
    for (const summary of proposal.summaries) {
      console.log(`${LOG_PREFIX} summary=${JSON.stringify(summary)}`);
    }
    console.log(`${LOG_PREFIX} suggested_merged_summary=${JSON.stringify(proposal.suggestedMergedSummary)}`);
  }
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
  let scopedStudents = allStudents;
  if (options.studentQuery) {
    scopedStudents = resolveStudentFilter(allStudents, options.studentQuery);
    if (scopedStudents.length === 0) {
      console.log(`${LOG_PREFIX} student_filter=no_matches`);
      console.log(`${LOG_PREFIX} student_query=${JSON.stringify(options.studentQuery)}`);
      return;
    }
  }

  const studentIds = options.studentQuery ? scopedStudents.map((student) => student.id) : null;
  const activeItems = await fetchActiveMemoryItems(studentIds, options.memoryType);
  const proposals = buildProposals(scopedStudents, activeItems).slice(0, options.limit);

  const result: JsonOutput = {
    mode: "read-only",
    policy: "select_only",
    filters: {
      student: options.studentQuery,
      limit: options.limit,
      type: options.memoryType,
    },
    studentsScanned: scopedStudents.length,
    activeItemsScanned: activeItems.length,
    proposals,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printReadableOutput(result);
  console.log("");
  console.log(`${LOG_PREFIX} OK read-only duplicate diagnostic complete`);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
