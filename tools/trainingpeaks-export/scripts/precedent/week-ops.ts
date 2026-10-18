/**
 * РАСКИДАТЬ / ПУБЛИКУЙ / СНЕСТИ — рабочий процесс Игоря (15.10). ПО УМОЛЧАНИЮ СУХОЙ ПРОГОН.
 *
 *   raskidat  — собрать неделю «повтор + дельта» и (в реальном режиме) записать её СКРЫТОЙ от ученика;
 *   publikuy  — перечитать из TP, что тренер поменял, записать правки в coach_plan_edits и открыть
 *               ученику ЕГО текущую версию (удалённое не возвращается, наш черновик не восстанавливается);
 *   snesti    — удалить всё, что поставил прогон, по манифесту (и только его).
 *
 * Логика — в week-core.ts (клиент внедряется, проверено на подставном клиенте), сборка недели — assemble.ts.
 * Здесь: аргументы, ворота, манифест, живой клиент.
 *
 * СКРЫТИЕ ДОКАЗАНО вживую 15.10 (probe-hidden-via-client.ts, tp-api-client: isHidden принимается прямо в POST).
 * Реальная запись всё равно требует ВСЕГО сразу: --execute-real, точную фразу --confirm, TP_ACTIONS_REAL_EXECUTION=true,
 * атлеты только из группы 12, не больше MAX_REAL_ATHLETES (первая живая постановка — один человек), отчёт пробника с тремя PASS,
 * свежая выгрузка кэша. Любое расхождение при постановке — откат ВСЕЙ постановки.
 *
 * Запуск:
 *   npx tsx tools/trainingpeaks-export/scripts/precedent/week-ops.ts raskidat --week 2026-10-19 --athletes <id>
 *   npx tsx tools/trainingpeaks-export/scripts/precedent/week-ops.ts publikuy --run <runId> [--athletes id,id]
 *   npx tsx tools/trainingpeaks-export/scripts/precedent/week-ops.ts snesti --run <runId> [--include-published]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { DAY_RU } from "../lib/autoplanner-week.ts";
import { addDays, iso, mondayOf } from "./corpus.ts";
import { sbc } from "./dump-corpus.ts";
import { DATA_DIR, OUT_DIR } from "./load.ts";
import { assemble, GROUP12 } from "./assemble.ts";
import { liveClient } from "./tp-live-client.ts";
import { placeWeek, runPublikuy, runSnesti, type Item, type Manifest } from "./week-core.ts";

export { GROUP12 };
export const CONFIRM = { raskidat: "РАСКИДАТЬ СКРЫТО ГРУППЕ 12", publikuy: "ПУБЛИКУЙ", snesti: "СНЕСТИ ПРОГОН" } as const;
/** Первая живая постановка — ОДИН человек (решение Игоря 15.10). Поднимается отдельным решением. */
export const MAX_REAL_ATHLETES = 1;
/** Сухой ли это прогон: любые ворота закрыты → только чтение. Единственное место решения — его проверяют тесты. */
export const isDry = (gate: string | null): boolean => gate !== null;
/** Писать в TP можно, только если ворота ОТКРЫТЫ и есть что писать. */
export const mayPlace = (gate: string | null, nItems: number): boolean => gate === null && nItems > 0;
const RUNS = path.join(OUT_DIR, "runs");
const PROOF_DIR = "/Users/igor/igor-tp-reports-bot/reports/hidden-workout-proof";

function arg(name: string): string | null { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] ?? null : null; }
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

/** Доказано ли скрытие нашим путём: живой отчёт пробника с обоими PASS. */
export function hiddenProven(dir = PROOF_DIR): { ok: boolean; why: string } {
  if (!existsSync(dir)) return { ok: false, why: `нет каталога ${dir}` };
  for (const d of readdirSync(dir).sort().reverse()) {
    const f = path.join(dir, d, "summary.md"); if (!existsSync(f)) continue;
    const t = readFileSync(f, "utf8");
    // формат пробника: «- hidden_verify_pass: `true`». Якорь на начало строки обязателен: без него
    // «hidden_verify_pass» находится и внутри «unhidden_verify_pass» (поймано проверкой 15.10).
    // Доказательство засчитывается ТОЛЬКО от пробника на tp-api-client (тот же путь, что у «раскидать»), с тремя PASS:
    // скрыто, открыто, удалено. Старый Playwright-пробник путь «раскидать» не доказывает.
    const pass = (k: string): boolean => new RegExp(`^\\s*-?\\s*${k}:\\s*\`?true\`?\\s*$`, "m").test(t);
    if (/^\s*-\s*path:\s*`tp-api-client`\s*$/m.test(t) && pass("hidden_verify_pass") && pass("unhidden_verify_pass") && pass("deleted_verify_pass")) return { ok: true, why: f };
  }
  return { ok: false, why: "ни одного живого прогона probe-hidden-via-client.ts (path tp-api-client) с hidden/unhidden/deleted_verify_pass = true" };
}

export type GateInput = { executeReal: boolean; confirm: string | null; realEnv: string | undefined; proof: { ok: boolean; why: string }; corpusAgeMin: number };
/** Ворота реального режима: null — можно писать; иначе почему нельзя. Чистая функция. */
export function realGate(cmd: keyof typeof CONFIRM, aids: number[], g: GateInput): string | null {
  if (!g.executeReal) return "сухой прогон (нет --execute-real)";
  if (g.confirm !== CONFIRM[cmd]) return `нет точной фразы --confirm "${CONFIRM[cmd]}"`;
  if (g.realEnv !== "true") return "TP_ACTIONS_REAL_EXECUTION != true";
  const out = aids.filter((a) => !GROUP12.includes(a)); if (out.length) return `атлеты вне группы 12: ${out.join(", ")}`;
  if (cmd === "raskidat") {
    if (aids.length > MAX_REAL_ATHLETES) return `первая живая постановка — не больше ${MAX_REAL_ATHLETES} человека, запрошено ${aids.length} (укажи --athletes <id>)`;
    if (!g.proof.ok) return `скрытие не доказано: ${g.proof.why}`;
    // «неделя уже написана тренером» проверяется по выгрузке кэша — она обязана быть свежей
    if (g.corpusAgeMin > 60) return `выгрузка кэша старше часа (${Math.round(g.corpusAgeMin)} мин) — сначала dump-corpus.ts`;
  }
  return null;
}
const gateFromCli = (cmd: keyof typeof CONFIRM, aids: number[]): string | null => realGate(cmd, aids, {
  executeReal: flag("execute-real"), confirm: arg("confirm"), realEnv: process.env.TP_ACTIONS_REAL_EXECUTION,
  proof: cmd === "raskidat" ? hiddenProven() : { ok: true, why: "" },
  corpusAgeMin: (Date.now() - statSync(path.join(DATA_DIR, "corpus.json")).mtimeMs) / 60000,
});

const saveManifest = (m: Manifest): void => { mkdirSync(RUNS, { recursive: true }); writeFileSync(path.join(RUNS, `${m.runId}.json`), JSON.stringify(m, null, 2)); };
const readManifest = (id: string): Manifest => JSON.parse(readFileSync(path.join(RUNS, `${id}.json`), "utf8")) as Manifest;

async function raskidat(): Promise<void> {
  const week = arg("week") ?? addDays(mondayOf(iso(Date.now())), 7);
  const aids = (arg("athletes")?.split(",").map(Number) ?? GROUP12);
  const gate = gateFromCli("raskidat", aids);
  const { L, results } = await assemble(week, aids);
  const m: Manifest = { runId: `raskidat-${week}-${Date.now()}`, createdAt: new Date().toISOString(), mode: isDry(gate) ? "dry_run" : "real", week, items: [], refused: [], published: [], deleted: [] };
  for (const r of results) {
    if (!r.ok) { m.refused.push({ aid: r.aid, why: r.why }); continue; }
    for (const s of r.built.sessions) m.items.push({ aid: r.aid, date: addDays(week, s.dayIdx), dayIdx: s.dayIdx, title: s.title, minutes: s.minutes, description: s.description, structure: s.structure, warnings: r.built.warnings, source: r.built.source, why: r.built.why, workoutId: null, verified: false });
  }
  saveManifest(m);
  let placed: string[] = [];
  if (mayPlace(gate, m.items.length)) {
    const res = await placeWeek(await liveClient(), m, saveManifest);
    placed = res.lines;
    if (!res.ok) { console.error(`ПОСТАНОВКА ОСТАНОВЛЕНА: ${res.stopped}\nоткат: ${res.rolledBack === null ? "ничего не писалось" : res.rolledBack ? "выполнен, поставленное убрано и проверено" : "НЕ ПОЛНЫЙ, остались: " + res.leftover.join(", ")}`); process.exitCode = 1; }
  }
  report(m, gate, L.names, placed);
}

async function publikuy(): Promise<void> {
  const m = readManifest(arg("run") ?? "");
  const only = arg("athletes")?.split(",").map(Number) ?? null;
  const placedAids = [...new Set(m.items.filter((i) => i.workoutId != null && (!only || only.includes(i.aid))).map((i) => i.aid))];
  const gate = gateFromCli("publikuy", placedAids);
  const out: string[] = [`# Публикация прогона ${m.runId} — ${gate ? `СУХОЙ ПРОГОН (только чтение; ${gate})` : "РЕАЛЬНО"}`];
  if (m.mode !== "real" || placedAids.length === 0) {
    out.push("", `Прогон «раскидать» был сухим или ничего не поставил: перечитывать нечего. Сессий в черновике: ${m.items.length}.`);
    console.log(out.join("\n")); return;
  }
  const sb = sbc();
  const r = await runPublikuy(await liveClient(), m, {
    dryRun: isDry(gate), only, save: saveManifest,
    insertEdits: async (rows) => { const { error } = await sb.from("coach_plan_edits").insert(rows.map((e) => ({ run_id: m.runId, trainingpeaks_athlete_id: e.aid, week_start: e.weekStart, workout_date: e.date, trainingpeaks_workout_id: e.workoutId, field: e.field, before_value: e.before, after_value: e.after }))); if (error) throw error; },
  });
  out.push("", ...r.lines.map((l) => `- ${l}`));
  console.log(out.join("\n"));
}

async function snesti(): Promise<void> {
  const m = readManifest(arg("run") ?? "");
  const ids = m.items.filter((i) => i.workoutId != null && !m.deleted.includes(i.workoutId!));
  const gate = gateFromCli("snesti", [...new Set(ids.map((i) => i.aid))]);
  if (m.mode !== "real" || ids.length === 0) { console.log(`${gate ? "СУХОЙ ПРОГОН" : "ПРОГОН"} (${gate ?? "реально"}). Удалилось бы тренировок: ${ids.length} — ${m.mode !== "real" ? "прогон был сухим, ничего не ставил" : "нечего удалять"}.`); return; }
  const r = await runSnesti(await liveClient(), m, { dryRun: isDry(gate), includePublished: flag("include-published"), save: saveManifest });
  console.log([`${gate ? "СУХОЙ ПРОГОН (только чтение; " + gate + ")" : "РЕАЛЬНО"} — снос прогона ${m.runId}`, ...r.lines.map((l) => `- ${l}`), ...(r.changedByCoach.length ? ["", "Изменено тренером:", ...r.changedByCoach.map((l) => `- ${l}`)] : []), `итог: ${gate ? "будет удалено" : "удалено"} ${gate ? r.wouldDelete.length : r.deleted.length}; пропущено как открытые ученику ${r.skippedPublished.length}; ${r.ok ? "чужое не тронуто" : "ЧУЖОЕ ИЗМЕНИЛОСЬ"}`].join("\n"));
  if (!r.ok) process.exitCode = 1;
}

function report(m: Manifest, gate: string | null, names: Map<number, string>, placed: string[]): void {
  const out: string[] = [`# «Раскидать» ${m.week} — ${gate ? `СУХОЙ ПРОГОН: ${gate}` : "РЕАЛЬНО, скрыто"}`, "", `Манифест: ${path.join(RUNS, `${m.runId}.json`)}`];
  const byAid = new Map<number, Item[]>(); for (const i of m.items) (byAid.get(i.aid) ?? byAid.set(i.aid, []).get(i.aid)!).push(i);
  const weeksWarned = [...byAid.values()].filter((its) => its[0].warnings.length).length;
  const sessFlagged = m.items.filter((i) => i.warnings.some((w) => w.startsWith(`⚑ ${i.title}:`))).length;
  out.push(`${gate ? "Поставлено бы" : "Поставлено"}: ${byAid.size} атлетам, сессий ${m.items.length}. Недель с пометками валидатора: ${weeksWarned} из ${byAid.size}; сессий с пометкой по тексту/темпу: ${sessFlagged}. Отказано: ${m.refused.length}.`, "");
  out.push("| атлет | итог | сессий | мин | пометок |", "|---|---|---:|---:|---:|");
  for (const [aid, its] of byAid) out.push(`| ${names.get(aid) ?? aid} | поставить | ${its.length} | ${its.reduce((s, x) => s + x.minutes, 0)} | ${its[0].warnings.length} |`);
  for (const r of m.refused) out.push(`| ${names.get(r.aid) ?? r.aid} | ОТКАЗ: ${r.why} | — | — | — |`);
  for (const [aid, its] of byAid) {
    out.push("", `## ${names.get(aid) ?? aid}`);
    out.push(`_Откуда:_ ${its[0].source}`, `_Почему:_ ${its[0].why}`);
    for (const i of its) out.push(`- ${DAY_RU[i.dayIdx]} ${i.date} · ${i.title} · ${i.minutes} мин${i.workoutId ? ` · workoutId ${i.workoutId}` : ""}`);
    for (const w of its[0].warnings) out.push(`  - ${w}`);
  }
  if (placed.length) out.push("", "## Ход постановки (чтение после каждого шага)", ...placed.map((l) => `- ${l}`));
  writeFileSync(path.join(OUT_DIR, `${m.runId}.md`), out.join("\n") + "\n");
  console.log(out.slice(0, 8 + byAid.size + m.refused.length).join("\n"), placed.length ? "\n\nХод постановки:\n" + placed.map((l) => `- ${l}`).join("\n") : "");
}

if (process.argv[1]?.endsWith("week-ops.ts")) main();
function main(): void {
  const cmd = process.argv[2];
  const run = cmd === "raskidat" ? raskidat : cmd === "publikuy" ? publikuy : cmd === "snesti" ? snesti : null;
  if (!run) { console.error("команда: raskidat | publikuy | snesti"); process.exit(2); }
  run().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
}
