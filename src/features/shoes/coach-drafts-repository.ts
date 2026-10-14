import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

import {
  applyDecision,
  batchProgress,
  draftIsConfirmed,
  type CoachDraft,
  type DraftFieldKey,
  type ExcludeReason,
} from "./coach-drafts";

/**
 * Хранилище черновиков тренерского каталога (таблица shoe_coach_drafts).
 * Только сервер, service role: страница проверки — за авторизацией админки.
 */

const TABLE = "shoe_coach_drafts";

type Row = {
  id: string;
  brand: string;
  model: string;
  kind: CoachDraft["kind"];
  batch: number;
  position: number;
  confidence: CoachDraft["confidence"];
  note: string | null;
  fields: CoachDraft["fields"];
  status: CoachDraft["status"];
  excluded_reason: CoachDraft["excluded_reason"];
};

const toDraft = (r: Row): CoachDraft => ({ ...r, fields: r.fields ?? {} });

export async function listDraftBatches(): Promise<{ batch: number; total: number; confirmed: number }[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.from(TABLE).select("batch,status");
  if (error) throw new Error(`shoe drafts: list batches: ${describeSupabaseError(error)}`);
  const by = new Map<number, { status: CoachDraft["status"] }[]>();
  for (const r of data ?? []) by.set(r.batch, [...(by.get(r.batch) ?? []), r]);
  // Убранные из каталога в счётчик пачки не входят.
  return [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([batch, rows]) => {
      const p = batchProgress(rows);
      return { batch, total: p.total, confirmed: p.confirmed };
    });
}

export async function listDraftBatch(batch: number): Promise<CoachDraft[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("id,brand,model,kind,batch,position,confidence,note,fields,status,excluded_reason")
    .eq("batch", batch)
    .order("position", { ascending: true });
  if (error) throw new Error(`shoe drafts: list batch ${batch}: ${describeSupabaseError(error)}`);
  return (data as Row[]).map(toDraft);
}

/**
 * Решение Игоря по одному полю. Читается свежая строка, решение кладётся в её
 * fields, статус модели пересчитывается: confirmed — когда ни одного поля в
 * статусе draft не осталось.
 */
export async function decideDraftField(input: {
  id: string;
  field: DraftFieldKey | "model";
  action: "confirm" | "correct" | "unknown";
  value: unknown;
}): Promise<CoachDraft> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("id,brand,model,kind,batch,position,confidence,note,fields,status,excluded_reason")
    .eq("id", input.id)
    .single();
  if (error || !data) throw new Error(`shoe drafts: read ${input.id}: ${error ? describeSupabaseError(error) : "нет строки"}`);
  const row = data as Row;
  const now = new Date().toISOString();
  const patch: Partial<Row> & { updated_at: string; confirmed_at?: string | null } = { updated_at: now };

  if (input.field === "model") {
    // Название правится только у пустых карточек: у прочитанных оно со страницы.
    if (row.kind !== "manual" || typeof input.value !== "string" || !input.value.trim()) {
      throw new Error("shoe drafts: название правится только у пустой карточки");
    }
    patch.model = input.value.trim();
  } else {
    const fields = { ...(row.fields ?? {}) };
    fields[input.field] = applyDecision(fields[input.field], input.action, input.value, now);
    patch.fields = fields;
    const confirmed = draftIsConfirmed(fields);
    // Убранная модель остаётся убранной, даже если по ней поправили поле.
    if (row.status !== "excluded") {
      patch.status = confirmed ? "confirmed" : "draft";
      patch.confirmed_at = confirmed ? now : null;
    }
  }

  const { data: updated, error: upErr } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("id", input.id)
    .select("id,brand,model,kind,batch,position,confidence,note,fields,status,excluded_reason")
    .single();
  if (upErr || !updated) throw new Error(`shoe drafts: update ${input.id}: ${upErr ? describeSupabaseError(upErr) : "нет строки"}`);
  return toDraft(updated as Row);
}

/**
 * «Убрать из каталога» (решение Игоря, 14.10.2026): модель целиком получает
 * status excluded с причиной. reason null — вернуть в работу: статус
 * пересчитывается по полям.
 */
export async function excludeDraft(id: string, reason: ExcludeReason | null): Promise<CoachDraft> {
  const supabase = createSupabaseServerClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase.from(TABLE).select("fields").eq("id", id).single();
  if (error || !data) throw new Error(`shoe drafts: read ${id}: ${error ? describeSupabaseError(error) : "нет строки"}`);
  const patch =
    reason === null
      ? {
          status: draftIsConfirmed((data as Row).fields ?? {}) ? "confirmed" : "draft",
          excluded_reason: null,
          excluded_by: null,
          excluded_at: null,
          updated_at: now,
        }
      : { status: "excluded", excluded_reason: reason, excluded_by: "igor", excluded_at: now, updated_at: now };
  const { data: updated, error: upErr } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("id", id)
    .select("id,brand,model,kind,batch,position,confidence,note,fields,status,excluded_reason")
    .single();
  if (upErr || !updated) throw new Error(`shoe drafts: exclude ${id}: ${upErr ? describeSupabaseError(upErr) : "нет строки"}`);
  return toDraft(updated as Row);
}
