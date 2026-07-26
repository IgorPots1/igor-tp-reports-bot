/**
 * Phase 1.5 report — race_events connected as a race source.
 *
 * READ-ONLY. Recomputes records on full data with race_events now feeding
 * classifyRecordType (via the refactored loadRaceDatesByStudent) and reports:
 *   - how many RACE records appear now (was 0 before wiring) + by source
 *   - per-distance race counts
 *   - who still has NO race (the real manual-entry remainder, 1.5.5)
 * Writes docs/race-events-report.md.
 *
 * Run:
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=/Users/igor/igor-tp-reports-bot/.env.local scripts/report-race-events.ts
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  evaluateAllRecordsForValidation,
  classifyRecordType,
  loadRaceDatesWithSource,
} from "@/features/club/service";
import { CLUB_RECORD_DISTANCES } from "@/features/club/constants";
import type { RecordDistanceKey } from "@/features/club/records";

async function main(): Promise<void> {
  const [run, raceSource] = await Promise.all([
    evaluateAllRecordsForValidation({ useBestSplit: true }),
    loadRaceDatesWithSource(),
  ]);
  const keys = CLUB_RECORD_DISTANCES.map((d) => d.key) as RecordDistanceKey[];

  const bySource: Record<string, number> = { race_events: 0, club_races: 0, reconstructed: 0 };
  const raceByDistance: Record<string, number> = {};
  for (const k of keys) raceByDistance[k] = 0;

  const studentsWithRace = new Set<string>();
  let raceRecords = 0;
  let trainingRecords = 0;

  for (const student of run.students) {
    const perDist = run.byStudent.get(student.id);
    for (const key of keys) {
      const best = perDist?.get(key)?.best ?? null;
      if (!best) continue;
      const type = classifyRecordType(student.id, best.candidate.date, run.raceDatesByStudent);
      if (type === "race") {
        raceRecords += 1;
        raceByDistance[key] += 1;
        studentsWithRace.add(student.id);
        const src = raceSource.get(student.id)?.get(best.candidate.date) ?? "reconstructed";
        bySource[src] = (bySource[src] ?? 0) + 1;
      } else {
        trainingRecords += 1;
      }
    }
  }

  const noRace = run.students.filter((s) => !studentsWithRace.has(s.id));

  const lines: string[] = [];
  lines.push("# race_events как источник гонок — отчёт (Фаза 1.5)");
  lines.push("");
  lines.push("Read-only пересчёт на ПОЛНЫХ данных. `trainingpeaks_race_events` подключён как");
  lines.push("источник гонок: его даты классифицируют тренировку того дня как race (время берётся");
  lines.push("из тренировки; `distance_km` race_events намеренно НЕ используется — ненадёжен).");
  lines.push("Приоритет источников: coach_confirmed > race_events > club_races > реконструкция.");
  lines.push("");
  lines.push("## Что появилось (было race = 0)");
  lines.push("");
  lines.push(`| Метрика | Значение |`);
  lines.push(`|---|---|`);
  lines.push(`| Записей типа RACE (лучшая на дистанцию) | ${raceRecords} |`);
  lines.push(`| Учеников с ≥1 гонкой | ${studentsWithRace.size} |`);
  lines.push(`| Записей типа отрезок тренировки | ${trainingRecords} |`);
  lines.push("");
  lines.push("### Гонки по источнику");
  lines.push("");
  lines.push(`| Источник | Записей |`);
  lines.push(`|---|---|`);
  lines.push(`| race_events (календарь TP) | ${bySource.race_events} |`);
  lines.push(`| club_races (заявки учеников) | ${bySource.club_races} |`);
  lines.push(`| reconstructed (дата без источника) | ${bySource.reconstructed} |`);
  lines.push("");
  lines.push("### Гонки по дистанциям");
  lines.push("");
  lines.push(`| Дистанция | Гонок |`);
  lines.push(`|---|---|`);
  for (const k of keys) lines.push(`| ${k} | ${raceByDistance[k]} |`);
  lines.push("");
  lines.push("## Что остаётся ручным (1.5.5)");
  lines.push("");
  lines.push(`Учеников БЕЗ единой гонки после подключения: **${noRace.length}** из ${run.students.length}.`);
  lines.push("Это реальный объём ручного ввода в админке (вместо всех ~110): у них нет ни");
  lines.push("совпадения race_events с тренировкой, ни заявки, ни coach_confirmed. Причины:");
  lines.push("гонка есть в календаре, но нет тренировки того дня (DNS / не синкнулось), либо");
  lines.push("вообще нет гонок в периоде.");
  lines.push("");
  lines.push("Список (первые 60):");
  lines.push("");
  for (const s of noRace.slice(0, 60)) lines.push(`- ${s.name}`);
  lines.push("");

  const out = resolve(process.cwd(), "docs/race-events-report.md");
  writeFileSync(out, lines.join("\n"), "utf8");

  console.log("== race_events report ==");
  console.log(`race records=${raceRecords} students_with_race=${studentsWithRace.size} training=${trainingRecords}`);
  console.log(`by source: race_events=${bySource.race_events} club_races=${bySource.club_races} reconstructed=${bySource.reconstructed}`);
  console.log(`no-race students=${noRace.length}/${run.students.length}`);
  console.log(`wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
