/**
 * Эталоны текстов шагов и история правок тренировок — сторона базы.
 * Чистая логика (ключи, проверки, подстановка) — в keys.ts.
 */
import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

import { isStepKey, type StepKey, type StepTextEtalons } from "./keys";

type Client = ReturnType<typeof createSupabaseServerClient>;

export type EtalonRow = {
  id: string;
  stepKey: StepKey;
  text: string;
  setAt: string;
  setBy: string;
  sourceSessionId: string | null;
  retiredAt: string | null;
  retiredBy: string | null;
};

/** Живые эталоны — то, что генератор подставляет вместо своих текстов. */
export async function loadLiveStepTextEtalons(client?: Client): Promise<StepTextEtalons> {
  const supabase = client ?? createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_step_text_etalons")
    .select("step_key, text")
    .is("retired_at", null);
  if (error) throw new Error(`intervals_step_text_etalons: ${describeSupabaseError(error)}`);
  const out: StepTextEtalons = {};
  for (const row of data ?? []) if (isStepKey(row.step_key)) out[row.step_key] = String(row.text);
  return out;
}

export async function listEtalons(client?: Client): Promise<EtalonRow[]> {
  const supabase = client ?? createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_step_text_etalons")
    .select("id, step_key, text, set_at, set_by, source_session_id, retired_at, retired_by")
    .order("set_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`intervals_step_text_etalons: ${describeSupabaseError(error)}`);
  return (data ?? [])
    .filter((r) => isStepKey(r.step_key))
    .map((r) => ({
      id: String(r.id),
      stepKey: r.step_key as StepKey,
      text: String(r.text),
      setAt: String(r.set_at),
      setBy: String(r.set_by),
      sourceSessionId: (r.source_session_id as string | null) ?? null,
      retiredAt: (r.retired_at as string | null) ?? null,
      retiredBy: (r.retired_by as string | null) ?? null,
    }));
}

/**
 * Поставить эталон: прежний живой для ключа снимается в том же шаге (живой один
 * на ключ — это держит и уникальный индекс в базе). Снятый не удаляется.
 */
export async function setEtalon(input: { key: StepKey; text: string; by: string; sourceSessionId: string | null }): Promise<void> {
  const supabase = createSupabaseServerClient();
  const now = new Date().toISOString();
  const { error: retireError } = await supabase
    .from("intervals_step_text_etalons")
    .update({ retired_at: now, retired_by: input.by })
    .eq("step_key", input.key)
    .is("retired_at", null);
  if (retireError) throw new Error(`снятие прежнего эталона: ${describeSupabaseError(retireError)}`);
  const { error } = await supabase.from("intervals_step_text_etalons").insert({
    step_key: input.key,
    text: input.text,
    set_by: input.by,
    source_session_id: input.sourceSessionId,
  });
  if (error) throw new Error(`эталон: ${describeSupabaseError(error)}`);
}

export async function retireEtalon(id: string, by: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("intervals_step_text_etalons")
    .update({ retired_at: new Date().toISOString(), retired_by: by })
    .eq("id", id)
    .is("retired_at", null);
  if (error) throw new Error(`снятие эталона: ${describeSupabaseError(error)}`);
}

export type SessionEditInput = {
  sourceId: string;
  sessionId: string;
  sessionDate: string;
  field: "title" | "note" | "step_text" | "step_minutes";
  stepIndex: number | null;
  stepKey: StepKey | null;
  before: string | null;
  after: string | null;
  becameEtalon: boolean;
};

export async function recordSessionEdits(edits: SessionEditInput[], by: string): Promise<void> {
  if (!edits.length) return;
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("intervals_session_edits").insert(
    edits.map((e) => ({
      source_id: e.sourceId,
      session_id: e.sessionId,
      session_date: e.sessionDate,
      field: e.field,
      step_index: e.stepIndex,
      step_key: e.stepKey,
      value_before: e.before,
      value_after: e.after,
      edited_by: by,
      became_etalon: e.becameEtalon,
    })),
  );
  if (error) throw new Error(`intervals_session_edits: ${describeSupabaseError(error)}`);
}

export async function listSessionEdits(sessionIds: string[], client?: Client) {
  if (!sessionIds.length) return [];
  const supabase = client ?? createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_session_edits")
    .select("session_id, field, step_index, step_key, value_before, value_after, edited_by, edited_at, became_etalon")
    .in("session_id", sessionIds)
    .order("edited_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`intervals_session_edits: ${describeSupabaseError(error)}`);
  return data ?? [];
}
