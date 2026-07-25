/**
 * Block 3 — pause_gap analysis on the NEW (best-split + running-effort) method.
 *
 * Lists every candidate rejected with pause_gap: student_id / distance / date /
 * elapsed vs moving / divergence / workout_type / method. Headline: how many
 * remain after best-split, and what kind of workouts they are. Anonymized.
 *
 * Run: node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *        --env-file=.env.local scripts/pause-gap-analysis.ts
 * Read-only. The pause threshold (10%) is NOT changed here.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { evaluateAllRecordsForValidation } from "@/features/club/service";
import type { RecordDistanceKey } from "@/features/club/records";

async function main() {
  const run = await evaluateAllRecordsForValidation({ useBestSplit: true });

  const rows: string[] = [];
  const byType = new Map<string, number>();
  const byMethod = new Map<string, number>();
  let total = 0;

  for (const [sid, perDist] of run.byStudent) {
    const shortId = sid.slice(0, 8);
    for (const [key, res] of perDist) {
      for (const ev of res.evaluated) {
        if (ev.trust !== "hidden" || ev.hiddenReason !== "pause_gap") continue;
        total += 1;
        const c = ev.candidate;
        const q = run.quality.get(c.workoutId);
        const elapsed = c.segment ? c.segment.elapsedS : q?.lapElapsedSumS ?? null;
        const moving = c.segment ? c.segment.movingS : q?.lapTimerSumS ?? null;
        const ratio = elapsed && moving && moving > 0 ? elapsed / moving : null;
        const wtype = q?.workoutType ?? "неизв";
        byType.set(wtype, (byType.get(wtype) ?? 0) + 1);
        byMethod.set(c.calcMethod, (byMethod.get(c.calcMethod) ?? 0) + 1);
        rows.push(
          `| ${shortId} | ${key as RecordDistanceKey} | ${c.date} | ${elapsed !== null ? Math.round(elapsed) : "-"} | ${moving !== null ? Math.round(moving) : "-"} | ${ratio !== null ? `+${Math.round((ratio - 1) * 100)}%` : "-"} | ${wtype} | ${c.calcMethod} |`
        );
      }
    }
  }

  const L: string[] = [];
  L.push("# Разбор отбраковок по паузам (pause_gap) — новый метод");
  L.push("");
  L.push("Сгенерировано `scripts/pause-gap-analysis.ts` (read-only). Порог пауз (10%) НЕ менялся. Без ФИО.");
  L.push("");
  L.push("## Итог");
  L.push("");
  L.push(`- Всего кандидатов отбраковано по паузам (best-split, после фильтра бег-усилия): **${total}**`);
  L.push("- По типу активности (derived workout_type):");
  for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    L.push(`  - ${t}: ${n}`);
  }
  L.push("- По методу расчёта:");
  for (const [m, n] of [...byMethod.entries()].sort((a, b) => b[1] - a[1])) {
    L.push(`  - ${m}: ${n}`);
  }
  L.push("");
  L.push(
    "Вывод: это отрезки, где elapsed заметно больше moving — непрерывного усилия не было (остановки: светофоры, вода, пауза). " +
      "Порог 10% оставлен как есть. Забег vs тренировка по этим строкам достоверно не разделить без реестра стартов (Блок 6) — " +
      "как появятся заявки на старты, отрезки в дни забегов можно будет пометить и при желании смягчить порог только для них."
  );
  L.push("");
  L.push("## Отбракованные по паузам");
  L.push("");
  L.push("| student_id | дист | дата | elapsed,с | moving,с | расхождение | workout_type | метод |");
  L.push("|---|---|---|---|---|---|---|---|");
  L.push(...(rows.length ? rows : ["| _нет_ | | | | | | | |"]));
  L.push("");

  const out = resolve(process.cwd(), "docs/pause-gap-analysis.md");
  writeFileSync(out, L.join("\n"), "utf8");
  console.log(`Wrote ${out}`);
  console.log(`pause_gap total=${total}`);
}

main().catch((e) => {
  console.error("pause-gap-analysis failed:", e);
  process.exit(1);
});
