/**
 * tp-cycle-growth-preview — ПРОГНОЗ ЦИКЛА ПРИ УСКОРЕННОМ РОСТЕ. READ-ONLY, ничего не пишет.
 *
 * ЗАЧЕМ. Ручной шаг роста и целевой объём к пику (миграция 20260923000000) — это решение
 * тренера, которого в истории ещё нет. Прежде чем вставлять строку в training_cycles, надо
 * увидеть, во что она развернётся: сколько минут будет на каждой неделе, где встанет
 * разгрузка, не упрётся ли рост в предел одного перехода.
 *
 * Скрипт НЕ ЧИТАЕТ training_cycles и ничего туда не пишет: он берёт РАСЧЁТНЫЙ черновик из
 * истории (cycle-drafts) и показывает три ряда рядом — штатный, с ручным шагом и с целевым
 * объёмом. Это витрина для решения, а не часть боевого пути.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/tp-cycle-growth-preview.ts
 * Флаги:  --athletes=5476215,5905779   кого показывать (по умолчанию эти двое)
 *         --step=1.12                  ручной шаг для второй колонки
 *         --target=340                 целевой объём к пику для третьей колонки
 *                                      (по умолчанию +20% к штатному пику атлета)
 */
import process from "node:process";

import { loadLocalEnv } from "./lib/local-env.ts";
loadLocalEnv();

import { createSupabaseServerClient } from "../../../src/features/supabase/server.ts";
import { loadAthleteContexts, mondayOf } from "./lib/autoplanner-context.ts";
import { buildDrafts } from "./lib/cycle-drafts.ts";
import { MAX_SINGLE_STEP, forecast, stepForTargetPeak, type CycleDraft } from "./lib/training-cycle.ts";

/** Кого Игорь назвал поимённо в наряде 12.08: «сейчас надо наращивать объём». */
const DEFAULT_ATHLETES = [5476215, 5905779];
/** Насколько поднимаем цель в третьей колонке, если тренер не задал своё число. */
const DEFAULT_TARGET_UPLIFT = 1.20;

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDays = (s: string, n: number): string => iso(Date.parse(s) + n * 86400000);
const arg = (name: string): string | null =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? null;

type Row = { i: number; role: string; aer: number; qual: number; total: number; note: string };

function rows(d: CycleDraft, from: string, weeks: number): Row[] {
  return forecast(d, from, weeks).map((w) => ({
    i: w.index, role: w.role, aer: w.aerobicMin, qual: w.qualityMin,
    total: w.aerobicMin + w.qualityMin, note: w.note,
  }));
}
const peak = (rs: Row[]): number => rs.reduce((m, r) => Math.max(m, r.total), 0);

async function main(): Promise<void> {
  const sb = createSupabaseServerClient();
  const ids = (arg("athletes") ?? DEFAULT_ATHLETES.join(",")).split(",").map((x) => Number(x.trim())).filter(Number.isFinite);
  const manualStep = Number(arg("step") ?? "1.12");
  const targetArg = arg("target") ? Number(arg("target")) : null;

  const today = iso(Date.now());
  const weekStart = addDays(mondayOf(today), 7);
  const ctx = await loadAthleteContexts(sb);
  const drafts = await buildDrafts(sb, ctx, today);

  const { data: st } = await sb.from("trainingpeaks_students").select("student_name, trainingpeaks_athlete_url");
  const names = new Map<number, string>();
  for (const r of (st ?? []) as Array<Record<string, unknown>>) {
    const hit = /athletes?\/(\d+)/.exec(String(r.trainingpeaks_athlete_url ?? ""));
    if (hit && r.student_name) names.set(Number(hit[1]), String(r.student_name));
  }

  console.log(`ПРОГНОЗ ПРИ УСКОРЕННОМ РОСТЕ · первая неделя ${weekStart}`);
  console.log(`Ряды разворачиваются из РАСЧЁТНОГО черновика; строка в training_cycles не читается и не пишется.\n`);

  for (const aid of ids) {
    const d = drafts.get(aid);
    if (!d) { console.log(`${names.get(aid) ?? aid}: черновика цикла нет\n`); continue; }
    const weeks = d.targetDate
      ? Math.max(1, Math.round((Date.parse(d.targetDate) - Date.parse(weekStart)) / (7 * 86400000)) + 1)
      : d.lengthWeeks;

    const base = rows(d, weekStart, weeks);
    const basePeak = peak(base);
    const target = targetArg ?? Math.round(basePeak * DEFAULT_TARGET_UPLIFT / 5) * 5;

    // Ручной шаг: потолки поднимаем так же, как это делает читатель при ручном росте, —
    // иначе разгон упрётся в потолок, посчитанный от штатного шага, и колонка соврёт.
    const share = d.baseAerobicMin + d.baseQualityMin > 0
      ? d.baseQualityMin / (d.baseAerobicMin + d.baseQualityMin) : 0;
    const lifted = (t: number): Partial<CycleDraft> => ({
      peakCapAerobicMin: Math.round(t * (1 - share)),
      peakCapQualityMin: Math.round(t * share),
      historicMaxAerobicMin: Math.round(t * (1 - share)),
    });
    const dStep: CycleDraft = { ...d, stepAerobic: manualStep, stepQuality: manualStep, ...lifted(Math.round(basePeak * 2)) };
    const step = stepForTargetPeak({ ...d, ...lifted(target) }, weekStart, weeks, target);
    const dTarget: CycleDraft = { ...d, stepAerobic: step, stepQuality: step, ...lifted(target) };

    const rStep = rows(dStep, weekStart, weeks);
    const rTarget = rows(dTarget, weekStart, weeks);

    console.log("═".repeat(104));
    console.log(`${names.get(aid) ?? aid} (${aid}) · ${d.intent}${d.targetDate ? ` к ${d.targetDate}` : ""}`
      + ` · база ${d.baseAerobicMin}+${d.baseQualityMin} · дней ${d.days}`);
    console.log(`штатный шаг ×${d.stepAerobic.toFixed(2)} → пик ${basePeak}`
      + `   │   ручной ×${manualStep.toFixed(2)} → пик ${peak(rStep)}`
      + `   │   цель ${target} → подобран шаг ×${step.toFixed(3)}, пик ${peak(rTarget)}`);
    if (peak(rTarget) < target) {
      console.log(`⚑ цель ${target} НЕ ДОСТИГНУТА: упёрлись в предел одного перехода ×${MAX_SINGLE_STEP}`
        + ` (p90 практики). Быстрее тренер и сам не наращивает.`);
    }
    console.log("═".repeat(104));
    console.log(`${"нед".padStart(4)} ${"роль".padEnd(20)}${"штатный".padStart(9)}${"ручной".padStart(9)}${"под цель".padStart(10)}   комментарий к неделе под цель`);
    for (let i = 0; i < base.length; i++) {
      const b = base[i], s2 = rStep[i], t = rTarget[i];
      console.log(`${String(b.i).padStart(4)} ${b.role.padEnd(20)}${String(b.total).padStart(9)}${String(s2.total).padStart(9)}${String(t.total).padStart(10)}`
        + `   ${t.note.slice(0, 60)}`);
    }
    const sum = (rs: Row[]): number => rs.reduce((a, r) => a + r.total, 0);
    console.log(`${"".padStart(4)} ${"ЗА ЦИКЛ".padEnd(20)}${String(sum(base)).padStart(9)}${String(sum(rStep)).padStart(9)}${String(sum(rTarget)).padStart(10)}`);
    console.log(`\nЧТО ВСТАВИТЬ В training_cycles, чтобы получить третью колонку:`);
    console.log(`   target_peak_weekly_min = ${target}   (либо step_aerobic_manual = ${step.toFixed(3)}, step_quality_manual = ${step.toFixed(3)})`);
    console.log(`   growth_manual_reason = 'ускоренный рост объёма, решение тренера'\n`);
  }
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
