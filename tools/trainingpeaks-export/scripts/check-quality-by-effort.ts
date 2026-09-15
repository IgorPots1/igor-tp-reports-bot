/**
 * Качество по усилию: когда оно назначается и когда НЕ должно.
 *
 * ── ЧТО ЗДЕСЬ ГЛАВНОЕ ───────────────────────────────────────────────────────
 *
 * Не «появилась ли работа» — это видно и на живом прогоне. Главное, что
 * поведение РОСТЕРА TRAININGPEAKS не изменилось: там отказ «нет порога» значит
 * «сначала поставь порог», и превращать его в работу по ощущениям нельзя.
 * Поэтому проверка гоняет ОДНИ И ТЕ ЖЕ данные дважды, отличая их одним флагом.
 *
 * Заглушки, а не живые данные: проверка обязана падать на логике, а не на том,
 * что сегодня в базе.
 */

import { buildWeek, effortText } from "./lib/autoplanner-week.ts";
import { stubAnchors, stubCatalog, stubEnvelope } from "./lib/cycle-check-stubs.ts";
import type { AthleteAnchors } from "./lib/pace-resolver.ts";

let failures = 0;
function expect(condition: boolean, message: string): void {
  console.log(`  ${condition ? "✓" : "✗"} ${message}`);
  if (!condition) failures += 1;
}
function step(title: string): void {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, 52 - title.length))}`);
}

const WEEK_START = "2026-09-21";

/** Атлет без порога: ни applied, ни какого-либо другого. */
function anchorsWithoutThreshold(qualityByEffort: boolean): AthleteAnchors {
  return { ...stubAnchors(), threshold: null, quality: null, qualityByEffort };
}

function main(): void {
  console.log("КАЧЕСТВО ПО УСИЛИЮ");
  const cat = stubCatalog();
  const env = { ...stubEnvelope(), qualityLast8w: 0, lastWeekQualityCount: 0, hasIntervalPractice: false };
  // Цикл просит работу: без этого гейт по истории не снимается и слотов нет.
  const cycle = {
    weekIndex: 1,
    totalWeeks: 12,
    role: "рост" as const,
    aerobicMin: 150,
    qualityMin: 15,
    days: 4,
    baseWeekMin: 165,
  };

  step("РОСТЕР TRAININGPEAKS: ПОВЕДЕНИЕ ПРЕЖНЕЕ");
  const tp = buildWeek(anchorsWithoutThreshold(false), env, cat, WEEK_START, false, null, cycle);
  const tpQuality = tp.sessions.filter((s) => s.role === "quality");
  expect(tpQuality.length === 0, "без флага качества нет: отказ «нет порога» остался отказом");
  expect(
    tp.qualityDecision.includes("порог") || tp.notes.some((n) => n.includes("порог")),
    "причина названа порогом, а не чем-то другим"
  );

  step("ВЕТКА INTERVALS: РАБОТА ПО УСИЛИЮ");
  const iv = buildWeek(anchorsWithoutThreshold(true), env, cat, WEEK_START, false, null, cycle);
  const ivQuality = iv.sessions.filter((s) => s.role === "quality");
  expect(ivQuality.length === 1, `качественная сессия назначена (${ivQuality.length})`);

  if (ivQuality.length === 1) {
    const session = ivQuality[0];
    expect(session.targetMode === "rpe", "режим сессии: по ощущениям");
    expect(session.anchorSource === "methodology_rpe", "источник назван честно: методика, не темп");
    expect(session.pctMin === null && session.pctMax === null, "процентов от порога нет: порога нет");
    expect(
      session.description.includes("усилие"),
      "в описании есть усилие, а не выдуманный темп"
    );
    // РАЗМИНКА ОСТАЁТСЯ ПО ТЕМПУ. Якорь лёгкого измерен, и подменять его
    // ощущениями незачем: это потеря точности там, где её не требовалось.
    const work = session.segments.filter((s) => s.fastSec === null && s.noPaceText?.includes("усилие"));
    const paced = session.segments.filter((s) => s.fastSec !== null);
    expect(work.length >= 1, `работа без темпа: сегментов ${work.length}`);
    expect(paced.length >= 2, `разминка и заминка по темпу: сегментов ${paced.length}`);
    expect(
      session.warnings.some((w) => w.includes("порога нет")),
      "тренер предупреждён, что темпов не назначено"
    );
    expect(session.roundTrip.ok, "описание сходится с сегментами (round trip)");
  }

  step("СЛОВАРЬ УСИЛИЙ");
  expect(effortText(7).includes("короткими фразами"), "RPE 7 описан речью, а не числом");
  expect(effortText(9).includes("разговаривать нельзя"), "RPE 9 описан речью");
  expect(effortText(null) === "по ощущениям", "без RPE остаётся общая формулировка");

  console.log("");
  if (failures === 0) {
    console.log("ВСЁ ПРОШЛО. Провалов: 0.");
    process.exit(0);
  }
  console.log(`ПРОВАЛОВ: ${failures}.`);
  process.exit(1);
}

main();
