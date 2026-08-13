/**
 * tp-week-side-by-side — НЕДЕЛЯ ТРЕНЕРА ПРОТИВ НЕДЕЛИ СБОРЩИКА, день к дню. READ-ONLY.
 *
 * ЗАЧЕМ. Игорь четвёртый раз говорит «мало объёма». За два наряда объём вырос на 1.5%,
 * и это подозрительно похоже на замкнутый круг: цель цикла считается от базы, база — от
 * медианы его же ПЛАНОВЫХ недель. Система метит в то, что он уже ставит, поэтому «мало»
 * не может быть про сумму минут — сумма по построению совпадает с его собственной.
 * Значит расхождение где-то в СОСТАВЕ недели, и увидеть его можно только положив
 * конкретную его неделю рядом с конкретной неделей сборщика.
 *
 * КАК ВЫБИРАЕТСЯ НЕДЕЛЯ ТРЕНЕРА. Самая свежая ЗАВЕРШЁННАЯ неделя (не текущая, она неполна
 * по построению), в которой есть плановые пробежки и НЕ БЫЛО активного health-сигнала —
 * иначе сравнивали бы обычную неделю сборщика с больной неделей тренера.
 *
 * ПРО «coach_authored»: такого признака в кэше нет, и он не нужен. Автопланировщик в TP не
 * пишет ВООБЩЕ (сквозное правило всех нарядов), поэтому любая плановая тренировка в кэше
 * написана тренером по построению. Это допущение, а не проверенный факт, и оно указано в отчёте.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/tp-week-side-by-side.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";
import { loadAthleteContexts, mondayOf, type AthleteContext } from "./lib/autoplanner-context.ts";
import { loadCatalog } from "./lib/autoplanner-catalog.ts";
import { buildWeek, DAY_RU, type CycleWeekTarget, type Week } from "./lib/autoplanner-week.ts";
import { buildDrafts } from "./lib/cycle-drafts.ts";
import { isQualityForPractice } from "./lib/practice-signals.ts";
import { forecast } from "./lib/training-cycle.ts";

function loadEnv(p: string): void { if (!existsSync(p)) return; for (const l of readFileSync(p, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const e = t.indexOf("="); if (e < 0) continue; const k = t.slice(0, e).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(e + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function sbc(): SupabaseClient {
  const root = path.resolve(toolRoot, "..", "..");
  for (const p of [path.join(root, ".env.local"), "/Users/igor/igor-tp-reports-bot/.env.local"]) loadEnv(p);
  return createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } });
}

const GROUP = [5733446, 5475652, 5476215, 6009851, 5931798, 5905779, 5748681, 5475750, 5475968, 5461678, 5807145, 6290336];
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDays = (s: string, n: number): string => iso(Date.parse(s) + n * 86400000);
/**
 * КЛАССИФИКАТОР ВИТРИНЫ БЫЛ НЕВЕРЕН В ОБЕ СТОРОНЫ (правка 12.08) и потому врал в отчёте:
 * «Легкий бег по темпу (темп выше)» считался у тренера КАЧЕСТВЕННОЙ (по замеру это обычная
 * лёгкая, разница темпа с ней 0 с/км), а «Темповый бег 30 минут» — не считался вовсе.
 * У Паниной из-за этого её неделя выглядела как «три качественных», хотя их две.
 * Берём тот же классификатор, что и весь остальной автопланировщик.
 */
const QUALITY_RE = /([0-9]+\s*[xх×]\s*[0-9]|интерв|отрезк|повтор|порог|фартлек|vo\s?2|мпк|темп выше)/i;
const isQ = (t: string): boolean => isQualityForPractice(t, QUALITY_RE);
const LONG_RE = /длительн|длинн/i;
/** Ниже этого сессия считается «коротышкой» для сводки. Порог отчётный, в логику не входит. */
const SHORT_SESSION_MIN = 45;

type CoachSession = { date: string; dayIdx: number; title: string; minutes: number; kind: "quality" | "long" | "easy" };
type Side = { total: number; days: number; longest: number; longestEasy: number; easies: number; work: number; sharePct: number; shortest: number; underMin: number;
  /** сколько качественных и в какие дни стоят роли — наряд 12.08 просит показать это отдельно */
  qCount: number; longDay: number | null; qDays: number[] };

/** Минуты РАБОТЫ из заголовка вида «6 х 4 мин» — та же грубая оценка, что в замерах. */
function workMinutesFromTitle(t: string): number {
  const m = /([0-9]{1,2})\s*[xх×]\s*([0-9]{1,2}(?:[.,][0-9])?)\s*(мин|min)?/i.exec(t);
  if (!m) return 0;
  const w = Number(m[1]) * Number(m[2].replace(",", "."));
  return Number.isFinite(w) && w > 0 && w <= 90 ? w : 0;
}

function summarise(sessions: Array<{ minutes: number; kind: string; work?: number; dayIdx?: number }>): Side {
  const total = sessions.reduce((s, x) => s + x.minutes, 0);
  const longs = sessions.filter((x) => x.kind === "long");
  const easies = sessions.filter((x) => x.kind === "easy");
  const work = sessions.reduce((s, x) => s + (x.work ?? 0), 0);
  return {
    total, days: sessions.length,
    longest: longs.reduce((m, x) => Math.max(m, x.minutes), 0),
    longestEasy: easies.reduce((m, x) => Math.max(m, x.minutes), 0),
    easies: easies.length,
    work, sharePct: total > 0 ? Math.round(1000 * work / total) / 10 : 0,
    // САМАЯ КОРОТКАЯ СЕССИЯ НЕДЕЛИ и сколько сессий короче 45 мин. Именно здесь, а не в
    // сумме и не в числе дней, видно «мелкую» неделю: у тренера коротышек почти не бывает.
    shortest: sessions.length ? sessions.reduce((m, x) => Math.min(m, x.minutes), Infinity) : 0,
    underMin: sessions.filter((x) => x.minutes < SHORT_SESSION_MIN).length,
    qCount: sessions.filter((x) => x.kind === "quality").length,
    longDay: longs.length ? (longs.sort((a, b) => b.minutes - a.minutes)[0].dayIdx ?? null) : null,
    qDays: sessions.filter((x) => x.kind === "quality").map((x) => x.dayIdx ?? -1).filter((d) => d >= 0).sort((a, b) => a - b),
  };
}

async function main(): Promise<void> {
  const sb = sbc();
  const ctx = await loadAthleteContexts(sb);
  const cat = await loadCatalog(sb);
  const today = iso(Date.now());
  const weekStart = addDays(mondayOf(today), 7);
  const drafts = await buildDrafts(sb, ctx, today);

  const { data: st } = await sb.from("trainingpeaks_students").select("student_name, trainingpeaks_athlete_url");
  const names = new Map<number, string>();
  for (const r of (st ?? []) as Array<Record<string, unknown>>) {
    const hit = /athletes?\/(\d+)/.exec(String(r.trainingpeaks_athlete_url ?? ""));
    if (hit && r.student_name) names.set(Number(hit[1]), String(r.student_name));
  }

  const out: string[] = [];
  out.push(`# НЕДЕЛЯ ТРЕНЕРА ПРОТИВ НЕДЕЛИ СБОРЩИКА · день к дню`);
  out.push(`\nСлева — конкретная неделя, которую Игорь написал сам. Справа — неделя сборщика на ${weekStart}.`);
  out.push(`Неделя тренера выбрана как самая свежая ЗАВЕРШЁННАЯ неделя без активного health-сигнала.`);
  out.push(`Сравниваются только БЕГОВЫЕ сессии: сборщик другого не планирует. Силовые и прочее`);
  out.push(`у тренера считаются отдельной строкой и в сумму не входят.`);

  const rows: Array<{ aid: number; nm: string; c: Side; m: Side; cw: string }> = [];
  const weekTotals = new Map<number, number[]>();
  const cycleTarget = new Map<number, number>();

  for (const aid of GROUP) {
    const c = ctx.get(aid); const d = drafts.get(aid);
    if (!c) continue;
    const nm = names.get(aid) ?? String(aid);

    // ── неделя тренера ──
    const since = addDays(today, -140);
    const { data: rowsRaw } = await sb.from("trainingpeaks_workout_cache")
      .select("workout_date,title,planned_time_raw,workout_type_value_id")
      .eq("trainingpeaks_athlete_id", aid).eq("is_planned", true)
      .gte("workout_date", since).lt("workout_date", mondayOf(today))
      .order("workout_date");
    const byWeek = new Map<string, Array<Record<string, unknown>>>();
    for (const r of (rowsRaw ?? []) as Array<Record<string, unknown>>) {
      if (!((r.planned_time_raw as number) > 0)) continue;
      const k = mondayOf(String(r.workout_date));
      (byWeek.get(k) ?? byWeek.set(k, []).get(k)!).push(r);
    }
    // самая свежая неделя без активного сигнала внутри неё
    const illFree = [...byWeek.keys()].sort().reverse().find((wk) => {
      const end = addDays(wk, 6);
      const hit = c.illness.some((w) => !(end < w.from || wk > w.to));
      const runs = (byWeek.get(wk) ?? []).filter((r) => Number(r.workout_type_value_id) === 3);
      return !hit && runs.length > 0;
    });
    if (!illFree) { out.push(`\n\n### ${nm} (${aid}) — недели тренера без сигнала не нашлось`); continue; }

    const all = byWeek.get(illFree)!;
    const coach: CoachSession[] = all.filter((r) => Number(r.workout_type_value_id) === 3).map((r) => {
      const t = String(r.title ?? "");
      const minutes = Math.round((r.planned_time_raw as number) * 60);
      const kind: CoachSession["kind"] = isQ(t) ? "quality" : LONG_RE.test(t) ? "long" : "easy";
      const dt = String(r.workout_date);
      return { date: dt, dayIdx: (new Date(dt + "T00:00:00Z").getUTCDay() + 6) % 7, title: t, minutes, kind };
    }).sort((a, b) => a.dayIdx - b.dayIdx);
    const otherCount = all.length - coach.length;
    // все его недельные суммы за окно — для сравнения цели с распределением
    weekTotals.set(aid, [...byWeek.entries()].map(([, rs]) => Math.round(rs
      .filter((r) => Number(r.workout_type_value_id) === 3)
      .reduce((s2, r) => s2 + (r.planned_time_raw as number) * 60, 0))).filter((x) => x > 0));

    // У тренера «длительная» может быть не помечена заголовком — тогда длительной считаем
    // самую длинную НЕ-качественную сессию недели, если она длиннее его обычной лёгкой.
    if (!coach.some((s) => s.kind === "long")) {
      const cand = coach.filter((s) => s.kind === "easy").sort((a, b) => b.minutes - a.minutes)[0];
      if (cand && c.envelope.typicalEasyMinutes > 0 && cand.minutes > c.envelope.typicalEasyMinutes) cand.kind = "long";
    }
    const coachSide = summarise(coach.map((s) => ({ minutes: s.minutes, kind: s.kind, dayIdx: s.dayIdx, work: s.kind === "quality" ? workMinutesFromTitle(s.title) : 0 })));

    // ── неделя сборщика ──
    let mach: Week | null = null;
    if (d) {
      const w2r = d.targetDate ? Math.round((Date.parse(d.targetDate) - Date.parse(weekStart)) / (7 * 86400000)) + 1 : 8;
      const fc = forecast(d, weekStart, Math.max(1, w2r));
      const f = fc[0];
      if (f) {
        const t: CycleWeekTarget = { weekIndex: 1, totalWeeks: fc.length, role: f.role, aerobicMin: f.aerobicMin, qualityMin: f.qualityMin, days: f.days,
          baseWeekMin: d.baseAerobicMin + d.baseQualityMin, hasTargetRace: d.targetDate != null, intent: d.intent };
        cycleTarget.set(aid, f.aerobicMin + f.qualityMin);
        mach = buildWeek(c, c.envelope, cat, weekStart, c.hasActiveIllness, c.tierNote, t);
      }
    }
    if (!mach) mach = buildWeek(c, c.envelope, cat, weekStart, c.hasActiveIllness, c.tierNote);
    const ms = (mach.sessions ?? []).filter((s) => !s.deferred);
    const machSide = summarise(ms.map((s) => ({
      minutes: s.minutes, kind: s.role === "quality" ? "quality" : s.role === "long" ? "long" : "easy",
      dayIdx: s.dayIdx, work: s.role === "quality" ? workMinutesFromTitle(s.title) : 0,
    })));

    rows.push({ aid, nm, c: coachSide, m: machSide, cw: illFree });

    // ── печать пары ──
    out.push(`\n\n${"═".repeat(96)}`);
    out.push(`${nm} (${aid}) · тир ${mach.tier}`);
    out.push(`НЕДЕЛЯ ТРЕНЕРА ${illFree}${otherCount > 0 ? `  (+ ${otherCount} небеговых, в сумму не входят)` : ""}   │   СБОРЩИК ${weekStart}`);
    if (mach.notes.some((n) => n.includes("РОЛЬ НЕДЕЛИ ПОНИЖЕНА"))) out.push(`⚑ неделя сборщика ПОНИЖЕНА активным health-сигналом — сравнение не в равных условиях`);
    out.push("═".repeat(96));
    const L = coach.map((s) => `${DAY_RU[s.dayIdx]} ${s.title.slice(0, 34).padEnd(34)} ${String(s.minutes).padStart(3)}`);
    const Rr = ms.map((s) => `${DAY_RU[s.dayIdx]} ${s.title.slice(0, 34).padEnd(34)} ${String(s.minutes).padStart(3)}`);
    for (let i = 0; i < Math.max(L.length, Rr.length); i++) {
      out.push(`  ${(L[i] ?? "").padEnd(44)}│  ${Rr[i] ?? ""}`);
    }
    out.push("  " + "─".repeat(44) + "┼" + "─".repeat(46));
    const cmp = (label: string, a: number | string, b: number | string, unit = ""): string =>
      `  ${label.padEnd(22)}${String(a).padStart(5)}${unit.padEnd(6)}      │  ${String(b).padStart(5)}${unit}`;
    out.push(cmp("сумма, мин", coachSide.total, machSide.total));
    out.push(cmp("дней", coachSide.days, machSide.days));
    out.push(cmp("длительная, мин", coachSide.longest, machSide.longest));
    out.push(cmp("самая длинная лёгкая", coachSide.longestEasy, machSide.longestEasy));
    out.push(cmp("лёгких дней", coachSide.easies, machSide.easies));
    out.push(cmp("минуты работы", coachSide.work, machSide.work));
    out.push(cmp("доля качества, %", coachSide.sharePct, machSide.sharePct));
    out.push(cmp("САМАЯ КОРОТКАЯ, мин", coachSide.shortest, machSide.shortest));
    out.push(cmp(`сессий короче ${SHORT_SESSION_MIN}`, coachSide.underMin, machSide.underMin));
    out.push(cmp("КАЧЕСТВЕННЫХ", coachSide.qCount, machSide.qCount));
    const dn = (d: number | null): string => (d == null || d < 0 ? "—" : DAY_RU[d]);
    out.push(cmp("день длительной", dn(coachSide.longDay), dn(machSide.longDay)));
    out.push(cmp("дни качественных", coachSide.qDays.map(dn).join(",") || "—", machSide.qDays.map(dn).join(",") || "—"));
  }

  // ── сводка расхождений ──
  out.push(`\n\n${"#".repeat(96)}`);
  out.push(`# ГДЕ ИМЕННО РАСХОЖДЕНИЕ · сборщик минус тренер, со знаком`);
  out.push("#".repeat(96));
  out.push("");
  const hdr = `${"атлет".padEnd(22)}${"дней".padStart(7)}${"сумма".padStart(8)}${"длит".padStart(7)}${"дл.лёгк".padStart(9)}${"лёгких".padStart(8)}${"работа".padStart(8)}${"кратч".padStart(8)}${"<45".padStart(6)}${"кач-х".padStart(7)}${"деньД".padStart(7)}${"деньК".padStart(7)}`;
  out.push(hdr);
  out.push("-".repeat(hdr.length));
  const sg = (n: number): string => (n > 0 ? "+" : "") + n;
  const acc = { days: 0, total: 0, longest: 0, longestEasy: 0, easies: 0, work: 0, shortest: 0, underMin: 0, qCount: 0, n: 0 };
  let longDayHit = 0, qDayHit = 0, qDayCmp = 0;
  for (const r of rows) {
    out.push(`${r.nm.slice(0, 21).padEnd(22)}${sg(r.m.days - r.c.days).padStart(7)}${sg(r.m.total - r.c.total).padStart(8)}`
      + `${sg(r.m.longest - r.c.longest).padStart(7)}${sg(r.m.longestEasy - r.c.longestEasy).padStart(9)}`
      + `${sg(r.m.easies - r.c.easies).padStart(8)}${sg(r.m.work - r.c.work).padStart(8)}`
      + `${sg(r.m.shortest - r.c.shortest).padStart(8)}${sg(r.m.underMin - r.c.underMin).padStart(6)}`
      + `${sg(r.m.qCount - r.c.qCount).padStart(7)}`
      + `${(r.m.longDay != null && r.m.longDay === r.c.longDay ? "совп" : "—").padStart(7)}`
      + `${(r.m.qDays.length > 0 && r.c.qDays.length > 0 && r.m.qDays.some((d) => r.c.qDays.includes(d)) ? "совп" : "—").padStart(7)}`);
    if (r.m.longDay != null && r.m.longDay === r.c.longDay) longDayHit++;
    if (r.m.qDays.length > 0 && r.c.qDays.length > 0) { qDayCmp++; if (r.m.qDays.some((d) => r.c.qDays.includes(d))) qDayHit++; }
    acc.qCount += r.m.qCount - r.c.qCount;
    acc.days += r.m.days - r.c.days; acc.total += r.m.total - r.c.total;
    acc.longest += r.m.longest - r.c.longest; acc.longestEasy += r.m.longestEasy - r.c.longestEasy;
    acc.easies += r.m.easies - r.c.easies; acc.work += r.m.work - r.c.work;
    acc.shortest += r.m.shortest - r.c.shortest; acc.underMin += r.m.underMin - r.c.underMin; acc.n++;
  }
  out.push("-".repeat(hdr.length));
  const av = (x: number): string => (Math.round(10 * x / Math.max(1, acc.n)) / 10).toString();
  out.push(`${"среднее на атлета".padEnd(22)}${av(acc.days).padStart(7)}${av(acc.total).padStart(8)}${av(acc.longest).padStart(7)}`
    + `${av(acc.longestEasy).padStart(9)}${av(acc.easies).padStart(8)}${av(acc.work).padStart(8)}`
    + `${av(acc.shortest).padStart(8)}${av(acc.underMin).padStart(6)}${av(acc.qCount).padStart(7)}`);
  out.push("");
  out.push(`ДЕНЬ ДЛИТЕЛЬНОЙ совпал с днём тренера: ${longDayHit} из ${acc.n}`);
  out.push(`ДЕНЬ КАЧЕСТВА пересёкся с днями тренера: ${qDayHit} из ${qDayCmp} (там, где качество есть у обоих)`);

  // ── ЦЕЛЬ ЦИКЛА ПРОТИВ РАСПРЕДЕЛЕНИЯ ЕГО СОБСТВЕННЫХ НЕДЕЛЬ ──
  // Гипотеза замкнутого круга: база цикла — взвешенная медиана его плановых недель, значит
  // цель по построению садится около середины его собственного распределения. Тренер же,
  // говоря «мало», сравнивает с той неделей, которую ПОМНИТ, а помнится хорошая — ближе к p75.
  out.push(`\n\n${"#".repeat(96)}`);
  out.push(`# ЦЕЛЬ ЦИКЛА ПРОТИВ ЕГО СОБСТВЕННЫХ НЕДЕЛЬ за 26 нед`);
  out.push("#".repeat(96));
  out.push("");
  out.push(`${"атлет".padEnd(22)}${"цель".padStart(7)}${"медиана".padStart(9)}${"p75".padStart(6)}${"макс".padStart(7)}${"цель−мед".padStart(10)}${"цель−p75".padStart(10)}`);
  out.push("-".repeat(71));
  let belowMed = 0, belowP75 = 0, cnt = 0;
  for (const r of rows) {
    const w = weekTotals.get(r.aid) ?? [];
    if (!w.length) continue;
    const srt = [...w].sort((a, b) => a - b);
    const at = (p: number): number => srt[Math.min(srt.length - 1, Math.floor(p * (srt.length - 1)))];
    const med = at(0.5), p75 = at(0.75), mx = srt[srt.length - 1];
    const tgt = cycleTarget.get(r.aid) ?? 0;
    if (tgt < med) belowMed++;
    if (tgt < p75) belowP75++;
    cnt++;
    const sgn = (n: number): string => (n > 0 ? "+" : "") + n;
    out.push(`${r.nm.slice(0, 21).padEnd(22)}${String(tgt).padStart(7)}${String(med).padStart(9)}${String(p75).padStart(6)}${String(mx).padStart(7)}`
      + `${sgn(tgt - med).padStart(10)}${sgn(tgt - p75).padStart(10)}`);
  }
  out.push("-".repeat(71));
  out.push(`цель НИЖЕ его медианы у ${belowMed} из ${cnt}; НИЖЕ его p75 у ${belowP75} из ${cnt}`);

  const dir = path.join(path.resolve(toolRoot, "..", ".."), "reports", "autoplanner-acceptance");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `week-side-by-side-${weekStart}.md`), out.join("\n") + "\n");
  console.log(out.join("\n"));
  console.log(`\n[side-by-side] → ${dir}/week-side-by-side-${weekStart}.md`);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
