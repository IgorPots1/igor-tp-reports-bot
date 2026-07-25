/**
 * Records diagnosis + root cause (naryad: почему рекорды медленнее реальных).
 *
 * Writes docs/records-diagnosis.md (per-record: what workout the algorithm chose,
 * segment lap boundaries, pace, elapsed/moving, trust, type) and
 * docs/records-root-cause.md (one-line verdict + evidence: pace distribution per
 * distance, the ~60min-10k constant check, record-pace vs the athlete's usual
 * weekly pace). Anonymized (student_id). Named companions → ops-log (outside git).
 *
 * Run: node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *        --env-file=.env.local scripts/records-diagnosis.ts
 * Read-only.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { evaluateAllRecordsForValidation, classifyRecordType } from "@/features/club/service";
import { CLUB_RECORD_DISTANCES } from "@/features/club/constants";
import type { RecordDistanceKey } from "@/features/club/records";

const KEYS = CLUB_RECORD_DISTANCES.map((d) => d.key) as RecordDistanceKey[];
const TARGET_KM: Record<string, number> = { "5k": 5, "10k": 10, "21k": 21.097, "42k": 42.195 };

function fmtT(sec: number): string {
  const t = Math.round(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
function fmtPace(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function main() {
  const run = await evaluateAllRecordsForValidation({ useBestSplit: true });
  const nameById = new Map(run.students.map((s) => [s.id, s.name]));
  const rowById = new Map(run.rows.map((r) => [r.id, r]));

  // Per-student usual weekly pace = median pace over completed running workouts.
  const pacesByStudent = new Map<string, number[]>();
  for (const r of run.rows) {
    if (!r.isCompleted || !r.isRunning) continue;
    const d = r.distanceKm ?? 0;
    const t = r.durationSeconds ?? 0;
    if (d > 1 && t > 0) {
      const p = t / d;
      const arr = pacesByStudent.get(r.studentId) ?? [];
      arr.push(p);
      pacesByStudent.set(r.studentId, arr);
    }
  }
  const usualPace = (sid: string): number | null => {
    const arr = (pacesByStudent.get(sid) ?? []).slice().sort((a, b) => a - b);
    if (arr.length === 0) return null;
    return arr[Math.floor(arr.length / 2)];
  };

  type Rec = {
    sid: string; name: string; key: string; date: string; workoutId: string;
    wtype: string; title: string; wholeKm: number; segKm: number; timeS: number;
    paceS: number; elapsed: number | null; moving: number | null; trust: string;
    method: string; type: string; startLap: number | null; endLap: number | null; lapCount: number | null;
    usual: number | null;
  };
  const recs: Rec[] = [];
  const pacesByKey = new Map<string, number[]>();

  for (const [sid, perDist] of run.byStudent) {
    for (const key of KEYS) {
      const best = perDist.get(key)?.best;
      if (!best) continue;
      const c = best.candidate;
      const row = rowById.get(c.workoutId);
      const q = run.quality.get(c.workoutId);
      const paceS = c.durationSeconds / c.distanceKm;
      (pacesByKey.get(key) ?? pacesByKey.set(key, []).get(key)!).push(paceS);
      recs.push({
        sid, name: nameById.get(sid) ?? sid.slice(0, 8), key, date: c.date, workoutId: c.workoutId,
        wtype: q?.workoutType ?? row?.family ?? "неизв",
        title: (row?.title ?? "").replace(/[|—–]/g, "-").slice(0, 40),
        wholeKm: Number(c.wholeDistanceKm.toFixed(2)), segKm: Number(c.distanceKm.toFixed(2)),
        timeS: c.durationSeconds, paceS,
        elapsed: c.segment ? Math.round(c.segment.elapsedS) : q?.lapElapsedSumS ?? null,
        moving: c.segment ? Math.round(c.segment.movingS) : q?.lapTimerSumS ?? null,
        trust: best.trust, method: c.calcMethod,
        type: classifyRecordType(sid, c.date, run.raceDatesByStudent),
        startLap: c.segment?.startLap ?? null, endLap: c.segment?.endLap ?? null, lapCount: c.segment?.lapCount ?? null,
        usual: usualPace(sid),
      });
    }
  }

  // ---- Root-cause aggregates ----
  const raceCount = recs.filter((r) => r.type === "race").length;
  const trainingCount = recs.filter((r) => r.type === "training_split").length;
  const nearUsual = recs.filter((r) => r.usual && Math.abs(r.paceS - r.usual) / r.usual < 0.05).length; // within 5%
  const fromLongRun = recs.filter((r) => r.wholeKm > TARGET_KM[r.key] * 1.5).length;
  const wholeMethod = recs.filter((r) => r.method === "whole_workout").length;

  // 10k ~60min constant check
  const tenK = recs.filter((r) => r.key === "10k").map((r) => r.timeS);
  const exact = new Map<number, number>();
  for (const t of tenK) exact.set(t, (exact.get(t) ?? 0) + 1);
  const dupGroups = [...exact.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  const near60 = tenK.filter((t) => t >= 3540 && t <= 3660).length;

  const paceLine = (key: string): string => {
    const arr = (pacesByKey.get(key) ?? []).slice().sort((a, b) => a - b);
    if (arr.length === 0) return `${key}: нет`;
    const min = arr[0], max = arr[arr.length - 1], med = arr[Math.floor(arr.length / 2)];
    return `${key}: n=${arr.length}, темп мин ${fmtPace(min)} · медиана ${fmtPace(med)} · макс ${fmtPace(max)} /км`;
  };

  // Verdict heuristic: if almost all records are training_split AND their pace ~ usual pace → data problem.
  const dataProblem = raceCount === 0 && nearUsual / Math.max(1, recs.length) > 0.4;
  const verdict = dataProblem
    ? "ПРОБЛЕМА В ДАННЫХ: забегов в кэше нет (0 записей на даты стартов), рекорды — лучшие отрезки лёгких пробежек, их темп близок к обычному недельному. Алгоритм выбирает лучшее из имеющегося."
    : raceCount === 0
      ? "СМЕШАННО: забегов на датах стартов в кэше нет (club_races пуст), но темп рекордов заметно быстрее обычного — алгоритм находит быстрые отрезки. Уточнить вручную."
      : "Есть записи на даты стартов — часть рекордов классифицирована как гонки; смотри разбор.";

  // ---- root-cause doc ----
  const R: string[] = [];
  R.push("# Рекорды: корневая причина (алгоритм или данные)");
  R.push("");
  R.push("Сгенерировано `scripts/records-diagnosis.ts` (read-only). Без ФИО.");
  R.push("");
  R.push(`## Вердикт (одной фразой)`);
  R.push("");
  R.push(`**${verdict}**`);
  R.push("");
  R.push("## Доказательства");
  R.push("");
  R.push(`- Рекордов всего: **${recs.length}** → тип **race ${raceCount}**, **training_split ${trainingCount}** (race = дата рекорда совпала с объявленным стартом в club_races).`);
  R.push(`- Темп рекорда ≈ обычный недельный (в пределах 5%): **${nearUsual}** из ${recs.length} → это лёгкие пробежки, не гонки.`);
  R.push(`- Источник — длинная пробежка (полная запись > 1.5× дистанции): **${fromLongRun}**.`);
  R.push(`- Посчитано методом «вся тренировка» (нет сплита): **${wholeMethod}**.`);
  R.push("");
  R.push("### Распределение темпа выбранных рекордов по дистанции");
  R.push("");
  for (const key of KEYS) R.push(`- ${paceLine(key)}`);
  R.push("");
  R.push("### Проверка «10 км ≈ 60 мин»: константа или просто похоже");
  R.push("");
  R.push(`- Значений 10k всего: ${tenK.length}; попадают в 59:00–61:00: **${near60}**.`);
  if (dupGroups.length === 0) {
    R.push("- Одинаковых значений (точное совпадение секунд) нет → это НЕ константа/дефолт в коде, а просто похожие реальные лёгкие пробежки у разных людей.");
  } else {
    R.push("- Повторяющиеся точные значения (подозрение на константу/дефолт):");
    for (const [t, n] of dupGroups.slice(0, 6)) R.push(`  - ${fmtT(t)} — ${n} раз`);
  }
  R.push("");
  R.push("Итог: якорь E-Predictor можно строить только на настоящих гонках. Пока их нет в кэше — рекорды остаются оценкой по тренировкам (training_split) и в клубные топы не идут.");
  R.push("");

  const rcOut = resolve(process.cwd(), "docs/records-root-cause.md");
  writeFileSync(rcOut, R.join("\n"), "utf8");

  // ---- diagnosis doc (anonymized) + named companion ----
  function buildDiag(named: boolean): string {
    const D: string[] = [];
    D.push(`# Разбор рекордов: что выбрал алгоритм${named ? " (с именами)" : ""}`);
    D.push("");
    D.push(`Сгенерировано \`scripts/records-diagnosis.ts\` (read-only).${named ? "" : " Без ФИО — student_id."}`);
    D.push("");
    D.push("## Паттерны (сколько рекордов)");
    D.push("");
    D.push(`- Тип race: ${raceCount} · training_split: ${trainingCount}`);
    D.push(`- Темп ≈ обычный недельный (не выделяется как усилие): ${nearUsual}`);
    D.push(`- Источник — длинная пробежка (>1.5× дистанции): ${fromLongRun}`);
    D.push(`- Метод «вся тренировка» (сплит не построен): ${wholeMethod}`);
    D.push("");
    D.push("## Пер-рекорд");
    D.push("");
    const idCol = named ? "Ученик" : "student_id";
    D.push(`| ${idCol} | дист | дата | тип трен. | назв. | полная,км | отрезок,км | лапы | время | темп/км | elapsed/moving | доверие | тип |`);
    D.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const r of recs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
      const id = named ? r.name : r.sid.slice(0, 8);
      const laps = r.startLap !== null ? `${r.startLap}–${r.endLap} (${r.lapCount})` : "—";
      const em = r.elapsed && r.moving ? `${r.elapsed}/${r.moving} (+${Math.round(((r.elapsed / r.moving) - 1) * 100)}%)` : "—";
      const usual = r.usual ? fmtPace(r.usual) : "—";
      D.push(`| ${id} | ${r.key} | ${r.date} | ${r.wtype} | ${r.title || "—"} | ${r.wholeKm} | ${r.segKm} | ${laps} | ${fmtT(r.timeS)} | ${fmtPace(r.paceS)} (обыч ${usual}) | ${em} | ${r.trust} | ${r.type} |`);
    }
    D.push("");
    return D.join("\n");
  }

  writeFileSync(resolve(process.cwd(), "docs/records-diagnosis.md"), buildDiag(false), "utf8");
  try {
    writeFileSync("/Users/igor/ops-log/igor-tp-reports-bot/records-diagnosis-with-names.md", buildDiag(true), "utf8");
    writeFileSync("/Users/igor/ops-log/igor-tp-reports-bot/records-root-cause.md", R.join("\n"), "utf8");
  } catch (e) {
    console.warn("named companion not written:", e);
  }

  console.log(`records=${recs.length} race=${raceCount} training=${trainingCount} nearUsual=${nearUsual} fromLong=${fromLongRun} whole=${wholeMethod}`);
  console.log(`verdict: ${dataProblem ? "DATA PROBLEM" : "check"}`);
}

main().catch((e) => {
  console.error("records-diagnosis failed:", e);
  process.exit(1);
});
