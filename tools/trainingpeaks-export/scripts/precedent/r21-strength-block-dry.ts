/**
 * R21 — сухой прогон блока «качественная в день силовой» (наряд 21.10). READ-ONLY: Supabase — select, TP — GET.
 * Две колонки: (а) контекст как есть (кэш; при выключенном TP_SCAN_STRENGTH силовых там нет);
 *              (б) силовые подставлены из живого календаря сервиса силовых TP — так увидит сборка после включения флага (скрытые тоже).
 * Запуск: tsx r21-strength-block-dry.ts --week 2026-10-26 --athletes 5478934,6685354
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadAthleteContexts } from "../lib/autoplanner-context.ts";
import { addDays, buildCorpus } from "./corpus.ts";
import { sbc } from "./dump-corpus.ts";
import { DATA_DIR, load } from "./load.ts";
import { indexCorpus, type Weights } from "./precedent.ts";
import { buildRepeatWeek, stateFor } from "./build-week.ts";
const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] ?? null : null; };
const week = arg("week") ?? "2026-10-26"; const aids = (arg("athletes") ?? "5478934,6685354").split(",").map(Number);
const L = load(); const ix = indexCorpus(buildCorpus(L.rows, L.races, L.sig, L.students, week)); const W = JSON.parse(readFileSync(path.join(DATA_DIR, "tuned-weights.json"), "utf8")) as Weights;
const ctx = await loadAthleteContexts(sbc(), week);
const tp = await import("../../../../src/features/trainingpeaks/tp-api-client.ts");
const DAY = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
for (const aid of aids) {
  const c = ctx.get(aid); if (!c) { console.log(`\n${aid}: нет контекста (не в ростере)`); continue; }
  const r = await tp.getTpApiJsonRaw("strength", `/rx/activity/v1/workouts/calendar/${aid}/${week}/${addDays(week, 6)}`);
  const live = (r.body as Array<Record<string, unknown>>).filter((x) => (x as { hasPrescribedData?: boolean }).hasPrescribedData !== false).map((x) => ({ date: String(x.prescribedDate).slice(0, 10), title: String(x.title), hidden: x.isHidden === true }));
  const t = stateFor(ix, aid, week, L.races.filter((x) => x.trainingpeaks_athlete_id === aid), c.hasActiveIllness);
  console.log(`\n══ ${aid}, неделя ${week} · силовые в кэше: ${(c.plannedStrength ?? []).map((x) => x.date).join(", ") || "нет"} · в TP: ${live.map((x) => `${x.date} «${x.title}»${x.hidden ? " (скрыта)" : ""}`).join(", ") || "нет"}`);
  for (const [label, cc] of [["(а) как есть", c], ["(б) с силовыми из TP", { ...c, plannedStrength: live.map(({ date, title }) => ({ date, title })), plannedStrengthDates: live.map((x) => x.date) }]] as const) {
    const b = buildRepeatWeek(ix, t, W, null, cc, L.names);
    if (!b) { console.log(`  ${label}: не из чего собрать`); continue; }
    const s = b.validator.find((x) => /силовой тренера/.test(x.name));
    console.log(`  ${label}: ${b.source.split(":")[0]} · ${b.sessions.map((x) => `${DAY[x.dayIdx]} ${x.kind === "quality" ? "КАЧ" : x.kind === "long" ? "длит" : "лёг"} ${x.minutes}`).join(", ")}`);
    console.log(`     правило силовых: ${s ? (s.ok ? "проверено — не нарушено" : "БЛОК — " + s.detail) : "не проверялось (силовых нет)"} · неделя ${b.refused ? "ОТКАЗАНА: " + b.refusedWhy : "выдаётся"}`);
  }
}
