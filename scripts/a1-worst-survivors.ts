/**
 * A1 validation (READ-ONLY). For each distance: training-split candidates BEFORE the
 * meaningfulness filter vs AFTER. Then the 10 SLOWEST-pace splits that STILL PASS,
 * with the athlete's baseline — to confirm junk-slow "records" (e.g. "5k @ 8:34/km")
 * are gone / only survive when genuinely faster than that athlete's own usual pace.
 * Writes docs/a1-worst-survivors.md. No DB writes.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { evaluateAllRecordsForValidation, classifyRecordType } from "@/features/club/service";
import { baselinePaceSecPerKm, isSplitMeaningful } from "@/features/club/records";
import * as C from "@/features/club/constants";
import type { RecordDistanceKey } from "@/features/club/records";

function paceStr(secPerKm: number | null): string {
  if (secPerKm === null || !Number.isFinite(secPerKm)) return "—";
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}/км`;
}

async function main(): Promise<void> {
  const run = await evaluateAllRecordsForValidation({ useBestSplit: true });
  const keys = C.CLUB_RECORD_DISTANCES.map((d) => d.key) as RecordDistanceKey[];
  const margin = C.CLUB_RECORD_MEANINGFUL_SPLIT_MARGIN;

  const baseline = new Map<string, number | null>();
  for (const s of run.students) {
    const paces: number[] = [];
    for (const r of run.rows) {
      if (r.studentId !== s.id || !r.isCompleted || !r.isRunning) continue;
      const km = r.distanceKm ?? 0, sec = r.durationSeconds ?? 0;
      if (km < C.CLUB_RECORD_BASELINE_MIN_KM || sec <= 0) continue;
      paces.push(sec / km);
    }
    baseline.set(s.id, baselinePaceSecPerKm(paces, {
      minRuns: C.CLUB_RECORD_BASELINE_MIN_RUNS,
      floorSecPerKm: C.CLUB_RECORD_BASELINE_PACE_FLOOR_SEC_PER_KM,
      ceilingSecPerKm: C.CLUB_RECORD_PACE_CEILING_SEC_PER_KM,
    }));
  }
  const nameById = new Map(run.students.map((s) => [s.id, s.name]));

  const before: Record<string, number> = {};
  const after: Record<string, number> = {};
  for (const k of keys) { before[k] = 0; after[k] = 0; }

  type Row = { studentId: string; name: string; key: string; pace: number; base: number | null; passed: boolean };
  const survivors: Row[] = [];

  for (const s of run.students) {
    const perDist = run.byStudent.get(s.id);
    const b = baseline.get(s.id) ?? null;
    for (const k of keys) {
      const evals = perDist?.get(k)?.evaluated ?? [];
      let best: { km: number; sec: number } | null = null;
      let bestDur = Infinity;
      for (const ev of evals) {
        if (ev.trust === "hidden") continue;
        if (classifyRecordType(s.id, ev.candidate.date, run.raceDatesByStudent) === "race") continue;
        if (ev.candidate.durationSeconds < bestDur) {
          bestDur = ev.candidate.durationSeconds;
          best = { km: ev.candidate.distanceKm, sec: ev.candidate.durationSeconds };
        }
      }
      if (!best) continue;
      const pace = best.km > 0 ? best.sec / best.km : NaN;
      before[k] += 1;
      const passed = isSplitMeaningful(pace, b, margin);
      if (passed) {
        after[k] += 1;
        survivors.push({ studentId: s.id, name: nameById.get(s.id) ?? "", key: k, pace, base: b, passed });
      }
    }
  }

  survivors.sort((a, z) => z.pace - a.pace); // slowest first
  const worst10 = survivors.slice(0, 10);

  const lines: string[] = [];
  lines.push("# A1 — до/после фильтра + 10 худших по темпу ПРОШЕДШИХ (read-only)");
  lines.push("");
  lines.push(`Порог: отрезок проходит, если его темп ≤ базовая линия × (1 − ${margin}) (т.е. ≥${margin * 100}% быстрее).`);
  lines.push("");
  lines.push("## Кандидаты-отрезки: до фильтра → после");
  lines.push("");
  lines.push("| Дистанция | до A1 | после A1 | отсеяно |");
  lines.push("|---|---|---|---|");
  for (const k of keys) lines.push(`| ${k} | ${before[k]} | ${after[k]} | ${before[k] - after[k]} |`);
  const bt = keys.reduce((a, k) => a + before[k], 0), at = keys.reduce((a, k) => a + after[k], 0);
  lines.push(`| **всего** | **${bt}** | **${at}** | **${bt - at}** |`);
  lines.push("");
  lines.push("## 10 самых МЕДЛЕННЫХ отрезков, которые фильтр ПРОПУСТИЛ");
  lines.push("");
  lines.push("Каждый прошёл, потому что быстрее СОБСТВЕННОЙ базовой линии атлета на ≥5%.");
  lines.push("");
  lines.push("| # | ученик | дист | темп отрезка | базовая линия | отрезок быстрее базы на |");
  lines.push("|---|---|---|---|---|---|");
  worst10.forEach((r, i) => {
    const faster = r.base ? `${(((r.base - r.pace) / r.base) * 100).toFixed(1)}%` : "—";
    lines.push(`| ${i + 1} | ${r.name} | ${r.key} | ${paceStr(r.pace)} | ${paceStr(r.base)} | ${faster} |`);
  });
  lines.push("");

  const out = resolve(process.cwd(), "docs/a1-worst-survivors.md");
  writeFileSync(out, lines.join("\n"), "utf8");

  console.log("== A1 before/after ==");
  for (const k of keys) console.log(`  ${k}: ${before[k]} → ${after[k]}`);
  console.log("== 10 slowest survivors (pace / baseline) ==");
  worst10.forEach((r, i) => console.log(`  ${i + 1}. ${r.key} ${paceStr(r.pace)} (base ${paceStr(r.base)}) ${r.name}`));
  console.log(`wrote ${out}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
