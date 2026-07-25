/**
 * Block 2 — best-split vs whole-workout comparison.
 *
 * Runs record reconstruction BOTH ways (whole-workout and best-continuous-split)
 * over all visible students and writes docs/records-best-split.md: per
 * (student_id, distance) old time / new time / delta / trust, plus the headline
 * numbers (average delta, pause_gap rejections eliminated). Anonymized — student_id
 * only (first 8 chars), no names.
 *
 * Run: node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *        --env-file=.env.local scripts/records-best-split-report.ts
 * Read-only.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { evaluateAllRecordsForValidation } from "@/features/club/service";
import { CLUB_RECORD_DISTANCES } from "@/features/club/constants";
import type { RecordDistanceKey } from "@/features/club/records";

function fmt(sec: number): string {
  const t = Math.round(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
function signed(sec: number): string {
  const s = Math.round(sec);
  return s > 0 ? `+${s}с` : `${s}с`;
}

const KEYS = CLUB_RECORD_DISTANCES.map((d) => d.key) as RecordDistanceKey[];

async function main() {
  const oldRun = await evaluateAllRecordsForValidation({ useBestSplit: false });
  const newRun = await evaluateAllRecordsForValidation({ useBestSplit: true });

  const countPause = (run: typeof oldRun): number => {
    let n = 0;
    for (const perDist of run.byStudent.values()) {
      for (const res of perDist.values()) {
        for (const ev of res.evaluated) {
          if (ev.trust === "hidden" && ev.hiddenReason === "pause_gap") n += 1;
        }
      }
    }
    return n;
  };

  const rows: string[] = [];
  const deltas: number[] = [];
  let bothCount = 0;
  let onlyNew = 0;

  const allStudents = new Set<string>([...oldRun.byStudent.keys(), ...newRun.byStudent.keys()]);
  for (const sid of allStudents) {
    const shortId = sid.slice(0, 8);
    for (const key of KEYS) {
      const oldBest = oldRun.byStudent.get(sid)?.get(key)?.best ?? null;
      const newBest = newRun.byStudent.get(sid)?.get(key)?.best ?? null;
      if (!oldBest && !newBest) continue;
      const oldT = oldBest ? oldBest.candidate.durationSeconds : null;
      const newT = newBest ? newBest.candidate.durationSeconds : null;
      const trust = newBest ? newBest.trust : "-";
      const method = newBest ? newBest.calcMethod : "-";
      let deltaCell = "-";
      if (oldT !== null && newT !== null) {
        const d = newT - oldT;
        deltas.push(d);
        bothCount += 1;
        deltaCell = signed(d);
      } else if (newT !== null && oldT === null) {
        onlyNew += 1;
        deltaCell = "новый";
      }
      rows.push(
        `| ${shortId} | ${key} | ${oldT !== null ? fmt(oldT) : "—"} | ${newT !== null ? fmt(newT) : "—"} | ${deltaCell} | ${trust} | ${method} |`
      );
    }
  }

  const avgDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
  const improved = deltas.filter((d) => d < 0).length;
  const oldPause = countPause(oldRun);
  const newPause = countPause(newRun);

  const L: string[] = [];
  L.push("# Рекорды: лучший непрерывный отрезок vs вся тренировка");
  L.push("");
  L.push("Сгенерировано `scripts/records-best-split-report.ts` (read-only). Без ФИО — только student_id.");
  L.push("");
  L.push("## Итог (главное)");
  L.push("");
  L.push(`- Пар (рекорд есть в обоих методах): **${bothCount}**`);
  L.push(`- Улучшено новым методом (время меньше): **${improved}** из ${bothCount}`);
  L.push(`- **Средняя дельta (новый − старый): ${signed(avgDelta)}** (отрицательное = новый быстрее/точнее)`);
  L.push(`- Появилось только в новом методе (сплит нашёл отрезок, старый — нет): **${onlyNew}**`);
  L.push(
    `- Отбраковок по паузам (pause_gap): старый метод **${oldPause}**, новый метод **${newPause}**. ` +
      `Рост — потому что best-split строит кандидатов из ЛЮБОЙ пробежки ≥ дистанции (пул кандидатов больше), ` +
      `включая лёгкие бега со стопами. На показываемые (быстрые непрерывные) рекорды это не влияет; разбор — docs/pause-gap-analysis.md (Блок 3), фильтр прогулок — Блок 4.`
  );
  L.push("");
  L.push("## Пер-ученик / дистанция");
  L.push("");
  L.push("| student_id | дист | старое время | новое время | дельта | доверие | метод |");
  L.push("|---|---|---|---|---|---|---|");
  L.push(...(rows.length ? rows : ["| _нет_ | | | | | | |"]));
  L.push("");

  const out = resolve(process.cwd(), "docs/records-best-split.md");
  writeFileSync(out, L.join("\n"), "utf8");
  console.log(`Wrote ${out}`);
  console.log(`pairs=${bothCount} improved=${improved} avgDelta=${avgDelta.toFixed(1)}s onlyNew=${onlyNew} pause ${oldPause}->${newPause}`);
}

main().catch((e) => {
  console.error("records-best-split-report failed:", e);
  process.exit(1);
});
