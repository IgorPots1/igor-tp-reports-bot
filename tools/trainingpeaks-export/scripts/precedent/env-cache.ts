/**
 * Кэш контекста атлетов «на понедельник» за последние N недель — для валидатора по всем неделям
 * тренера (шаг R1). READ-ONLY. Пишет DATA_DIR/env-weeks.json: { "<aid>|<W>": {env, tier, ill, easy, thr} }.
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/precedent/env-cache.ts [N=26]
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadAthleteContexts } from "../lib/autoplanner-context.ts";
import { addDays, iso, mondayOf } from "./corpus.ts";
import { sbc } from "./dump-corpus.ts";
import { DATA_DIR } from "./load.ts";

const n = Number(process.argv[2] ?? 26);
const sb = sbc();
const thisMonday = mondayOf(iso(Date.now()));
const out: Record<string, unknown> = {};
for (let k = n; k >= 1; k--) {
  const W = addDays(thisMonday, -7 * k);
  const ctx = await loadAthleteContexts(sb, W);
  for (const [aid, c] of ctx) out[`${aid}|${W}`] = { env: c.envelope, tier: c.tier, ill: c.hasActiveIllness, easy: c.easy, threshold: c.threshold, athleteId: aid, quality: c.quality ?? null, runsOnTreadmill: c.runsOnTreadmill ?? false, qualityByEffort: c.qualityByEffort ?? null };
  console.log(`[env] ${W}: ${ctx.size}`);
}
writeFileSync(path.join(DATA_DIR, "env-weeks.json"), JSON.stringify(out));
console.log(`[env] → ${Object.keys(out).length} записей`);
