import { createSupabaseServerClient } from "@/features/supabase/server";

export type TrainingPeaksStudent = {
  id: string;
  studentId: string;
  studentName: string;
  trainingPeaksAthleteUrl: string;
  isActive: boolean;
  weeklyReportEnabled: boolean;
  archivedAt: string | null;
  telegramChatId: string | null;
  telegramUsername: string | null;
  telegramProfileUrl: string | null;
  telegramDeliveryEnabled: boolean;
  dataQualityStatus: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type TrainingPeaksStudentRow = {
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
  created_at: string;
  updated_at: string;
};

export type InsertTrainingPeaksStudentInput = {
  studentId: string;
  studentName: string;
  trainingPeaksAthleteUrl: string;
  isActive?: boolean;
  weeklyReportEnabled?: boolean;
  telegramChatId?: string | null;
  telegramUsername?: string | null;
  telegramProfileUrl?: string | null;
  telegramDeliveryEnabled?: boolean;
  dataQualityStatus?: string | null;
  notes?: string | null;
};

export type UpdateTrainingPeaksStudentTelegramContactInput = {
  telegramChatId?: string | null;
  telegramUsername?: string | null;
  telegramProfileUrl?: string | null;
  telegramDeliveryEnabled?: boolean;
};

export type UpdateTrainingPeaksStudentTelegramContactParams = {
  telegram_chat_id?: string | null;
  telegram_username?: string | null;
  telegram_profile_url?: string | null;
  telegram_delivery_enabled?: boolean;
};

export class TrainingPeaksStudentConflictError extends Error {
  readonly reason: "student_id" | "trainingpeaks_athlete_url";

  constructor(reason: "student_id" | "trainingpeaks_athlete_url") {
    super(`TrainingPeaks student already exists for ${reason}`);
    this.name = "TrainingPeaksStudentConflictError";
    this.reason = reason;
  }
}

export type TrainingPeaksWeeklyReport = {
  id: string;
  studentId: string;
  studentName: string;
  weekFrom: string;
  weekTo: string;
  status: string;
  reportMarkdown: string | null;
  editedReportMarkdown: string | null;
  editedAt: string | null;
  summaryJson: unknown | null;
  warnings: unknown | null;
  syncedAt: string;
  reviewStatus: string;
  approvedAt: string | null;
  sentAt: string | null;
  sentToChatId: string | null;
  deliveryError: string | null;
  createdAt: string;
  updatedAt: string;
};

type TrainingPeaksWeeklyReportRow = {
  id: string;
  student_id: string;
  student_name: string;
  week_from: string;
  week_to: string;
  status: string;
  report_markdown: string | null;
  edited_report_markdown: string | null;
  edited_at: string | null;
  summary_json: unknown | null;
  warnings: unknown | null;
  synced_at: string;
  review_status: string;
  approved_at: string | null;
  sent_at: string | null;
  sent_to_chat_id: string | null;
  delivery_error: string | null;
  created_at: string;
  updated_at: string;
};

export type UpdateTrainingPeaksWeeklyReportStateInput = {
  reviewStatus?: string;
  approvedAt?: string | null;
  sentAt?: string | null;
  sentToChatId?: string | null;
  deliveryError?: string | null;
};

export type UpdateTrainingPeaksWeeklyReportContentInput = {
  editedReportMarkdown?: string | null;
  editedAt?: string | null;
};

export type UpdateTrainingPeaksWeeklyReportReviewStateInput = {
  review_status: string;
  approved_at?: string | null;
  sent_at?: string | null;
  sent_to_chat_id?: string | null;
  delivery_error?: string | null;
};

export type TrainingPeaksWeek = {
  weekFrom: string;
  weekTo: string;
};

type TrainingPeaksWeekRow = {
  week_from: string;
  week_to: string;
};

export type TrainingPeaksJobType = "weekly_reports";
export type TrainingPeaksJobStatus = "queued" | "running" | "completed" | "failed";

export type TrainingPeaksJob = {
  id: string;
  jobType: TrainingPeaksJobType;
  status: TrainingPeaksJobStatus;
  weekFrom: string;
  weekTo: string;
  requestedByChatId: string | null;
  requestedByUserId: string | null;
  resultJson: unknown | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

type TrainingPeaksJobRow = {
  id: string;
  job_type: TrainingPeaksJobType;
  status: TrainingPeaksJobStatus;
  week_from: string;
  week_to: string;
  requested_by_chat_id: string | null;
  requested_by_user_id: string | null;
  result_json: unknown | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
};

export type CreateTrainingPeaksWeeklyJobInput = {
  weekFrom: string;
  weekTo: string;
  requestedByChatId?: string | null;
  requestedByUserId?: string | null;
};

export type TrainingPeaksBusinessChat = {
  id: string;
  businessConnectionId: string;
  chatId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  lastText: string | null;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

type TrainingPeaksBusinessChatRow = {
  id: string;
  business_connection_id: string;
  chat_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  last_text: string | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

export type UpsertTrainingPeaksBusinessChatInput = {
  businessConnectionId: string;
  chatId: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  lastText?: string | null;
  lastSeenAt?: string;
};

export type TrainingPeaksStudentTelegramLinkCodeStatus = "active" | "used" | "expired";

export type TrainingPeaksStudentTelegramLinkCode = {
  id: string;
  studentId: string;
  code: string;
  status: TrainingPeaksStudentTelegramLinkCodeStatus;
  expiresAt: string;
  usedAt: string | null;
  businessConnectionId: string | null;
  chatId: string | null;
  createdAt: string;
};

type TrainingPeaksStudentTelegramLinkCodeRow = {
  id: string;
  student_id: string;
  code: string;
  status: TrainingPeaksStudentTelegramLinkCodeStatus;
  expires_at: string;
  used_at: string | null;
  business_connection_id: string | null;
  chat_id: string | null;
  created_at: string;
};

export type InsertTrainingPeaksStudentTelegramLinkCodeInput = {
  studentId: string;
  code: string;
  status?: TrainingPeaksStudentTelegramLinkCodeStatus;
  expiresAt: string;
};

export class TrainingPeaksTelegramLinkCodeConflictError extends Error {
  readonly codeValue: string;

  constructor(codeValue: string) {
    super(`TrainingPeaks Telegram link code already exists: ${codeValue}`);
    this.name = "TrainingPeaksTelegramLinkCodeConflictError";
    this.codeValue = codeValue;
  }
}

export const TRAININGPEAKS_JOB_CANCELLED_ERROR_MESSAGE =
  "Cancelled from Telegram before Mac runner start";

export class TrainingPeaksJobConflictError extends Error {
  constructor() {
    super("TrainingPeaks weekly job already queued or running for this week");
    this.name = "TrainingPeaksJobConflictError";
  }
}

function mapTrainingPeaksStudentRow(row: TrainingPeaksStudentRow): TrainingPeaksStudent {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    trainingPeaksAthleteUrl: row.trainingpeaks_athlete_url,
    isActive: row.is_active,
    weeklyReportEnabled: row.weekly_report_enabled,
    archivedAt: row.archived_at,
    telegramChatId: row.telegram_chat_id,
    telegramUsername: row.telegram_username,
    telegramProfileUrl: row.telegram_profile_url,
    telegramDeliveryEnabled: row.telegram_delivery_enabled,
    dataQualityStatus: row.data_quality_status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTrainingPeaksWeeklyReportRow(
  row: TrainingPeaksWeeklyReportRow
): TrainingPeaksWeeklyReport {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    weekFrom: row.week_from,
    weekTo: row.week_to,
    status: row.status,
    reportMarkdown: row.report_markdown,
    editedReportMarkdown: row.edited_report_markdown,
    editedAt: row.edited_at,
    summaryJson: row.summary_json,
    warnings: row.warnings,
    syncedAt: row.synced_at,
    reviewStatus: row.review_status,
    approvedAt: row.approved_at,
    sentAt: row.sent_at,
    sentToChatId: row.sent_to_chat_id,
    deliveryError: row.delivery_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTrainingPeaksWeekRow(row: TrainingPeaksWeekRow): TrainingPeaksWeek {
  return {
    weekFrom: row.week_from,
    weekTo: row.week_to,
  };
}

function mapTrainingPeaksJobRow(row: TrainingPeaksJobRow): TrainingPeaksJob {
  return {
    id: row.id,
    jobType: row.job_type,
    status: row.status,
    weekFrom: row.week_from,
    weekTo: row.week_to,
    requestedByChatId: row.requested_by_chat_id,
    requestedByUserId: row.requested_by_user_id,
    resultJson: row.result_json,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

function mapTrainingPeaksBusinessChatRow(
  row: TrainingPeaksBusinessChatRow
): TrainingPeaksBusinessChat {
  return {
    id: row.id,
    businessConnectionId: row.business_connection_id,
    chatId: row.chat_id,
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    lastText: row.last_text,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTrainingPeaksStudentTelegramLinkCodeRow(
  row: TrainingPeaksStudentTelegramLinkCodeRow
): TrainingPeaksStudentTelegramLinkCode {
  return {
    id: row.id,
    studentId: row.student_id,
    code: row.code,
    status: row.status,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    businessConnectionId: row.business_connection_id,
    chatId: row.chat_id,
    createdAt: row.created_at,
  };
}

function pickDefinedValues<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as Partial<T>;
}

function getTrainingPeaksStudentConflictReason(error: {
  code?: string | null;
  constraint?: string | null;
  message?: string | null;
  details?: string | null;
}): "student_id" | "trainingpeaks_athlete_url" | null {
  if (error.code !== "23505") {
    return null;
  }

  const haystack = `${error.constraint ?? ""} ${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();

  if (haystack.includes("trainingpeaks_athlete_url")) {
    return "trainingpeaks_athlete_url";
  }

  if (haystack.includes("student_id")) {
    return "student_id";
  }

  return "student_id";
}

function isTrainingPeaksJobConflict(error: {
  code?: string | null;
  constraint?: string | null;
  message?: string | null;
  details?: string | null;
}): boolean {
  if (error.code !== "23505") {
    return false;
  }

  const haystack = `${error.constraint ?? ""} ${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return haystack.includes("trainingpeaks_jobs_active_week_idx");
}

function isTrainingPeaksTelegramLinkCodeConflict(error: {
  code?: string | null;
  constraint?: string | null;
  message?: string | null;
  details?: string | null;
}): boolean {
  if (error.code !== "23505") {
    return false;
  }

  const haystack = `${error.constraint ?? ""} ${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return haystack.includes("trainingpeaks_student_telegram_link_codes_active_code_idx");
}

export async function insertTrainingPeaksStudent(
  input: InsertTrainingPeaksStudentInput
): Promise<TrainingPeaksStudent> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .insert({
      student_id: input.studentId,
      student_name: input.studentName,
      trainingpeaks_athlete_url: input.trainingPeaksAthleteUrl,
      is_active: input.isActive ?? true,
      weekly_report_enabled: input.weeklyReportEnabled ?? true,
      telegram_chat_id: input.telegramChatId ?? null,
      telegram_username: input.telegramUsername ?? null,
      telegram_profile_url: input.telegramProfileUrl ?? null,
      telegram_delivery_enabled: input.telegramDeliveryEnabled ?? false,
      data_quality_status: input.dataQualityStatus ?? null,
      notes: input.notes ?? null,
    })
    .select("*")
    .single();

  if (error) {
    const conflictReason = getTrainingPeaksStudentConflictReason(error);

    if (conflictReason) {
      throw new TrainingPeaksStudentConflictError(conflictReason);
    }

    throw new Error(`Failed to insert TrainingPeaks student: ${error.message}`);
  }

  return mapTrainingPeaksStudentRow(data as TrainingPeaksStudentRow);
}

export async function setTrainingPeaksStudentWeeklyReportsEnabledById(
  id: string,
  enabled: boolean
): Promise<TrainingPeaksStudent | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .update({
      weekly_report_enabled: enabled,
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to update weekly reports flag for TrainingPeaks student ${id}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksStudentRow(data as TrainingPeaksStudentRow);
}

export async function listTrainingPeaksStudents(): Promise<TrainingPeaksStudent[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("*")
    .eq("is_active", true)
    .order("student_name", { ascending: true })
    .order("student_id", { ascending: true });

  if (error) {
    throw new Error(`Failed to list TrainingPeaks students: ${error.message}`);
  }

  return ((data as TrainingPeaksStudentRow[]) ?? []).map(mapTrainingPeaksStudentRow);
}

export async function listTrainingPeaksStudentsIncludingArchived(): Promise<TrainingPeaksStudent[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("*")
    .order("is_active", { ascending: false })
    .order("student_name", { ascending: true })
    .order("student_id", { ascending: true });

  if (error) {
    throw new Error(`Failed to list TrainingPeaks students: ${error.message}`);
  }

  return ((data as TrainingPeaksStudentRow[]) ?? []).map(mapTrainingPeaksStudentRow);
}

export async function getTrainingPeaksStudentById(id: string): Promise<TrainingPeaksStudent | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get TrainingPeaks student ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksStudentRow(data as TrainingPeaksStudentRow);
}

export async function getTrainingPeaksStudentByStudentId(
  studentId: string
): Promise<TrainingPeaksStudent | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("*")
    .eq("student_id", studentId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get TrainingPeaks student by student_id ${studentId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksStudentRow(data as TrainingPeaksStudentRow);
}

export async function upsertTrainingPeaksBusinessChatFromMessage(
  input: UpsertTrainingPeaksBusinessChatInput
): Promise<TrainingPeaksBusinessChat> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_business_chats")
    .upsert(
      {
        business_connection_id: input.businessConnectionId,
        chat_id: input.chatId,
        username: input.username ?? null,
        first_name: input.firstName ?? null,
        last_name: input.lastName ?? null,
        last_text: input.lastText ?? null,
        last_seen_at: input.lastSeenAt ?? new Date().toISOString(),
      },
      {
        onConflict: "business_connection_id,chat_id",
      }
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to upsert TrainingPeaks business chat: ${error.message}`);
  }

  return mapTrainingPeaksBusinessChatRow(data as TrainingPeaksBusinessChatRow);
}

export async function getTrainingPeaksBusinessChatById(
  id: string
): Promise<TrainingPeaksBusinessChat | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_business_chats")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get TrainingPeaks business chat ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksBusinessChatRow(data as TrainingPeaksBusinessChatRow);
}

export async function getTrainingPeaksBusinessChatByConnectionAndChatId(
  businessConnectionId: string,
  chatId: string
): Promise<TrainingPeaksBusinessChat | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_business_chats")
    .select("*")
    .eq("business_connection_id", businessConnectionId)
    .eq("chat_id", chatId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to get TrainingPeaks business chat ${businessConnectionId}/${chatId}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksBusinessChatRow(data as TrainingPeaksBusinessChatRow);
}

export async function listRecentTrainingPeaksBusinessChats(
  limit = 10
): Promise<TrainingPeaksBusinessChat[]> {
  const supabase = createSupabaseServerClient();
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_business_chats")
    .select("*")
    .order("last_seen_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Failed to list TrainingPeaks business chats: ${error.message}`);
  }

  return ((data as TrainingPeaksBusinessChatRow[]) ?? []).map(mapTrainingPeaksBusinessChatRow);
}

export async function listTrainingPeaksBusinessChatsByUsername(
  username: string,
  limit = 10
): Promise<TrainingPeaksBusinessChat[]> {
  const normalizedUsername = username.trim().replace(/^@+/, "");

  if (!normalizedUsername) {
    return [];
  }

  const supabase = createSupabaseServerClient();
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_business_chats")
    .select("*")
    .ilike("username", normalizedUsername)
    .order("last_seen_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(
      `Failed to list TrainingPeaks business chats by username ${normalizedUsername}: ${error.message}`
    );
  }

  return ((data as TrainingPeaksBusinessChatRow[]) ?? []).map(mapTrainingPeaksBusinessChatRow);
}

export async function expireActiveTrainingPeaksStudentTelegramLinkCodesForStudent(
  studentId: string
): Promise<number> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_telegram_link_codes")
    .update({
      status: "expired",
    })
    .eq("student_id", studentId)
    .eq("status", "active")
    .select("id");

  if (error) {
    throw new Error(
      `Failed to expire TrainingPeaks Telegram link codes for student ${studentId}: ${error.message}`
    );
  }

  return (data ?? []).length;
}

export async function insertTrainingPeaksStudentTelegramLinkCode(
  input: InsertTrainingPeaksStudentTelegramLinkCodeInput
): Promise<TrainingPeaksStudentTelegramLinkCode> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_telegram_link_codes")
    .insert({
      student_id: input.studentId,
      code: input.code,
      status: input.status ?? "active",
      expires_at: input.expiresAt,
    })
    .select("*")
    .single();

  if (error) {
    if (isTrainingPeaksTelegramLinkCodeConflict(error)) {
      throw new TrainingPeaksTelegramLinkCodeConflictError(input.code);
    }

    throw new Error(`Failed to insert TrainingPeaks Telegram link code: ${error.message}`);
  }

  return mapTrainingPeaksStudentTelegramLinkCodeRow(data as TrainingPeaksStudentTelegramLinkCodeRow);
}

export async function listTrainingPeaksStudentTelegramLinkCodesByCode(
  codes: string[]
): Promise<TrainingPeaksStudentTelegramLinkCode[]> {
  const normalizedCodes = Array.from(
    new Set(
      codes
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean)
    )
  );

  if (normalizedCodes.length === 0) {
    return [];
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_telegram_link_codes")
    .select("*")
    .in("code", normalizedCodes)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list TrainingPeaks Telegram link codes: ${error.message}`);
  }

  return ((data as TrainingPeaksStudentTelegramLinkCodeRow[]) ?? []).map(
    mapTrainingPeaksStudentTelegramLinkCodeRow
  );
}

export async function expireTrainingPeaksStudentTelegramLinkCodesByIds(ids: string[]): Promise<number> {
  const normalizedIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));

  if (normalizedIds.length === 0) {
    return 0;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_telegram_link_codes")
    .update({
      status: "expired",
    })
    .in("id", normalizedIds)
    .eq("status", "active")
    .select("id");

  if (error) {
    throw new Error(`Failed to expire TrainingPeaks Telegram link codes: ${error.message}`);
  }

  return (data ?? []).length;
}

export async function markTrainingPeaksStudentTelegramLinkCodeUsed(
  id: string,
  input: {
    usedAt?: string;
    businessConnectionId: string;
    chatId: string;
  }
): Promise<TrainingPeaksStudentTelegramLinkCode | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_telegram_link_codes")
    .update({
      status: "used",
      used_at: input.usedAt ?? new Date().toISOString(),
      business_connection_id: input.businessConnectionId,
      chat_id: input.chatId,
    })
    .eq("id", id)
    .eq("status", "active")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to mark TrainingPeaks Telegram link code ${id} used: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksStudentTelegramLinkCodeRow(data as TrainingPeaksStudentTelegramLinkCodeRow);
}

export async function updateTrainingPeaksStudentTelegramContactById(
  id: string,
  input: UpdateTrainingPeaksStudentTelegramContactInput
): Promise<TrainingPeaksStudent> {
  const updates = pickDefinedValues({
    telegram_chat_id: input.telegramChatId,
    telegram_username: input.telegramUsername,
    telegram_profile_url: input.telegramProfileUrl,
    telegram_delivery_enabled: input.telegramDeliveryEnabled,
  });

  if (Object.keys(updates).length === 0) {
    const existingStudent = await getTrainingPeaksStudentById(id);

    if (!existingStudent) {
      throw new Error(`Failed to update TrainingPeaks student ${id}: student not found`);
    }

    return existingStudent;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .update(updates)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update TrainingPeaks student ${id}: ${error.message}`);
  }

  if (!data) {
    throw new Error(`Failed to update TrainingPeaks student ${id}: student not found`);
  }

  return mapTrainingPeaksStudentRow(data as TrainingPeaksStudentRow);
}

export async function updateTrainingPeaksStudentTelegramContact(
  studentId: string,
  input: UpdateTrainingPeaksStudentTelegramContactParams
): Promise<TrainingPeaksStudent> {
  return updateTrainingPeaksStudentTelegramContactById(studentId, {
    telegramChatId: input.telegram_chat_id,
    telegramUsername: input.telegram_username,
    telegramProfileUrl: input.telegram_profile_url,
    telegramDeliveryEnabled: input.telegram_delivery_enabled,
  });
}

export async function unlinkTrainingPeaksStudentTelegramById(
  id: string
): Promise<TrainingPeaksStudent | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .update({
      telegram_chat_id: null,
      telegram_username: null,
      telegram_profile_url: null,
      telegram_delivery_enabled: false,
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to unlink Telegram for TrainingPeaks student ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksStudentRow(data as TrainingPeaksStudentRow);
}

export async function linkTrainingPeaksStudentToBusinessChat(
  studentId: string,
  chatId: string,
  businessConnectionId: string
): Promise<{ student: TrainingPeaksStudent; chat: TrainingPeaksBusinessChat } | null> {
  const [student, chat] = await Promise.all([
    getTrainingPeaksStudentById(studentId),
    getTrainingPeaksBusinessChatByConnectionAndChatId(businessConnectionId, chatId),
  ]);

  if (!student || !chat || !student.isActive) {
    return null;
  }

  const nextProfileUrl =
    chat.username?.trim()
      ? `https://t.me/${chat.username.trim()}`
      : student.telegramProfileUrl?.trim() || null;

  const updatedStudent = await updateTrainingPeaksStudentTelegramContact(studentId, {
    telegram_chat_id: chat.chatId,
    telegram_username: chat.username,
    telegram_profile_url: nextProfileUrl,
    telegram_delivery_enabled: true,
  });

  return {
    student: updatedStudent,
    chat,
  };
}

export async function disableTrainingPeaksStudentById(id: string): Promise<TrainingPeaksStudent> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .update({
      is_active: false,
      weekly_report_enabled: false,
      telegram_delivery_enabled: false,
      archived_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to disable TrainingPeaks student ${id}: ${error.message}`);
  }

  return mapTrainingPeaksStudentRow(data as TrainingPeaksStudentRow);
}

export async function enableTrainingPeaksStudentById(id: string): Promise<TrainingPeaksStudent> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .update({
      is_active: true,
      weekly_report_enabled: true,
      archived_at: null,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to enable TrainingPeaks student ${id}: ${error.message}`);
  }

  return mapTrainingPeaksStudentRow(data as TrainingPeaksStudentRow);
}

export async function getLatestTrainingPeaksWeek(): Promise<TrainingPeaksWeek | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_weekly_reports")
    .select("week_from, week_to")
    .order("week_from", { ascending: false })
    .order("week_to", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get latest TrainingPeaks week: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksWeekRow(data as TrainingPeaksWeekRow);
}

export async function listTrainingPeaksReportsForWeek(
  weekFrom: string,
  weekTo: string
): Promise<TrainingPeaksWeeklyReport[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_weekly_reports")
    .select("*")
    .eq("week_from", weekFrom)
    .eq("week_to", weekTo)
    .order("student_name", { ascending: true })
    .order("student_id", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list TrainingPeaks reports for ${weekFrom}..${weekTo}: ${error.message}`
    );
  }

  return ((data as TrainingPeaksWeeklyReportRow[]) ?? []).map(mapTrainingPeaksWeeklyReportRow);
}

export async function listAllTrainingPeaksReports(): Promise<TrainingPeaksWeeklyReport[]> {
  const supabase = createSupabaseServerClient();
  const pageSize = 1000;
  const reports: TrainingPeaksWeeklyReport[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("trainingpeaks_weekly_reports")
      .select("*")
      .order("week_from", { ascending: false })
      .order("week_to", { ascending: false })
      .order("synced_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Failed to list TrainingPeaks reports: ${error.message}`);
    }

    const rows = (data as TrainingPeaksWeeklyReportRow[]) ?? [];
    reports.push(...rows.map(mapTrainingPeaksWeeklyReportRow));

    if (rows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return reports;
}

export async function getTrainingPeaksWeeklyReportById(
  id: string
): Promise<TrainingPeaksWeeklyReport | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_weekly_reports")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get TrainingPeaks weekly report ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksWeeklyReportRow(data as TrainingPeaksWeeklyReportRow);
}

export async function updateTrainingPeaksWeeklyReportStateById(
  id: string,
  input: UpdateTrainingPeaksWeeklyReportStateInput
): Promise<TrainingPeaksWeeklyReport> {
  const updates = pickDefinedValues({
    review_status: input.reviewStatus,
    approved_at: input.approvedAt,
    sent_at: input.sentAt,
    sent_to_chat_id: input.sentToChatId,
    delivery_error: input.deliveryError,
  });

  if (Object.keys(updates).length === 0) {
    const existingReport = await getTrainingPeaksWeeklyReportById(id);

    if (!existingReport) {
      throw new Error(`Failed to update TrainingPeaks weekly report ${id}: report not found`);
    }

    return existingReport;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_weekly_reports")
    .update(updates)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update TrainingPeaks weekly report ${id}: ${error.message}`);
  }

  if (!data) {
    throw new Error(`Failed to update TrainingPeaks weekly report ${id}: report not found`);
  }

  return mapTrainingPeaksWeeklyReportRow(data as TrainingPeaksWeeklyReportRow);
}

export async function updateTrainingPeaksWeeklyReportContentById(
  id: string,
  input: UpdateTrainingPeaksWeeklyReportContentInput
): Promise<TrainingPeaksWeeklyReport> {
  const updates = pickDefinedValues({
    edited_report_markdown: input.editedReportMarkdown,
    edited_at: input.editedAt,
  });

  if (Object.keys(updates).length === 0) {
    const existingReport = await getTrainingPeaksWeeklyReportById(id);

    if (!existingReport) {
      throw new Error(`Failed to update TrainingPeaks weekly report ${id}: report not found`);
    }

    return existingReport;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_weekly_reports")
    .update(updates)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update TrainingPeaks weekly report ${id}: ${error.message}`);
  }

  if (!data) {
    throw new Error(`Failed to update TrainingPeaks weekly report ${id}: report not found`);
  }

  return mapTrainingPeaksWeeklyReportRow(data as TrainingPeaksWeeklyReportRow);
}

export async function updateTrainingPeaksWeeklyReportReviewState(
  reportId: string,
  input: UpdateTrainingPeaksWeeklyReportReviewStateInput
): Promise<TrainingPeaksWeeklyReport> {
  return updateTrainingPeaksWeeklyReportStateById(reportId, {
    reviewStatus: input.review_status,
    approvedAt: input.approved_at,
    sentAt: input.sent_at,
    sentToChatId: input.sent_to_chat_id,
    deliveryError: input.delivery_error,
  });
}

export async function approveTrainingPeaksWeeklyReportIfDraft(
  id: string
): Promise<TrainingPeaksWeeklyReport | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_weekly_reports")
    .update({
      review_status: "approved",
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("review_status", "draft")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to approve TrainingPeaks weekly report ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksWeeklyReportRow(data as TrainingPeaksWeeklyReportRow);
}

export async function claimTrainingPeaksWeeklyReportForSend(
  reportId: string
): Promise<TrainingPeaksWeeklyReport | null> {
  const supabase = createSupabaseServerClient();
  const nextApprovedAt = new Date().toISOString();

  for (const currentStatus of ["draft", "approved", "failed", "skipped"]) {
    const { data, error } = await supabase
      .from("trainingpeaks_weekly_reports")
      .update({
        review_status: "approved",
        approved_at: nextApprovedAt,
        delivery_error: null,
      })
      .eq("id", reportId)
      .eq("review_status", currentStatus)
      .select("*")
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to claim TrainingPeaks weekly report ${reportId}: ${error.message}`);
    }

    if (data) {
      return mapTrainingPeaksWeeklyReportRow(data as TrainingPeaksWeeklyReportRow);
    }
  }

  return null;
}

export async function createTrainingPeaksWeeklyJob(
  input: CreateTrainingPeaksWeeklyJobInput
): Promise<TrainingPeaksJob> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_jobs")
    .insert({
      job_type: "weekly_reports",
      status: "queued",
      week_from: input.weekFrom,
      week_to: input.weekTo,
      requested_by_chat_id: input.requestedByChatId ?? null,
      requested_by_user_id: input.requestedByUserId ?? null,
    })
    .select("*")
    .single();

  if (error) {
    if (isTrainingPeaksJobConflict(error)) {
      throw new TrainingPeaksJobConflictError();
    }

    throw new Error(`Failed to create TrainingPeaks weekly job: ${error.message}`);
  }

  return mapTrainingPeaksJobRow(data as TrainingPeaksJobRow);
}

export async function getTrainingPeaksJobById(jobId: string): Promise<TrainingPeaksJob | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get TrainingPeaks job ${jobId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksJobRow(data as TrainingPeaksJobRow);
}

export async function findActiveTrainingPeaksJobForWeek(
  jobType: TrainingPeaksJobType,
  weekFrom: string,
  weekTo: string
): Promise<TrainingPeaksJob | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_jobs")
    .select("*")
    .eq("job_type", jobType)
    .eq("week_from", weekFrom)
    .eq("week_to", weekTo)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to find active TrainingPeaks job for ${jobType} ${weekFrom}..${weekTo}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksJobRow(data as TrainingPeaksJobRow);
}

export async function listRecentTrainingPeaksJobs(limit = 10): Promise<TrainingPeaksJob[]> {
  const supabase = createSupabaseServerClient();
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const { data, error } = await supabase
    .from("trainingpeaks_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Failed to list TrainingPeaks jobs: ${error.message}`);
  }

  return ((data as TrainingPeaksJobRow[]) ?? []).map(mapTrainingPeaksJobRow);
}

export async function claimNextQueuedTrainingPeaksJob(): Promise<TrainingPeaksJob | null> {
  const supabase = createSupabaseServerClient();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: nextJob, error: selectError } = await supabase
      .from("trainingpeaks_jobs")
      .select("*")
      .eq("job_type", "weekly_reports")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (selectError) {
      throw new Error(`Failed to select next TrainingPeaks job: ${selectError.message}`);
    }

    if (!nextJob) {
      return null;
    }

    const { data: claimedJob, error: claimError } = await supabase
      .from("trainingpeaks_jobs")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
        finished_at: null,
        error_message: null,
      })
      .eq("id", nextJob.id)
      .eq("status", "queued")
      .select("*")
      .maybeSingle();

    if (claimError) {
      throw new Error(`Failed to claim TrainingPeaks job ${nextJob.id}: ${claimError.message}`);
    }

    if (claimedJob) {
      return mapTrainingPeaksJobRow(claimedJob as TrainingPeaksJobRow);
    }
  }

  return null;
}

export async function recoverStaleTrainingPeaksRunningJobs(timeoutMinutes: number): Promise<number> {
  const supabase = createSupabaseServerClient();
  const safeTimeoutMinutes = Math.max(1, Math.floor(timeoutMinutes));
  const cutoff = new Date(Date.now() - safeTimeoutMinutes * 60 * 1000).toISOString();
  const finishedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("trainingpeaks_jobs")
    .update({
      status: "failed",
      error_message: "Job marked failed after stale running timeout",
      result_json: null,
      finished_at: finishedAt,
    })
    .eq("job_type", "weekly_reports")
    .eq("status", "running")
    .not("started_at", "is", null)
    .lt("started_at", cutoff)
    .select("id");

  if (error) {
    throw new Error(`Failed to recover stale TrainingPeaks jobs: ${error.message}`);
  }

  return (data ?? []).length;
}

export async function completeTrainingPeaksJob(jobId: string, result: unknown): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("trainingpeaks_jobs")
    .update({
      status: "completed",
      result_json: result,
      error_message: null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to complete TrainingPeaks job ${jobId}: ${error.message}`);
  }
}

export async function failTrainingPeaksJob(
  jobId: string,
  errorMessage: string,
  result?: unknown
): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("trainingpeaks_jobs")
    .update({
      status: "failed",
      error_message: errorMessage,
      result_json: result ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to fail TrainingPeaks job ${jobId}: ${error.message}`);
  }
}

export async function cancelQueuedTrainingPeaksJob(jobId: string): Promise<TrainingPeaksJob | null> {
  const supabase = createSupabaseServerClient();
  const finishedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("trainingpeaks_jobs")
    .update({
      status: "failed",
      error_message: TRAININGPEAKS_JOB_CANCELLED_ERROR_MESSAGE,
      result_json: null,
      finished_at: finishedAt,
    })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to cancel queued TrainingPeaks job ${jobId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksJobRow(data as TrainingPeaksJobRow);
}
