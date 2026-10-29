/* Агрегаты кликов на консультацию для /admin/tools-stats: по инструменту за сегодня / 7 / 30 дней
 * и всего. Дни московские, как у просмотров. */

import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";
import { moscowDay } from "@/features/page-views/stats";

export type ConsultClickStat = { tool: string; today: number; d7: number; d30: number; total: number };

const PAGE_SIZE = 1000;
const MAX_ROWS = 20000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const CONSULT_TOOL_LABELS: Record<string, string> = {
  marathon: "Тест готовности к марафону (МАРАФОН)",
  calendar: "Календарь подготовки к марафону (ВЕСНА)",
  raskladka: "Раскладка на марафон (ММ)",
  plan: "Калькулятор темпа (ПЛАН)",
  dress: "Калькулятор одежды (ГРАДУС)",
  nutrition: "Калькулятор питания (БАНАН)",
  shoes: "Подборщик кроссовок",
  trial: "Пробная неделя в боте",
  "en-marathon": "EN: marathon readiness test",
  "en-calendar": "EN: marathon calendar",
  "en-plan": "EN: pace calculator",
  "en-dress": "EN: what-to-wear calculator",
  "en-nutrition": "EN: fuel calculator",
  "en-week": "EN: free training week",
  other: "Другое",
};

export async function loadConsultClickStats(now = new Date()): Promise<{ rows: ConsultClickStat[]; truncated: boolean }> {
  const supabase = createSupabaseServerClient();
  const all: { tool: string; created_at: string }[] = [];
  let truncated = false;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("consult_clicks")
      .select("tool, created_at")
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(describeSupabaseError(error));
    all.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    if (all.length >= MAX_ROWS) {
      truncated = true;
      break;
    }
  }

  const today = moscowDay(now);
  const t7 = now.getTime() - 7 * DAY_MS;
  const t30 = now.getTime() - 30 * DAY_MS;
  const byTool = new Map<string, ConsultClickStat>();
  for (const r of all) {
    const s = byTool.get(r.tool) ?? { tool: r.tool, today: 0, d7: 0, d30: 0, total: 0 };
    const at = new Date(r.created_at);
    s.total += 1;
    if (at.getTime() >= t30) s.d30 += 1;
    if (at.getTime() >= t7) s.d7 += 1;
    if (moscowDay(at) === today) s.today += 1;
    byTool.set(r.tool, s);
  }
  const rows = [...byTool.values()].sort((a, b) => b.d30 - a.d30 || b.total - a.total);
  return { rows, truncated };
}
