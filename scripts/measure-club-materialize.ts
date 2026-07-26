/**
 * Phase 1.1 measurement + Phase 1.2 recompute-on-full-data.
 *
 * READ-ONLY + DRY-RUN. Writes nothing to the DB (materialize runs dryRun). Writes
 * one doc: docs/records-full-data.md.
 *
 * Timings:
 *   - OLD per-open path  = evaluateAllRecordsForValidation() (loads ~20k workouts
 *     + all laps + reconstructs). This is the work getClubRecords USED to do on
 *     every tab open. Now it runs ONCE per scan inside materialize.
 *   - RECOMPUTE cost     = materializeClubRecords({dryRun:true}) — same heavy work.
 *   - NEW per-open read  = loadRecordSnapshots() — the small indexed read the tab
 *     now does (empty until the migration is applied + first materialize runs).
 *
 * Run:
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=/Users/igor/igor-tp-reports-bot/.env.local \
 *     scripts/measure-club-materialize.ts
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  evaluateAllRecordsForValidation,
  materializeClubRecords,
  loadRecordSnapshots,
  classifyRecordType,
} from "@/features/club/service";
import { CLUB_RECORD_DISTANCES } from "@/features/club/constants";
import type { RecordDistanceKey, RecordHiddenReason } from "@/features/club/records";

function ms(n: number): string {
  return `${Math.round(n)} ms`;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const evalOut = await evaluateAllRecordsForValidation();
  const oldPathMs = Date.now() - t0;

  const t1 = Date.now();
  const matResult = await materializeClubRecords({ dryRun: true });
  const recomputeMs = Date.now() - t1;

  const t2 = Date.now();
  const snapshots = await loadRecordSnapshots();
  const readMs = Date.now() - t2;

  // --- Recompute artifacts on FULL (paginated) data ---
  const distanceKeys = CLUB_RECORD_DISTANCES.map((d) => d.key);
  const trustTotals = { verified: 0, preliminary: 0, hidden: 0 };
  const hiddenReasons: Record<string, number> = {};
  const perDistance: Record<string, { verified: number; preliminary: number; hidden: number }> = {};
  const calcMethod = { best_split: 0, whole_workout: 0 };
  let raceBest = 0;
  let trainingBest = 0;

  for (const key of distanceKeys) perDistance[key] = { verified: 0, preliminary: 0, hidden: 0 };

  for (const [studentId, perDist] of evalOut.byStudent) {
    for (const key of distanceKeys) {
      const result = perDist.get(key as RecordDistanceKey);
      if (!result) continue;
      for (const ev of result.evaluated) {
        trustTotals[ev.trust] += 1;
        perDistance[key][ev.trust] += 1;
        if (ev.trust === "hidden") {
          const reason = (ev.hiddenReason ?? "unknown") as RecordHiddenReason | "unknown";
          hiddenReasons[reason] = (hiddenReasons[reason] ?? 0) + 1;
        } else {
          calcMethod[ev.calcMethod] += 1;
          const type = classifyRecordType(studentId, ev.candidate.date, evalOut.raceDatesByStudent);
          if (type === "race") raceBest += 1;
          else trainingBest += 1;
        }
      }
    }
  }

  const totalEvaluated = trustTotals.verified + trustTotals.preliminary + trustTotals.hidden;
  const pct = (n: number): string => (totalEvaluated > 0 ? `${((n / totalEvaluated) * 100).toFixed(1)}%` : "—");

  const lines: string[] = [];
  lines.push("# Records on FULL data (Phase 1.2 recompute)");
  lines.push("");
  lines.push(`Дата пересчёта: см. git-коммит. Read-only + dry-run прогон на ПОЛНЫХ (пагинированных) данных.`);
  lines.push(`Раньше клуб видел ~5% (1000 из ~20k строк из-за усечения); теперь окно читается целиком.`);
  lines.push("");
  lines.push("## Перф (Фаза 1.1)");
  lines.push("");
  lines.push(`| Метрика | Значение |`);
  lines.push(`|---|---|`);
  lines.push(`| Строк тренировок в окне (видимые) | ${evalOut.rows.length} |`);
  lines.push(`| Беговых завершённых | ${evalOut.runningWorkoutCount} |`);
  lines.push(`| Кандидатов | ${evalOut.candidateCount} |`);
  lines.push(`| **СТАРЫЙ путь / открытие вкладки** (loadRows+laps+reconstruct) | **${ms(oldPathMs)}** |`);
  lines.push(`| Пересчёт (materialize, dry-run) — раз на скан | ${ms(recomputeMs)} |`);
  lines.push(`| **НОВОЕ чтение вкладки** (loadRecordSnapshots) | **${ms(readMs)}** |`);
  lines.push(`| Снимков в таблице сейчас (учеников) | ${snapshots.size} |`);
  lines.push(`| Строк снимка при пересчёте (dry-run rowsWritten) | ${matResult.rowsWritten} |`);
  lines.push("");
  lines.push(
    `Вывод: тяжёлая работа (${ms(oldPathMs)}) уходит с «каждое открытие вкладки» на «раз на скан». ` +
      `Вкладка теперь читает ≤${matResult.rowsWritten || "N"} маленьких индексированных строк.`
  );
  lines.push("");
  lines.push("## Артефакты рекордов на полных данных (Фаза 1.2)");
  lines.push("");
  lines.push(`Всего оценённых кандидатов: ${totalEvaluated}`);
  lines.push("");
  lines.push(`| Уровень доверия | Кол-во | Доля |`);
  lines.push(`|---|---|---|`);
  lines.push(`| verified | ${trustTotals.verified} | ${pct(trustTotals.verified)} |`);
  lines.push(`| preliminary | ${trustTotals.preliminary} | ${pct(trustTotals.preliminary)} |`);
  lines.push(`| hidden | ${trustTotals.hidden} | ${pct(trustTotals.hidden)} |`);
  lines.push("");
  lines.push("### Причины отбраковки (hidden)");
  lines.push("");
  lines.push(`| Причина | Кол-во |`);
  lines.push(`|---|---|`);
  for (const [reason, n] of Object.entries(hiddenReasons).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${reason} | ${n} |`);
  }
  lines.push("");
  lines.push("### По дистанциям (не-hidden кандидаты)");
  lines.push("");
  lines.push(`| Дистанция | verified | preliminary | hidden |`);
  lines.push(`|---|---|---|---|`);
  for (const key of distanceKeys) {
    const d = perDistance[key];
    lines.push(`| ${key} | ${d.verified} | ${d.preliminary} | ${d.hidden} |`);
  }
  lines.push("");
  lines.push("### Метод расчёта / тип (не-hidden)");
  lines.push("");
  lines.push(`- best_split: ${calcMethod.best_split}`);
  lines.push(`- whole_workout: ${calcMethod.whole_workout}`);
  lines.push(`- как гонка (race date): ${raceBest}`);
  lines.push(`- как отрезок тренировки: ${trainingBest}`);
  lines.push("");

  const out = resolve(process.cwd(), "docs/records-full-data.md");
  writeFileSync(out, lines.join("\n"), "utf8");

  // Console summary
  console.log("== Club materialize measurement ==");
  console.log(`OLD per-open (heavy):   ${ms(oldPathMs)}`);
  console.log(`Recompute (dry-run):    ${ms(recomputeMs)}  rowsWritten=${matResult.rowsWritten}`);
  console.log(`NEW per-open (read):    ${ms(readMs)}  snapshots(students)=${snapshots.size}`);
  console.log(`rows=${evalOut.rows.length} running=${evalOut.runningWorkoutCount} candidates=${evalOut.candidateCount}`);
  console.log(`trust: verified=${trustTotals.verified} preliminary=${trustTotals.preliminary} hidden=${trustTotals.hidden}`);
  console.log(`wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
