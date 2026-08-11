/**
 * tp-autoplanner-acceptance — ПАКЕТ НА ПРИЁМКУ ТРЕНЕРУ. READ-ONLY, без записи в TP и в БД.
 *
 * ЗАЧЕМ. Метрика совпадения с практикой — это не приёмка. Приёмка — когда тренер читает
 * НЕДЕЛЮ ЦЕЛИКОМ, ровно как её увидел бы ученик, и по каждой говорит «ставлю» или
 * «не ставлю, потому что…». Поэтому здесь ничего не сокращается и не приглаживается.
 *
 * СОСТАВ ВЫБОРКИ задан нарядом и проверяется на выходе:
 *   5 недель у T1, 5 у T2, 5 у T3
 *   не меньше 5 с качеством и 5 без
 *   не меньше 5 на своём якоре (easy_description) и 5 на зоне 2 TP (tp_zone2)
 *   1–2 худших по совпадению из топ-10 (берутся из теневого сравнения)
 *   ровно 1 отказ
 *
 * БЕЗ PII: только TrainingPeaks-id, имён учеников здесь нет и быть не должно.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/tp-autoplanner-acceptance.ts
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";
import { loadAthleteContexts, mondayOf } from "./lib/autoplanner-context.ts";
import { loadCatalog } from "./lib/autoplanner-catalog.ts";
import { buildWeek, DAY_RU, type Week } from "./lib/autoplanner-week.ts";

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDays = (s: string, n: number): string => iso(Date.parse(s) + n * 86400000);

function loadEnv(p: string): void { if (!existsSync(p)) return; for (const l of readFileSync(p, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const e = t.indexOf("="); if (e < 0) continue; const k = t.slice(0, e).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(e + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function sbc(): SupabaseClient {
  const root = path.resolve(toolRoot, "..", "..");
  for (const p of [path.join(root, ".env.local"), "/Users/igor/igor-tp-reports-bot/.env.local"]) loadEnv(p);
  return createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } });
}

type Attrs = { w: Week; tier: string; hasQuality: boolean; anchor: string; badness: number; downgraded: boolean; plannedVol: number };

/** Основной источник якоря недели — по лёгким сессиям (качественная живёт на своём). */
function weekAnchor(w: Week): string {
  const counts = new Map<string, number>();
  for (const s of w.sessions) counts.set(s.anchorSource, (counts.get(s.anchorSource) ?? 0) + 1);
  let best = "—", n = -1;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return best;
}

/** Худшие по совпадению — из последнего теневого прогона, а не «на глаз». */
function loadBadness(): Map<number, number> {
  const dir = path.join(path.resolve(toolRoot, "..", ".."), "reports", "autoplanner-shadow");
  const out = new Map<number, number>();
  if (!existsSync(dir)) return out;
  const file = readdirSync(dir).filter((f) => f.startsWith("pairs-") && f.endsWith(".json") && !f.includes("-off")).sort().pop();
  if (!file) return out;
  const pairs = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Array<{ aid: number; genMin: number; actMin: number; genDays: number; actDays: number }>;
  const byAth = new Map<number, number[]>();
  for (const p of pairs) {
    if (!(p.actMin > 0)) continue;
    // «Плохо» = и по объёму, и по числу дней. Одного объёма мало: неделя может совпасть
    // по минутам и при этом быть разложена на другое число дней.
    const err = Math.abs(p.genMin / p.actMin - 1) + Math.abs(p.genDays - p.actDays) * 0.25;
    (byAth.get(p.aid) ?? byAth.set(p.aid, []).get(p.aid)!).push(err);
  }
  for (const [aid, xs] of byAth) {
    const s = [...xs].sort((a, b) => a - b);
    out.set(aid, s[Math.floor(s.length / 2)]); // медиана ошибки по всем неделям атлета
  }
  return out;
}

function printWeek(w: Week, label: string): string[] {
  const L: string[] = [];
  L.push(`\n${"═".repeat(78)}`);
  L.push(`${label}`);
  L.push(`атлет ${w.athleteId} · тир ${w.tier} · неделя с ${w.weekStart} · потолок недели ${w.weeklyCap} мин · выдано ${w.plannedMinutes} мин`);
  L.push("═".repeat(78));
  if (w.notes.length) for (const n of w.notes) L.push(`  заметка сборщика: ${n}`);
  if (w.refused) {
    L.push(`  ОТКАЗ (${w.refusedKind}): ${w.refused}`);
    L.push(`  сессий не выдано ни одной — случай уходит тренеру`);
    return L;
  }
  L.push(`  решение по качеству: ${w.qualityDecision}`);
  for (const s of w.sessions) {
    L.push(`\n  ${DAY_RU[s.dayIdx]} ${addDays(w.weekStart, s.dayIdx)} — ${s.title} (${s.minutes} мин) [${s.presetCode}]`);
    if (s.deferred) { L.push(`     ⚑ DEFER: ${s.deferReason}`); continue; }
    L.push(`     ${s.description}`);
    const pctTxt = s.pctMin != null ? ` · ${s.pctMin}–${s.pctMax}% от порога` : " · % не считаем (порога нет)";
    L.push(`     [источник: ${s.anchorSource} · доверие: ${s.confidence} · режим: ${s.targetMode}${pctTxt}]`);
    if (s.warnings.length) L.push(`     ⚠ ${s.warnings.join(" | ")}`);
    if (s.coachReview.length) L.push(`     ✋ на проверку тренеру: ${s.coachReview.join(" | ")}`);
  }
  return L;
}

async function main(): Promise<void> {
  const sb = sbc();
  const ctx = await loadAthleteContexts(sb);
  const cat = await loadCatalog(sb);
  const weekStart = addDays(mondayOf(iso(Date.now())), 7);
  const badness = loadBadness();

  const ok: Attrs[] = [], refused: Attrs[] = [];
  for (const c of ctx.values()) {
    const w = buildWeek(c, c.envelope, cat, weekStart, c.hasActiveIllness, c.tierNote);
    const a: Attrs = {
      w, tier: w.tier, hasQuality: w.sessions.some((s) => s.role === "quality"), anchor: weekAnchor(w),
      badness: badness.get(c.athleteId) ?? -1, downgraded: c.tierNote != null, plannedVol: c.envelope.rolling4wPlannedMin,
    };
    (w.refused ? refused : ok).push(a);
  }

  // ── ОТБОР ПОД КВОТУ ──
  // Жадный: на каждом шаге берём кандидата, закрывающего больше всего НЕЗАКРЫТЫХ требований.
  const need = { T1: 5, T2: 5, T3: 5 };
  const quota = { withQuality: 5, withoutQuality: 5, ownAnchor: 5, zone2: 5, worst: 2 };
  const picked: Attrs[] = [];

  // 1) отказ — обязателен, ровно один; берём самый содержательный (с заметками сборщика)
  const refusePick = [...refused].sort((a, b) => b.w.notes.length - a.w.notes.length)[0];
  if (refusePick) { picked.push(refusePick); need[refusePick.tier as keyof typeof need]--; }

  // 2) худшие по совпадению — из топ-10 теневого прогона
  const worstList = ok.filter((a) => a.badness >= 0).sort((a, b) => b.badness - a.badness).slice(0, 10);
  let worstTaken = 0;
  for (const a of worstList) {
    if (worstTaken >= quota.worst) break;
    const t = a.tier as keyof typeof need;
    if (need[t] <= 0) continue;
    picked.push(a); need[t]--; worstTaken++;
  }

  // 3) остальное — жадно под незакрытые требования
  const score = (a: Attrs): number => {
    let s = 0;
    const wq = picked.filter((p) => !p.w.refused && p.hasQuality).length;
    const wo = picked.filter((p) => !p.w.refused && !p.hasQuality).length;
    const own = picked.filter((p) => p.anchor === "easy_description").length;
    const z2 = picked.filter((p) => p.anchor === "tp_zone2").length;
    if (a.hasQuality && wq < quota.withQuality) s += 2;
    if (!a.hasQuality && wo < quota.withoutQuality) s += 2;
    if (a.anchor === "easy_description" && own < quota.ownAnchor) s += 2;
    if (a.anchor === "tp_zone2" && z2 < quota.zone2) s += 2;
    // РАЗНООБРАЗИЕ. Без этого выборка вырождается: первый прогон дал четыре T1-недели подряд,
    // и все четыре — не малообъёмные ученики, а понижённые из T2/T3 активным health-сигналом
    // с одной и той же причиной отказа по качеству. Тренеру такая выборка ничего не показывает.
    const sameTierDown = picked.filter((p) => p.tier === a.tier && p.downgraded).length;
    if (a.downgraded && sameTierDown >= 1) s -= 3;
    const reason = a.w.qualityDecision;
    if (picked.filter((p) => p.w.qualityDecision === reason).length >= 2) s -= 2;
    return s;
  };
  const pool = ok.filter((a) => !picked.includes(a));
  while (picked.length < 15 && (need.T1 > 0 || need.T2 > 0 || need.T3 > 0)) {
    const cands = pool.filter((a) => !picked.includes(a) && need[a.tier as keyof typeof need] > 0);
    if (cands.length === 0) break;
    cands.sort((a, b) => score(b) - score(a) || b.w.plannedMinutes - a.w.plannedMinutes);
    const take = cands[0];
    picked.push(take); need[take.tier as keyof typeof need]--;
  }

  picked.sort((a, b) => a.tier.localeCompare(b.tier) || Number(!!a.w.refused) - Number(!!b.w.refused));

  const out: string[] = [];
  out.push(`# ПАКЕТ НА ПРИЁМКУ · ${picked.length} недель · неделя с ${weekStart}`);
  out.push(`\nСгенерировано недель всего: ${ok.length} · отказов: ${refused.length} · атлетов в контексте: ${ctx.size}`);
  out.push(`\nЧитать как тренер: по каждой неделе — «ставлю» или «не ставлю, потому что…».`);
  out.push(`Ничего не сокращено: описания приведены ровно так, как их увидит ученик.`);

  out.push(`\n## Состав выборки (проверка квоты наряда)`);
  out.push("```");
  for (const t of ["T1", "T2", "T3"]) out.push(`${t}: ${picked.filter((p) => p.tier === t).length} недель`);
  out.push(`с качеством: ${picked.filter((p) => !p.w.refused && p.hasQuality).length} · без качества: ${picked.filter((p) => !p.w.refused && !p.hasQuality).length}`);
  out.push(`свой якорь (easy_description): ${picked.filter((p) => p.anchor === "easy_description").length} · зона 2 TP (tp_zone2): ${picked.filter((p) => p.anchor === "tp_zone2").length}`);
  out.push(`худших по совпадению из топ-10: ${worstTaken} · отказов: ${picked.filter((p) => p.w.refused).length}`);
  out.push("```");

  // СОСТАВ РОСТЕРА ПО ТИРАМ — не для красоты. Первый прогон показал, что «T1» у генератора
  // сегодня означает не «малообъёмный ученик», а чаще «понижен health-сигналом»,
  // и тренеру важно видеть, из кого на самом деле состоит каждый тир.
  out.push(`\n## Из кого состоит каждый тир (весь ростер, не только выборка)`);
  out.push("```");
  const all = [...ok, ...refused];
  for (const t of ["T1", "T2", "T3"]) {
    const g = all.filter((a) => a.tier === t);
    if (g.length === 0) continue;
    const down = g.filter((a) => a.downgraded).length;
    const vols = g.map((a) => a.plannedVol).sort((x, y) => x - y);
    out.push(`${t}: атлетов ${String(g.length).padStart(3)} · из них ПОНИЖЕНЫ в этот тир ${String(down).padStart(3)}`
      + ` (${Math.round(100 * down / g.length)}%) · плановый объём медиана ${vols[Math.floor(vols.length / 2)]} мин`);
  }
  out.push("```");

  let i = 0;
  for (const a of picked) {
    i++;
    const tags = [a.tier, a.w.refused ? "ОТКАЗ" : a.hasQuality ? "с качеством" : "без качества", a.anchor];
    if (a.badness >= 0 && worstList.slice(0, 10).includes(a)) tags.push(`худшее совпадение (медианная ошибка ${a.badness.toFixed(2)})`);
    out.push(...printWeek(a.w, `НЕДЕЛЯ ${i} из ${picked.length} · ${tags.join(" · ")}`));
  }

  const dir = path.join(path.resolve(toolRoot, "..", ".."), "reports", "autoplanner-acceptance");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `acceptance-${weekStart}.md`), out.join("\n") + "\n");
  console.log(out.join("\n"));
  console.log(`\n[acceptance] пакет → ${dir}/acceptance-${weekStart}.md`);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
