/**
 * tp-collision-calibrate — в какой валюте задавать порог проверки на слипание. READ-ONLY.
 *
 * ЗАЧЕМ. Порог 1.09 взят из распределения лёгкий/ПОРОГ, а проверка сравнивает
 * лёгкий/ТЕМП ОТРЕЗКОВ. Это разные величины: контролируемый порог бежится МЕДЛЕННЕЕ порога,
 * значит отношение лёгкий/отрезки СИСТЕМАТИЧЕСКИ НИЖЕ, чем лёгкий/порог, и старая граница
 * режет здоровых атлетов. Считаем распределение в правильной валюте по тому, что тренер
 * реально прописал, и границу берём из нижнего хвоста ЭТОГО распределения.
 *
 * Источник — только coach_authored: проверено SQL, что все описания с диапазонами темпа
 * лежат на is_planned=true (0 из 1345 неплановых имеют диапазон), то есть написаны тренером.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/tp-collision-calibrate.ts
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";
import { loadAthleteContexts } from "./lib/autoplanner-context.ts";
import { MIN_EASY_TO_QUALITY_RATIO } from "./lib/band-collision.ts";
import { extractQualitySample } from "./lib/quality-anchor.ts";
import { MIN_EFFECTIVE_SAMPLES } from "./lib/easy-anchor.ts";

function loadEnv(p: string): void { if (!existsSync(p)) return; for (const l of readFileSync(p, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const e = t.indexOf("="); if (e < 0) continue; const k = t.slice(0, e).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(e + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function sbc(): SupabaseClient {
  const root = path.resolve(toolRoot, "..", "..");
  for (const p of [path.join(root, ".env.local"), "/Users/igor/igor-tp-reports-bot/.env.local"]) loadEnv(p);
  return createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } });
}
const fp = (s: number): string => { const m = Math.floor(s / 60), x = Math.round(s % 60); return `${m}:${String(x).padStart(2, "0")}`; };
const iso = (d: number): string => new Date(d).toISOString().slice(0, 10);

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
function stats(xs: number[], label: string): void {
  const s = [...xs].sort((a, b) => a - b);
  console.log(`${label}  n=${s.length}`);
  if (!s.length) return;
  console.log(`   min ${s[0].toFixed(3)} · p05 ${pct(s, 0.05).toFixed(3)} · p10 ${pct(s, 0.10).toFixed(3)} · `
    + `p25 ${pct(s, 0.25).toFixed(3)} · медиана ${pct(s, 0.5).toFixed(3)} · p75 ${pct(s, 0.75).toFixed(3)} · max ${s[s.length - 1].toFixed(3)}`);
}

type CacheRow = { trainingpeaks_athlete_id: number; workout_date: string; title: string | null; description: string | null };

async function pullRuns(sb: SupabaseClient, sinceDays: number): Promise<CacheRow[]> {
  const since = iso(Date.now() - sinceDays * 86400000);
  const out: CacheRow[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("trainingpeaks_workout_cache")
      .select("trainingpeaks_athlete_id, workout_date, title, description:source_snapshot->>description")
      .eq("workout_type_value_id", 3).eq("is_planned", true) // coach_authored: описания живут на плановых
      .gte("workout_date", since).order("workout_date").range(f, f + 999);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as CacheRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function main(): Promise<void> {
  const sb = sbc();
  const ctx = await loadAthleteContexts(sb);
  const rows = await pullRuns(sb, 200);

  // ── А. Уровень атлета: середина прописанного лёгкого / середина прописанных отрезков ──
  const perAthlete: Array<{ aid: number; ratio: number; easy: string; qual: string; effN: number }> = [];
  const easyOverThr: number[] = []; const qualOverThr: number[] = [];
  for (const c of ctx.values()) {
    if (!c.easy || c.easy.source !== "easy_description") continue; // только ПРОПИСАННЫЙ лёгкий
    if (!c.quality) continue;                                       // только ПРОПИСАННЫЕ отрезки
    const em = (c.easy.fastSec + c.easy.slowSec) / 2;
    const qm = (c.quality.fastSec + c.quality.slowSec) / 2;
    perAthlete.push({ aid: c.athleteId, ratio: em / qm, effN: c.quality.effectiveN ?? 0,
      easy: `${fp(c.easy.fastSec)}–${fp(c.easy.slowSec)}`, qual: `${fp(c.quality.fastSec)}–${fp(c.quality.slowSec)}` });
    if (c.threshold) { easyOverThr.push(em / c.threshold.paceSec); qualOverThr.push(qm / c.threshold.paceSec); }
  }

  console.log("═".repeat(84));
  console.log("А. ПРОПИСАННЫЙ ЛЁГКИЙ / ПРОПИСАННЫЕ ОТРЕЗКИ — валюта, в которой РАБОТАЕТ проверка");
  console.log("═".repeat(84));
  stats(perAthlete.map((x) => x.ratio), "отношение лёгкий/отрезки (по атлетам)");

  console.log("\nдля сравнения, старая валюта (те же атлеты, где есть порог):");
  stats(easyOverThr, "  лёгкий/ПОРОГ    ");
  stats(qualOverThr, "  отрезки/ПОРОГ   ");
  const medEasyThr = pct([...easyOverThr].sort((a, b) => a - b), 0.5);
  const medQualThr = pct([...qualOverThr].sort((a, b) => a - b), 0.5);
  console.log(`  сдвиг валюты: медиана лёгкий/порог ${medEasyThr.toFixed(3)} ÷ медиана отрезки/порог ${medQualThr.toFixed(3)}`
    + ` = ${(medEasyThr / medQualThr).toFixed(3)} — столько «стоит» пересчёт 1.09 в новую валюту`);

  // ── Б. Уровень тренировки: лёгкий атлета против КАЖДОЙ прописанной интервальной ──
  const perSample: number[] = [];
  const lowSamples: Array<{ aid: number; date: string; title: string; ratio: number; easy: string; work: string }> = [];
  const byAth = new Map<number, CacheRow[]>();
  for (const r of rows) (byAth.get(r.trainingpeaks_athlete_id) ?? byAth.set(r.trainingpeaks_athlete_id, []).get(r.trainingpeaks_athlete_id)!).push(r);
  for (const c of ctx.values()) {
    if (!c.easy || c.easy.source !== "easy_description") continue;
    const em = (c.easy.fastSec + c.easy.slowSec) / 2;
    for (const r of byAth.get(c.athleteId) ?? []) {
      const qs = r.title ? extractQualitySample(r.title, r.description ?? "") : null;
      if (!qs) continue;
      const rr = em / ((qs.fast + qs.slow) / 2);
      perSample.push(rr);
      if (rr < 1.09) lowSamples.push({ aid: c.athleteId, date: r.workout_date, title: (r.title ?? "").slice(0, 46),
        ratio: rr, easy: `${fp(c.easy.fastSec)}–${fp(c.easy.slowSec)}`, work: `${fp(qs.fast)}–${fp(qs.slow)}` });
    }
  }
  console.log("\n" + "═".repeat(84));
  console.log("Б. ТО ЖЕ ПОТРЕНИРОВОЧНО (лёгкий атлета против каждой прописанной интервальной)");
  console.log("═".repeat(84));
  stats(perSample, "отношение лёгкий/отрезки (по тренировкам)");
  const ps = [...perSample].sort((a, b) => a - b);
  console.log(`   крайний хвост: p01 ${pct(ps, 0.01).toFixed(3)} · p02 ${pct(ps, 0.02).toFixed(3)} · p03 ${pct(ps, 0.03).toFixed(3)}`);
  console.log(`   ниже 1.09: ${lowSamples.length} тренировок у ${new Set(lowSamples.map((x) => x.aid)).size} атлетов`);
  lowSamples.sort((a, b) => a.ratio - b.ratio);
  console.log("   самые низкие (что это за тренировки):");
  for (const x of lowSamples.slice(0, 12)) console.log(`     ${x.ratio.toFixed(3)} · ${x.aid} ${x.date} · «${x.title}» · лёгкий ${x.easy} · работа ${x.work}`);

  // ── В. Нижний хвост поимённо ──
  console.log("\n" + "═".repeat(84));
  console.log("В. НИЖНИЙ ХВОСТ ПОАТЛЕТНО (кого режет граница)");
  console.log("═".repeat(84));
  perAthlete.sort((a, b) => a.ratio - b.ratio);
  for (const x of perAthlete.slice(0, 14)) {
    console.log(`  ${x.aid} ratio ${x.ratio.toFixed(3)} · лёгкий ${x.easy} · отрезки ${x.qual} · effN качества ${x.effN.toFixed(1)}`);
  }

  // ── Г. Тот же хвост, но с разделением по НАДЁЖНОСТИ якоря качества ──
  // Гипотеза: низкое отношение — не «тренер так пишет», а тонкий якорь качества
  // (одна-две старые тренировки), то есть шум измерителя, а не факт практики.
  console.log("\n" + "═".repeat(84));
  console.log("Г. РАЗРЕЗ ПО НАДЁЖНОСТИ ЯКОРЯ КАЧЕСТВА (effN — эффективный размер выборки)");
  console.log("═".repeat(84));
  const solid = perAthlete.filter((x) => x.effN >= MIN_EFFECTIVE_SAMPLES);
  const thin = perAthlete.filter((x) => x.effN < MIN_EFFECTIVE_SAMPLES);
  stats(solid.map((x) => x.ratio), `якорь качества НАДЁЖНЫЙ (effN >= ${MIN_EFFECTIVE_SAMPLES})`);
  stats(thin.map((x) => x.ratio), `якорь качества ТОНКИЙ  (effN <  ${MIN_EFFECTIVE_SAMPLES})`);

  // ── Д. Порог из геометрии полос: когда полосы перестают перекрываться ──
  // Слипание по сути — это ПЕРЕКРЫТИЕ: быстрый край лёгкого быстрее медленного края работы.
  console.log("\n" + "═".repeat(84));
  console.log("Д. ПЕРЕКРЫТИЕ ПОЛОС (быстрый край лёгкого быстрее медленного края работы)");
  console.log("═".repeat(84));
  let overlap = 0; const overlapRatios: number[] = []; const touchRatios: number[] = [];
  for (const c of ctx.values()) {
    if (!c.easy || !c.quality) continue;
    const r = ((c.easy.fastSec + c.easy.slowSec) / 2) / ((c.quality.fastSec + c.quality.slowSec) / 2);
    if (c.easy.fastSec < c.quality.slowSec) { overlap++; overlapRatios.push(r); } else touchRatios.push(r);
  }
  console.log(`  полосы перекрываются у ${overlap} атлетов`);
  stats(overlapRatios, "  отношение там, где ПЕРЕКРЫВАЮТСЯ");
  stats(touchRatios, "  отношение там, где НЕ перекрываются");

  // ── Е. Сколько отвалится при разных границах ──
  console.log("\n" + "═".repeat(84));
  console.log("Е. ЦЕНА ГРАНИЦЫ: сколько атлетов (из всех, кого проверка вообще касается) отвалится");
  console.log("═".repeat(84));
  const checkable: Array<{ aid: number; ratio: number; src: string; effN: number }> = [];
  for (const c of ctx.values()) {
    if (!c.easy || !c.quality) continue;
    checkable.push({ aid: c.athleteId, src: c.easy.source, effN: c.quality.effectiveN ?? 0,
      ratio: ((c.easy.fastSec + c.easy.slowSec) / 2) / ((c.quality.fastSec + c.quality.slowSec) / 2) });
  }
  for (const g of [1.09, 1.08, 1.075, 1.07, 1.06, 1.055, 1.05, 1.045, 1.04, 1.035, 1.03]) {
    const bad = checkable.filter((x) => x.ratio < g);
    const z = bad.filter((x) => x.src === "tp_zone2").length;
    const th = bad.filter((x) => x.effN < MIN_EFFECTIVE_SAMPLES).length;
    console.log(`  граница ${g.toFixed(3)}: отвал ${bad.length}/${checkable.length} (зона2 ${z}, свой лёгкий ${bad.length - z}; из них с тонким якорем качества ${th})`);
  }
  console.log(`\n(текущая граница в коде: ${MIN_EASY_TO_QUALITY_RATIO})`);

  // ── З. Цена порога по effN: якорь без свежих данных не должен давать числа ──
  console.log("\n" + "═".repeat(84));
  console.log("З. ЯКОРЬ КАЧЕСТВА БЕЗ СВЕЖИХ ДАННЫХ (effN) — сколько теряем на каждом пороге");
  console.log("═".repeat(84));
  const effs = [...ctx.values()].filter((c) => c.quality).map((c) => c.quality!.effectiveN ?? 0).sort((a, b) => a - b);
  console.log(`  атлетов со своим якорем качества: ${effs.length}`);
  console.log(`  effN: min ${effs[0]?.toFixed(2)} · p25 ${pct(effs, 0.25).toFixed(2)} · медиана ${pct(effs, 0.5).toFixed(2)}`
    + ` · p75 ${pct(effs, 0.75).toFixed(2)} · max ${effs[effs.length - 1]?.toFixed(2)}`);
  for (const t of [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0]) {
    const lost = effs.filter((x) => x < t).length;
    console.log(`    порог effN >= ${t.toFixed(2)}: якорь теряют ${lost} из ${effs.length} (останется ${effs.length - lost})`);
  }
  const stale = [...ctx.values()].filter((c) => c.quality && (c.quality.effectiveN ?? 0) < 0.5);
  console.log(`  с effN < 0.5 поимённо: ${stale.map((c) => `${c.athleteId}(${(c.quality!.effectiveN ?? 0).toFixed(2)})`).join(", ") || "нет"}`);

  // ── Ж. Перепроверка шестерых, отклонённых старой границей 1.09 ──
  console.log("\n" + "═".repeat(84));
  console.log("Ж. ШЕСТЕРО, ОТКЛОНЁННЫХ СТАРОЙ ГРАНИЦЕЙ 1.09 — что с ними теперь");
  console.log("═".repeat(84));
  const WAS_REJECTED = [5770413, 5673496, 5847207, 5475750, 6324800, 5751651];
  const OLD_RATIO: Record<number, number> = { 5770413: 1.031, 5673496: 1.036, 5847207: 1.039, 5475750: 1.053, 6324800: 1.054, 5751651: 1.071 };
  for (const aid of WAS_REJECTED) {
    const c = ctx.get(aid);
    if (!c) { console.log(`  ${aid}: контекста нет`); continue; }
    if (!c.easy) { console.log(`  ${aid}: якоря лёгкого нет`); continue; }
    if (!c.quality) { console.log(`  ${aid}: своего якоря качества больше нет → проверять нечем (unverifiable)`); continue; }
    const r = ((c.easy.fastSec + c.easy.slowSec) / 2) / ((c.quality.fastSec + c.quality.slowSec) / 2);
    const ov = c.easy.fastSec < c.quality.slowSec;
    console.log(`  ${aid} [${c.easy.source}, тир ${c.tier}] было ${OLD_RATIO[aid].toFixed(3)} → стало ${r.toFixed(3)}`
      + ` · лёгкий ${fp(c.easy.fastSec)}–${fp(c.easy.slowSec)} · отрезки ${fp(c.quality.fastSec)}–${fp(c.quality.slowSec)}`
      + ` · полосы ${ov ? "ПЕРЕКРЫВАЮТСЯ" : "не перекрываются"}`);
  }

  console.log("\nатлеты, у кого полосы перекрываются, поимённо:");
  for (const c of ctx.values()) {
    if (!c.easy || !c.quality) continue;
    if (c.easy.fastSec >= c.quality.slowSec) continue;
    const r = ((c.easy.fastSec + c.easy.slowSec) / 2) / ((c.quality.fastSec + c.quality.slowSec) / 2);
    console.log(`  ${c.athleteId} [${c.easy.source}, тир ${c.tier}] ratio ${r.toFixed(3)}`
      + ` · лёгкий ${fp(c.easy.fastSec)}–${fp(c.easy.slowSec)} · отрезки ${fp(c.quality.fastSec)}–${fp(c.quality.slowSec)}`);
  }
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
