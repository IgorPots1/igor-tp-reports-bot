/**
 * tp-cycle-week-acceptance — пакет на приёмку: недели, СОБРАННЫЕ ОТ ЦИКЛА. READ-ONLY.
 *
 * Ничего не пишет ни в БД, ни в TP. Цикл здесь строится черновиком из данных (как в
 * tp-cycle-draft), разворачивается в недели и отдаётся сборщику как цель по объёму и дням.
 *
 * ДВА РЕЖИМА ОДНОВРЕМЕННО. У кого цикл есть — неделя строится от него. У кого нет —
 * ровно прежнее поведение, сборщик вызывается без цели. Обе группы печатаются, чтобы
 * тренер видел, что у «безцикловых» ничего не поехало.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/tp-cycle-week-acceptance.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";
import { loadAthleteContexts, mondayOf } from "./lib/autoplanner-context.ts";
import { loadCatalog } from "./lib/autoplanner-catalog.ts";
import { buildWeek, DAY_RU, type CycleWeekTarget, type Week } from "./lib/autoplanner-week.ts";
import { buildDrafts } from "./lib/cycle-drafts.ts";
import { forecast } from "./lib/training-cycle.ts";

function loadEnv(p: string): void { if (!existsSync(p)) return; for (const l of readFileSync(p, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const e = t.indexOf("="); if (e < 0) continue; const k = t.slice(0, e).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(e + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function sbc(): SupabaseClient {
  const root = path.resolve(toolRoot, "..", "..");
  for (const p of [path.join(root, ".env.local"), "/Users/igor/igor-tp-reports-bot/.env.local"]) loadEnv(p);
  return createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } });
}

const GROUP = new Set([5733446, 5475652, 5476215, 6009851, 5931798, 5905779, 5748681, 5475750, 5475968, 5461678, 5807145, 6290336]);
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDays = (s: string, n: number): string => iso(Date.parse(s) + n * 86400000);

function printWeek(w: Week, head: string[]): string[] {
  const L: string[] = [`\n${"═".repeat(78)}`, ...head, "═".repeat(78)];
  for (const n of w.notes) L.push(`  заметка: ${n}`);
  if (w.refused) { L.push(`  ОТКАЗ (${w.refusedKind}): ${w.refused}`); return L; }
  L.push(`  решение по качеству: ${w.qualityDecision}`);
  for (const s of w.sessions) {
    L.push(`\n  ${DAY_RU[s.dayIdx]} ${addDays(w.weekStart, s.dayIdx)} — ${s.title} (${s.minutes} мин) [${s.presetCode}]`);
    if (s.deferred) { L.push(`     ⚑ DEFER: ${s.deferReason}`); continue; }
    L.push(`     ${s.description}`);
    const pct = s.pctMin != null ? ` · ${s.pctMin}–${s.pctMax}% от порога` : " · % не считаем (порога нет)";
    L.push(`     [источник: ${s.anchorSource} · доверие: ${s.confidence} · режим: ${s.targetMode}${pct}]`);
    if (s.warnings.length) L.push(`     ⚠ ${s.warnings.join(" | ")}`);
    if (s.coachReview.length) L.push(`     ✋ тренеру: ${s.coachReview.join(" | ")}`);
  }
  return L;
}

async function main(): Promise<void> {
  const sb = sbc();
  const ctx = await loadAthleteContexts(sb);
  const cat = await loadCatalog(sb);
  const today = iso(Date.now());
  const weekStart = addDays(mondayOf(today), 7);
  const drafts = await buildDrafts(sb, ctx, today);

  const out: string[] = [];
  out.push(`# ПАКЕТ НА ПРИЁМКУ · НЕДЕЛИ ОТ ЦИКЛА · неделя с ${weekStart}`);
  out.push(`\nНичего не записано: ни в БД, ни в TP. Цикл задаёт цель по объёму и дням,`);
  out.push(`дальше работает прежний сборщик — якоря, полосы, каталог, полы, обратная сверка.`);

  // ── режимы ──
  // ЧЕСТНО: активных циклов в базе СЕЙЧАС НЕТ — таблица training_cycles пуста, тренер их
  // ещё не заводил. Пакет показывает, что БУДЕТ, если завести: цикл берётся черновиком
  // из истории. Реальное разделение режимов пойдёт по training_cycles.status = 'active'.
  const { data: active } = await sb.from("training_cycles")
    .select("trainingpeaks_athlete_id").eq("status", "active");
  const activeIds = new Set((active ?? []).map((r) => Number((r as Record<string, unknown>).trainingpeaks_athlete_id)));
  const withCycle = [...ctx.keys()].filter((a) => drafts.has(a));
  const withoutCycle = [...ctx.keys()].filter((a) => !drafts.has(a));
  out.push(`\n## Режимы`);
  out.push("```");
  out.push(`атлетов в контексте: ${ctx.size}`);
  out.push(`АКТИВНЫХ ЦИКЛОВ В БАЗЕ СЕЙЧАС: ${activeIds.size} — тренер их ещё не заводил,`);
  out.push(`  поэтому в бою СЕЙЧАС все ${ctx.size} идут прежним путём, ничего не изменилось.`);
  out.push(`в этом пакете цикл СИМУЛИРОВАН черновиком из истории у ${withCycle.length} атлетов,`);
  out.push(`  чтобы показать, что будет после заведения; без черновика (мало недель): ${withoutCycle.length}`);
  out.push("```");

  // ── 12 недель группы от цикла ──
  let n = 0;
  for (const aid of [...GROUP].filter((a) => ctx.has(a) && drafts.has(a))) {
    const c = ctx.get(aid)!, d = drafts.get(aid)!;
    const w2r = d.targetDate ? Math.round((Date.parse(d.targetDate) - Date.parse(weekStart)) / (7 * 86400000)) + 1 : 8;
    const fc = forecast(d, weekStart, Math.max(1, w2r));
    const first = fc[0];
    if (!first) continue;
    n++;
    const target: CycleWeekTarget = {
      weekIndex: 1, totalWeeks: fc.length, role: first.role,
      aerobicMin: first.aerobicMin, qualityMin: first.qualityMin, days: first.days,
    };
    const w = buildWeek(c, c.envelope, cat, weekStart, c.hasActiveIllness, c.tierNote, target);
    const got = w.plannedMinutes;
    const want = first.aerobicMin + first.qualityMin;
    const dev = want > 0 ? Math.round(1000 * (got / want - 1)) / 10 : 0;
    out.push(...printWeek(w, [
      `НЕДЕЛЯ ${n} · атлет ${aid} · тир ${w.tier} · ОТ ЦИКЛА`,
      `цикл: неделя 1 из ${fc.length} · роль «${first.role}» · тип ${d.intent}${d.targetDate ? ` · старт ${d.targetDate}` : ""}`,
      `цель цикла ${want} мин (${first.aerobicMin} аэробн + ${first.qualityMin} работы) · собрано ${got} мин · отклонение ${dev >= 0 ? "+" : ""}${dev}%`,
      `дней: цикл просил ${first.days}, собрано ${w.sessions.length}`,
    ]));
  }

  // ── 3 недели без цикла ──
  out.push(`\n\n${"#".repeat(78)}`);
  out.push(`# КОНТРОЛЬ: 3 НЕДЕЛИ АТЛЕТОВ БЕЗ ЦИКЛА — должно быть как раньше`);
  out.push("#".repeat(78));
  let m = 0;
  for (const aid of withoutCycle) {
    if (m >= 3) break;
    const c = ctx.get(aid)!;
    const w = buildWeek(c, c.envelope, cat, weekStart, c.hasActiveIllness, c.tierNote);
    if (w.refused) continue;
    m++;
    out.push(...printWeek(w, [`БЕЗ ЦИКЛА ${m} · атлет ${aid} · тир ${w.tier}`,
      `потолок недели ${w.weeklyCap} мин · собрано ${w.plannedMinutes} мин · дней ${w.sessions.length}`]));
  }

  const dir = path.join(path.resolve(toolRoot, "..", ".."), "reports", "autoplanner-acceptance");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `cycle-weeks-${weekStart}.md`), out.join("\n") + "\n");
  console.log(out.join("\n"));
  console.log(`\n[acceptance] пакет → ${dir}/cycle-weeks-${weekStart}.md`);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
