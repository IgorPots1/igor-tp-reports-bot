/**
 * Stage C4 — records validation.
 *
 * Runs the club record reconstruction over ALL visible students and writes a
 * density report to docs/records-validation.md: per (student, distance) the
 * reconstructed time / date / trust level / whether laps exist / rejection reason,
 * plus top-line stats (verified / preliminary / hidden shares, laps coverage,
 * rejection-reason breakdown).
 *
 * Run (with tsx):     npx tsx scripts/validate-records.ts
 * Run (no tsx, node):  node --experimental-strip-types \
 *                        --loader ./scripts/_alias-loader.mjs \
 *                        --env-file=.env.local scripts/validate-records.ts
 * (_alias-loader.mjs resolves the `@/` + extensionless TS imports for raw node.)
 * Needs the same Supabase env as the app (reads trainingpeaks_workout_cache +
 * _laps + _derived_metrics). Read-only — writes nothing to the DB.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { evaluateAllRecordsForValidation } from "@/features/club/service";
import { CLUB_RECORD_DISTANCES } from "@/features/club/constants";
import type { RecordDistanceKey, RecordHiddenReason } from "@/features/club/records";

function fmtTime(sec: number): string {
  const t = Math.round(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

async function main() {
  const { students, byStudent, quality, candidateCount, runningWorkoutCount } =
    await evaluateAllRecordsForValidation();

  const nameById = new Map(students.map((s) => [s.id, s.name]));

  let verified = 0;
  let preliminary = 0;
  let hidden = 0;
  const hiddenReasons = new Map<RecordHiddenReason, number>();
  const tableRows: string[] = [];
  const hiddenRows: string[] = [];

  for (const [studentId, perDist] of byStudent) {
    const name = nameById.get(studentId) ?? studentId.slice(0, 8);
    for (const key of CLUB_RECORD_DISTANCES.map((d) => d.key) as RecordDistanceKey[]) {
      const res = perDist.get(key);
      if (!res) {
        continue;
      }
      const surfaced = res.best;
      if (surfaced) {
        const c = surfaced.candidate;
        const trust = surfaced.trust;
        if (trust === "verified") verified += 1;
        else preliminary += 1;
        tableRows.push(
          `| ${name} | ${key} | ${fmtTime(c.durationSeconds)} | ${c.date} | ${trust} | ${surfaced.hasLaps ? "да" : "нет"} | ${surfaced.paceCv !== null ? surfaced.paceCv.toFixed(3) : "-"} |`
        );
      }
      // Count + list every hidden candidate (rejected), even if a slower record surfaced.
      for (const ev of res.evaluated) {
        if (ev.trust === "hidden" && ev.hiddenReason) {
          hidden += 1;
          hiddenReasons.set(ev.hiddenReason, (hiddenReasons.get(ev.hiddenReason) ?? 0) + 1);
          const c = ev.candidate;
          hiddenRows.push(
            `| ${name} | ${key} | ${fmtTime(c.durationSeconds)} | ${c.date} | ${ev.hiddenReason} |`
          );
        }
      }
    }
  }

  const withLaps = [...quality.values()].filter((q) => q.hasLaps).length;
  const totalQuality = quality.size;
  const totalRecords = verified + preliminary;
  const pctVerified = totalRecords > 0 ? Math.round((verified / totalRecords) * 100) : 0;
  const pctPreliminary = totalRecords > 0 ? Math.round((preliminary / totalRecords) * 100) : 0;
  const pctLaps = totalQuality > 0 ? Math.round((withLaps / totalQuality) * 100) : 0;

  const lines: string[] = [];
  lines.push("# Валидация рекордов /m/club");
  lines.push("");
  lines.push(`Сгенерировано скриптом \`scripts/validate-records.ts\` (read-only).`);
  lines.push("");
  lines.push("## Плотность данных (главное)");
  lines.push("");
  lines.push(`- Беговых завершённых тренировок в окне: **${runningWorkoutCount}**`);
  lines.push(`- Кандидатов в рекорды (в полосах дистанций): **${candidateCount}**`);
  lines.push(`- Тренировок-кандидатов с заполненными laps: **${withLaps} из ${totalQuality} (${pctLaps}%)**`);
  lines.push(`- Показываемых рекордов: **${totalRecords}** → verified **${verified} (${pctVerified}%)**, preliminary **${preliminary} (${pctPreliminary}%)**`);
  lines.push(`- Отбраковано кандидатов (hidden): **${hidden}**`);
  lines.push("");
  lines.push("### Причины отбраковки");
  lines.push("");
  if (hiddenReasons.size === 0) {
    lines.push("_нет отбракованных_");
  } else {
    lines.push("| Причина | Кол-во |");
    lines.push("|---|---|");
    for (const [reason, n] of [...hiddenReasons.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${reason} | ${n} |`);
    }
  }
  lines.push("");
  lines.push("## Показываемые рекорды");
  lines.push("");
  lines.push("| Ученик | Дистанция | Время | Дата | Доверие | Есть laps | CV темпа |");
  lines.push("|---|---|---|---|---|---|---|");
  lines.push(...(tableRows.length ? tableRows : ["| _нет_ | | | | | | |"]));
  lines.push("");
  lines.push("## Отбракованные (hidden) кандидаты");
  lines.push("");
  lines.push("| Ученик | Дистанция | Время | Дата | Причина |");
  lines.push("|---|---|---|---|---|");
  lines.push(...(hiddenRows.length ? hiddenRows : ["| _нет_ | | | | |"]));
  lines.push("");

  const outPath = resolve(process.cwd(), "docs/records-validation.md");
  writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`Wrote ${outPath}`);
  console.log(
    `verified=${verified} preliminary=${preliminary} hidden=${hidden} laps=${pctLaps}% candidates=${candidateCount}`
  );
}

main().catch((err) => {
  console.error("validate-records failed:", err);
  process.exit(1);
});
