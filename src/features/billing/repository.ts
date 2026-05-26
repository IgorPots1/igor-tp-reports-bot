import { createSupabaseServerClient } from "@/features/supabase/server";
import type {
  BillingClient,
  BillingCurrency,
  BillingEmailImportAttachment,
  BillingEmailImportAttachmentStatus,
  BillingEmailImportRun,
  BillingEmailImportRunStatus,
  BillingImportedPayment,
  BillingPayerIdentity,
  BillingPayerIdentityConfidence,
  BillingPayerIdentityType,
  BillingImportedPaymentRawRow,
  BillingImportedPaymentStatus,
  BillingImportedPaymentUpdateInput,
  BillingClientUpdateInput,
  BillingMonthlyPayment,
  BillingMonthlyPaymentWithClient,
  BillingPaymentMethod,
  BillingPaymentSource,
  BillingPaymentStatus,
} from "@/features/billing/types";

type BillingClientRow = {
  id: string;
  student_id: string | null;
  client_name: string;
  group_name: string | null;
  monthly_amount: number;
  currency: BillingCurrency;
  planned_payment_day: number;
  payment_method: BillingPaymentMethod;
  is_active: boolean;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type BillingMonthlyPaymentRow = {
  id: string;
  billing_client_id: string;
  billing_month: string;
  planned_payment_date: string;
  actual_payment_date: string | null;
  planned_amount: number;
  paid_amount: number | null;
  currency: BillingCurrency;
  status: BillingPaymentStatus;
  source: BillingPaymentSource;
  external_payment_hash: string | null;
  overdue_reminded_at: string | null;
  marked_paid_by: string | null;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type BillingMonthlyPaymentWithClientRow = BillingMonthlyPaymentRow & {
  billing_clients: BillingClientRow | null;
};

type InsertBillingMonthlyPaymentRow = {
  billing_client_id: string;
  billing_month: string;
  planned_payment_date: string;
  planned_amount: number;
  currency: BillingCurrency;
  status: BillingPaymentStatus;
  source: BillingPaymentSource;
  created_by?: string | null;
  updated_by?: string | null;
};

type UpdateBillingMonthlyPaymentRow = Partial<{
  actual_payment_date: string | null;
  paid_amount: number | null;
  status: BillingPaymentStatus;
  source: BillingPaymentSource;
  external_payment_hash: string | null;
  overdue_reminded_at: string | null;
  marked_paid_by: string | null;
  notes: string | null;
  updated_by: string | null;
}>;

type UpdateBillingClientRow = Partial<{
  student_id: string | null;
  client_name: string;
  group_name: string | null;
  monthly_amount: number;
  planned_payment_day: number;
  payment_method: BillingPaymentMethod;
  is_active: boolean;
  updated_by: string | null;
}>;

type BillingImportedPaymentRow = {
  id: string;
  import_batch_id: string;
  payment_date: string;
  amount: number;
  currency: BillingCurrency;
  payer_hint: string | null;
  description: string | null;
  raw_row: BillingImportedPaymentRawRow;
  external_hash: string;
  status: BillingImportedPaymentStatus;
  matched_monthly_payment_id: string | null;
  matched_at: string | null;
  matched_by_coach_chat_id: string | null;
  source_file_name: string | null;
  email_message_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type InsertBillingImportedPaymentRow = {
  import_batch_id: string;
  payment_date: string;
  amount: number;
  currency: BillingCurrency;
  payer_hint: string | null;
  description: string | null;
  raw_row: BillingImportedPaymentRawRow;
  external_hash: string;
  status: "new";
  matched_monthly_payment_id: null;
  matched_at: null;
  matched_by_coach_chat_id: null;
  source_file_name: string | null;
  email_message_id: string | null;
};

type UpdateBillingImportedPaymentRow = Partial<{
  status: BillingImportedPaymentStatus;
  matched_monthly_payment_id: string | null;
  matched_at: string | null;
  matched_by_coach_chat_id: string | null;
  notes: string | null;
}>;

type BillingPayerIdentityRow = {
  id: string;
  billing_client_id: string;
  identity_type: BillingPayerIdentityType;
  identity_hash: string;
  display_hint: string | null;
  source_imported_payment_id: string | null;
  confidence: BillingPayerIdentityConfidence;
  first_seen_at: string;
  last_seen_at: string;
  match_count: number;
  created_at: string;
  updated_at: string;
};

type BillingEmailImportRunRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: BillingEmailImportRunStatus;
  mode: "dry_run" | "apply";
  scanned_messages_count: number;
  found_attachments_count: number;
  imported_payments_count: number;
  duplicate_payments_count: number;
  auto_matched_count: number;
  review_required_count: number;
  error_message: string | null;
  created_at: string;
};

type InsertBillingEmailImportRunRow = {
  status: BillingEmailImportRunStatus;
  mode: "dry_run" | "apply";
};

type UpdateBillingEmailImportRunRow = Partial<{
  finished_at: string | null;
  status: BillingEmailImportRunStatus;
  scanned_messages_count: number;
  found_attachments_count: number;
  imported_payments_count: number;
  duplicate_payments_count: number;
  auto_matched_count: number;
  review_required_count: number;
  error_message: string | null;
}>;

type BillingEmailImportAttachmentRow = {
  id: string;
  run_id: string | null;
  message_uid: string;
  attachment_filename: string;
  attachment_hash: string;
  status: BillingEmailImportAttachmentStatus;
  imported_count: number;
  duplicate_count: number;
  error_message: string | null;
  created_at: string;
};

type InsertBillingEmailImportAttachmentRow = {
  run_id: string | null;
  message_uid: string;
  attachment_filename: string;
  attachment_hash: string;
  status: BillingEmailImportAttachmentStatus;
  imported_count?: number;
  duplicate_count?: number;
  error_message?: string | null;
};

type UpdateBillingEmailImportAttachmentRow = Partial<{
  run_id: string | null;
  status: BillingEmailImportAttachmentStatus;
  imported_count: number;
  duplicate_count: number;
  error_message: string | null;
}>;

type InsertBillingPayerIdentityRow = {
  billing_client_id: string;
  identity_type: BillingPayerIdentityType;
  identity_hash: string;
  display_hint: string | null;
  source_imported_payment_id: string | null;
  confidence: BillingPayerIdentityConfidence;
};

type UpdateBillingPayerIdentityRow = Partial<{
  display_hint: string | null;
  source_imported_payment_id: string | null;
  last_seen_at: string;
  match_count: number;
}>;

function mapBillingClientRow(row: BillingClientRow): BillingClient {
  return {
    id: row.id,
    studentId: row.student_id,
    clientName: row.client_name,
    groupName: row.group_name,
    monthlyAmount: row.monthly_amount,
    currency: row.currency,
    plannedPaymentDay: row.planned_payment_day,
    paymentMethod: row.payment_method,
    isActive: row.is_active,
    notes: row.notes,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBillingMonthlyPaymentRow(row: BillingMonthlyPaymentRow): BillingMonthlyPayment {
  return {
    id: row.id,
    billingClientId: row.billing_client_id,
    billingMonth: row.billing_month,
    plannedPaymentDate: row.planned_payment_date,
    actualPaymentDate: row.actual_payment_date,
    plannedAmount: row.planned_amount,
    paidAmount: row.paid_amount,
    currency: row.currency,
    status: row.status,
    source: row.source,
    externalPaymentHash: row.external_payment_hash,
    overdueRemindedAt: row.overdue_reminded_at,
    markedPaidBy: row.marked_paid_by,
    notes: row.notes,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBillingImportedPaymentRow(row: BillingImportedPaymentRow): BillingImportedPayment {
  return {
    id: row.id,
    importBatchId: row.import_batch_id,
    paymentDate: row.payment_date,
    amount: row.amount,
    currency: row.currency,
    payerHint: row.payer_hint,
    description: row.description,
    rawRow: row.raw_row,
    externalHash: row.external_hash,
    status: row.status,
    matchedMonthlyPaymentId: row.matched_monthly_payment_id,
    matchedAt: row.matched_at,
    matchedByCoachChatId: row.matched_by_coach_chat_id,
    sourceFileName: row.source_file_name,
    emailMessageId: row.email_message_id,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBillingPayerIdentityRow(row: BillingPayerIdentityRow): BillingPayerIdentity {
  return {
    id: row.id,
    billingClientId: row.billing_client_id,
    identityType: row.identity_type,
    identityHash: row.identity_hash,
    displayHint: row.display_hint,
    sourceImportedPaymentId: row.source_imported_payment_id,
    confidence: row.confidence,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    matchCount: row.match_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBillingEmailImportRunRow(row: BillingEmailImportRunRow): BillingEmailImportRun {
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    mode: row.mode,
    scannedMessagesCount: row.scanned_messages_count,
    foundAttachmentsCount: row.found_attachments_count,
    importedPaymentsCount: row.imported_payments_count,
    duplicatePaymentsCount: row.duplicate_payments_count,
    autoMatchedCount: row.auto_matched_count,
    reviewRequiredCount: row.review_required_count,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

function mapBillingEmailImportAttachmentRow(
  row: BillingEmailImportAttachmentRow
): BillingEmailImportAttachment {
  return {
    id: row.id,
    runId: row.run_id,
    messageUid: row.message_uid,
    attachmentFilename: row.attachment_filename,
    attachmentHash: row.attachment_hash,
    status: row.status,
    importedCount: row.imported_count,
    duplicateCount: row.duplicate_count,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

function mapBillingMonthlyPaymentWithClientRow(
  row: BillingMonthlyPaymentWithClientRow
): BillingMonthlyPaymentWithClient {
  if (!row.billing_clients) {
    throw new Error(`Billing payment ${row.id} is missing joined client data.`);
  }

  return {
    ...mapBillingMonthlyPaymentRow(row),
    client: mapBillingClientRow(row.billing_clients),
  };
}

function mapBillingClientUpdateInput(input: BillingClientUpdateInput): UpdateBillingClientRow {
  const patch: UpdateBillingClientRow = {};

  if ("studentId" in input) {
    patch.student_id = input.studentId ?? null;
  }
  if ("clientName" in input) {
    patch.client_name = input.clientName;
  }
  if ("groupName" in input) {
    patch.group_name = input.groupName ?? null;
  }
  if ("monthlyAmount" in input) {
    patch.monthly_amount = input.monthlyAmount;
  }
  if ("plannedPaymentDay" in input) {
    patch.planned_payment_day = input.plannedPaymentDay;
  }
  if ("paymentMethod" in input) {
    patch.payment_method = input.paymentMethod;
  }
  if ("isActive" in input) {
    patch.is_active = input.isActive;
  }
  if ("updatedBy" in input) {
    patch.updated_by = input.updatedBy ?? null;
  }

  return patch;
}

export async function listActiveBillingClients(): Promise<BillingClient[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_clients")
    .select("*")
    .eq("is_active", true)
    .order("group_name", { ascending: true })
    .order("client_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to list active billing clients: ${error.message}`);
  }

  return ((data as BillingClientRow[]) ?? []).map(mapBillingClientRow);
}

export async function listBillingClientsIncludingInactive(): Promise<BillingClient[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_clients")
    .select("*")
    .order("is_active", { ascending: false })
    .order("group_name", { ascending: true })
    .order("client_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to list billing clients: ${error.message}`);
  }

  return ((data as BillingClientRow[]) ?? []).map(mapBillingClientRow);
}

export async function getBillingClientById(id: string): Promise<BillingClient | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.from("billing_clients").select("*").eq("id", id).maybeSingle();

  if (error) {
    throw new Error(`Failed to get billing client ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapBillingClientRow(data as BillingClientRow);
}

export async function getBillingClientByStudentId(studentId: string): Promise<BillingClient | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_clients")
    .select("*")
    .eq("student_id", studentId)
    .order("is_active", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get billing client by student ${studentId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapBillingClientRow(data as BillingClientRow);
}

export async function listBillingClientsByStudentId(studentId: string): Promise<BillingClient[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_clients")
    .select("*")
    .eq("student_id", studentId)
    .order("is_active", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list billing clients by student ${studentId}: ${error.message}`);
  }

  return ((data as BillingClientRow[]) ?? []).map(mapBillingClientRow);
}

export async function updateBillingClientById(
  id: string,
  patch: BillingClientUpdateInput
): Promise<BillingClient | null> {
  const supabase = createSupabaseServerClient();
  const rowPatch = mapBillingClientUpdateInput(patch);

  const { data, error } = await supabase
    .from("billing_clients")
    .update(rowPatch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update billing client ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapBillingClientRow(data as BillingClientRow);
}

export async function listBillingMonthlyPaymentsForMonth(
  billingMonth: string
): Promise<BillingMonthlyPayment[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_monthly_payments")
    .select("*")
    .eq("billing_month", billingMonth)
    .order("planned_payment_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to list billing payments for ${billingMonth}: ${error.message}`);
  }

  return ((data as BillingMonthlyPaymentRow[]) ?? []).map(mapBillingMonthlyPaymentRow);
}

export async function listBillingMonthlyPaymentsForClient(
  billingClientId: string
): Promise<BillingMonthlyPayment[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_monthly_payments")
    .select("*")
    .eq("billing_client_id", billingClientId)
    .order("billing_month", { ascending: false })
    .order("planned_payment_date", { ascending: false });

  if (error) {
    throw new Error(`Failed to list billing payments for client ${billingClientId}: ${error.message}`);
  }

  return ((data as BillingMonthlyPaymentRow[]) ?? []).map(mapBillingMonthlyPaymentRow);
}

export async function listBillingMonthlyPaymentsWithClientsForMonth(
  billingMonth: string
): Promise<BillingMonthlyPaymentWithClient[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_monthly_payments")
    .select("*, billing_clients(*)")
    .eq("billing_month", billingMonth)
    .order("planned_payment_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to list billing month status for ${billingMonth}: ${error.message}`);
  }

  return ((data as BillingMonthlyPaymentWithClientRow[]) ?? [])
    .map(mapBillingMonthlyPaymentWithClientRow)
    .sort((left, right) => {
      const groupCompare = (left.client.groupName ?? "").localeCompare(right.client.groupName ?? "", "en");
      if (groupCompare !== 0) {
        return groupCompare;
      }

      const nameCompare = left.client.clientName.localeCompare(right.client.clientName, "en");
      if (nameCompare !== 0) {
        return nameCompare;
      }

      return left.plannedPaymentDate.localeCompare(right.plannedPaymentDate);
    });
}

export async function getBillingMonthlyPaymentForClientMonth(input: {
  billingClientId: string;
  billingMonth: string;
}): Promise<BillingMonthlyPayment | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_monthly_payments")
    .select("*")
    .eq("billing_client_id", input.billingClientId)
    .eq("billing_month", input.billingMonth)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to get billing payment for client ${input.billingClientId} and month ${input.billingMonth}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  return mapBillingMonthlyPaymentRow(data as BillingMonthlyPaymentRow);
}

export async function insertBillingMonthlyPayments(
  rows: InsertBillingMonthlyPaymentRow[]
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("billing_monthly_payments").upsert(rows, {
    onConflict: "billing_client_id,billing_month",
    ignoreDuplicates: true,
  });

  if (error) {
    throw new Error(`Failed to insert monthly billing rows: ${error.message}`);
  }
}

export async function updateBillingMonthlyPaymentById(
  id: string,
  patch: UpdateBillingMonthlyPaymentRow
): Promise<BillingMonthlyPayment | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_monthly_payments")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update billing payment ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapBillingMonthlyPaymentRow(data as BillingMonthlyPaymentRow);
}

export async function getBillingImportedPaymentsByExternalHashes(
  externalHashes: string[]
): Promise<BillingImportedPayment[]> {
  if (externalHashes.length === 0) {
    return [];
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_imported_payments")
    .select("*")
    .in("external_hash", externalHashes);

  if (error) {
    throw new Error(`Failed to get imported billing payments by hash: ${error.message}`);
  }

  return ((data as BillingImportedPaymentRow[]) ?? []).map(mapBillingImportedPaymentRow);
}

export async function insertBillingImportedPayments(
  rows: InsertBillingImportedPaymentRow[]
): Promise<BillingImportedPayment[]> {
  if (rows.length === 0) {
    return [];
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_imported_payments")
    .upsert(rows, { onConflict: "external_hash", ignoreDuplicates: true })
    .select("*");

  if (error) {
    throw new Error(`Failed to insert imported billing payments: ${error.message}`);
  }

  return ((data as BillingImportedPaymentRow[]) ?? []).map(mapBillingImportedPaymentRow);
}

export async function createBillingEmailImportRun(
  row: InsertBillingEmailImportRunRow
): Promise<BillingEmailImportRun> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.from("billing_email_import_runs").insert(row).select("*").single();

  if (error) {
    throw new Error(`Failed to create billing email import run: ${error.message}`);
  }

  return mapBillingEmailImportRunRow(data as BillingEmailImportRunRow);
}

export async function updateBillingEmailImportRunById(
  id: string,
  patch: UpdateBillingEmailImportRunRow
): Promise<BillingEmailImportRun | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_email_import_runs")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update billing email import run ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapBillingEmailImportRunRow(data as BillingEmailImportRunRow);
}

export async function getBillingEmailImportAttachmentByMessageUidHash(input: {
  messageUid: string;
  attachmentHash: string;
}): Promise<BillingEmailImportAttachment | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_email_import_attachments")
    .select("*")
    .eq("message_uid", input.messageUid)
    .eq("attachment_hash", input.attachmentHash)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to get billing email import attachment ${input.messageUid}/${input.attachmentHash}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  return mapBillingEmailImportAttachmentRow(data as BillingEmailImportAttachmentRow);
}

export async function createBillingEmailImportAttachment(
  row: InsertBillingEmailImportAttachmentRow
): Promise<BillingEmailImportAttachment> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_email_import_attachments")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create billing email import attachment: ${error.message}`);
  }

  return mapBillingEmailImportAttachmentRow(data as BillingEmailImportAttachmentRow);
}

export async function updateBillingEmailImportAttachmentById(
  id: string,
  patch: UpdateBillingEmailImportAttachmentRow
): Promise<BillingEmailImportAttachment | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_email_import_attachments")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update billing email import attachment ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapBillingEmailImportAttachmentRow(data as BillingEmailImportAttachmentRow);
}

function mapBillingImportedPaymentUpdateInput(
  patch: BillingImportedPaymentUpdateInput
): UpdateBillingImportedPaymentRow {
  const rowPatch: UpdateBillingImportedPaymentRow = {};

  if ("status" in patch) {
    rowPatch.status = patch.status;
  }
  if ("matchedMonthlyPaymentId" in patch) {
    rowPatch.matched_monthly_payment_id = patch.matchedMonthlyPaymentId ?? null;
  }
  if ("matchedAt" in patch) {
    rowPatch.matched_at = patch.matchedAt ?? null;
  }
  if ("matchedByCoachChatId" in patch) {
    rowPatch.matched_by_coach_chat_id = patch.matchedByCoachChatId ?? null;
  }
  if ("notes" in patch) {
    rowPatch.notes = patch.notes ?? null;
  }

  return rowPatch;
}

export async function listBillingImportedPayments(options?: {
  status?: BillingImportedPaymentStatus;
}): Promise<BillingImportedPayment[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("billing_imported_payments")
    .select("*")
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list imported billing payments: ${error.message}`);
  }

  return ((data as BillingImportedPaymentRow[]) ?? []).map(mapBillingImportedPaymentRow);
}

export async function getBillingImportedPaymentById(id: string): Promise<BillingImportedPayment | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_imported_payments")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get imported billing payment ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapBillingImportedPaymentRow(data as BillingImportedPaymentRow);
}

export async function updateBillingImportedPaymentById(
  id: string,
  patch: BillingImportedPaymentUpdateInput
): Promise<BillingImportedPayment | null> {
  const supabase = createSupabaseServerClient();
  const rowPatch = mapBillingImportedPaymentUpdateInput(patch);
  const { data, error } = await supabase
    .from("billing_imported_payments")
    .update(rowPatch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update imported billing payment ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapBillingImportedPaymentRow(data as BillingImportedPaymentRow);
}

export async function getBillingPayerIdentityByTypeHash(input: {
  identityType: BillingPayerIdentityType;
  identityHash: string;
}): Promise<BillingPayerIdentity | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_payer_identities")
    .select("*")
    .eq("identity_type", input.identityType)
    .eq("identity_hash", input.identityHash)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to get billing payer identity ${input.identityType}/${input.identityHash}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  return mapBillingPayerIdentityRow(data as BillingPayerIdentityRow);
}

export async function listBillingPayerIdentitiesByTypeHash(input: {
  identityType: BillingPayerIdentityType;
  identityHash: string;
}): Promise<BillingPayerIdentity[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_payer_identities")
    .select("*")
    .eq("identity_type", input.identityType)
    .eq("identity_hash", input.identityHash);

  if (error) {
    throw new Error(
      `Failed to list billing payer identities ${input.identityType}/${input.identityHash}: ${error.message}`
    );
  }

  return ((data as BillingPayerIdentityRow[]) ?? []).map(mapBillingPayerIdentityRow);
}

export async function insertBillingPayerIdentity(
  row: InsertBillingPayerIdentityRow
): Promise<BillingPayerIdentity> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_payer_identities")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to insert billing payer identity: ${error.message}`);
  }

  return mapBillingPayerIdentityRow(data as BillingPayerIdentityRow);
}

export async function updateBillingPayerIdentityById(
  id: string,
  patch: UpdateBillingPayerIdentityRow
): Promise<BillingPayerIdentity | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_payer_identities")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update billing payer identity ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapBillingPayerIdentityRow(data as BillingPayerIdentityRow);
}

export async function listBillingPayerIdentitiesForClient(
  billingClientId: string
): Promise<BillingPayerIdentity[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_payer_identities")
    .select("*")
    .eq("billing_client_id", billingClientId)
    .order("match_count", { ascending: false })
    .order("last_seen_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list billing payer identities for ${billingClientId}: ${error.message}`);
  }

  return ((data as BillingPayerIdentityRow[]) ?? []).map(mapBillingPayerIdentityRow);
}

export async function getBillingMonthlyPaymentWithClientById(
  id: string
): Promise<BillingMonthlyPaymentWithClient | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_monthly_payments")
    .select("*, billing_clients(*)")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get billing payment ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapBillingMonthlyPaymentWithClientRow(data as BillingMonthlyPaymentWithClientRow);
}

export async function listUnpaidBillingMonthlyPaymentsWithClients(): Promise<BillingMonthlyPaymentWithClient[]> {
  const supabase = createSupabaseServerClient();
  const minBillingMonth = shiftBillingMonthIso(getCurrentBillingMonthIso(), -3);
  const { data, error } = await supabase
    .from("billing_monthly_payments")
    .select("*, billing_clients(*)")
    .in("status", ["pending", "overdue", "manual_review"])
    .gte("billing_month", minBillingMonth)
    .order("planned_payment_date", { ascending: false });

  if (error) {
    throw new Error(`Failed to list unpaid billing monthly payments: ${error.message}`);
  }

  return ((data as BillingMonthlyPaymentWithClientRow[]) ?? []).map(mapBillingMonthlyPaymentWithClientRow);
}

function getCurrentBillingMonthIso(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  const year = Number.parseInt(parts.find((part) => part.type === "year")?.value ?? "", 10);
  const month = Number.parseInt(parts.find((part) => part.type === "month")?.value ?? "", 10);

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error(`Unable to derive current billing month for ${now.toISOString()}.`);
  }

  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function shiftBillingMonthIso(monthIso: string, delta: number): string {
  const date = new Date(`${monthIso}T12:00:00.000Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1, 12, 0, 0))
    .toISOString()
    .slice(0, 10);
}
