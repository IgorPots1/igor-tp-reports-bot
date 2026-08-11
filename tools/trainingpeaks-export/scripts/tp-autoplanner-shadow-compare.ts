/**
 * tp-autoplanner-shadow-compare — теневое сравнение: что выдал бы генератор против того,
 * что Игорь реально поставил. READ-ONLY: ни записи в TP, ни записи в БД.
 *
 * ЧЕСТНОСТЬ ТЕСТА. Для каждой пары (атлет, историческая неделя N) контекст собирается СТРОГО
 * по данным ДО начала недели N (loadAthleteContexts(asOf = weekStart) фильтрует строки по дате),
 * поэтому генератор не видит ни саму неделю, ни то, что было после. Это out-of-sample.
 *
 * ЗАЧЕМ ЗНАК, А НЕ ТОЛЬКО ДОЛЯ. Систематический перекос («машина всегда даёт на день меньше»)
 * чинится одной константой. Разброс без перекоса — нормальная вариативность тренера, и чинить
 * там нечего. Поэтому по каждой оси печатается доля совпадений И знак расхождения.
 *
 * Запись в autoplanner_shadow_results — только по ключу --persist (таблица применена 13.08).
 * Пишем ТОЛЬКО в свою аналитическую таблицу: ни TP, ни рабочие таблицы не трогаем.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/tp-autoplanner-shadow-compare.ts
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";
import { loadAthleteContexts, mondayOf } from "./lib/autoplanner-context.ts";
import { buildWeek, type Week } from "./lib/autoplanner-week.ts";
import { loadCatalog } from "./lib/autoplanner-catalog.ts";
import { extractEasySample, INTERVAL_TITLE_RE } from "./lib/easy-anchor.ts";

function loadEnv(p: string): void { if (!existsSync(p)) return; for (const l of readFileSync(p, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const e = t.indexOf("="); if (e < 0) continue; const k = t.slice(0, e).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(e + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function sbc(): SupabaseClient {
  const root = path.resolve(toolRoot, "..", "..");
  for (const p of [path.join(root, ".env.local"), "/Users/igor/igor-tp-reports-bot/.env.local"]) loadEnv(p);
  return createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } });
}
const iso = (d: number): string => new Date(d).toISOString().slice(0, 10);
const addDays = (s: string, n: number): string => iso(Date.parse(s) + n * 86400000);

/** Сколько исторических недель проверяем. */
const WEEKS_BACK = 16;
/** Допуск по объёму и по длительной: в пределах этого считаем «совпало». */
const VOLUME_TOL = 0.15;
const LONG_TOL = 0.15;
const LONG_TITLE_RE = /длительн|длинн/i;

type ActualRow = { trainingpeaks_athlete_id: number; workout_date: string; title: string | null;
  planned_time_raw: number | null; description: string | null };

type Actual = { days: number; minutes: number; hasQuality: boolean; longMinutes: number;
  easyFast: number | null; easySlow: number | null };

async function pullPlanned(sb: SupabaseClient, from: string, to: string): Promise<ActualRow[]> {
  const out: ActualRow[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("trainingpeaks_workout_cache")
      .select("trainingpeaks_athlete_id, workout_date, title, planned_time_raw, description:source_snapshot->>description")
      .eq("workout_type_value_id", 3).eq("is_planned", true)
      .gte("workout_date", from).lt("workout_date", to).order("workout_date").range(f, f + 999);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as ActualRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function summarizeActual(rows: ActualRow[]): Actual | null {
  const sessions = rows.filter((r) => (r.planned_time_raw ?? 0) > 0);
  if (sessions.length === 0) return null;
  let minutes = 0, longMinutes = 0, hasQuality = false;
  const easyFasts: number[] = [], easySlows: number[] = [];
  for (const r of sessions) {
    const m = Math.round((r.planned_time_raw as number) * 60);
    if (m <= 0 || m > 300) continue;
    minutes += m;
    const t = r.title ?? "";
    if (INTERVAL_TITLE_RE.test(t)) hasQuality = true;
    if (LONG_TITLE_RE.test(t)) longMinutes = Math.max(longMinutes, m);
    const s = t ? extractEasySample(t, r.description ?? "") : null;
    if (s) { easyFasts.push(s.fast); easySlows.push(s.slow); }
  }
  const med = (xs: number[]): number | null => {
    if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
  };
  // Если явной «длительной» тренер не назвал — берём самую длинную сессию недели.
  if (longMinutes === 0) longMinutes = Math.max(...sessions.map((r) => Math.round((r.planned_time_raw ?? 0) * 60)));
  return { days: sessions.length, minutes, hasQuality, longMinutes, easyFast: med(easyFasts), easySlow: med(easySlows) };
}

type Pair = {
  aid: number; weekStart: string; tier: string; anchorSource: string;
  genDays: number; actDays: number;
  genMin: number; actMin: number;
  genQuality: boolean; actQuality: boolean;
  genLong: number; actLong: number;
  genEasyFast: number | null; genEasySlow: number | null;
  actEasyFast: number | null; actEasySlow: number | null;
};

function genSummary(w: Week): { days: number; minutes: number; hasQuality: boolean; long: number; easyFast: number | null; easySlow: number | null; anchorSource: string } {
  const live = w.sessions.filter((s) => !s.deferred);
  const longS = live.filter((s) => s.role === "long").map((s) => s.minutes);
  const easy = live.find((s) => s.role !== "quality" && s.segments.some((x) => x.fastSec != null));
  const seg = easy?.segments.find((x) => x.fastSec != null && x.slowSec != null);
  const src = live.find((s) => s.role !== "quality")?.anchorSource ?? live[0]?.anchorSource ?? "—";
  return {
    days: live.length,
    minutes: live.reduce((a, s) => a + s.minutes, 0),
    hasQuality: live.some((s) => s.role === "quality"),
    long: longS.length ? Math.max(...longS) : Math.max(0, ...live.map((s) => s.minutes)),
    easyFast: seg?.fastSec ?? null, easySlow: seg?.slowSec ?? null,
    anchorSource: src,
  };
}

const pctFmt = (n: number, d: number): string => (d > 0 ? `${Math.round((100 * n) / d)}%` : "—");

function axisLine(label: string, less: number, same: number, more: number): string {
  const tot = less + same + more;
  const sign = more > less * 1.25 ? "машина БОЛЬШЕ" : less > more * 1.25 ? "машина МЕНЬШЕ" : "перекоса нет";
  return `${label.padEnd(22)} совпало ${pctFmt(same, tot).padStart(4)}  ·  меньше ${pctFmt(less, tot).padStart(4)}`
    + `  ·  больше ${pctFmt(more, tot).padStart(4)}  →  ${sign}`;
}

async function main(): Promise<void> {
  const sb = sbc();
  const cat = await loadCatalog(sb);
  const thisMonday = mondayOf(iso(Date.now()));
  const weekStarts: string[] = [];
  for (let i = WEEKS_BACK; i >= 1; i--) weekStarts.push(addDays(thisMonday, -7 * i));

  // ДЕНЬ ЗАМЕРА. По умолчанию контекст берётся на понедельник целевой недели — то есть тест
  // всегда «запускается» в понедельник. Ошибки, зависящие от дня запуска, он при этом не видит
  // в принципе: последняя такая (обрезанная неполная неделя в конверте) прошла мимо целиком и
  // всплыла только на живом прогоне. Ключ --asof-offset=N сдвигает момент замера на N дней
  // назад от начала недели: 6 = вторник предыдущей недели, 5 = среда, 4 = четверг, 3 = пятница.
  const offArg = process.argv.find((a) => a.startsWith("--asof-offset="));
  const asOfOffset = offArg ? Math.max(0, Math.round(Number(offArg.split("=")[1]))) : 0;
  const DOW = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const offsetLabel = asOfOffset === 0 ? "Пн (начало целевой недели)"
    : `${DOW[(7 - (asOfOffset % 7)) % 7]} за ${asOfOffset} дн до недели`;

  console.log(`[shadow] недель к проверке: ${weekStarts.length} (${weekStarts[0]} … ${weekStarts[weekStarts.length - 1]}) · замер: ${offsetLabel}`);
  const pairs: Pair[] = [];

  for (const ws of weekStarts) {
    const [ctx, actualRows] = await Promise.all([
      loadAthleteContexts(sb, addDays(ws, -asOfOffset)), // контекст СТРОГО до момента замера
      pullPlanned(sb, ws, addDays(ws, 7)),         // что тренер реально поставил в неделю ws
    ]);
    const actualByAth = new Map<number, ActualRow[]>();
    for (const r of actualRows) (actualByAth.get(r.trainingpeaks_athlete_id) ?? actualByAth.set(r.trainingpeaks_athlete_id, []).get(r.trainingpeaks_athlete_id)!).push(r);

    let made = 0;
    for (const c of ctx.values()) {
      const act = summarizeActual(actualByAth.get(c.athleteId) ?? []);
      if (!act) continue;                          // тренер ничего не ставил — сравнивать не с чем
      if (!c.easy || c.envelope.weeksObserved === 0) continue;
      const w = buildWeek(c, c.envelope, cat, ws, c.hasActiveIllness, c.tierNote);
      if (w.refused) continue;                     // отказ — отдельная история, в оси не мешаем
      const g = genSummary(w);
      if (g.days === 0) continue;
      pairs.push({
        aid: c.athleteId, weekStart: ws, tier: c.tier, anchorSource: g.anchorSource,
        genDays: g.days, actDays: act.days, genMin: g.minutes, actMin: act.minutes,
        genQuality: g.hasQuality, actQuality: act.hasQuality,
        genLong: g.long, actLong: act.longMinutes,
        genEasyFast: g.easyFast, genEasySlow: g.easySlow,
        actEasyFast: act.easyFast, actEasySlow: act.easySlow,
      });
      made++;
    }
    console.log(`[shadow] ${ws}: пар ${made}`);
  }

  // ── агрегаты ──
  const out: string[] = [];
  const athletes = new Set(pairs.map((p) => p.aid));
  out.push(`# Теневое сравнение автопланировщика с практикой`);
  out.push(`\nпар: ${pairs.length} · недель: ${weekStarts.length} (${weekStarts[0]} … ${weekStarts[weekStarts.length - 1]}) · атлетов: ${athletes.size}`);
  out.push(`контекст каждой пары собран СТРОГО до начала недели (out-of-sample)`);

  const daysAxis = { less: 0, same: 0, more: 0, near: 0 };
  const volAxis = { less: 0, same: 0, more: 0 };
  const qual = { both: 0, onlyCoach: 0, onlyMachine: 0, neither: 0 };
  const longAxis = { less: 0, same: 0, more: 0 };
  const easyAxis = { overlap: 0, machineFaster: 0, machineSlower: 0, noData: 0 };

  for (const p of pairs) {
    if (p.genDays === p.actDays) daysAxis.same++;
    else if (p.genDays < p.actDays) daysAxis.less++;
    else daysAxis.more++;
    if (Math.abs(p.genDays - p.actDays) <= 1) daysAxis.near++;

    const vr = p.actMin > 0 ? p.genMin / p.actMin : 1;
    if (Math.abs(vr - 1) <= VOLUME_TOL) volAxis.same++; else if (vr < 1) volAxis.less++; else volAxis.more++;

    if (p.genQuality && p.actQuality) qual.both++;
    else if (!p.genQuality && p.actQuality) qual.onlyCoach++;
    else if (p.genQuality && !p.actQuality) qual.onlyMachine++;
    else qual.neither++;

    const lr = p.actLong > 0 ? p.genLong / p.actLong : 1;
    if (Math.abs(lr - 1) <= LONG_TOL) longAxis.same++; else if (lr < 1) longAxis.less++; else longAxis.more++;

    if (p.genEasyFast == null || p.actEasyFast == null || p.genEasySlow == null || p.actEasySlow == null) easyAxis.noData++;
    else if (p.genEasyFast <= p.actEasySlow && p.actEasyFast <= p.genEasySlow) easyAxis.overlap++;
    else if (p.genEasySlow < p.actEasyFast) easyAxis.machineFaster++;  // темп в сек/км: меньше = быстрее
    else easyAxis.machineSlower++;
  }

  out.push(`\n## Оси сравнения — доля и ЗНАК`);
  out.push("```");
  out.push(axisLine("беговых дней", daysAxis.less, daysAxis.same, daysAxis.more)
    + `   (в пределах ±1 дня: ${pctFmt(daysAxis.near, pairs.length)})`);
  out.push(axisLine(`объём (±${VOLUME_TOL * 100}%)`, volAxis.less, volAxis.same, volAxis.more));
  out.push(axisLine(`длительная (±${LONG_TOL * 100}%)`, longAxis.less, longAxis.same, longAxis.more));
  out.push("```");
  const qTot = pairs.length;
  out.push(`\n**качество:** у обоих ${pctFmt(qual.both, qTot)} · только у тренера ${pctFmt(qual.onlyCoach, qTot)}`
    + ` · только у машины ${pctFmt(qual.onlyMachine, qTot)} · ни у кого ${pctFmt(qual.neither, qTot)}`
    + ` → ${qual.onlyCoach > qual.onlyMachine * 1.25 ? "машина ставит качество РЕЖЕ" : qual.onlyMachine > qual.onlyCoach * 1.25 ? "машина ставит качество ЧАЩЕ" : "перекоса нет"}`);
  const easyTot = pairs.length - easyAxis.noData;
  out.push(`\n**темп лёгкого:** полосы пересекаются ${pctFmt(easyAxis.overlap, easyTot)}`
    + ` · машина быстрее ${pctFmt(easyAxis.machineFaster, easyTot)} · машина медленнее ${pctFmt(easyAxis.machineSlower, easyTot)}`
    + ` · нечем сравнить ${easyAxis.noData} пар`);

  // ── разбивки ──
  const groupLines = (key: (p: Pair) => string, title: string): void => {
    out.push(`\n## ${title}`);
    out.push("```");
    const keys = [...new Set(pairs.map(key))].sort();
    for (const k of keys) {
      const g = pairs.filter((p) => key(p) === k);
      const dLess = g.filter((p) => p.genDays < p.actDays).length, dMore = g.filter((p) => p.genDays > p.actDays).length;
      const vLess = g.filter((p) => p.actMin > 0 && p.genMin / p.actMin < 1 - VOLUME_TOL).length;
      const vMore = g.filter((p) => p.actMin > 0 && p.genMin / p.actMin > 1 + VOLUME_TOL).length;
      const qOnlyCoach = g.filter((p) => !p.genQuality && p.actQuality).length;
      const qOnlyMach = g.filter((p) => p.genQuality && !p.actQuality).length;
      const medRatio = (() => { const xs = g.filter((p) => p.actMin > 0).map((p) => p.genMin / p.actMin).sort((a, b) => a - b);
        return xs.length ? xs[Math.floor(xs.length / 2)] : NaN; })();
      out.push(`${k.padEnd(22)} n=${String(g.length).padStart(4)}  дней −${String(dLess).padStart(3)}/+${String(dMore).padStart(3)}`
        + `  объём медиана ×${Number.isFinite(medRatio) ? medRatio.toFixed(2) : "—"}  качество только тренер ${String(qOnlyCoach).padStart(3)} / только машина ${String(qOnlyMach).padStart(3)}`);
    }
    out.push("```");
  };
  groupLines((p) => p.tier, "Разбивка по тирам");
  groupLines((p) => p.anchorSource, "Разбивка по anchor_source");

  // ── худшее совпадение ──
  const score = (p: Pair): number => {
    let s = 0;
    s += Math.abs(p.genDays - p.actDays);
    s += p.actMin > 0 ? Math.abs(p.genMin / p.actMin - 1) * 5 : 0;
    s += p.genQuality === p.actQuality ? 0 : 2;
    s += p.actLong > 0 ? Math.abs(p.genLong / p.actLong - 1) * 2 : 0;
    return s;
  };
  const byAth = new Map<number, Pair[]>();
  for (const p of pairs) (byAth.get(p.aid) ?? byAth.set(p.aid, []).get(p.aid)!).push(p);
  const worst = [...byAth.entries()]
    .map(([aid, ps]) => ({ aid, n: ps.length, avg: ps.reduce((a, p) => a + score(p), 0) / ps.length, ps }))
    .filter((x) => x.n >= 3).sort((a, b) => b.avg - a.avg).slice(0, 10);
  out.push(`\n## Топ-10 худших совпадений (атлеты с >= 3 парами)`);
  out.push("```");
  for (const w of worst) {
    const dD = w.ps.reduce((a, p) => a + (p.genDays - p.actDays), 0) / w.n;
    const vR = w.ps.filter((p) => p.actMin > 0).map((p) => p.genMin / p.actMin);
    const vMed = vR.length ? vR.sort((a, b) => a - b)[Math.floor(vR.length / 2)] : NaN;
    const qc = w.ps.filter((p) => !p.genQuality && p.actQuality).length;
    const qm = w.ps.filter((p) => p.genQuality && !p.actQuality).length;
    out.push(`${String(w.aid).padEnd(9)} пар ${String(w.n).padStart(2)} · дней в среднем ${dD >= 0 ? "+" : ""}${dD.toFixed(1)}`
      + ` · объём ×${Number.isFinite(vMed) ? vMed.toFixed(2) : "—"} · качество пропущено ${qc}, лишнее ${qm} · тир ${w.ps[0].tier}`);
  }
  out.push("```");

  // ── запись в autoplanner_shadow_results (таблица применена 13.08) ──
  // Пишем ТОЛЬКО в свою аналитическую таблицу. Ни TP, ни рабочие таблицы не трогаем.
  if (process.argv.includes("--persist")) {
    const rows = pairs.map((p) => ({
      trainingpeaks_athlete_id: p.aid,
      week_start: p.weekStart,
      train_window_from: addDays(p.weekStart, -7 * 26),
      train_window_to: p.weekStart,
      half_life_days: 21,
      anchor_source: p.anchorSource,
      generated_json: { days: p.genDays, minutes: p.genMin, hasQuality: p.genQuality, long: p.genLong, easyFast: p.genEasyFast, easySlow: p.genEasySlow, tier: p.tier },
      actual_json: { days: p.actDays, minutes: p.actMin, hasQuality: p.actQuality, long: p.actLong, easyFast: p.actEasyFast, easySlow: p.actEasySlow },
      match_scores_json: {
        daysDelta: p.genDays - p.actDays,
        volumeRatio: p.actMin > 0 ? Math.round((p.genMin / p.actMin) * 100) / 100 : null,
        longRatio: p.actLong > 0 ? Math.round((p.genLong / p.actLong) * 100) / 100 : null,
        qualityMatch: p.genQuality === p.actQuality,
      },
      easy_pred_minus_actual_s: (p.genEasyFast != null && p.genEasySlow != null && p.actEasyFast != null && p.actEasySlow != null)
        ? Math.round((p.genEasyFast + p.genEasySlow) / 2 - (p.actEasyFast + p.actEasySlow) / 2) : null,
    }));
    // Уникальность в таблице задана индексом ПО ВЫРАЖЕНИЮ (coalesce(half_life_days,-1)),
    // поэтому upsert с onConflict по списку колонок не годится. Перезаписываем ровно те строки,
    // которые сами же и пишем: свои недели и своё half_life. Чужого не трогаем.
    const { error: delErr } = await sb.from("autoplanner_shadow_results")
      .delete().eq("half_life_days", 21).in("week_start", weekStarts);
    if (delErr) throw new Error(`delete: ${delErr.message}`);
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from("autoplanner_shadow_results").insert(rows.slice(i, i + 500));
      if (error) throw new Error(`insert: ${error.message}`);
    }
    console.log(`[shadow] записано строк в autoplanner_shadow_results: ${rows.length}`);
  }

  const dir = path.join(path.resolve(toolRoot, "..", ".."), "reports", "autoplanner-shadow");
  mkdirSync(dir, { recursive: true });
  // Имя файла несёт день замера — иначе прогоны с разным --asof-offset затирают друг друга.
  const sfx = asOfOffset === 0 ? "" : `-off${asOfOffset}`;
  writeFileSync(path.join(dir, `compare-${weekStarts[0]}${sfx}.md`), out.join("\n") + "\n");
  writeFileSync(path.join(dir, `pairs-${weekStarts[0]}${sfx}.json`), JSON.stringify(pairs, null, 2) + "\n");
  console.log(out.join("\n"));
  console.log(`\n[shadow] отчёт → ${dir}`);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : JSON.stringify(e)); process.exit(1); });
