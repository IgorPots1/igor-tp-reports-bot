/**
 * МУТАЦИОННЫЙ ПРОГОН check-repeat.ts — тот же приём, что tp-mutation-harness.ts для сборщика.
 * Каждая мутация портит ровно одно правило нового пути; проверки обязаны это заметить.
 * Файлы восстанавливаются в finally. Мутация, которую никто не заметил, роняет прогон (exit 1).
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/precedent/check-repeat-mutations.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = path.join(HERE, "repeat.ts"), P = path.join(HERE, "precedent.ts"), V = path.join(HERE, "validate.ts"), S = path.join(HERE, "..", "lib", "signal-closure.ts");
type M = { id: string; file: string; find: string; replace: string; what: string };
const MUT: M[] = [
  { id: "no-skip", file: R, find: "    if (!why || !SKIP_REASONS.has(why)) { base = own[i]; break; }", replace: "    if (true) { base = own[i]; break; }", what: "ненормальная неделя снова берётся формой" },
  { id: "no-post-factor", file: R, find: "  if (postRace && APPLY_POST_FACTOR) {", replace: "  if (false) {", what: "после старта неделя не снижается" },
  { id: "quality-scaled", file: R, find: "    minutes: s.kind === \"quality\" ? s.minutes : round5(s.minutes * delta),", replace: "    minutes: round5(s.minutes * delta),", what: "дельта масштабирует и качественную" },
  { id: "no-clamp", file: R, find: "  delta = Math.min(DELTA_MAX, Math.max(DELTA_MIN, delta));", replace: "", what: "дельта не зажата" },
  { id: "race-repeat", file: R, find: "  if (t.phase === \"race\") return { kind: \"precedent\", why: \"неделя старта\" };", replace: "", what: "неделю старта повторяем, а не берём прецедент" },
  { id: "gap-repeat", file: R, find: "  if (gap >= RETURN_GAP_WEEKS)", replace: "  if (false && gap >= RETURN_GAP_WEEKS)", what: "после паузы повторяем неделю до паузы" },
  { id: "no-drop-day", file: R, find: "  if (delta < DROP_DAY_BELOW) {", replace: "  if (false) {", what: "глубокая разгрузка не снимает день" },
  { id: "no-align", file: P, find: "    const shift = t.raceDayIdx - p.raceDayIdx;", replace: "    const shift = 0;", what: "неделя старта не выравнивается по дню гонки" },
  { id: "no-ban", file: P, find: "    if (off >= 1 && off <= PRE_RACE_DAYS && heavyBeforeRace(s)) {", replace: "    if (false) {", what: "тяжёлое перед стартом не снимается" },
  { id: "ban-1day", file: V, find: "export const PRE_RACE_DAYS = 2;", replace: "export const PRE_RACE_DAYS = 1;", what: "запрет только на один день" },
  { id: "activation-100", file: V, find: "export const PRE_RACE_ACTIVATION_MAX_MIN = 40;", replace: "export const PRE_RACE_ACTIVATION_MAX_MIN = 100;", what: "«короткая активация» до 100 мин" },
  { id: "race-warn", file: V, find: "bad.map((s) => `${s.title} ${s.minutes} мин`).join(\"; \"), \"hard\");", replace: "bad.map((s) => `${s.title} ${s.minutes} мин`).join(\"; \"), \"warn\");", what: "предстартовый запрет понижен до предупреждения" },
  { id: "cap-hard", file: V, find: "l.every((x) => x.minutes <= o.windowCaps!.long!), `потолок ${o.windowCaps.long}`);", replace: "l.every((x) => x.minutes <= o.windowCaps!.long!), `потолок ${o.windowCaps.long}`, \"hard\");", what: "потолок длительной снова жёсткий" },
  { id: "easy-floor-10", file: V, find: "export const HARD_EASY_MIN = 20;", replace: "export const HARD_EASY_MIN = 10;", what: "жёсткий пол лёгкой 10 мин" },
  { id: "sig-no-race", file: S, find: "  if (raced.length) return", replace: "  if (false) return", what: "прошедший старт сигнал не закрывает" },
  { id: "sig-ttl-7", file: S, find: "pain_injury: 24,", replace: "pain_injury: 7,", what: "срок pain_injury 7 вместо 24" },
  { id: "sig-window-race", file: S, find: "  if (race && race < to) to = race;", replace: "", what: "окно сигнала не обрывается стартом" },
];

const run = (): string[] => {
  try { execFileSync(process.execPath, [...process.execArgv, path.join(HERE, "check-repeat.ts")], { encoding: "utf8", stdio: "pipe" }); return []; }
  catch (e) { const out = String((e as { stdout?: string }).stdout ?? ""); return out.split("\n").filter((l) => l.includes("FAIL")).map((l) => l.replace(/^\s*FAIL\s+/, "").split("  —")[0]); }
};
let survivors = 0;
for (const m of MUT) {
  const orig = readFileSync(m.file, "utf8");
  if (!orig.includes(m.find)) { console.log(`  ?  ${m.id.padEnd(16)} НЕ ПРИМЕНИЛАСЬ — строка не найдена (каталог отстал от кода)`); survivors++; continue; }
  try { writeFileSync(m.file, orig.replace(m.find, m.replace)); const f = run(); if (f.length === 0) survivors++;
    console.log(`  ${f.length ? "✓" : "✗"}  ${m.id.padEnd(16)} ${f.length ? `уронила ${f.length}` : "НИКТО НЕ ЗАМЕТИЛ"} · ${m.what}${f.length ? ` (${f[0].slice(0, 70)})` : ""}`); }
  finally { writeFileSync(m.file, orig); }
}
console.log(`\nИТОГ: ${MUT.length - survivors} из ${MUT.length} мутаций пойманы${survivors ? `, НЕ ПОЙМАНО ${survivors}` : ""}`);
process.exit(survivors ? 1 : 0);
