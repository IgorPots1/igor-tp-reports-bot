/**
 * Бэктест НЫНЕШНЕГО генератора по правилам на прошлых неделях. READ-ONLY, в TP не пишет.
 *
 * Для каждого понедельника W из последних N завершённых недель: контекст атлетов «на W»
 * (loadAthleteContexts(sb, W) режет данные строго < W), черновик цикла buildDrafts(sb, ctx, W),
 * цель недели forecast(...)[0] и buildWeek — ровно как в tp-week-side-by-side.ts.
 *
 * ЧЕСТНО ПРО ПОДГЛЯДЫВАНИЕ: buildDrafts режет плановые строки только снизу (будущие плановые
 * недели тренера могут попасть в базу цикла), а training_cycles и тиры порогов берутся нынешние.
 * То есть сборщик здесь в чуть ЛУЧШИХ условиях, чем был бы тогда. Прецедент таких поблажек не имеет.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/precedent/rules-backtest.ts [N=8]
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadAthleteContexts } from "../lib/autoplanner-context.ts";
import { loadCatalog } from "../lib/autoplanner-catalog.ts";
import { buildWeek, type CycleWeekTarget, type Week } from "../lib/autoplanner-week.ts";
import { buildDrafts } from "../lib/cycle-drafts.ts";
import { forecast } from "../lib/training-cycle.ts";
import { addDays, iso, mondayOf } from "./corpus.ts";
import { sbc } from "./dump-corpus.ts";
import { DATA_DIR } from "./load.ts";

export type RulesSession = { dayIdx: number; role: string; title: string; minutes: number; description: string; deferred: boolean };
export type CycleInfo = { role: string; target: number; base: number; weekIndex: number; totalWeeks: number; hasTargetRace: boolean };
export type RulesWeek = { aid: number; weekStart: string; tier: string; refused: boolean; withCycle: boolean; cycle: CycleInfo | null; sessions: RulesSession[]; notes: string[]; studentNotes: string[] };

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? 8);
  const sb = sbc();
  const cat = await loadCatalog(sb);
  const thisMonday = mondayOf(iso(Date.now()));
  const out: RulesWeek[] = [];
  for (let k = n; k >= 1; k--) {
    const W = addDays(thisMonday, -7 * k);
    const ctx = await loadAthleteContexts(sb, W);
    const drafts = await buildDrafts(sb, ctx, W);
    let built = 0;
    for (const [aid, c] of ctx) {
      const d = drafts.get(aid);
      let w: Week | null = null; let withCycle = false; let cycle: CycleInfo | null = null;
      try {
        if (d) {
          const w2r = d.targetDate ? Math.round((Date.parse(d.targetDate) - Date.parse(W)) / (7 * 86400000)) + 1 : 8;
          const f = forecast(d, W, Math.max(1, w2r))[0];
          if (f) {
            const t: CycleWeekTarget = { weekIndex: 1, totalWeeks: Math.max(1, w2r), role: f.role, aerobicMin: f.aerobicMin, qualityMin: f.qualityMin, days: f.days,
              baseWeekMin: d.baseAerobicMin + d.baseQualityMin, hasTargetRace: d.targetDate != null, intent: d.intent };
            w = buildWeek(c, c.envelope, cat, W, c.hasActiveIllness, c.tierNote, t); withCycle = true;
            cycle = { role: f.role, target: f.aerobicMin + f.qualityMin, base: d.baseAerobicMin + d.baseQualityMin, weekIndex: 1, totalWeeks: Math.max(1, w2r), hasTargetRace: d.targetDate != null };
          }
        }
        if (!w) w = buildWeek(c, c.envelope, cat, W, c.hasActiveIllness, c.tierNote);
      } catch (e) { console.error(`[rules] ${aid} ${W}: ${e instanceof Error ? e.message : String(e)}`); continue; }
      out.push({
        aid, weekStart: W, tier: w.tier, refused: Boolean(w.refused), withCycle, cycle,
        sessions: (w.sessions ?? []).map((s) => ({ dayIdx: s.dayIdx, role: s.role, title: s.title, minutes: s.minutes, description: s.description, deferred: Boolean(s.deferred) })),
        notes: w.notes ?? [], studentNotes: w.studentNotes ?? [],
      });
      built++;
    }
    console.log(`[rules] ${W}: контекстов ${ctx.size}, черновиков ${drafts.size}, недель ${built}`);
  }
  writeFileSync(path.join(DATA_DIR, "rules-weeks.json"), JSON.stringify(out));
  console.log(`[rules] всего ${out.length} → ${DATA_DIR}/rules-weeks.json`);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
