import { createSupabaseServerClient } from "@/features/supabase/server";
import type {
  BillingClient,
  BillingCurrency,
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
