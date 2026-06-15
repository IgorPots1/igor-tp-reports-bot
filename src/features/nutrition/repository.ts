import { createHash } from "node:crypto";

import { createSupabaseServerClient } from "@/features/supabase/server";
import type {
  TrainingPeaksStudent,
  TrainingPeaksStudentMemoryItem,
  TrainingPeaksStudentMemoryType,
  TrainingPeaksWorkoutCacheRow,
} from "@/features/trainingpeaks/repository";
import {
  getTrainingPeaksStudentById,
  listActiveTrainingPeaksStudentMemoryItems,
  listTrainingPeaksWorkoutCacheForStudentDateRange,
} from "@/features/trainingpeaks/repository";
import { listTrainingPeaksAdminStudents } from "@/features/trainingpeaks/admin";
import { buildNutritionNextActionHref } from "@/features/nutrition/admin-labels";
import {
  sanitizeNutritionFoodItems,
  type NutritionFoodItem,
} from "@/features/nutrition/context";

export const NUTRITION_COACH_CONTEXT_RU_MAX_LENGTH = 500;

/**
 * Compact per-student nutrition review memory (Tasks 7+8). Kept small — it is
 * fed into every review prompt, so it must not balloon token cost.
 */
export type NutritionApprovedPattern = {
  /** Short coach-approved pattern, e.g. "углеводы в беговые дни ниже ориентира". */
  text: string;
  /** ISO week-from of the earliest week this was observed (for "третью неделю"). */
  since_week: string | null;
};

export type NutritionStudentMemory = {
  approved_patterns: NutritionApprovedPattern[];
  persistent_notes: string[];
  last_focus: string | null;
  key_trends: string[];
};

export function emptyNutritionStudentMemory(): NutritionStudentMemory {
  return { approved_patterns: [], persistent_notes: [], last_focus: null, key_trends: [] };
}

export type NutritionStudentProfile = {
  id: string;
  studentId: string;
  enabled: boolean;
  goal: string | null;
  trackingApp: string | null;
  currentWeightKg: number | null;
  preferences: Record<string, unknown>;
  dislikes: Record<string, unknown>;
  toleranceNotes: string | null;
  coachNotes: string | null;
  coachContextRu: string | null;
  nutritionMemory: NutritionStudentMemory;
  createdAt: string;
  updatedAt: string;
};

export type NutritionWeightLog = {
  id: string;
  studentId: string;
  weightKg: number;
  loggedAt: string;
  source: string;
  confirmedByCoach: boolean;
  rawText: string | null;
  createdAt: string;
};

export type NutritionContextItemType =
  | "preference"
  | "dislike"
  | "tolerance"
  | "energy"
  | "hunger"
  | "gi"
  | "training_food_experience"
  | "note";

export type NutritionContextItem = {
  id: string;
  studentId: string;
  itemType: NutritionContextItemType;
  text: string;
  source: string;
  confidence: number | null;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NutritionReportStatus =
  | "received"
  | "parsed"
  | "insufficient"
  | "needs_review"
  | "ready_for_analysis";

export type NutritionReport = {
  id: string;
  studentId: string;
  weekFrom: string;
  weekTo: string;
  sourceType: string;
  rawText: string | null;
  coachNotesRu: string | null;
  fileRefs: Record<string, unknown> | null;
  status: NutritionReportStatus;
  dataQuality: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type NutritionDailyMacro = {
  id: string;
  reportId: string | null;
  studentId: string;
  day: string;
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  confidence: number | null;
  source: string | null;
  notes: string | null;
  items: NutritionFoodItem[];
  createdAt: string;
};

export type NutritionWeeklyAnalysisStatus =
  | "draft_generated"
  | "blocked_safety"
  | "needs_review"
  | "awaiting_generation"
  | "approved_for_copy"
  | "archived";

export type NutritionWeeklyAnalysis = {
  id: string;
  studentId: string;
  reportId: string | null;
  weekFrom: string;
  weekTo: string;
  status: NutritionWeeklyAnalysisStatus;
  internalSummary: Record<string, unknown>;
  tpPastWeekContext: Record<string, unknown>;
  tpNextWeekContext: Record<string, unknown>;
  nutritionSummary: Record<string, unknown>;
  safetyFlags: Record<string, unknown>;
  contextSnapshot: Record<string, unknown>;
  promptHash: string | null;
  contextHash: string | null;
  aiModel: string | null;
  athleteMessageDraft: string | null;
  coachEdits: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NutritionWeeklyPlanStatus =
  | "draft_generated"
  | "blocked_safety"
  | "needs_review"
  | "approved_for_copy"
  | "archived"
  | "superseded";

export type NutritionWeeklyPlanGenerationMode = "ai" | "fallback";

export type NutritionWeeklyPlan = {
  id: string;
  studentId: string;
  sourceReportId: string | null;
  sourceAnalysisId: string | null;
  planWeekFrom: string;
  planWeekTo: string;
  status: NutritionWeeklyPlanStatus;
  generationMode: NutritionWeeklyPlanGenerationMode;
  promptVersion: string | null;
  aiModel: string | null;
  coachSummary: string | null;
  athleteMessageDraft: string | null;
  coachEditedDraft: string | null;
  approvedAt: string | null;
  planSummary: Record<string, unknown>;
  trainingContextSnapshot: Record<string, unknown>;
  nutritionContextSnapshot: Record<string, unknown>;
  safetyFlags: Record<string, unknown>;
  supersededByPlanId: string | null;
  createdAt: string;
  updatedAt: string;
};

type NutritionStudentProfileRow = {
  id: string;
  student_id: string;
  enabled: boolean;
  goal: string | null;
  tracking_app: string | null;
  current_weight_kg: number | string | null;
  preferences: unknown;
  dislikes: unknown;
  tolerance_notes: string | null;
  coach_notes: string | null;
  coach_context_ru: string | null;
  nutrition_memory: unknown | null;
  created_at: string;
  updated_at: string;
};

type NutritionWeightLogRow = {
  id: string;
  student_id: string;
  weight_kg: number | string;
  logged_at: string;
  source: string;
  confirmed_by_coach: boolean;
  raw_text: string | null;
  created_at: string;
};

type NutritionContextItemRow = {
  id: string;
  student_id: string;
  item_type: string;
  text: string;
  source: string;
  confidence: number | string | null;
  priority: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type NutritionReportRow = {
  id: string;
  student_id: string;
  week_from: string;
  week_to: string;
  source_type: string;
  raw_text: string | null;
  coach_notes_ru: string | null;
  file_refs: unknown | null;
  status: NutritionReportStatus;
  data_quality: unknown;
  created_at: string;
  updated_at: string;
};

type NutritionDailyMacroRow = {
  id: string;
  report_id: string | null;
  student_id: string;
  day: string;
  kcal: number | string | null;
  protein_g: number | string | null;
  fat_g: number | string | null;
  carbs_g: number | string | null;
  confidence: number | string | null;
  source: string | null;
  notes: string | null;
  food_items: unknown | null;
  created_at: string;
};

type NutritionWeeklyAnalysisRow = {
  id: string;
  student_id: string;
  report_id: string | null;
  week_from: string;
  week_to: string;
  status: NutritionWeeklyAnalysisStatus;
  internal_summary: unknown;
  tp_past_week_context: unknown;
  tp_next_week_context: unknown;
  nutrition_summary: unknown;
  safety_flags: unknown;
  context_snapshot: unknown;
  prompt_hash: string | null;
  context_hash: string | null;
  ai_model: string | null;
  athlete_message_draft: string | null;
  coach_edits: string | null;
  created_at: string;
  updated_at: string;
};

type NutritionWeeklyPlanRow = {
  id: string;
  student_id: string;
  source_report_id: string | null;
  source_analysis_id: string | null;
  plan_week_from: string;
  plan_week_to: string;
  status: NutritionWeeklyPlanStatus;
  generation_mode: NutritionWeeklyPlanGenerationMode;
  prompt_version: string | null;
  ai_model: string | null;
  coach_summary: string | null;
  athlete_message_draft: string | null;
  coach_edited_draft: string | null;
  approved_at: string | null;
  plan_summary: unknown;
  training_context_snapshot: unknown;
  nutrition_context_snapshot: unknown;
  safety_flags: unknown;
  superseded_by_plan_id: string | null;
  created_at: string;
  updated_at: string;
};

export type UpsertNutritionStudentProfileInput = {
  studentId: string;
  enabled?: boolean;
  goal?: string | null;
  trackingApp?: string | null;
  currentWeightKg?: number | null;
  preferences?: Record<string, unknown>;
  dislikes?: Record<string, unknown>;
  toleranceNotes?: string | null;
  coachNotes?: string | null;
  coachContextRu?: string | null;
  nutritionMemory?: NutritionStudentMemory;
};

export type AddNutritionWeightLogInput = {
  studentId: string;
  weightKg: number;
  loggedAt?: string;
  source: string;
  confirmedByCoach?: boolean;
  rawText?: string | null;
};

export type AddNutritionContextItemInput = {
  studentId: string;
  itemType: NutritionContextItemType;
  text: string;
  source: string;
  confidence?: number | null;
  priority?: number;
  isActive?: boolean;
};

export type CreateNutritionReportInput = {
  studentId: string;
  weekFrom: string;
  weekTo: string;
  sourceType: string;
  rawText?: string | null;
  coachNotesRu?: string | null;
  fileRefs?: Record<string, unknown> | null;
  status?: NutritionReportStatus;
  dataQuality?: Record<string, unknown>;
};

export type InsertNutritionDailyMacrosInput = {
  reportId?: string | null;
  studentId: string;
  day: string;
  kcal?: number | null;
  proteinG?: number | null;
  fatG?: number | null;
  carbsG?: number | null;
  confidence?: number | null;
  source?: string | null;
  notes?: string | null;
  items?: NutritionFoodItem[];
};

export type CreateNutritionWeeklyAnalysisInput = {
  studentId: string;
  reportId?: string | null;
  weekFrom: string;
  weekTo: string;
  status: NutritionWeeklyAnalysisStatus;
  internalSummary?: Record<string, unknown>;
  tpPastWeekContext?: Record<string, unknown>;
  tpNextWeekContext?: Record<string, unknown>;
  nutritionSummary?: Record<string, unknown>;
  safetyFlags?: Record<string, unknown>;
  contextSnapshot?: Record<string, unknown>;
  promptHash?: string | null;
  contextHash?: string | null;
  aiModel?: string | null;
  athleteMessageDraft?: string | null;
  coachEdits?: string | null;
};

export type CreateNutritionWeeklyPlanInput = {
  studentId: string;
  sourceReportId?: string | null;
  sourceAnalysisId?: string | null;
  planWeekFrom: string;
  planWeekTo: string;
  status: NutritionWeeklyPlanStatus;
  generationMode: NutritionWeeklyPlanGenerationMode;
  promptVersion?: string | null;
  aiModel?: string | null;
  coachSummary?: string | null;
  athleteMessageDraft?: string | null;
  coachEditedDraft?: string | null;
  approvedAt?: string | null;
  planSummary?: Record<string, unknown>;
  trainingContextSnapshot?: Record<string, unknown>;
  nutritionContextSnapshot?: Record<string, unknown>;
  safetyFlags?: Record<string, unknown>;
};

const NUTRITION_WEEKLY_PLAN_ACTIVE_STATUSES: NutritionWeeklyPlanStatus[] = [
  "draft_generated",
  "blocked_safety",
  "needs_review",
  "approved_for_copy",
];

export type NutritionDashboardViewMode = "test" | "all" | "not-in-test";

export type NutritionDashboardFilters = {
  viewMode?: NutritionDashboardViewMode;
  active?: boolean;
  /** @deprecated use viewMode=test instead */
  enabledNutrition?: boolean;
  statuses?: NutritionReportStatus[];
  analysisStatuses?: NutritionWeeklyAnalysisStatus[];
  safetyOnly?: boolean;
};

export type NutritionDashboardRow = {
  studentId: string;
  studentSlug: string;
  studentName: string;
  isActive: boolean;
  weeklyReportEnabled: boolean;
  telegramDeliveryEnabled: boolean;
  nutritionEnabled: boolean;
  currentWeightKg: number | null;
  trackingApp: string | null;
  lastReportStatus: NutritionReportStatus | null;
  lastReportCreatedAt: string | null;
  parsedDays: number;
  lastAnalysisStatus: NutritionWeeklyAnalysisStatus | null;
  lastAnalysisId: string | null;
  lastAnalysisWeekFrom: string | null;
  lastAnalysisWeekTo: string | null;
  hasSafetyFlag: boolean;
  nextAction: string;
  latestReportId: string | null;
  latestReportWeekFrom: string | null;
  latestReportWeekTo: string | null;
  nextActionHref: string | null;
};

export type NutritionReportWithMacros = {
  report: NutritionReport;
  macros: NutritionDailyMacro[];
};

function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function mapNutritionStudentProfileRow(row: NutritionStudentProfileRow): NutritionStudentProfile {
  return {
    id: row.id,
    studentId: row.student_id,
    enabled: row.enabled,
    goal: row.goal,
    trackingApp: row.tracking_app,
    currentWeightKg: toFiniteNumber(row.current_weight_kg),
    preferences: toObject(row.preferences),
    dislikes: toObject(row.dislikes),
    toleranceNotes: row.tolerance_notes,
    coachNotes: row.coach_notes,
    coachContextRu: compactText(row.coach_context_ru),
    nutritionMemory: sanitizeNutritionStudentMemory(row.nutrition_memory),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapNutritionWeightLogRow(row: NutritionWeightLogRow): NutritionWeightLog {
  return {
    id: row.id,
    studentId: row.student_id,
    weightKg: toFiniteNumber(row.weight_kg) ?? 0,
    loggedAt: row.logged_at,
    source: row.source,
    confirmedByCoach: row.confirmed_by_coach,
    rawText: row.raw_text,
    createdAt: row.created_at,
  };
}

function mapNutritionContextItemRow(row: NutritionContextItemRow): NutritionContextItem {
  return {
    id: row.id,
    studentId: row.student_id,
    itemType: row.item_type as NutritionContextItemType,
    text: row.text,
    source: row.source,
    confidence: toFiniteNumber(row.confidence),
    priority: row.priority,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapNutritionReportRow(row: NutritionReportRow): NutritionReport {
  return {
    id: row.id,
    studentId: row.student_id,
    weekFrom: row.week_from,
    weekTo: row.week_to,
    sourceType: row.source_type,
    rawText: row.raw_text,
    coachNotesRu: compactText(row.coach_notes_ru),
    fileRefs: row.file_refs && typeof row.file_refs === "object" && !Array.isArray(row.file_refs)
      ? (row.file_refs as Record<string, unknown>)
      : null,
    status: row.status,
    dataQuality: toObject(row.data_quality),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapNutritionDailyMacroRow(row: NutritionDailyMacroRow): NutritionDailyMacro {
  return {
    id: row.id,
    reportId: row.report_id,
    studentId: row.student_id,
    day: row.day,
    kcal: toFiniteNumber(row.kcal),
    proteinG: toFiniteNumber(row.protein_g),
    fatG: toFiniteNumber(row.fat_g),
    carbsG: toFiniteNumber(row.carbs_g),
    confidence: toFiniteNumber(row.confidence),
    source: row.source,
    notes: row.notes,
    items: sanitizeNutritionFoodItems(row.food_items),
    createdAt: row.created_at,
  };
}

function mapNutritionWeeklyAnalysisRow(row: NutritionWeeklyAnalysisRow): NutritionWeeklyAnalysis {
  return {
    id: row.id,
    studentId: row.student_id,
    reportId: row.report_id,
    weekFrom: row.week_from,
    weekTo: row.week_to,
    status: row.status,
    internalSummary: toObject(row.internal_summary),
    tpPastWeekContext: toObject(row.tp_past_week_context),
    tpNextWeekContext: toObject(row.tp_next_week_context),
    nutritionSummary: toObject(row.nutrition_summary),
    safetyFlags: toObject(row.safety_flags),
    contextSnapshot: toObject(row.context_snapshot),
    promptHash: row.prompt_hash,
    contextHash: row.context_hash,
    aiModel: row.ai_model,
    athleteMessageDraft: row.athlete_message_draft,
    coachEdits: row.coach_edits,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapNutritionWeeklyPlanRow(row: NutritionWeeklyPlanRow): NutritionWeeklyPlan {
  return {
    id: row.id,
    studentId: row.student_id,
    sourceReportId: row.source_report_id,
    sourceAnalysisId: row.source_analysis_id,
    planWeekFrom: row.plan_week_from,
    planWeekTo: row.plan_week_to,
    status: row.status,
    generationMode: row.generation_mode,
    promptVersion: row.prompt_version,
    aiModel: row.ai_model,
    coachSummary: row.coach_summary,
    athleteMessageDraft: row.athlete_message_draft,
    coachEditedDraft: row.coach_edited_draft,
    approvedAt: row.approved_at,
    planSummary: toObject(row.plan_summary),
    trainingContextSnapshot: toObject(row.training_context_snapshot),
    nutritionContextSnapshot: toObject(row.nutrition_context_snapshot),
    safetyFlags: toObject(row.safety_flags),
    supersededByPlanId: row.superseded_by_plan_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function compactText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized || null;
}

/**
 * Defensive parse for the stored nutrition_memory JSONB. Caps list sizes so the
 * memory stays compact (it is fed into every review prompt — Tasks 7+8).
 */
export function sanitizeNutritionStudentMemory(value: unknown): NutritionStudentMemory {
  const obj = toObject(value);
  const strings = (raw: unknown, max: number): string[] =>
    (Array.isArray(raw) ? raw : [])
      .map((item) => compactText(typeof item === "string" ? item : null))
      .filter((item): item is string => Boolean(item))
      .slice(0, max);
  const patterns = (Array.isArray(obj.approved_patterns) ? obj.approved_patterns : [])
    .map((item) => toObject(item))
    .map((item) => ({
      text: compactText(typeof item.text === "string" ? item.text : null),
      since_week: typeof item.since_week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.since_week) ? item.since_week : null,
    }))
    .filter((item): item is NutritionApprovedPattern => Boolean(item.text))
    .slice(0, 4);
  return {
    approved_patterns: patterns,
    persistent_notes: strings(obj.persistent_notes, 6),
    last_focus: compactText(typeof obj.last_focus === "string" ? obj.last_focus : null),
    key_trends: strings(obj.key_trends, 3),
  };
}

export function normalizeNutritionCoachContextRu(value: string | null | undefined): string | null {
  const normalized = compactText(value);
  if (!normalized) {
    return null;
  }
  if (normalized.length > NUTRITION_COACH_CONTEXT_RU_MAX_LENGTH) {
    throw new Error(
      `Контекст для разбора не может быть длиннее ${NUTRITION_COACH_CONTEXT_RU_MAX_LENGTH} символов.`
    );
  }
  return normalized;
}

export function stableHash(input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

export async function getNutritionStudentProfile(studentId: string): Promise<NutritionStudentProfile | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("nutrition_student_profiles")
    .select("*")
    .eq("student_id", studentId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get nutrition student profile ${studentId}: ${error.message}`);
  }
  if (!data) {
    return null;
  }
  return mapNutritionStudentProfileRow(data as NutritionStudentProfileRow);
}

export async function upsertNutritionStudentProfile(
  input: UpsertNutritionStudentProfileInput
): Promise<NutritionStudentProfile> {
  const supabase = createSupabaseServerClient();
  const payload = {
    student_id: input.studentId,
    enabled: input.enabled ?? false,
    goal: compactText(input.goal),
    tracking_app: compactText(input.trackingApp),
    current_weight_kg: input.currentWeightKg ?? null,
    preferences: input.preferences ?? {},
    dislikes: input.dislikes ?? {},
    tolerance_notes: compactText(input.toleranceNotes),
    coach_notes: compactText(input.coachNotes),
    coach_context_ru:
      input.coachContextRu === undefined ? undefined : normalizeNutritionCoachContextRu(input.coachContextRu),
    nutrition_memory:
      input.nutritionMemory === undefined ? undefined : sanitizeNutritionStudentMemory(input.nutritionMemory),
  };
  const upsertPayload = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
  const { data, error } = await supabase
    .from("nutrition_student_profiles")
    .upsert(upsertPayload, { onConflict: "student_id" })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to upsert nutrition student profile ${input.studentId}: ${error.message}`);
  }
  return mapNutritionStudentProfileRow(data as NutritionStudentProfileRow);
}

export async function saveNutritionCoachContextRu(input: {
  studentId: string;
  coachContextRu: string | null;
}): Promise<NutritionStudentProfile> {
  const existing = await getNutritionStudentProfile(input.studentId);
  return upsertNutritionStudentProfile({
    studentId: input.studentId,
    enabled: existing?.enabled ?? false,
    goal: existing?.goal ?? null,
    trackingApp: existing?.trackingApp ?? null,
    currentWeightKg: existing?.currentWeightKg ?? null,
    toleranceNotes: existing?.toleranceNotes ?? null,
    coachNotes: existing?.coachNotes ?? null,
    coachContextRu: normalizeNutritionCoachContextRu(input.coachContextRu),
  });
}

export async function saveNutritionStudentMemory(input: {
  studentId: string;
  nutritionMemory: NutritionStudentMemory;
}): Promise<NutritionStudentProfile> {
  const existing = await getNutritionStudentProfile(input.studentId);
  return upsertNutritionStudentProfile({
    studentId: input.studentId,
    enabled: existing?.enabled ?? false,
    goal: existing?.goal ?? null,
    trackingApp: existing?.trackingApp ?? null,
    currentWeightKg: existing?.currentWeightKg ?? null,
    preferences: existing?.preferences,
    dislikes: existing?.dislikes,
    toleranceNotes: existing?.toleranceNotes ?? null,
    coachNotes: existing?.coachNotes ?? null,
    coachContextRu: existing?.coachContextRu ?? null,
    nutritionMemory: sanitizeNutritionStudentMemory(input.nutritionMemory),
  });
}

/** Append one persistent coach note (Task 8 "remember"), deduped, keeping memory compact. */
export async function appendNutritionPersistentNote(input: {
  studentId: string;
  note: string;
}): Promise<NutritionStudentProfile | null> {
  const note = compactText(input.note);
  if (!note) {
    return null;
  }
  const existing = await getNutritionStudentProfile(input.studentId);
  const memory = existing?.nutritionMemory ?? emptyNutritionStudentMemory();
  if (memory.persistent_notes.some((item) => item.toLowerCase() === note.toLowerCase())) {
    return existing;
  }
  return saveNutritionStudentMemory({
    studentId: input.studentId,
    nutritionMemory: { ...memory, persistent_notes: [...memory.persistent_notes, note] },
  });
}

export async function addNutritionWeightLog(input: AddNutritionWeightLogInput): Promise<NutritionWeightLog> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("nutrition_weight_logs")
    .insert({
      student_id: input.studentId,
      weight_kg: input.weightKg,
      logged_at: input.loggedAt ?? new Date().toISOString(),
      source: input.source,
      confirmed_by_coach: input.confirmedByCoach ?? true,
      raw_text: compactText(input.rawText),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to add nutrition weight log for ${input.studentId}: ${error.message}`);
  }
  return mapNutritionWeightLogRow(data as NutritionWeightLogRow);
}

export async function getNutritionWeightLogs(studentId: string): Promise<NutritionWeightLog[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("nutrition_weight_logs")
    .select("*")
    .eq("student_id", studentId)
    .order("logged_at", { ascending: false })
    .limit(30);

  if (error) {
    throw new Error(`Failed to list nutrition weight logs for ${studentId}: ${error.message}`);
  }
  return ((data as NutritionWeightLogRow[]) ?? []).map(mapNutritionWeightLogRow);
}

export async function addNutritionContextItem(input: AddNutritionContextItemInput): Promise<NutritionContextItem> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("nutrition_context_items")
    .insert({
      student_id: input.studentId,
      item_type: input.itemType,
      text: compactText(input.text) ?? "",
      source: input.source,
      confidence: input.confidence ?? null,
      priority: input.priority ?? 0,
      is_active: input.isActive ?? true,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to add nutrition context item for ${input.studentId}: ${error.message}`);
  }
  return mapNutritionContextItemRow(data as NutritionContextItemRow);
}

export async function getActiveNutritionContextItems(studentId: string): Promise<NutritionContextItem[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("nutrition_context_items")
    .select("*")
    .eq("student_id", studentId)
    .eq("is_active", true)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) {
    throw new Error(`Failed to list active nutrition context items for ${studentId}: ${error.message}`);
  }
  return ((data as NutritionContextItemRow[]) ?? []).map(mapNutritionContextItemRow);
}

export async function createNutritionReport(input: CreateNutritionReportInput): Promise<NutritionReport> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("nutrition_reports")
    .insert({
      student_id: input.studentId,
      week_from: input.weekFrom,
      week_to: input.weekTo,
      source_type: input.sourceType,
      raw_text: compactText(input.rawText),
      coach_notes_ru: compactText(input.coachNotesRu),
      file_refs: input.fileRefs ?? null,
      status: input.status ?? "received",
      data_quality: input.dataQuality ?? {},
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create nutrition report for ${input.studentId}: ${error.message}`);
  }
  return mapNutritionReportRow(data as NutritionReportRow);
}

export async function insertNutritionDailyMacros(
  input: InsertNutritionDailyMacrosInput[]
): Promise<NutritionDailyMacro[]> {
  if (input.length === 0) {
    return [];
  }

  const supabase = createSupabaseServerClient();
  const payload = input.map((item) => ({
    report_id: item.reportId ?? null,
    student_id: item.studentId,
    day: item.day,
    kcal: item.kcal ?? null,
    protein_g: item.proteinG ?? null,
    fat_g: item.fatG ?? null,
    carbs_g: item.carbsG ?? null,
    confidence: item.confidence ?? null,
    source: compactText(item.source),
    notes: compactText(item.notes),
    food_items: sanitizeNutritionFoodItems(item.items ?? []),
  }));

  const { data, error } = await supabase
    .from("nutrition_daily_macros")
    .upsert(payload, { onConflict: "report_id,day" })
    .select("*");
  if (error) {
    throw new Error(`Failed to insert nutrition daily macros: ${error.message}`);
  }
  return ((data as NutritionDailyMacroRow[]) ?? []).map(mapNutritionDailyMacroRow);
}

export async function getNutritionStudentDefaultWeek(
  studentId: string
): Promise<{ weekFrom: string; weekTo: string } | null> {
  const supabase = createSupabaseServerClient();
  const { data: analysis, error: analysisError } = await supabase
    .from("nutrition_weekly_analyses")
    .select("week_from, week_to")
    .eq("student_id", studentId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (analysisError) {
    throw new Error(`Failed to load default nutrition week for ${studentId}: ${analysisError.message}`);
  }
  if (analysis) {
    return { weekFrom: analysis.week_from, weekTo: analysis.week_to };
  }

  const { data: report, error: reportError } = await supabase
    .from("nutrition_reports")
    .select("week_from, week_to")
    .eq("student_id", studentId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reportError) {
    throw new Error(`Failed to load default nutrition report week for ${studentId}: ${reportError.message}`);
  }
  if (report) {
    return { weekFrom: report.week_from, weekTo: report.week_to };
  }
  return null;
}

export async function listNutritionReportsForStudent(
  studentId: string,
  input?: { weekFrom?: string; weekTo?: string; limit?: number }
): Promise<NutritionReport[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("nutrition_reports")
    .select("*")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false });

  if (input?.weekFrom) {
    query = query.eq("week_from", input.weekFrom);
  }
  if (input?.weekTo) {
    query = query.eq("week_to", input.weekTo);
  }
  if (input?.limit) {
    query = query.limit(input.limit);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list nutrition reports for ${studentId}: ${error.message}`);
  }
  return ((data as NutritionReportRow[]) ?? []).map(mapNutritionReportRow);
}

export async function getNutritionWeeklyAnalysisById(id: string): Promise<NutritionWeeklyAnalysis | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("nutrition_weekly_analyses")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load nutrition weekly analysis ${id}: ${error.message}`);
  }
  if (!data) {
    return null;
  }
  return mapNutritionWeeklyAnalysisRow(data as NutritionWeeklyAnalysisRow);
}

export async function listNutritionWeeklyAnalysesForStudentWeek(
  studentId: string,
  weekFrom: string,
  weekTo: string
): Promise<NutritionWeeklyAnalysis[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("nutrition_weekly_analyses")
    .select("*")
    .eq("student_id", studentId)
    .eq("week_from", weekFrom)
    .eq("week_to", weekTo)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(
      `Failed to list nutrition weekly analyses for ${studentId} ${weekFrom}..${weekTo}: ${error.message}`
    );
  }
  return ((data as NutritionWeeklyAnalysisRow[]) ?? []).map(mapNutritionWeeklyAnalysisRow);
}

/**
 * Recent weekly analyses for a student, newest week first (Task 7 pattern
 * detection). One per week; optionally exclude the week being generated now.
 */
export async function listRecentNutritionWeeklyAnalysesForStudent(
  studentId: string,
  options?: { limit?: number; excludeWeekFrom?: string }
): Promise<NutritionWeeklyAnalysis[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("nutrition_weekly_analyses")
    .select("*")
    .eq("student_id", studentId)
    .order("week_from", { ascending: false })
    .limit(Math.max(1, (options?.limit ?? 4) + 1));
  if (error) {
    throw new Error(`Failed to list recent nutrition weekly analyses for ${studentId}: ${error.message}`);
  }
  const rows = ((data as NutritionWeeklyAnalysisRow[]) ?? []).map(mapNutritionWeeklyAnalysisRow);
  const filtered = options?.excludeWeekFrom
    ? rows.filter((row) => row.weekFrom !== options.excludeWeekFrom)
    : rows;
  return filtered.slice(0, options?.limit ?? 4);
}

/**
 * Append a coach-approved pattern to student memory (Task 7 draft->approve).
 * Deduped by text; capped by the sanitizer so memory stays compact.
 */
export async function addNutritionApprovedPattern(input: {
  studentId: string;
  text: string;
  sinceWeek?: string | null;
}): Promise<NutritionStudentProfile | null> {
  const text = compactText(input.text);
  if (!text) {
    return null;
  }
  const existing = await getNutritionStudentProfile(input.studentId);
  const memory = existing?.nutritionMemory ?? emptyNutritionStudentMemory();
  if (memory.approved_patterns.some((item) => item.text.toLowerCase() === text.toLowerCase())) {
    return existing;
  }
  const sinceWeek =
    typeof input.sinceWeek === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.sinceWeek) ? input.sinceWeek : null;
  return saveNutritionStudentMemory({
    studentId: input.studentId,
    nutritionMemory: {
      ...memory,
      approved_patterns: [...memory.approved_patterns, { text, since_week: sinceWeek }],
    },
  });
}

/** Update the rolling review-memory signals after a review (last focus + numeric trends). */
export async function updateNutritionMemoryAfterReview(input: {
  studentId: string;
  lastFocus?: string | null;
  keyTrends?: string[];
}): Promise<NutritionStudentProfile | null> {
  const existing = await getNutritionStudentProfile(input.studentId);
  const memory = existing?.nutritionMemory ?? emptyNutritionStudentMemory();
  return saveNutritionStudentMemory({
    studentId: input.studentId,
    nutritionMemory: {
      ...memory,
      last_focus: input.lastFocus !== undefined ? compactText(input.lastFocus) : memory.last_focus,
      key_trends: input.keyTrends !== undefined ? input.keyTrends : memory.key_trends,
    },
  });
}

/**
 * Remove one pattern candidate from a stored analysis after the coach decided on
 * it (accept or reject), so the proposal stops showing. Decisions never auto-store
 * to memory here — approval is a separate explicit call.
 */
export async function removeNutritionAnalysisPatternCandidate(input: {
  analysisId: string;
  code: string;
}): Promise<void> {
  const analysis = await getNutritionWeeklyAnalysisById(input.analysisId);
  if (!analysis) {
    return;
  }
  const summary = toObject(analysis.nutritionSummary);
  const candidates = Array.isArray(summary.pattern_candidates) ? summary.pattern_candidates : [];
  const next = candidates.filter(
    (item) => !(item && typeof item === "object" && (item as Record<string, unknown>).code === input.code)
  );
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("nutrition_weekly_analyses")
    .update({ nutrition_summary: { ...summary, pattern_candidates: next } })
    .eq("id", input.analysisId);
  if (error) {
    throw new Error(`Failed to update nutrition analysis pattern candidates ${input.analysisId}: ${error.message}`);
  }
}

export async function getNutritionWeeklyAnalysisForWeek(input: {
  studentId: string;
  weekFrom: string;
  weekTo: string;
}): Promise<NutritionWeeklyAnalysis | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("nutrition_weekly_analyses")
    .select("*")
    .eq("student_id", input.studentId)
    .eq("week_from", input.weekFrom)
    .eq("week_to", input.weekTo)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load nutrition weekly analysis for ${input.studentId} ${input.weekFrom}..${input.weekTo}: ${error.message}`
    );
  }
  if (!data) {
    return null;
  }
  return mapNutritionWeeklyAnalysisRow(data as NutritionWeeklyAnalysisRow);
}

export async function getNutritionReportWithMacros(reportId: string): Promise<NutritionReportWithMacros | null> {
  const supabase = createSupabaseServerClient();
  const [{ data: reportData, error: reportError }, { data: macroData, error: macroError }] = await Promise.all([
    supabase.from("nutrition_reports").select("*").eq("id", reportId).maybeSingle(),
    supabase
      .from("nutrition_daily_macros")
      .select("*")
      .eq("report_id", reportId)
      .order("day", { ascending: true }),
  ]);

  if (reportError) {
    throw new Error(`Failed to load nutrition report ${reportId}: ${reportError.message}`);
  }
  if (!reportData) {
    return null;
  }
  if (macroError) {
    throw new Error(`Failed to load nutrition report macros ${reportId}: ${macroError.message}`);
  }

  return {
    report: mapNutritionReportRow(reportData as NutritionReportRow),
    macros: ((macroData as NutritionDailyMacroRow[]) ?? []).map(mapNutritionDailyMacroRow),
  };
}

export async function createNutritionWeeklyPlan(
  input: CreateNutritionWeeklyPlanInput
): Promise<NutritionWeeklyPlan> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("nutrition_weekly_plans")
    .insert({
      student_id: input.studentId,
      source_report_id: input.sourceReportId ?? null,
      source_analysis_id: input.sourceAnalysisId ?? null,
      plan_week_from: input.planWeekFrom,
      plan_week_to: input.planWeekTo,
      status: input.status,
      generation_mode: input.generationMode,
      prompt_version: compactText(input.promptVersion),
      ai_model: compactText(input.aiModel),
      coach_summary: compactText(input.coachSummary),
      athlete_message_draft: compactText(input.athleteMessageDraft),
      coach_edited_draft: compactText(input.coachEditedDraft),
      approved_at: input.approvedAt ?? null,
      plan_summary: input.planSummary ?? {},
      training_context_snapshot: input.trainingContextSnapshot ?? {},
      nutrition_context_snapshot: input.nutritionContextSnapshot ?? {},
      safety_flags: input.safetyFlags ?? {},
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create nutrition weekly plan for ${input.studentId}: ${error.message}`);
  }
  return mapNutritionWeeklyPlanRow(data as NutritionWeeklyPlanRow);
}

export async function getNutritionWeeklyPlanById(planId: string): Promise<NutritionWeeklyPlan | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("nutrition_weekly_plans")
    .select("*")
    .eq("id", planId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load nutrition weekly plan ${planId}: ${error.message}`);
  }
  if (!data) {
    return null;
  }
  return mapNutritionWeeklyPlanRow(data as NutritionWeeklyPlanRow);
}

export async function listNutritionWeeklyPlansForStudentWeek(params: {
  studentId: string;
  planWeekFrom: string;
  planWeekTo: string;
  limit?: number;
}): Promise<NutritionWeeklyPlan[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("nutrition_weekly_plans")
    .select("*")
    .eq("student_id", params.studentId)
    .eq("plan_week_from", params.planWeekFrom)
    .eq("plan_week_to", params.planWeekTo)
    .order("created_at", { ascending: false });

  if (params.limit) {
    query = query.limit(params.limit);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(
      `Failed to list nutrition weekly plans for ${params.studentId} ${params.planWeekFrom}..${params.planWeekTo}: ${error.message}`
    );
  }
  return ((data as NutritionWeeklyPlanRow[]) ?? []).map(mapNutritionWeeklyPlanRow);
}

const NUTRITION_WEEKLY_PLAN_INACTIVE_STATUSES: NutritionWeeklyPlanStatus[] = ["superseded", "archived"];

function isActiveNutritionWeeklyPlanStatus(status: NutritionWeeklyPlanStatus): boolean {
  return !NUTRITION_WEEKLY_PLAN_INACTIVE_STATUSES.includes(status);
}

function pickPreferredNutritionWeeklyPlan(plans: NutritionWeeklyPlan[]): NutritionWeeklyPlan | null {
  return plans.find((plan) => isActiveNutritionWeeklyPlanStatus(plan.status)) ?? plans[0] ?? null;
}

async function resolveSupersedingNutritionWeeklyPlan(
  plan: NutritionWeeklyPlan,
  plansById: Map<string, NutritionWeeklyPlan>
): Promise<NutritionWeeklyPlan> {
  let current = plan;
  const visited = new Set<string>();
  while (
    current.status === "superseded" &&
    current.supersededByPlanId &&
    !visited.has(current.id)
  ) {
    visited.add(current.id);
    const next = plansById.get(current.supersededByPlanId) ?? (await getNutritionWeeklyPlanById(current.supersededByPlanId));
    if (!next) {
      break;
    }
    plansById.set(next.id, next);
    current = next;
  }
  return current;
}

export type NutritionWeeklyPlanDisplayResolution = {
  displayPlan: NutritionWeeklyPlan | null;
  selectedPlanById: NutritionWeeklyPlan | null;
  latestPlanForWeek: NutritionWeeklyPlan | null;
  plansForWeek: NutritionWeeklyPlan[];
  planIdWarning: string | null;
  supersededPlanNotice: string | null;
  planSelectedById: boolean;
};

export async function resolveNutritionWeeklyPlanForDisplay(params: {
  studentId: string;
  planWeekFrom: string;
  planWeekTo: string;
  planIdFromQuery?: string | null;
  plansLimit?: number;
}): Promise<NutritionWeeklyPlanDisplayResolution> {
  const plansForWeek = await listNutritionWeeklyPlansForStudentWeek({
    studentId: params.studentId,
    planWeekFrom: params.planWeekFrom,
    planWeekTo: params.planWeekTo,
    limit: params.plansLimit ?? 10,
  });
  const plansById = new Map(plansForWeek.map((plan) => [plan.id, plan]));
  const latestPlanForWeek = pickPreferredNutritionWeeklyPlan(plansForWeek);

  let selectedPlanById: NutritionWeeklyPlan | null = null;
  let planIdWarning: string | null = null;
  let supersededPlanNotice: string | null = null;
  let displayPlan = latestPlanForWeek;
  let planSelectedById = false;

  if (params.planIdFromQuery) {
    const planById =
      plansById.get(params.planIdFromQuery) ?? (await getNutritionWeeklyPlanById(params.planIdFromQuery));
    if (!planById) {
      planIdWarning = "Фокус по planId не найден — показан последний сохранённый за неделю.";
    } else if (planById.studentId !== params.studentId) {
      planIdWarning = "Фокус не принадлежит этому ученику — показан последний сохранённый за неделю.";
    } else {
      selectedPlanById = planById;
      plansById.set(planById.id, planById);
      if (
        planById.planWeekFrom !== params.planWeekFrom ||
        planById.planWeekTo !== params.planWeekTo
      ) {
        if (latestPlanForWeek) {
          displayPlan = latestPlanForWeek;
          planIdWarning =
            "Выбранный фокус относится к другой неделе — показан последний сохранённый за целевую неделю.";
        } else {
          displayPlan = planById;
          planSelectedById = true;
          planIdWarning =
            "Выбранный фокус относится к другой неделе — сохранённого фокуса на целевую неделю пока нет.";
        }
      } else if (planById.status === "superseded") {
        const supersedingPlan = await resolveSupersedingNutritionWeeklyPlan(planById, plansById);
        if (supersedingPlan.id !== planById.id) {
          displayPlan = supersedingPlan;
          supersededPlanNotice = "Вы открыли старую версию фокуса. Показана новая версия.";
        } else {
          displayPlan = latestPlanForWeek;
          planIdWarning = "Фокус по planId устарел — показан последний сохранённый за неделю.";
        }
      } else {
        displayPlan = planById;
        planSelectedById = true;
      }
    }
  }

  return {
    displayPlan,
    selectedPlanById,
    latestPlanForWeek,
    plansForWeek,
    planIdWarning,
    supersededPlanNotice,
    planSelectedById,
  };
}

export async function getLatestNutritionWeeklyPlanForStudentWeek(params: {
  studentId: string;
  planWeekFrom: string;
  planWeekTo: string;
}): Promise<NutritionWeeklyPlan | null> {
  const plans = await listNutritionWeeklyPlansForStudentWeek({ ...params, limit: 10 });
  return pickPreferredNutritionWeeklyPlan(plans);
}

export async function markNutritionWeeklyPlansSuperseded(params: {
  studentId: string;
  planWeekFrom: string;
  planWeekTo: string;
  supersededByPlanId: string;
  excludePlanId?: string;
}): Promise<void> {
  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("nutrition_weekly_plans")
    .update({
      status: "superseded",
      superseded_by_plan_id: params.supersededByPlanId,
    })
    .eq("student_id", params.studentId)
    .eq("plan_week_from", params.planWeekFrom)
    .eq("plan_week_to", params.planWeekTo)
    .in("status", NUTRITION_WEEKLY_PLAN_ACTIVE_STATUSES);

  if (params.excludePlanId) {
    query = query.neq("id", params.excludePlanId);
  }

  const { error } = await query;
  if (error) {
    throw new Error(
      `Failed to mark nutrition weekly plans superseded for ${params.studentId} ${params.planWeekFrom}..${params.planWeekTo}: ${error.message}`
    );
  }
}

export async function createNutritionWeeklyAnalysis(
  input: CreateNutritionWeeklyAnalysisInput
): Promise<NutritionWeeklyAnalysis> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("nutrition_weekly_analyses")
    .upsert(
      {
        student_id: input.studentId,
        report_id: input.reportId ?? null,
        week_from: input.weekFrom,
        week_to: input.weekTo,
        status: input.status,
        internal_summary: input.internalSummary ?? {},
        tp_past_week_context: input.tpPastWeekContext ?? {},
        tp_next_week_context: input.tpNextWeekContext ?? {},
        nutrition_summary: input.nutritionSummary ?? {},
        safety_flags: input.safetyFlags ?? {},
        context_snapshot: input.contextSnapshot ?? {},
        prompt_hash: input.promptHash ?? null,
        context_hash: input.contextHash ?? null,
        ai_model: input.aiModel ?? null,
        athlete_message_draft: input.athleteMessageDraft ?? null,
        coach_edits: input.coachEdits ?? null,
      },
      { onConflict: "student_id,week_from,week_to" }
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create nutrition weekly analysis for ${input.studentId}: ${error.message}`);
  }
  return mapNutritionWeeklyAnalysisRow(data as NutritionWeeklyAnalysisRow);
}

async function getLatestReportsByStudent(studentIds: string[]): Promise<Map<string, NutritionReport>> {
  if (studentIds.length === 0) {
    return new Map();
  }
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("nutrition_reports")
    .select("*")
    .in("student_id", studentIds)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`Failed to load nutrition dashboard reports: ${error.message}`);
  }
  const map = new Map<string, NutritionReport>();
  for (const row of (data as NutritionReportRow[]) ?? []) {
    if (!map.has(row.student_id)) {
      map.set(row.student_id, mapNutritionReportRow(row));
    }
  }
  return map;
}

async function getLatestAnalysesByStudent(studentIds: string[]): Promise<Map<string, NutritionWeeklyAnalysis>> {
  if (studentIds.length === 0) {
    return new Map();
  }
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("nutrition_weekly_analyses")
    .select("*")
    .in("student_id", studentIds)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`Failed to load nutrition dashboard analyses: ${error.message}`);
  }
  const map = new Map<string, NutritionWeeklyAnalysis>();
  for (const row of (data as NutritionWeeklyAnalysisRow[]) ?? []) {
    if (!map.has(row.student_id)) {
      map.set(row.student_id, mapNutritionWeeklyAnalysisRow(row));
    }
  }
  return map;
}

async function getDailyMacroCountsByStudent(studentIds: string[]): Promise<Map<string, number>> {
  if (studentIds.length === 0) {
    return new Map();
  }
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("nutrition_daily_macros")
    .select("student_id")
    .in("student_id", studentIds);
  if (error) {
    throw new Error(`Failed to load nutrition daily macro counts: ${error.message}`);
  }
  const map = new Map<string, number>();
  for (const row of ((data as Array<{ student_id: string }>) ?? [])) {
    map.set(row.student_id, (map.get(row.student_id) ?? 0) + 1);
  }
  return map;
}

export async function getNutritionProfilesByStudent(studentIds: string[]): Promise<Map<string, NutritionStudentProfile>> {
  if (studentIds.length === 0) {
    return new Map();
  }
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("nutrition_student_profiles")
    .select("*")
    .in("student_id", studentIds);
  if (error) {
    throw new Error(`Failed to load nutrition profiles for dashboard: ${error.message}`);
  }
  return new Map(
    ((data as NutritionStudentProfileRow[]) ?? []).map((row) => [row.student_id, mapNutritionStudentProfileRow(row)])
  );
}

function hasHardSafetyFlag(analysis: NutritionWeeklyAnalysis | null): boolean {
  if (!analysis) {
    return false;
  }
  const blocked = analysis.status === "blocked_safety";
  const reasons = analysis.safetyFlags?.hard_flags;
  return blocked || (Array.isArray(reasons) && reasons.length > 0);
}

function resolveNextAction(row: {
  profile: NutritionStudentProfile | null;
  report: NutritionReport | null;
  analysis: NutritionWeeklyAnalysis | null;
  hasSafetyFlag: boolean;
}): string {
  if (!row.profile?.enabled) {
    return "Enable nutrition profile";
  }
  if (!row.report) {
    return "Add manual report";
  }
  if (row.report.status === "received" || row.report.status === "parsed") {
    return "Parse and review macros";
  }
  if (row.report.status === "insufficient" || row.report.status === "needs_review") {
    return "Fix report data quality";
  }
  if (row.hasSafetyFlag) {
    return "Manual safety review required";
  }
  if (!row.analysis || row.analysis.status === "needs_review") {
    return "Generate weekly nutrition review";
  }
  if (row.analysis.status === "draft_generated") {
    return "Review draft and mark approved";
  }
  return "Up to date";
}

export async function listNutritionDashboardRows(
  filters: NutritionDashboardFilters = {}
): Promise<NutritionDashboardRow[]> {
  const adminStudents = await listTrainingPeaksAdminStudents("all");
  const studentIds = adminStudents.map((student) => student.id);
  const [profilesByStudent, latestReportsByStudent, latestAnalysesByStudent, dailyMacroCounts] = await Promise.all([
    getNutritionProfilesByStudent(studentIds),
    getLatestReportsByStudent(studentIds),
    getLatestAnalysesByStudent(studentIds),
    getDailyMacroCountsByStudent(studentIds),
  ]);

  let rows: NutritionDashboardRow[] = adminStudents.map((student) => {
    const profile = profilesByStudent.get(student.id) ?? null;
    const report = latestReportsByStudent.get(student.id) ?? null;
    const analysis = latestAnalysesByStudent.get(student.id) ?? null;
    const safety = hasHardSafetyFlag(analysis);
    const nextAction = resolveNextAction({ profile, report, analysis, hasSafetyFlag: safety });
    return {
      studentId: student.id,
      studentSlug: student.studentId,
      studentName: student.studentName,
      isActive: student.isActive,
      weeklyReportEnabled: student.weeklyReportEnabled,
      telegramDeliveryEnabled: student.telegramDeliveryEnabled,
      nutritionEnabled: profile?.enabled ?? false,
      currentWeightKg: profile?.currentWeightKg ?? null,
      trackingApp: profile?.trackingApp ?? null,
      lastReportStatus: report?.status ?? null,
      lastReportCreatedAt: report?.createdAt ?? null,
      parsedDays: dailyMacroCounts.get(student.id) ?? 0,
      lastAnalysisStatus: analysis?.status ?? null,
      lastAnalysisId: analysis?.id ?? null,
      lastAnalysisWeekFrom: analysis?.weekFrom ?? null,
      lastAnalysisWeekTo: analysis?.weekTo ?? null,
      hasSafetyFlag: safety,
      nextAction,
      latestReportId: report?.id ?? null,
      latestReportWeekFrom: report?.weekFrom ?? null,
      latestReportWeekTo: report?.weekTo ?? null,
      nextActionHref: buildNutritionNextActionHref({
        studentId: student.id,
        nextAction,
        report: report
          ? { id: report.id, weekFrom: report.weekFrom, weekTo: report.weekTo }
          : null,
        analysis: analysis
          ? {
              id: analysis.id,
              weekFrom: analysis.weekFrom,
              weekTo: analysis.weekTo,
              reportId: analysis.reportId,
            }
          : null,
      }),
    };
  });

  const viewMode = filters.viewMode ?? "test";
  if (viewMode === "test") {
    rows = rows.filter((row) => row.nutritionEnabled);
  } else if (viewMode === "not-in-test") {
    rows = rows.filter((row) => !row.nutritionEnabled);
  }

  if (filters.active === true) {
    rows = rows.filter((row) => row.isActive);
  }
  if (filters.statuses && filters.statuses.length > 0) {
    rows = rows.filter((row) => row.lastReportStatus !== null && filters.statuses?.includes(row.lastReportStatus));
  }
  if (filters.analysisStatuses && filters.analysisStatuses.length > 0) {
    rows = rows.filter(
      (row) => row.lastAnalysisStatus !== null && filters.analysisStatuses?.includes(row.lastAnalysisStatus)
    );
  }
  if (filters.safetyOnly) {
    rows = rows.filter((row) => row.hasSafetyFlag);
  }

  return rows;
}

export async function getNutritionStudentEssentials(studentId: string): Promise<{
  student: TrainingPeaksStudent | null;
  profile: NutritionStudentProfile | null;
  contextItems: NutritionContextItem[];
  weightLogs: NutritionWeightLog[];
  activeMemoryItems: TrainingPeaksStudentMemoryItem[];
}> {
  const [student, profile, contextItems, weightLogs, activeMemoryItems] = await Promise.all([
    getTrainingPeaksStudentById(studentId),
    getNutritionStudentProfile(studentId),
    getActiveNutritionContextItems(studentId),
    getNutritionWeightLogs(studentId),
    listActiveTrainingPeaksStudentMemoryItems(studentId, {
      memoryTypes: [
        "communication_style",
        "schedule_constraint",
        "availability_preference",
        "planning_preference",
        "travel_or_life_event",
        "health_status",
        "pain_or_injury",
        "load_tolerance",
        "race_or_goal",
      ] as TrainingPeaksStudentMemoryType[],
      limit: 40,
    }),
  ]);
  return {
    student,
    profile,
    contextItems,
    weightLogs,
    activeMemoryItems,
  };
}

export async function getNutritionTrainingPeaksCacheWindow(input: {
  studentId: string;
  from: string;
  to: string;
}): Promise<TrainingPeaksWorkoutCacheRow[]> {
  return listTrainingPeaksWorkoutCacheForStudentDateRange(input);
}
