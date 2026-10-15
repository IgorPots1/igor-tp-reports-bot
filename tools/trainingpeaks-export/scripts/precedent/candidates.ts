/**
 * ОТБОР ОДНОГО ЧЕЛОВЕКА ДЛЯ ПЕРВОЙ ЖИВОЙ ПОСТАНОВКИ СКРЫТОЙ НЕДЕЛИ. READ-ONLY (в TP только чтение календаря).
 * Критерии (наряд Игоря 15.10), каждый считается отдельно и показывается:
 *   1. неделя идёт ПОВТОРОМ своей недели (не чужим прецедентом);
 *   2. нет активных сигналов здоровья (status=active в базе — строго, без нашего правила «протух»);
 *   3. нет старта в ближайшие 3 недели и нет окна восстановления после старта (неделя «как обычная»);
 *   4. нет пометок валидатора или они мелкие (≤2, только потолки baseline / личный пол лёгкой / прирост к прошлой неделе);
 *   5. у Игоря на эту неделю ничего не стоит: по кэшу И живым чтением календаря TP;
 *   6. у каждой сессии есть текст, сессий ≥ 3, нет пометок по тексту/темпу (⚑).
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/precedent/candidates.ts [--week 2026-10-19]
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { DAY_RU } from "../lib/autoplanner-week.ts";
import { addDays, iso, mondayOf } from "./corpus.ts";
import { sbc } from "./dump-corpus.ts";
import { OUT_DIR } from "./load.ts";
import { assemble, GROUP12, type Assembled } from "./assemble.ts";
import { recoveryFactor } from "./post-race.ts";
import { ILLNESS_SIGNAL_TYPES } from "../lib/signal-closure.ts";
import { liveClient } from "./tp-live-client.ts";

/** «Мелкие» пометки: потолки baseline, личный пол лёгкой, прирост к прошлой неделе. Всё остальное — не мелкое. */
const MINOR = /потолка baseline|личный пол лёгкой|прирост к прошлой плановой неделе|сигнал здоровья активен/;

async function main(): Promise<void> {
  const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] ?? null : null; };
  const week = arg("week") ?? addDays(mondayOf(iso(Date.now())), 7);
  const { L, ix, results } = await assemble(week, GROUP12);
  const sb = sbc();
  const sidByAid = new Map<number, string>(); for (const s of L.students) { const m = /athletes?\/(\d+)/.exec(s.trainingpeaks_athlete_url ?? ""); if (m) sidByAid.set(Number(m[1]), s.id); }
  const { data: sig } = await sb.from("trainingpeaks_student_operational_signals").select("student_id,signal_type,status").eq("status", "active").in("signal_type", ILLNESS_SIGNAL_TYPES);
  const activeBy = new Map<string, string[]>(); for (const r of (sig ?? []) as Array<{ student_id: string; signal_type: string }>) (activeBy.get(r.student_id) ?? activeBy.set(r.student_id, []).get(r.student_id)!).push(r.signal_type);
  const live = await liveClient();

  type Row = { aid: number; name: string; r: Assembled; crit: Record<string, { ok: boolean; why: string }>; pass: boolean; minor: number };
  const rows: Row[] = [];
  for (const r of results) {
    const name = L.names.get(r.aid) ?? String(r.aid);
    const crit: Row["crit"] = {};
    const b = r.ok ? r.built : r.built;
    crit["1 повтор своей недели"] = { ok: !!r.ok && !!b && b.source.startsWith("ПОВТОР"), why: r.ok ? (b!.source.split("×")[0].trim()) : r.why.slice(0, 90) };
    const sid = sidByAid.get(r.aid); const act = sid ? activeBy.get(sid) ?? [] : [];
    crit["2 нет активных сигналов"] = { ok: act.length === 0, why: act.length ? `активных: ${act.length} (${[...new Set(act)].join(", ")})` : "нет" };
    const races = L.races.filter((x) => x.trainingpeaks_athlete_id === r.aid);
    const soon = races.filter((x) => x.event_date >= week && x.event_date < addDays(week, 21));
    const t = r.ok || r.t ? (r.t ?? null) : null;
    const rec = t ? recoveryFactor(t.lastRaceKm, t.weeksSinceRace) : null;
    crit["3 нет старта ≤3 нед и окна восстановления"] = { ok: soon.length === 0 && rec == null, why: soon.length ? `старт ${soon[0].event_date}` : rec != null ? `после старта: неделя +${t!.weeksSinceRace}, ×${rec}` : "нет" };
    const warns = r.ok ? r.built.warnings : [];
    const minor = warns.filter((w) => w.startsWith("⚠") && MINOR.test(w)).length; const major = warns.filter((w) => w.startsWith("⚠") && !MINOR.test(w)).length;
    const flags = warns.filter((w) => w.startsWith("⚑")).length; const hard = warns.filter((w) => w.startsWith("⛔")).length;
    crit["4 пометки валидатора мелкие"] = { ok: r.ok && hard === 0 && major === 0 && minor <= 2, why: r.ok ? `мелких ${minor}, прочих ${major}, жёстких ${hard}` : "—" };
    const cacheEmpty = !(r.ok === false && /уже написана тренером/.test(r.why));
    crit["5a у Игоря пусто (кэш)"] = { ok: cacheEmpty, why: cacheEmpty ? "в кэше нет плановых пробежек" : "в кэше есть" };
    crit["6 тексты есть, ≥3 сессий, без ⚑"] = { ok: r.ok && r.built.sessions.length >= 3 && r.built.sessions.every((s) => s.description.trim().length > 0) && flags === 0, why: r.ok ? `сессий ${r.built.sessions.length}, пометок по тексту ${flags}` : "—" };
    const pass = Object.values(crit).every((c) => c.ok);
    rows.push({ aid: r.aid, name, r, crit, pass, minor });
  }
  // живое чтение календаря — только у тех, кто прошёл остальное (чтобы не нагружать TP лишним)
  for (const row of rows.filter((x) => x.pass)) {
    let n = 0; const seen: string[] = [];
    for (let d = 0; d < 7; d++) { const list = await live.listDay(row.aid, addDays(week, d)); n += list.length; seen.push(...list.map((x) => `${addDays(week, d)} «${x.title}»`)); }
    row.crit["5b у Игоря пусто (живое чтение TP)"] = { ok: n === 0, why: n === 0 ? "на 7 дней недели тренировок нет" : `есть ${n}: ${seen.join("; ")}` };
    row.pass = Object.values(row.crit).every((c) => c.ok);
  }
  const out: string[] = [];
  const p = (s = ""): void => { out.push(s); };
  p(`# Кандидаты на первую живую постановку — неделя ${week}`); p();
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.crit)))];
  p(`| атлет | ${keys.join(" | ")} | итог |`); p(`|---|${keys.map(() => "---").join("|")}|---|`);
  for (const r of rows) p(`| ${r.name} | ${keys.map((k) => (r.crit[k] ? `${r.crit[k].ok ? "да" : "**нет**"}: ${r.crit[k].why}` : "—")).join(" | ")} | ${r.pass ? "**ПОДХОДИТ**" : "нет"} |`);
  const good = rows.filter((r) => r.pass).sort((a, b) => a.minor - b.minor || ((b.r.ok ? ix.byAid.get(b.aid)?.length ?? 0 : 0) - (a.r.ok ? ix.byAid.get(a.aid)?.length ?? 0 : 0)));
  p(); p(`Подходят по всем критериям: ${good.length}.`);
  writeFileSync(path.join(OUT_DIR, "live-candidates.md"), out.join("\n") + "\n");
  console.log(out.join("\n"));
  if (good[0]?.r.ok) {
    const b = good[0].r.built;
    console.log(`\n\n===== ВЫБРАН: ${good[0].name} (${good[0].aid}) =====\n${b.source}\n${b.why}\n`);
    for (const s of b.sessions) console.log(`\n--- ${DAY_RU[s.dayIdx]} ${addDays(week, s.dayIdx)} · ${s.title} · ${s.minutes} мин [${s.kind}] · темп: ${s.paceMode}\n${s.description}`);
    console.log(`\nПометки (для Игоря, ученику не видны):`); for (const w of b.warnings) console.log(`  ${w}`);
  }
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
