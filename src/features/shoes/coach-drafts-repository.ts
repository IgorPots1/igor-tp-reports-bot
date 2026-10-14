import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

import { applyDecision, draftIsConfirmed, type CoachDraft, type DraftFieldKey } from "./coach-drafts";

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
};

const toDraft = (r: Row): CoachDraft => ({ ...r, fields: r.fields ?? {} });

export async function listDraftBatches(): Promise<{ batch: number; total: number; confirmed: number }[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.from(TABLE).select("batch,status");
  if (error) throw new Error(`shoe drafts: list batches: ${describeSupabaseError(error)}`);
  const by = new Map<number, { total: number; confirmed: number }>();
  for (const r of data ?? []) {
    const b = by.get(r.batch) ?? { total: 0, confirmed: 0 };
    b.total++;
    if (r.status === "confirmed") b.confirmed++;
    by.set(r.batch, b);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([batch, v]) => ({ batch, ...v }));
}

export async function listDraftBatch(batch: number): Promise<CoachDraft[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("id,brand,model,kind,batch,position,confidence,note,fields,status")
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
    .select("id,brand,model,kind,batch,position,confidence,note,fields,status")
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
    patch.status = confirmed ? "confirmed" : "draft";
    patch.confirmed_at = confirmed ? now : null;
  }

  const { data: updated, error: upErr } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("id", input.id)
    .select("id,brand,model,kind,batch,position,confidence,note,fields,status")
    .single();
  if (upErr || !updated) throw new Error(`shoe drafts: update ${input.id}: ${upErr ? describeSupabaseError(upErr) : "нет строки"}`);
  return toDraft(updated as Row);
}
