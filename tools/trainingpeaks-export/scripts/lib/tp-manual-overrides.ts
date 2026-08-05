// Ручные оверрайды непрерывного пересчёта — единственный источник (restore / ночной джоб / verify).
// Обе функции ЗАЩИЩЁННЫЕ: если таблицы ещё нет (миграция не применена) или чтение упало — вернут
// пусто, а не бросят. Так код работает и до, и после миграции.
import type { SupabaseClient } from "@supabase/supabase-js";

/** Одобренные тренером лёгкие якоря (athlete_id → сек/км). Ручной ПЕРЕБИВАЕТ вычисленный. */
export async function loadManualAnchors(sb: SupabaseClient): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  try {
    const { data, error } = await sb.from("tp_manual_anchors").select("athlete_id, anchor_sec");
    if (error) return out;
    for (const r of data ?? []) { const id = Number(r.athlete_id); const a = Number(r.anchor_sec); if (Number.isInteger(id) && id > 0 && Number.isFinite(a) && a > 0) out.set(id, a); }
  } catch { /* таблицы нет → пусто */ }
  return out;
}

/** Атлеты, которых тренер ведёт вручную — НЕ пересчитываем автоматом, убираем из активных деферов. */
export async function loadRecomputeExceptions(sb: SupabaseClient): Promise<Set<number>> {
  const out = new Set<number>();
  try {
    const { data, error } = await sb.from("tp_recompute_exceptions").select("athlete_id");
    if (error) return out;
    for (const r of data ?? []) { const id = Number(r.athlete_id); if (Number.isInteger(id) && id > 0) out.add(id); }
  } catch { /* таблицы нет → пусто */ }
  return out;
}
