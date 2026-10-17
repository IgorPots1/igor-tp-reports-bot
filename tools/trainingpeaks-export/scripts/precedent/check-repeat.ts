/**
 * check-repeat — ПРОВЕРКИ НОВОГО ПУТИ «повтор + дельта». Без базы, без TP: синтетические недели.
 *
 * 137 проверок tp-cycle-forecast-check работают на заглушках buildWeek и этот путь не задевают.
 * Здесь — его собственные утверждения; мутационно подтверждены check-repeat-mutations.ts.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/precedent/check-repeat.ts
 */
import process from "node:process";
import { addDays, buildCorpus, type CWeek, type RawRow, type Race } from "./corpus.ts";
import { adapt, enforcePreRace, findPrecedent, indexCorpus, type PSess, type Weights } from "./precedent.ts";
import { QUALITY_SHARE_MIN, donorExcluded, isPeak, planRepeat, recoveryFactor, setRepeatParams, PEAK_RATIO, SKIP_REASONS, RECOVERY_ON, LOOKBACK_WEEKS } from "./repeat.ts";
import { plainTemplate, postRaceAdjust, setRecovery } from "./post-race.ts";
import { substituteDonorStyle } from "./donor-style.ts";
import { recent, LEVEL_MAX_RATIO, MAX_GAP_WEEKS, MIN_RECENT_WEEKS } from "./recent-level.ts";
import { validateWeek, type VSess } from "./validate.ts";
import { signalWindow, staleReason } from "../lib/signal-closure.ts";
import { addedByCoach, diffPlaced, toPublish, type Placed } from "./plan-edits.ts";
import { buildRepeatWeek, selectDonor, useExplicitParams } from "./build-week.ts";
import { runProbeCycle } from "./hidden-flow.ts";
import { hasQualityContent } from "./validate.ts";
import { fakeClient, probeBody, probeGate, PROBE_ATHLETE_ID, PROBE_CONFIRM } from "./probe-hidden-via-client.ts";
import { placeWeek, runPublikuy, runSnesti, verifyPlaced, type Manifest } from "./week-core.ts";
import { CONFIRM, GROUP12, MAX_REAL_ATHLETES, hiddenProven, isDry, mayPlace, realGate } from "./week-ops.ts";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let failures = 0, total = 0;
function check(name: string, ok: boolean, detail = ""): void { total++; if (!ok) failures++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `  — ${detail}`}`); }

// ── синтетический корпус ──
let wid = 1;
type S = { d: number; t: string; m: number };
const EASY = "Легкий бег по темпу", LONG = "Длительный бег по темпу", Q = "6 х 4 мин";
const DESC = "50 минут в темпе 06:50-07:13 Ровно.";
function weekRows(aid: number, monday: string, ss: S[]): RawRow[] {
  return ss.map((s) => ({ trainingpeaks_athlete_id: aid, trainingpeaks_workout_id: wid++, student_name: null, workout_date: addDays(monday, s.d), title: s.t, workout_type_value_id: 3,
    planned_time_raw: s.m / 60, planned_distance_raw: null, is_completed: false, completed_time_raw: null, order_on_day: 1, src: DESC, struct: null, cc: null }));
}
const NORMAL: S[] = [{ d: 1, t: EASY, m: 50 }, { d: 3, t: Q, m: 60 }, { d: 4, t: EASY, m: 50 }, { d: 6, t: LONG, m: 100 }]; // 260
const DIP: S[] = [{ d: 1, t: EASY, m: 40 }, { d: 6, t: EASY, m: 38 }]; // 78 — «Столова»
const M0 = "2026-06-01";
const wk = (k: number): string => addDays(M0, 7 * k);
const rows: RawRow[] = []; const races: Race[] = [];
// атлет 1: 6 нормальных недель, потом провал → целевая неделя 8
for (let k = 0; k < 6; k++) rows.push(...weekRows(1, wk(k), NORMAL));
rows.push(...weekRows(1, wk(6), DIP));
rows.push(...weekRows(1, wk(7), NORMAL)); // целевая (её не видим)
// атлет 2: 6 нормальных, старт в вс недели 6, целевая — неделя 7 (после старта)
for (let k = 0; k < 6; k++) rows.push(...weekRows(2, wk(k), NORMAL));
rows.push(...weekRows(2, wk(6), [{ d: 1, t: EASY, m: 40 }, { d: 3, t: EASY, m: 30 }, { d: 6, t: "Марафон", m: 240 }]));
rows.push(...weekRows(2, wk(7), NORMAL));
races.push({ trainingpeaks_athlete_id: 2, event_date: addDays(wk(6), 6), distance_km: 42.2, distance_raw: null });
// атлет 3 (прецедент старта): старт в СБ недели 5, накануне — тяжёлое
for (let k = 0; k < 5; k++) rows.push(...weekRows(3, wk(k), NORMAL));
rows.push(...weekRows(3, wk(5), [{ d: 1, t: EASY, m: 50 }, { d: 3, t: "Бег в марафонском темпе", m: 60 }, { d: 4, t: LONG, m: 60 }, { d: 5, t: "Забег", m: 230 }]));
races.push({ trainingpeaks_athlete_id: 3, event_date: addDays(wk(5), 5), distance_km: 42.2, distance_raw: null });
// атлет 4: старт в ВС недели 8, история как у 3 — прецедент недели старта
for (let k = 0; k < 8; k++) rows.push(...weekRows(4, wk(k), NORMAL));
rows.push(...weekRows(4, wk(8), [{ d: 1, t: EASY, m: 40 }, { d: 6, t: "Марафон", m: 240 }]));
races.push({ trainingpeaks_athlete_id: 4, event_date: addDays(wk(8), 6), distance_km: 42.2, distance_raw: null });
// атлет 5: пауза 3 недели
for (let k = 0; k < 4; k++) rows.push(...weekRows(5, wk(k), NORMAL));
rows.push(...weekRows(5, wk(7), NORMAL));

// атлеты 7 и 8: проходной старт (10 км в пн следующей недели) — у 7 позже есть марафон (главный), у 8 только эта десятка (главный)
for (const aid of [7, 8]) { for (let k = 0; k < 6; k++) rows.push(...weekRows(aid, wk(k), [{ d: 1, t: EASY, m: 50 }, { d: 3, t: Q, m: 60 }, { d: 4, t: EASY, m: 50 }, { d: 6, t: LONG, m: 100 }])); races.push({ trainingpeaks_athlete_id: aid, event_date: wk(6), distance_km: 10, distance_raw: null }); }
// марафон через 3 недели после десятки: десятка — проходной старт на пути к марафону (за 19+ недель она сама была бы целью цикла)
races.push({ trainingpeaks_athlete_id: 7, event_date: addDays(wk(9), 6), distance_km: 42.2, distance_raw: null });

// атлеты 10 и 11: в образцовых неделях длительная «24 км в темпе марафона» (как у Богачёва — ярлык «длительная», по сути работа).
// 10 — марафон (42.2 км) в вс недели 6, 11 — половинка (21.1 км) там же. Целевые недели 7 (+1), 8 (+2), 9 (+3).
const MP: S[] = [{ d: 1, t: EASY, m: 50 }, { d: 3, t: EASY, m: 50 }, { d: 6, t: "24 км в темпе марафона", m: 170 }];
for (const [aid, km] of [[10, 42.2], [11, 21.1]] as const) {
  for (let k = 0; k < 6; k++) rows.push(...weekRows(aid, wk(k), MP));
  rows.push(...weekRows(aid, wk(6), [{ d: 1, t: EASY, m: 40 }, { d: 6, t: "Забег", m: 240 }]));
  for (const k of [7, 8, 9]) rows.push(...weekRows(aid, wk(k), [{ d: 1, t: EASY, m: 40 }, { d: 3, t: EASY, m: 40 }, { d: 6, t: EASY, m: 60 }]));
  races.push({ trainingpeaks_athlete_id: aid, event_date: addDays(wk(6), 6), distance_km: km, distance_raw: null });
}
for (const k of [10, 11, 12, 13, 14]) rows.push(...weekRows(10, wk(k), [{ d: 1, t: EASY, m: 40 }, { d: 3, t: EASY, m: 40 }, { d: 6, t: EASY, m: 60 }]));
// атлет 16: марафон в вс недели 6, потом пауза две недели (нет недель 7 и 8) и целевая неделя 9 = +3 после марафона — ветка ПРЕЦЕДЕНТА
for (let k = 0; k < 6; k++) rows.push(...weekRows(16, wk(k), MP));
rows.push(...weekRows(16, wk(6), [{ d: 1, t: EASY, m: 40 }, { d: 6, t: "Забег", m: 240 }]), ...weekRows(16, wk(9), [{ d: 1, t: EASY, m: 40 }]));
races.push({ trainingpeaks_athlete_id: 16, event_date: addDays(wk(6), 6), distance_km: 42.2, distance_raw: null });
// атлет 18: две недели истории и сразу неделя старта — прецедент невозможен без истории
for (let k = 0; k < 2; k++) rows.push(...weekRows(18, wk(k), NORMAL));
rows.push(...weekRows(18, wk(2), [{ d: 1, t: EASY, m: 40 }, { d: 6, t: "Забег", m: 200 }]));
races.push({ trainingpeaks_athlete_id: 18, event_date: addDays(wk(2), 6), distance_km: 10, distance_raw: null });
// атлеты 21 и 22: донор в стиле «по пульсу» и цель в стиле «по темпу» с двумя видами лёгкой (40 и 90 мин)
const PUL: S[] = [{ d: 1, t: "Легкий бег по пульсу", m: 50 }, { d: 3, t: Q, m: 60 }, { d: 4, t: "Легкий бег по пульсу", m: 85 }, { d: 6, t: "Длительный бег по пульсу", m: 100 }];
const TMP: S[] = [{ d: 1, t: "Лёгкий кросс", m: 40 }, { d: 3, t: Q, m: 60 }, { d: 4, t: "Легкий бег по темпу", m: 90 }, { d: 6, t: "Длительный бег по темпу", m: 100 }];
for (let k = 0; k < 6; k++) { rows.push(...weekRows(21, wk(k), PUL)); rows.push(...weekRows(22, wk(k), TMP)); }
rows.push(...weekRows(22, wk(6), TMP));
// атлет 23: в истории есть отдельные тренировки «Разминка» (23 мин) рядом с обычными лёгкими — в шаблоны они не годятся
const WU: S[] = [{ d: 1, t: "Разминка", m: 25 }, { d: 2, t: "Легкий бег по темпу", m: 50 }, { d: 4, t: "Легкий бег по темпу", m: 45 }, { d: 6, t: "Длительный бег по темпу", m: 100 }];
for (let k = 0; k < 6; k++) rows.push(...weekRows(23, wk(k), WU));
rows.push(...weekRows(23, wk(6), WU));
// атлет 12: пиковая неделя (400 при медиане 260) прямо перед целевой
for (let k = 0; k < 6; k++) rows.push(...weekRows(12, wk(k), NORMAL));
rows.push(...weekRows(12, wk(6), [{ d: 1, t: EASY, m: 80 }, { d: 3, t: Q, m: 60 }, { d: 4, t: EASY, m: 80 }, { d: 6, t: LONG, m: 180 }]));
rows.push(...weekRows(12, wk(7), NORMAL));
// атлет 13: четыре недели истории и пауза 5 недель; атлет 14: всего две недели истории
for (let k = 0; k < 4; k++) rows.push(...weekRows(13, wk(k), NORMAL));
rows.push(...weekRows(13, wk(9), NORMAL));
for (let k = 0; k < 2; k++) rows.push(...weekRows(14, wk(k), NORMAL));
rows.push(...weekRows(14, wk(2), NORMAL));

// атлет 15: после марафона подряд шесть не-образцов (подводка 2, старт, +1…+3), обычная неделя — седьмая назад: окно 6 её не видит
for (let k = 0; k < 8; k++) rows.push(...weekRows(15, wk(k), NORMAL));
rows.push(...weekRows(15, wk(8), [{ d: 1, t: EASY, m: 40 }, { d: 3, t: EASY, m: 40 }]), ...weekRows(15, wk(9), [{ d: 1, t: EASY, m: 40 }, { d: 6, t: "Марафон", m: 240 }]));
for (const k of [10, 11, 12]) rows.push(...weekRows(15, wk(k), [{ d: 1, t: EASY, m: 30 }, { d: 3, t: EASY, m: 30 }]));
rows.push(...weekRows(15, wk(13), NORMAL));
races.push({ trainingpeaks_athlete_id: 15, event_date: addDays(wk(9), 6), distance_km: 42.2, distance_raw: null });

// КАЧЕСТВО ПО ПРАКТИКЕ (17.10): образец качества не содержит. Атлет 31: качество в 7 из 8 недель, образец (последняя) — без него; 32: качество в 3 из 8.
const NOQ: S[] = [{ d: 1, t: EASY, m: 50 }, { d: 3, t: EASY, m: 60 }, { d: 4, t: EASY, m: 50 }, { d: 6, t: LONG, m: 100 }]; // 260 без качества
for (const aid of [31, 33]) { for (let k = 0; k < 7; k++) rows.push(...weekRows(aid, wk(k), NORMAL)); rows.push(...weekRows(aid, wk(7), NOQ), ...weekRows(aid, wk(8), NOQ)); }
// 34: тот же 7/8, но в образце на его привычный день качества (3) лёгкой нет — качество встаёт на ПРИВЫЧНЫЙ день, заменяя ближайшую лёгкую
const NOQ2: S[] = [{ d: 1, t: EASY, m: 50 }, { d: 4, t: EASY, m: 60 }, { d: 5, t: EASY, m: 50 }, { d: 6, t: LONG, m: 100 }];
for (let k = 0; k < 7; k++) rows.push(...weekRows(34, wk(k), NORMAL)); rows.push(...weekRows(34, wk(7), NOQ2), ...weekRows(34, wk(8), NOQ2));
for (let k = 0; k < 8; k++) rows.push(...weekRows(32, wk(k), k % 8 < 3 ? NORMAL : NOQ));
rows.push(...weekRows(32, wk(8), NOQ));

const corpus = buildCorpus(rows, races, [], [], "2027-01-01");
const ix = indexCorpus(corpus);
const T = (aid: number, k: number): CWeek => corpus.find((w) => w.aid === aid && w.weekStart === wk(k))!;
const hasQ = (s: { kind: string; title: string; src?: { desc?: string } }): boolean => hasQualityContent({ kind: s.kind, title: s.title, description: s.src?.desc ?? "" });
const total_ = (ss: PSess[]): number => ss.reduce((s, x) => s + x.minutes, 0);
const W8: Weights = { phase: 2.5, dist: 1.4, vol: 0.9, prev: 0.5, prevDays: 0.2, prevQ: 0.2, ill: 0.3, post: 0.3, gap: 1.8, own: 0.6, recency: 0.7 };
// БОЕВЫЕ УМОЛЧАНИЯ снимаются ДО того, как проверки зададут свои значения: именно они работают в «раскидать».
const PROD = { lookback: LOOKBACK_WEEKS, peak: PEAK_RATIO, skip: [...SKIP_REASONS].sort().join(), recovery: RECOVERY_ON, qs: QUALITY_SHARE_MIN };
setRepeatParams({ normal: 0.6, gap: 2, skip: ["старт", "после старта", "подводка", "пик", "провал объёма"], peak: 1.5, recovery: true });
useExplicitParams();

console.log("\n── форма: защита от наследования ──");
{
  const p = planRepeat(ix, T(1, 7), null);
  check("провальная неделя (78 мин при обычных 260) формой НЕ берётся — берётся прошлая нормальная",
    p.kind === "repeat" && p.base.weekStart === wk(5) && total_(p.sessions) === 260, JSON.stringify(p.kind === "repeat" ? { base: p.base.weekStart, t: total_(p.sessions) } : p));
  check("пропуск провала назван причиной", p.kind === "repeat" && p.skipped.some((s) => s.why === "провал объёма"));
}
{
  const p = planRepeat(ix, T(2, 7), null);
  // ПЕРЕПИСАНО 15.10 (правило 6a). Было: «форма — неделя ДО старта (wk5), пропущена только неделя старта».
  // Отменено решением Игоря: предстартовая неделя перед главным стартом — не образец (подводка). Теперь
  // пропущены старт И обе недели подводки (wk4, wk5), образцом служит последняя обычная (wk3).
  check("неделя после старта: форма — последняя ОБЫЧНАЯ неделя до подводки; старт и обе недели подводки пропущены",
    p.kind === "repeat" && p.base.weekStart === wk(3) && p.skipped.some((s) => s.why === "старт") && p.skipped.filter((s) => s.why === "подводка").length === 2,
    JSON.stringify(p.kind === "repeat" ? { base: p.base.weekStart, skipped: p.skipped } : p));
  // ПЕРЕПИСАНО 15.10 (правило 6a). Было: «неделя после старта ×0.67, одна лёгкая снята, качественная не масштабируется».
  // Отменено решением Игоря: единый ×0.67 был усреднением. После МАРАФОНА неделя +1 = ×0.39 (замер по его неделям), и КАЧЕСТВА
  // на ней нет вовсе (оно заменяется его же обычной лёгкой). Новое утверждение сильнее: и множитель по таблице, и отсутствие качества.
  check("1-я неделя после марафона: ×0.39 по таблице (не ×0.67), качества нет, качественная заменена его обычной лёгкой",
    p.kind === "repeat" && p.delta === 0.39 && !p.sessions.some((s) => s.kind === "quality") && p.sessions.length === 3
      && p.sessions.every((s) => s.minutes <= 40) && p.deltaWhy.includes("качество снято"),
    JSON.stringify(p.kind === "repeat" ? { d: p.delta, s: p.sessions.map((s) => [s.kind, s.title, s.minutes]), why: p.deltaWhy } : p));
}

console.log("\n── дельта цикла: объём меняется, форма нет ──");
{
  const base = planRepeat(ix, T(1, 5), null);
  const grow = planRepeat(ix, T(1, 5), { role: "рост", target: 330, base: 300 });
  check("рост ×1.1: лёгкие и длительная растут, качественная та же, дни те же",
    base.kind === "repeat" && grow.kind === "repeat" && grow.delta === 1.1
      && grow.sessions.map((s) => s.dayIdx).join() === base.sessions.map((s) => s.dayIdx).join()
      && grow.sessions.find((s) => s.kind === "quality")!.minutes === 60
      && grow.sessions.find((s) => s.kind === "long")!.minutes > base.sessions.find((s) => s.kind === "long")!.minutes,
    JSON.stringify(grow.kind === "repeat" ? grow.sessions.map((s) => [s.dayIdx, s.kind, s.minutes]) : grow));
  const deload = planRepeat(ix, T(1, 5), { role: "плановая разгрузка", target: 210, base: 300 });
  check("разгрузка ×0.7: убрана самая короткая лёгкая, день качества и длительной на месте",
    deload.kind === "repeat" && deload.sessions.length === 3 && deload.sessions.some((s) => s.kind === "quality" && s.dayIdx === 3) && deload.sessions.some((s) => s.kind === "long" && s.dayIdx === 6),
    JSON.stringify(deload.kind === "repeat" ? deload.sessions.map((s) => [s.dayIdx, s.kind, s.minutes]) : deload));
  const wild = planRepeat(ix, T(1, 5), { role: "рост", target: 900, base: 300 });
  check("дельта зажата сверху 1.25 (цикл не разгоняет неделю втрое)", wild.kind === "repeat" && wild.delta === 1.25, String(wild.kind === "repeat" && wild.delta));
}

console.log("\n── прецедент: только когда повторять нечего ──");
check("пауза 3 недели → прецедент, а не повтор недели до паузы", planRepeat(ix, T(5, 7), null).kind === "precedent");
check("неделя старта → прецедент", planRepeat(ix, T(4, 8), null).kind === "precedent");
check("обычная неделя → повтор", planRepeat(ix, T(1, 5), null).kind === "repeat");

console.log("\n── день гонки: выравнивание и запрет ──");
{
  const t = T(4, 8);
  const f = findPrecedent(ix, t, W8, "others");
  const a = f ? adapt(ix, t, f) : null;
  check("прецедент недели старта взят у атлета со стартом (сб) и выровнен на старт цели (вс): сдвиг +1",
    !!f && f.p.aid === 3 && !!a && a.dayMap.includes("сдвиг +1"), `${f?.p.aid} ${a?.dayMap}`);
  check("за 1–2 дня до старта в выровненной неделе нет ничего тяжелее короткой активации",
    !!a && a.sessions.every((s) => { const off = 6 - s.dayIdx; return !(off >= 1 && off <= 2) || (s.kind === "easy" && s.minutes <= 40); }),
    JSON.stringify(a?.sessions.map((s) => [s.dayIdx, s.kind, s.title, s.minutes])));
  check("день самого старта прецедентом не занят", !!a && a.sessions.every((s) => s.dayIdx !== 6));
  const ss: PSess[] = [{ dayIdx: 5, kind: "long", title: "Длительный", minutes: 90, work: 0, src: corpus[0].sessions[0] }, { dayIdx: 3, kind: "easy", title: "Лёгкий", minutes: 50, work: 0, src: corpus[0].sessions[0] }];
  const removed = enforcePreRace(ss, 6);
  check("запрет снимает длительную накануне старта, лёгкую за три дня не трогает", removed.length === 1 && ss.length === 1 && ss[0].dayIdx === 3, JSON.stringify(removed));
  const sat: PSess[] = [{ dayIdx: 6, kind: "quality", title: "6 х 4", minutes: 60, work: 24, src: corpus[0].sessions[0] }];
  const act40: PSess[] = [{ dayIdx: 5, kind: "long", title: "Лёгкий", minutes: 40, work: 0, src: corpus[0].sessions[0] }];
  check("40 мин, названная «длительной» только потому, что самая длинная в неделе, — это активация, не снимается", enforcePreRace(act40, 6).length === 0 && act40.length === 1);
  const act45: PSess[] = [{ dayIdx: 5, kind: "easy", title: "Лёгкий", minutes: 45, work: 0, src: corpus[0].sessions[0] }];
  check("45 мин за день до старта — уже не активация, снимается", enforcePreRace(act45, 6).length === 1 && act45.length === 0);
  check("старт в понедельник следующей недели: воскресная работа снимается", enforcePreRace(sat, 7).length === 1 && sat.length === 0);
}

console.log("\n── валидатор: жёсткое против предупреждения ──");
{
  const v = (ss: VSess[], o = {}): ReturnType<typeof validateWeek> => validateWeek(ss, null, { hasActiveIllness: false, checkText: false, ...o });
  const wk1: VSess[] = [{ dayIdx: 1, kind: "easy", title: "л", minutes: 50, work: 0, description: "" }, { dayIdx: 6, kind: "long", title: "д", minutes: 180, work: 0, description: "" }];
  const capRes = v(wk1, { windowCaps: { weekly: 150, long: 115 } });
  check("потолки — предупреждение: длительная 180 при потолке 115 не делает неделю отказной",
    capRes.some((r) => !r.ok && r.severity === "warn" && r.name.includes("длительная")) && !capRes.some((r) => !r.ok && r.severity === "hard"));
  const preRace = v([{ dayIdx: 5, kind: "long", title: "д", minutes: 90, work: 0, description: "" }], { raceDayIdx: 6 });
  check("тяжёлое накануне старта — ЖЁСТКО", preRace.some((r) => !r.ok && r.severity === "hard" && r.name.includes("до старта")));
  const shortAct = v([{ dayIdx: 5, kind: "easy", title: "л", minutes: 30, work: 0, description: "" }], { raceDayIdx: 6 });
  check("короткая активация накануне старта — допустима", !shortAct.some((r) => !r.ok && r.severity === "hard"));
  check("лёгкая 15 мин — ЖЁСТКО", v([{ dayIdx: 1, kind: "easy", title: "л", minutes: 15, work: 0, description: "" }]).some((r) => !r.ok && r.severity === "hard"));
  check("доля работы 0.9 — ЖЁСТКО", v([{ dayIdx: 1, kind: "quality", title: "q", minutes: 50, work: 45, description: "" }]).some((r) => !r.ok && r.severity === "hard"));
  check("скачок 2.5× обычного — ЖЁСТКО, 1.5× — нет",
    v(wk1, { normalLevel: 90 }).some((r) => !r.ok && r.severity === "hard" && r.name.includes("обычного")) && !v(wk1, { normalLevel: 160 }).some((r) => !r.ok && r.severity === "hard"));
}

console.log("\n── сигналы: закрытие для планирования ──");
{
  check("старт после начала сигнала — сигнал протух", staleReason({ type: "pain_injury", start: "2026-09-01", validUntil: null, races: ["2026-09-20"], today: "2026-10-01" })?.startsWith("старт") === true);
  check("старт ДО сигнала его не закрывает", staleReason({ type: "pain_injury", start: "2026-09-25", validUntil: null, races: ["2026-09-20"], today: "2026-10-01" }) === null);
  check("pain_injury без даты живёт 24 дня, на 25-й протух",
    staleReason({ type: "pain_injury", start: "2026-09-01", validUntil: null, races: [], today: "2026-09-25" }) === null
      && staleReason({ type: "pain_injury", start: "2026-09-01", validUntil: null, races: [], today: "2026-09-26" })?.startsWith("срок") === true);
  const w = signalWindow({ type: "pain_injury", start: "2026-09-01", validUntil: null, resolvedAt: null, races: ["2026-09-10"] });
  check("окно сигнала для плана обрывается днём старта", w.to === "2026-09-10", JSON.stringify(w));
}

console.log("\n── главный старт против проходного ──");
{
  check("десятка при марафоне позже — проходной (длинная дистанция бьёт короткую)", T(7, 5).nextRaceIsMain === false, String(T(7, 5).nextRaceIsMain));
  check("единственная десятка в горизонте цикла — главный", T(8, 5).nextRaceIsMain === true);
  check("марафон — главный", T(4, 8).nextRaceIsMain === true);
  const heavySun = (p: ReturnType<typeof planRepeat>): boolean => p.kind === "repeat" && p.sessions.some((s) => s.dayIdx === 6);
  check("перед ПРОХОДНЫМ стартом (пн) воскресная длительная остаётся: запрет не применяется", heavySun(planRepeat(ix, T(7, 5), null)));
  check("перед ГЛАВНЫМ стартом (пн) воскресная длительная снимается", !heavySun(planRepeat(ix, T(8, 5), null)));
  check("предстартовая неделя перед главным стартом — не образец (подводка)", planRepeat(ix, T(8, 5), null).kind === "repeat" && (planRepeat(ix, T(8, 5), null) as { skipped: Array<{ why: string }> }).skipped.some((x) => x.why === "подводка"));
  check("предстартовая неделя перед проходным стартом — образец (подводка не пропускается)", planRepeat(ix, T(7, 5), null).kind === "repeat" && !(planRepeat(ix, T(7, 5), null) as { skipped: Array<{ why: string }> }).skipped.some((x) => x.why === "подводка"));
}

console.log("\n── шаблонные названия и восстановление после марафона ──");
{
  const samp = buildCorpus([...weekRows(9, wk(0), [{ d: 1, t: "Long Run - Sample Workout", m: 60 }, { d: 3, t: EASY, m: 50 }])], [], [], [], "2027-01-01");
  check("шаблонная английская «Sample Workout» не попадает в корпус как тренировка Игоря", samp.length === 1 && samp[0].sessions.length === 1 && samp[0].sessions[0].title === EASY, JSON.stringify(samp[0]?.sessions.map((s) => s.title)));
  const b = buildRepeatWeek(ix, T(2, 7), W8, null, undefined, new Map());
  // ПЕРЕПИСАНО 15.10 (правило 6a). Было: «1-я неделя после марафона: тренер получает ПРЕДУПРЕЖДЕНИЕ с долей 0.39» — неделя
  // собиралась как обычная, а тренеру предлагали заметить. Отменено: теперь неделя собирается уже сниженной, без качества, и ЖЁСТКАЯ
  // проверка гарантирует, что качества не осталось. Новое утверждение: сниженная неделя выдаётся, причина восстановления названа,
  // жёсткая проверка «без качества» в ней есть и пройдена.
  check("1-я неделя после марафона: неделя выдана сниженной, жёсткая проверка «без качества» есть и пройдена",
    !!b && !b.refused && b.why.includes("восстановление") && b.validator.some((v) => v.severity === "hard" && v.ok && v.name.includes("после марафона")), JSON.stringify(b?.validator.filter((v) => v.name.includes("марафон"))));
  const none = buildRepeatWeek(ix, T(1, 7), W8, null, undefined, new Map());
  check("обычная неделя: предупреждения про восстановление нет", !!none && !none.warnings.some((w) => w.includes("после старта на")));
}

console.log("\n── восстановление после старта по дистанции и неделе ──");
{
  // ПЕРЕПИСАНО 15.10 (правило 6a). Было: таблица по ВСЕМУ корпусу (марафон 0.39/0.75/0.81 до +3; половинка 0.76/0.99/0.99; до 15 км
  // 0.86/1/1). Отменено решением Игоря: продлить до +7 и взять ОБУЧАЮЩИЕ числа, если полный корпус с ними сильно расходится
  // (r9-recovery.ts: до 0.19 по марафону, до 0.24 по коротким). Новые утверждения: точные обучающие значения, длина строки по
  // дистанции и то, что за краем строки множителя нет.
  const row = (km: number, n: number): string => Array.from({ length: n }, (_, i) => recoveryFactor(km, i + 1)).join();
  check("таблица (обучающая): марафон +1…+7 = 0.39 / 0.71 / 0.77 / 0.81 / 0.82 / 0.82 / 0.94", row(42.2, 7) === "0.39,0.71,0.77,0.81,0.82,0.82,0.94", row(42.2, 7));
  check("таблица (обучающая): половинка +1…+3 = 0.59 / 0.99 / 0.99", row(21.1, 3) === "0.59,0.99,0.99", row(21.1, 3));
  // ПЕРЕПИСАНО 15.10 (правило 6a). Было: «до 15 км +1…+3 = 0.74 / 0.76 / 0.94». Отменено решением по разбросу (r12): на +2 и +3 p75 > 1,
  // надёжного числа нет — не понижаем. Новое утверждение сильнее: понижается только +1, а +2/+3 дают ровно 1 (нет снижения).
  check("таблица (обучающая): до 15 км понижается только +1 = 0.74; +2 и +3 = 1 (разброс накрывает единицу — не понижаем наугад)", row(10, 3) === "0.74,1,1", row(10, 3));
  check("за краем строки множителя нет: марафон +8, половинка +4, до 15 км +4, без дистанции, неделя 0", recoveryFactor(42.2, 8) === null && recoveryFactor(21.1, 4) === null && recoveryFactor(10, 4) === null && recoveryFactor(null, 1) === null && recoveryFactor(42.2, 0) === null && recoveryFactor(42.2, null) === null);
  setRecovery({ table: "all" });
  check("множитель зажат сверху единицей: в измеренной таблице до 15 км +3 = 1.02, выдаётся 1", recoveryFactor(10, 3) === 1, String(recoveryFactor(10, 3)));
  setRecovery({ table: "train" });
  const d = (aid: number, k: number): number | null => { const p = planRepeat(ix, T(aid, k), null); return p.kind === "repeat" ? p.delta : null; };
  check("дельта по таблице: марафон +1…+7", [d(10, 7), d(10, 8), d(10, 9), d(10, 10), d(10, 11), d(10, 12), d(10, 13)].join() === "0.39,0.71,0.77,0.81,0.82,0.82,0.94", [d(10, 7), d(10, 8), d(10, 9), d(10, 10), d(10, 11), d(10, 12), d(10, 13)].join());
  check("на +8 после марафона восстановления нет: нагрузка 100% (дельта 1)", d(10, 14) === 1, String(d(10, 14)));
  check("половинка +1 = 0.59, +2 = 0.99 (дистанция меняет множитель)", d(11, 7) === 0.59 && d(11, 8) === 0.99, `${d(11, 7)} ${d(11, 8)}`);
  const keep2 = planRepeat(ix, T(10, 8), null);
  check("марафон +2 (×0.71 — ниже порога 0.75): день НЕ снимается, объём режется внутри сессий (измерено: дни +2…+4 = 1.00 обычных)",
    keep2.kind === "repeat" && keep2.sessions.length === 3, JSON.stringify(keep2.kind === "repeat" ? keep2.sessions.map((x) => [x.dayIdx, x.minutes]) : keep2));
  const keepH = planRepeat(ix, T(11, 7), null);
  check("половинка +1 (×0.59): день тоже не снимается — по дням замер только для марафона", keepH.kind === "repeat" && keepH.sessions.length === 3, JSON.stringify(keepH.kind === "repeat" ? keepH.sessions.length : keepH));
  const m4 = planRepeat(ix, T(10, 10), null);
  check("марафон +4 (как у Семешиной): нагрузка ×0.81 от обычной, а не 100%; правило «без качества» уже не действует (только +1…+3)",
    m4.kind === "repeat" && m4.delta === 0.81 && m4.sessions.some((s) => hasQ(s)), JSON.stringify(m4.kind === "repeat" ? { d: m4.delta, s: m4.sessions.map((s) => [s.title, s.minutes]) } : m4));
  const m7 = planRepeat(ix, T(10, 13), null);
  check("марафон +7: образец найден на пределе окна (10 недель назад: подводка 2 + старт + 7 недель восстановления)", m7.kind === "repeat" && m7.base.weekStart === wk(3), JSON.stringify(m7.kind === "repeat" ? m7.base.weekStart : m7));
  const m2 = planRepeat(ix, T(10, 8), null);
  check("2-я неделя после марафона: «24 км в темпе марафона» заменена его обычной лёгкой, день не потерян",
    m2.kind === "repeat" && !m2.sessions.some((s) => hasQ(s)) && m2.sessions.some((s) => s.dayIdx === 6) && m2.deltaWhy.includes("качество снято"), JSON.stringify(m2.kind === "repeat" ? m2.sessions.map((s) => [s.dayIdx, s.title, s.minutes]) : m2));
  const m3 = planRepeat(ix, T(10, 9), null);
  check("3-я неделя после марафона: качества тоже нет", m3.kind === "repeat" && !m3.sessions.some((s) => hasQ(s)));
  const h2 = planRepeat(ix, T(11, 8), null);
  check("после ПОЛОВИНКИ правило «без качества» не действует: марафонский темп остаётся (оно только для марафона)", h2.kind === "repeat" && h2.sessions.some((s) => hasQ(s)), JSON.stringify(h2.kind === "repeat" ? h2.sessions.map((s) => s.title) : h2));
  const bb = buildRepeatWeek(ix, T(10, 8), W8, null, undefined, new Map());
  check("2-я неделя после марафона целиком: выдана, без отказа, качества в тексте нет", !!bb && !bb.refused && !bb.sessions.some((s) => hasQ({ kind: s.kind, title: s.title, src: { desc: s.description } as never } as never)), JSON.stringify(bb?.refusedWhy));
  const hard = validateWeek([{ dayIdx: 6, kind: "long", title: "24 км в темпе марафона", minutes: 170, work: 0, description: "" }], null, { hasActiveIllness: false, checkText: false, postMarathonWeek: 2 });
  check("ЖЁСТКО: марафонский блок на 2-й неделе после марафона — отказ валидатора", hard.some((r) => r.severity === "hard" && !r.ok && r.name.includes("после марафона")));
  const late = validateWeek([{ dayIdx: 6, kind: "long", title: "24 км в темпе марафона", minutes: 170, work: 0, description: "" }], null, { hasActiveIllness: false, checkText: false, postMarathonWeek: 4 });
  check("на 4-й неделе после марафона это правило уже не действует", !late.some((r) => r.name.includes("после марафона")));
}

console.log("\n── качество по практике: пустоту образца не копируем ──");
{
  const withQ = (qs: number | null) => { setRepeatParams({ qualityShare: qs }); return planRepeat(ix, T(31, 8), null); };
  const on = withQ(0.875), off = withQ(null);
  check("боевое умолчание: качество «обычно», если было в 7 из 8 недель (0.875, измерено r14)", PROD.qs === 0.875, String(PROD.qs));
  check("атлет делает качество в 7 из 8 недель, образец без него: в неделе появляется ровно одна качественная сессия (его «6 х 4 мин») на его привычный день 3",
    on.kind === "repeat" && on.sessions.filter((s) => s.kind === "quality").length === 1 && on.sessions.find((s) => s.kind === "quality")!.title === Q && on.sessions.find((s) => s.kind === "quality")!.dayIdx === 3, JSON.stringify(on.kind === "repeat" ? on.sessions.map((s) => [s.dayIdx, s.kind, s.title]) : on));
  check("добавленное качество ЗАМЕНЯЕТ лёгкую (дней столько же, сколько в образце), а не прибавляется сверху; в причине названо «качество по практике»",
    on.kind === "repeat" && on.sessions.length === 4 && /качество по практике \(7 из 8/.test(on.deltaWhy), on.kind === "repeat" ? on.deltaWhy : "");
  check("при выключенном правиле та же неделя копирует пустоту (проверка различает)", off.kind === "repeat" && off.sessions.every((s) => s.kind !== "quality"));
  setRepeatParams({ qualityShare: 0.875 });
  const rare = planRepeat(ix, T(32, 8), null);
  check("качество в 3 из 8 недель — НЕ «обычно»: образец копируется как есть, качество не добавляется", rare.kind === "repeat" && rare.sessions.every((s) => s.kind !== "quality") && !/качество по практике/.test(rare.deltaWhy));
  const free = planRepeat(ix, T(34, 8), null); const fq = free.kind === "repeat" ? free.sessions.find((x) => x.kind === "quality") : undefined;
  check("привычный день качества в образце свободен: качество встаёт на него (день 3), заменяя ближайшую лёгкую (день 4), а не садится на чужой день",
    free.kind === "repeat" && fq?.dayIdx === 3 && !free.sessions.some((x) => x.dayIdx === 4) && free.sessions.length === 4, JSON.stringify(free.kind === "repeat" ? free.sessions.map((x) => [x.dayIdx, x.kind]) : free));
  const sick = planRepeat(ix, { ...T(33, 8), ill: true }, null), sick2 = planRepeat(ix, { ...T(33, 8), illAtStart: true }, null);
  check("активная болезнь на неделе: качество по практике не добавляется (ни по сигналу, ни по сигналу на понедельник)",
    sick.kind === "repeat" && sick.sessions.every((s) => s.kind !== "quality") && sick2.kind === "repeat" && sick2.sessions.every((s) => s.kind !== "quality"));
  const pre = planRepeat(ix, { ...T(31, 8), raceDayIdx: 4, nextRaceIsMain: true }, null);
  check("перед главным стартом в четверг добавленное качество в среду-четверг снимается предстартовым запретом (добавка не обходит границы)",
    pre.kind === "repeat" && pre.sessions.every((s) => !(s.kind === "quality" && s.dayIdx >= 4 - 2 && s.dayIdx < 4)), JSON.stringify(pre.kind === "repeat" ? pre.sessions.map((s) => [s.dayIdx, s.kind]) : pre));
}

console.log("\n── класс «пик» ──");
{
  check("боевые умолчания: пик >1.5 × медианы, восстановление включено, окно поиска образца 10 нед (подводка+старт+восстановление занимают 6)", PROD.peak === 1.5 && PROD.recovery === true && PROD.lookback === 10, JSON.stringify(PROD));
  check("боевые умолчания: не-образцы — ровно пять проверенных классов: старт, после старта, подводка, пик, провал (сигнал здоровья — НЕ класс, замер R4)",
    PROD.skip === ["старт", "после старта", "подводка", "пик", "провал объёма"].sort().join(), PROD.skip);
  const pk = planRepeat(ix, T(12, 7), null);
  check("пиковая неделя (400 при медиане 260, ×1.54) образцом не служит: берётся предыдущая обычная",
    pk.kind === "repeat" && pk.base.weekStart === wk(5) && pk.skipped.some((x) => x.why === "пик") && total_(pk.sessions) === 260, JSON.stringify(pk.kind === "repeat" ? { b: pk.base.weekStart, sk: pk.skipped } : pk));
  setRepeatParams({ peak: 0 });
  const nopk = planRepeat(ix, T(12, 7), null);
  check("без класса «пик» та же пиковая неделя была бы образцом (проверка различает)", nopk.kind === "repeat" && nopk.base.weekStart === wk(6) && total_(nopk.sessions) === 400);
  setRepeatParams({ peak: 1.5 });
  // БЫЛО (до 17.10): порог 1.25, затем на один день 1.35 (подгонка под Семешину ×1.39 — Игорь отменил: порог по данным, не под случай).
  // Теперь 1.5 = точка, где по 4307 неделям держится-после падает с ~60% до ~46%. Граница и зазор держатся числами с обеих сторон.
  check("зазор пика: ×1.26 (Ярулина 239 при 190), ×1.39 (Семешина 430 при 310) и ровно на границе ×1.5 НЕ пик; ×1.51 и ×1.9 — пик",
    !isPeak(Array(8).fill(190), 239) && !isPeak(Array(8).fill(310), 430) && !isPeak(Array(8).fill(200), 300) && isPeak(Array(8).fill(200), 302) && isPeak(Array(8).fill(200), 380));
  check("зазор пика: нет единичной хрупкости — сдвиг недели на ±1.5 мин вокруг прежней границы 1.25 не меняет вердикта",
    [236, 237.5, 239].every((t) => !isPeak(Array(8).fill(190), t)));
  check("неделя ×1.15 медианы — не пик", planRepeat(ix, T(1, 5), null).kind === "repeat" && !(planRepeat(ix, T(1, 5), null) as { skipped: Array<{ why: string }> }).skipped.some((x) => x.why === "пик"));
}

console.log("\n── после старта: ОБЕ ветки (повтор и прецедент) ──");
{
  const tgt = T(16, 9);
  const pl = planRepeat(ix, tgt, null);
  check("контроль сценария: неделя +3 после марафона у атлета 16 идёт ветка ПРЕЦЕДЕНТА (пауза 2 недели)", tgt.weeksSinceRace === 3 && tgt.lastRaceKm === 42.2 && pl.kind === "precedent", JSON.stringify({ k: pl.kind, w: tgt.weeksSinceRace }));
  const bp = buildRepeatWeek(ix, tgt, W8, null, undefined, new Map());
  const qContent = (x: { kind: string; title: string; description: string }): boolean => hasQualityContent(x);
  // ПЕРЕПИСАНО 15.10 (правило 6a). Было: в ветке прецедента «после старта» не обрабатывалось, а остаток качества ловился жёстким ОТКАЗОМ
  // (3 недели из 809). Отменено решением Игоря: правило живёт в обеих ветках, качество ЗАМЕНЯЕТСЯ, отказа нет.
  check("прецедент, +3 после марафона: неделя выдана (НЕ отказ), восстановление названо, качества нет", !!bp && !bp.refused && bp.source.includes("ПРЕЦЕДЕНТ") && bp.source.includes("восстановление: неделя +3") && !bp.sessions.some(qContent), JSON.stringify({ r: bp?.refusedWhy, src: bp?.source, s: bp?.sessions.map((x) => [x.title, x.minutes]) }));
  check("в обеих ветках жёсткая проверка «без качества после марафона» есть и пройдена", !!bp && bp.validator.some((v) => v.severity === "hard" && v.ok && v.name.includes("после марафона")));
  // донор сам был неделей восстановления — его множитель уже в сессиях, второй раз не применяется и нагрузку не повышаем
  const t2 = T(10, 8); // +2 после марафона: 0.71
  const sess: PSess[] = [{ dayIdx: 1, kind: "easy", title: "Лёгкий", minutes: 100, work: 0, src: corpus[0].sessions[0] }];
  check("донор — не неделя восстановления: ×0.71", postRaceAdjust(ix, t2, sess, 1).sessions[0].minutes === 70);
  check("донор уже был на 0.71 (та же неделя): повторно не снижаем", postRaceAdjust(ix, t2, sess, 0.71).sessions[0].minutes === 100);
  const lower = postRaceAdjust(ix, t2, sess, 0.5);
  check("донор был ещё ниже (0.5): нагрузку НЕ повышаем — ни минуты, ни возвращаемый множитель не выше 1", lower.sessions[0].minutes === 100 && lower.rel === 1, JSON.stringify({ m: lower.sessions[0].minutes, r: lower.rel }));
  // через adapt: донор — неделя того же восстановления (+3 после марафона у атлета 10), цель — +3 после марафона у атлета 16
  const donor = { p: T(10, 9), why: { d: 0, parts: [] as Array<[string, number]> }, ownAvailable: 0 };
  const aOn = adapt(ix, T(16, 9), donor, true).sessions.map((x) => x.minutes).join();
  const aOff = adapt(ix, T(16, 9), donor, false).sessions.map((x) => x.minutes).join();
  check("прецедент через adapt: донор сам неделя +3 после марафона — второй раз множитель не применяется", aOn === aOff, `${aOn} против ${aOff}`);
  const donorN = { p: T(1, 5), why: { d: 0, parts: [] as Array<[string, number]> }, ownAvailable: 0 };
  const bOn = adapt(ix, T(16, 9), donorN, true).sessions.map((x) => x.minutes).reduce((a, b) => a + b, 0);
  const bOff = adapt(ix, T(16, 9), donorN, false).sessions.map((x) => x.minutes).reduce((a, b) => a + b, 0);
  check("прецедент через adapt: донор — обычная неделя, цель +3 после марафона — нагрузка снижена", bOn < bOff, `${bOn} против ${bOff}`);
  const t18 = T(18, 2);
  check("неделя старта без истории (2 недели): ОТКАЗ и в ветке прецедента", t18.phase === "race" && planRepeat(ix, t18, null).kind === "refuse");
  check("неделя старта с историей: прецедент (не отказ)", planRepeat(ix, T(4, 8), null).kind === "precedent");
}

console.log("\n── названия донора → обычные сессии атлета ──");
{
  const don = (p: CWeek) => ({ p, why: { d: 0, parts: [] as Array<[string, number]> }, ownAvailable: 0 });
  const tgt = T(22, 6); const own = new Set(["Лёгкий кросс", "Легкий бег по темпу", "Длительный бег по темпу"]);
  const on = adapt(ix, tgt, don(T(21, 5)), true); const off = adapt(ix, tgt, don(T(21, 5)), false);
  const nonQ = on.sessions.filter((x) => x.kind !== "quality");
  check("чужой донор «по пульсу»: все названия лёгких и длительной — из обычных сессий атлета («по темпу»), «пульса» нет",
    nonQ.length === 3 && nonQ.every((x) => own.has(x.title)) && !on.sessions.some((x) => /пульс/i.test(x.title) && x.kind !== "quality"), JSON.stringify(on.sessions.map((x) => [x.kind, x.title, x.minutes])));
  check("в тексте тоже его сессия: описание (src) принадлежит шаблону атлета, а не донору", nonQ.every((x) => !/пульс/i.test(x.src.title)));
  check("качественная не подменяется: рецепт «6 х 4 мин» остаётся", on.sessions.some((x) => x.kind === "quality" && x.title === Q));
  check("минуты и дни остаются донорскими (подмена меняет заголовок и текст, не нагрузку)", on.sessions.map((x) => `${x.dayIdx}:${x.minutes}`).join() === off.sessions.map((x) => `${x.dayIdx}:${x.minutes}`).join());
  const e50 = on.sessions.find((x) => x.kind === "easy" && x.minutes <= 55)!, e85 = on.sessions.find((x) => x.kind === "easy" && x.minutes >= 80)!;
  check("шаблон — ближайший по минутам: лёгкая ~50 → «Лёгкий кросс» (40), ~85 → «Легкий бег по темпу» (90)", e50.title === "Лёгкий кросс" && e85.title === "Легкий бег по темпу", `${e50.title} / ${e85.title}`);
  const ownDon = adapt(ix, tgt, don(T(22, 5)), true);
  check("свой донор не трогается: подмены нет, в пометке про названия пусто", !ownDon.dayMap.includes("названия донора"), ownDon.dayMap);
  check("в пометке недели названо, что заменено и сколько", on.dayMap.includes("названия донора заменены обычными сессиями атлета: 3 из 3"), on.dayMap);
  const mp = adapt(ix, T(10, 5), don(T(21, 5)), true);
  check("шаблон не бывает блоком «в темпе марафона»: у атлета 10 такие длительные — берётся его обычная лёгкая", !mp.sessions.some((x) => /марафон/i.test(x.title)), JSON.stringify(mp.sessions.map((x) => x.title)));
  const keepMp = adapt(ix, T(22, 6), don(T(10, 5)), true);
  check("донорская сессия с блоком «в темпе марафона» (качество по содержанию) остаётся как есть, лёгкие подменены", keepMp.sessions.some((x) => /темпе марафона/.test(x.title)) && keepMp.sessions.filter((x) => x.kind === "easy").every((x) => own.has(x.title)), JSON.stringify(keepMp.sessions.map((x) => x.title)));
  const tw = T(23, 6);
  const warmDonor = { p: T(21, 5), why: { d: 0, parts: [] as Array<[string, number]> }, ownAvailable: 0 };
  const w1 = adapt(ix, tw, warmDonor, true).sessions.filter((x) => x.kind === "easy");
  check("разминка не становится шаблоном: у атлета с отдельными «Разминка» 25 мин заголовки лёгких — только настоящие лёгкие", w1.length > 0 && w1.every((x) => !/разминк/i.test(x.title)), JSON.stringify(w1.map((x) => x.title)));
  const short25: PSess[] = [{ dayIdx: 2, kind: "easy", title: "Легкий бег по пульсу", minutes: 25, work: 0, src: { ...corpus[0].sessions[0], title: "Легкий бег по пульсу", desc: "" } }];
  const s25 = substituteDonorStyle(ix, tw, short25, 21);
  check("донорская лёгкая в 25 мин (ровно как «Разминка» атлета по минутам) всё равно получает настоящую лёгкую, а не разминку", s25.sessions[0].title === "Легкий бег по темпу", s25.sessions[0].title);
  const plain = plainTemplate(ix, 23, wk(6), ["easy"]);
  check("замена снятого качества тоже не берёт разминку: у атлета 23 это «Легкий бег по темпу», а не «Разминка»", plain != null && plain.title === "Легкий бег по темпу", JSON.stringify(plain?.title));
  const wuSess: PSess[] = [{ dayIdx: 1, kind: "easy", title: "Разминка", minutes: 25, work: 0, src: { ...corpus[0].sessions[0], title: "Разминка", desc: "" } }];
  const wu = substituteDonorStyle(ix, tw, wuSess, 21);
  check("сама донорская «Разминка» получает его собственную разминку, а не лёгкий бег", wu.sessions[0].title === "Разминка", wu.sessions[0].title);
  const none = substituteDonorStyle(ix, T(18, 0), adapt(ix, T(18, 0), don(T(21, 5)), false).sessions, 21);
  check("у атлета нет своей истории (шаблонов нет): донорские сессии остаются, подмены 0", none.replaced === 0 && none.considered > 0, JSON.stringify({ r: none.replaced, c: none.considered }));
}

console.log("\n── донор прецедента: пик не донор (правило из повтора выровнено) ──");
{
  check("донор-пик определяется так же, как образец-пик: неделя 400 при медиане 260 — исключена, обычная — нет", donorExcluded(ix, T(12, 6)) === true && donorExcluded(ix, T(12, 5)) === false);
  let peakBest = 0, replaced = 0, leaks = 0;
  for (const t of corpus) {
    const f0 = findPrecedent(ix, t, W8, "any"); if (!f0) continue;
    const f1 = selectDonor(ix, t, W8, "any");
    if (f1 && donorExcluded(ix, f1.p)) leaks++;
    if (donorExcluded(ix, f0.p)) { peakBest++; if (f1 && f1.p !== f0.p) replaced++; }
  }
  check("боевой выбор донора НИКОГДА не возвращает пик (по всем целям синтетики)", leaks === 0, `утечек ${leaks}`);
  check("сценарий содержит случаи, где ближайший донор — пик, и боевой выбор его заменяет (проверка не пустая)", peakBest >= 1 && replaced === peakBest, `пиков-ближайших ${peakBest}, заменено ${replaced}`);
}

console.log("\n── окно поиска образца ──");
{
  const w = planRepeat(ix, T(15, 13), null);
  check("после марафонного блока образец найден за окном в 6 недель: берётся последняя обычная неделя (wk6, шесть не-образцов позади), а не чужой прецедент",
    w.kind === "repeat" && w.base.weekStart === wk(6) && w.skipped.length === 6, JSON.stringify(w.kind === "repeat" ? { b: w.base.weekStart, sk: w.skipped.map((x) => x.why) } : w));
}

console.log("\n── жёсткая граница: отказ вместо предупреждения ──");
{
  const gap = planRepeat(ix, T(13, 9), null);
  check("пауза 5 недель — ОТКАЗ без попытки взять чужую неделю", gap.kind === "refuse" && gap.why.includes("пауза"), JSON.stringify(gap));
  check("пауза 3 недели (< порога) — не отказ", planRepeat(ix, T(5, 7), null).kind !== "refuse");
  const few = planRepeat(ix, T(14, 2), null);
  check("только две недели своей истории — ОТКАЗ (нужно ≥ 3)", few.kind === "refuse" && few.why.includes("своих недель"), JSON.stringify(few));
  const bg = buildRepeatWeek(ix, T(13, 9), W8, null, undefined, new Map());
  check("в сборке отказ приходит с причиной и без сессий", !!bg && bg.refused && bg.sessions.length === 0 && (bg.refusedWhy ?? "").includes("нет недавней истории"), JSON.stringify(bg?.refusedWhy));
  check("порог паузы и минимум истории — измеренные значения (4 нед, 3 недели, 1.5×)", MAX_GAP_WEEKS === 4 && MIN_RECENT_WEEKS === 3 && LEVEL_MAX_RATIO === 1.5);
  // уровень = p75 плана, а не медиана: пять недель 100..500 → p75 = 400, медиана 300
  const lv = recent(indexCorpus(buildCorpus([100, 200, 300, 400, 500].flatMap((m, k) => weekRows(20, wk(k), [{ d: 1, t: EASY, m }])), [], [], [], "2027-01-01")), 20, wk(5));
  check("недавний уровень = p75 плана за 8 недель (400), а не медиана (300)", lv.level === 400 && lv.ok, JSON.stringify(lv));
  const lvl = { ok: true, level: 200, weeks: 6, gapWeeks: 0, why: "" };
  const v = (m: number): ReturnType<typeof validateWeek> => validateWeek([{ dayIdx: 1, kind: "easy", title: "л", minutes: m, work: 0, description: "" }], null, { hasActiveIllness: false, checkText: false, recent: lvl });
  check("ЖЁСТКО: неделя 400 при уровне 200 (×2) — отказ", v(400).some((r) => r.severity === "hard" && !r.ok && r.name.includes("недавнего уровня")));
  check("неделя 290 при уровне 200 (×1.45) — проходит", !v(290).some((r) => r.severity === "hard" && !r.ok));
  const nohist = validateWeek([{ dayIdx: 1, kind: "easy", title: "л", minutes: 60, work: 0, description: "" }], null, { hasActiveIllness: false, checkText: false, recent: { ok: false, level: null, weeks: 0, gapWeeks: null, why: "x" } });
  check("ЖЁСТКО: нет недавней истории — отказ даже у короткой недели", nohist.some((r) => r.severity === "hard" && !r.ok && r.name.includes("недавняя история")));
}

console.log("\n── раскидать / публикуй / снести: правки тренера и ворота записи ──");
{
  const pl: Placed = { aid: 1, weekStart: "2026-10-19", workoutId: 11, date: "2026-10-21", title: "6 х 4 мин", description: "текст", minutes: 60 };
  check("без правок — пусто", diffPlaced(pl, { workoutId: 11, date: "2026-10-21T00:00:00", title: "6 х 4 мин", description: "текст", minutes: 60, isHidden: true }).length === 0);
  const ch = diffPlaced(pl, { workoutId: 11, date: "2026-10-22T00:00:00", title: "5 х 5 мин", description: "текст", minutes: 70, isHidden: true });
  check("правка дня, длительности и формата — три строки с было/стало",
    ch.length === 3 && ch.some((r) => r.field === "день недели" && r.before === "2026-10-21" && r.after === "2026-10-22") && ch.some((r) => r.field === "длительность" && r.after === "70") && ch.some((r) => r.field === "формат" && r.after === "5 х 5 мин"), JSON.stringify(ch));
  check("удалённая тренером — строка «удаление»", diffPlaced(pl, null).map((r) => r.field).join() === "удаление");
  check("добавленная тренером — строка «добавление»", addedByCoach(1, "2026-10-19", new Set([11]), [{ workoutId: 11, date: "2026-10-21", title: "x", minutes: 60 }, { workoutId: 99, date: "2026-10-23", title: "Свой бег", minutes: 45 }]).map((r) => `${r.field}:${r.workoutId}`).join() === "добавление:99");
  const pub = toPublish([pl, { ...pl, workoutId: 12 }], new Map([[11, { workoutId: 11, date: "", title: "", description: "", minutes: 0, isHidden: true }], [12, null]]));
  check("публикуется только живое: удалённая тренером назад не возвращается", pub.length === 1 && pub[0].workoutId === 11);

  // ПЕРЕПИСАНО 15.10 (правило 6a). Было: доказательством считался отчёт с hidden/unhidden PASS в любом формате,
  // в том числе от старого Playwright-пробника. Отменено: тот путь «раскидать» не доказывает. Теперь нужен отчёт
  // пробника на tp-api-client (`- path: tp-api-client`) и ТРИ PASS: скрыто, открыто, удалено.
  const dir = mkdtempSync(path.join(tmpdir(), "proof-"));
  const rep = (name: string, lines: string[]): void => { mkdirSync(path.join(dir, name)); writeFileSync(path.join(dir, name, "summary.md"), lines.join("\n") + "\n"); };
  check("скрытие не доказано, пока нет живого отчёта пробника", hiddenProven(dir).ok === false);
  rep("a", ["- hidden_verify_pass: `true`", "- unhidden_verify_pass: `null`"]);
  check("доказано только скрытие — не доказано", hiddenProven(dir).ok === false);
  rep("b", ["- hidden_verify_pass: `null`", "- unhidden_verify_pass: `true`", "- deleted_verify_pass: `true`", "- path: `tp-api-client`"]);
  check("скрыть не удалось, открыть удалось — НЕ доказано (имя одного поля внутри другого)", hiddenProven(dir).ok === false);
  rep("c", ["- hidden_verify_pass: `true`", "- unhidden_verify_pass: `true`"]);
  check("два PASS от старого пробника (Playwright, без path и без удаления) — НЕ доказательство для «раскидать»", hiddenProven(dir).ok === false);
  rep("d", ["- path: `tp-api-client`", "- hidden_verify_pass: `true`", "- unhidden_verify_pass: `true`", "- deleted_verify_pass: `null`"]);
  check("tp-api-client, но удаление не подтверждено — НЕ доказано", hiddenProven(dir).ok === false);
  rep("f", ["- hidden_verify_pass: `true`", "- unhidden_verify_pass: `true`", "- deleted_verify_pass: `true`"]);
  check("три PASS, но без path tp-api-client (отчёт не от нашего пути) — НЕ доказано", hiddenProven(dir).ok === false);
  rep("g", ["- path: `tp-api-client`", "- hidden_verify_pass: `true`", "- unhidden_verify_pass: `null`", "- deleted_verify_pass: `true`"]);
  check("tp-api-client, скрыто и удалено, но открытие не подтверждено — НЕ доказано", hiddenProven(dir).ok === false);
  rep("e", ["- path: `tp-api-client`", "- hidden_verify_pass: `true`", "- unhidden_verify_pass: `true`", "- deleted_verify_pass: `true`"]);
  check("tp-api-client и три PASS (скрыто, открыто, удалено) — доказано", hiddenProven(dir).ok === true);
  const ok = { executeReal: true, confirm: CONFIRM.raskidat, realEnv: "true", proof: { ok: true, why: "" }, corpusAgeMin: 5 };
  check("ворота открыты только при всех условиях", realGate("raskidat", [GROUP12[0]], ok) === null);
  check("без --execute-real — сухой прогон", realGate("raskidat", [GROUP12[0]], { ...ok, executeReal: false }) != null);
  check("не та фраза подтверждения — отказ", realGate("raskidat", [GROUP12[0]], { ...ok, confirm: "да" }) != null);
  check("без TP_ACTIONS_REAL_EXECUTION — отказ", realGate("raskidat", [GROUP12[0]], { ...ok, realEnv: undefined }) != null);
  check("атлет вне группы 12 — отказ", realGate("raskidat", [5058370], ok)?.includes("вне группы 12") === true);
  check("скрытие не доказано — отказ раскидать", realGate("raskidat", [GROUP12[0]], { ...ok, proof: { ok: false, why: "нет" } })?.includes("скрытие") === true);
  check("выгрузка кэша старше часа — отказ раскидать", realGate("raskidat", [GROUP12[0]], { ...ok, corpusAgeMin: 90 }) != null);
}

console.log("\n── пробник скрытия: поток на подставном клиенте (сети нет) ──");
{
  const D = "2026-10-29"; const body = probeBody(D);
  const ok = fakeClient({}); const r1 = await runProbeCycle(ok, PROBE_ATHLETE_ID, D, body);
  check("нормальный цикл: скрыто, открыто, удалено — три PASS, без расхождений, ничего не осталось",
    r1.stopped === null && r1.hiddenVerifyPass === true && r1.unhiddenVerifyPass === true && r1.deletedVerifyPass === true && r1.discrepancies.length === 0 && ok.store.size === 0 && r1.hiddenInPost === true, JSON.stringify(r1));
  check("в POST ушёл isHidden:true", ok.log[0].includes('"isHidden":true'));
  const ign = fakeClient({ ignoreHiddenInPost: true }); const r2 = await runProbeCycle(ign, PROBE_ATHLETE_ID, D, body);
  check("TP игнорирует isHidden в POST: расхождение записано, скрыто отдельным PUT, цикл пройден", r2.stopped === null && r2.hiddenInPost === false && r2.discrepancies.length === 1 && r2.discrepancies[0].includes("ИГНОРИРУЕТ") && ign.log.some((l) => /^PUT \d+ isHidden=true$/.test(l)) && ign.store.size === 0, JSON.stringify(r2.discrepancies));
  const stub = fakeClient({ ignoreHiddenInPost: true, putIgnoresHidden: true }); const r3 = await runProbeCycle(stub, PROBE_ATHLETE_ID, D, body);
  check("TP не скрывает даже PUT-ом: СТОП, созданное удалено и проверено, у атлета ничего не осталось", r3.stopped !== null && r3.hiddenVerifyPass === null && r3.cleanedUp === true && stub.store.size === 0, JSON.stringify({ s: r3.stopped, c: r3.cleanedUp, left: stub.store.size }));
  const pre = fakeClient({ preExisting: true }); const r4 = await runProbeCycle(pre, PROBE_ATHLETE_ID, D, body);
  check("на дате уже есть чужая тренировка: СТОП до записи, ничего не создано и чужое не тронуто", r4.stopped !== null && pre.created() === 0 && pre.store.size === 1, JSON.stringify({ c: pre.created(), left: pre.store.size }));
  const nodel = fakeClient({ deleteNoop: true }); const r5 = await runProbeCycle(nodel, PROBE_ATHLETE_ID, D, body);
  check("DELETE не удалил: СТОП, и отчёт честно говорит, что уборка не удалась", r5.stopped !== null && r5.deletedVerifyPass === null && r5.cleanedUp === false && r5.stopped.includes("УБОРКА НЕ УДАЛАСЬ"), JSON.stringify(r5.stopped));
  const today = "2026-10-15"; const g0 = { apply: true, confirm: PROBE_CONFIRM, realEnv: "true", athleteId: PROBE_ATHLETE_ID, date: "2026-10-29", today };
  check("ворота пробника открыты только при всех условиях", probeGate(g0) === null);
  check("не тестовый атлет — отказ", probeGate({ ...g0, athleteId: 5475968 })?.includes("не тестовый") === true);
  check("дата ближе 7 дней — отказ (пишем только в будущее)", probeGate({ ...g0, date: "2026-10-20" }) != null);
  check("без --apply — сухой прогон", probeGate({ ...g0, apply: false }) != null);
  check("не та фраза — отказ", probeGate({ ...g0, confirm: "да" }) != null);
  check("без TP_ACTIONS_REAL_EXECUTION — отказ", probeGate({ ...g0, realEnv: undefined }) != null);
}

console.log("\n── ядро «раскидать / снести / публикуй» на подставном клиенте (сети нет) ──");
{
  const A = 6009851; const WEEK = "2026-10-19";
  const mkM = (aid = A): Manifest => ({ runId: "t", createdAt: "", mode: "real", week: WEEK, refused: [], published: [], deleted: [], items: [
    { aid, date: "2026-10-21", dayIdx: 2, title: "Бег по темпу", minutes: 40, description: "40 минут равномерного бега в темпе 06:28-06:50 /км.", warnings: [], source: "t", why: "t", workoutId: null, verified: false },
    { aid, date: "2026-10-23", dayIdx: 4, title: "Бег по темпу", minutes: 40, description: "40 минут равномерного бега в темпе 06:28-06:50 /км.", warnings: [], source: "t", why: "t", workoutId: null, verified: false },
    { aid, date: "2026-10-25", dayIdx: 6, title: "Бег по темпу", minutes: 90, description: "90 минут равномерного бега в темпе 06:28-06:50 /км.", warnings: [], source: "t", why: "t", workoutId: null, verified: false }] });
  const saves: number[] = []; const save = (m: Manifest): void => { saves.push(m.items.filter((i) => i.workoutId != null).length); };
  const placedOk = async (): Promise<{ fc: ReturnType<typeof fakeClient>; m: Manifest }> => { const fc = fakeClient({}); const m = mkM(); const r = await placeWeek(fc, m, save); if (!r.ok) throw new Error(`постановка не прошла: ${r.stopped}`); return { fc, m }; };

  // — постановка —
  const { fc: f1, m: m1 } = await placedOk();
  check("постановка: 3 тренировки, все скрыты, на нужных днях, с нужными названиями и длительностью", [...f1.store.values()].length === 3 && [...f1.store.values()].every((r) => r.isHidden === true) && m1.items.map((i) => String((f1.store.get(i.workoutId!) as Record<string, unknown>).workoutDay).slice(0, 10)).join() === "2026-10-21,2026-10-23,2026-10-25", JSON.stringify([...f1.store.values()].map((r) => [r.workoutDay, r.isHidden])));
  check("постановка: id записаны в манифест после КАЖДОЙ сессии (сохранений 6: 3 создания + возможные), и все три в конце", m1.items.every((i) => i.workoutId != null && i.verified) && Math.max(...saves) === 3, String(saves));
  check("постановка: ни одного лишнего PUT (TP принял isHidden в POST), удалений нет", f1.count("PUT") === 0 && f1.count("DELETE") === 0, JSON.stringify(f1.log.filter((l) => !l.startsWith("POST"))));
  const v1 = await verifyPlaced(f1, m1);
  check("итоговая проверка: ok, в календаре недели ровно наши три", v1.ok && v1.lines.some((l) => l.includes("ровно наши")), JSON.stringify(v1.problems));

  const f2 = fakeClient({}); f2.seed({ workoutId: 77, athleteId: A, workoutDay: "2026-10-22T00:00:00", title: "тренировка Игоря", minutes: 50 });
  const r2 = await placeWeek(f2, mkM(), save);
  check("на неделе у атлета уже есть тренировка Игоря: ничего не пишем (ни одного POST), чужая цела", !r2.ok && f2.count("POST") === 0 && f2.store.has(77) && r2.rolledBack === null, JSON.stringify({ s: r2.stopped, p: f2.count("POST") }));

  const f3 = fakeClient({ failFromCreate: 3 }); f3.seed({ workoutId: 88, athleteId: A, workoutDay: "2026-10-12T00:00:00", title: "прошлая неделя Игоря", minutes: 60 });
  const m3 = mkM(); const r3 = await placeWeek(f3, m3, save);
  check("отказ TP скрывать на 3-й сессии: СТОП и откат ВСЕЙ постановки — не только последней (все три убраны, проверено)", !r3.ok && r3.rolledBack === true && [...f3.store.keys()].every((id) => id === 88) && m3.deleted.length === 3, JSON.stringify({ s: r3.stopped, rb: r3.rolledBack, left: [...f3.store.keys()] }));
  check("откат не трогает чужое: тренировка Игоря на прошлой неделе осталась", f3.store.has(88));

  const f4 = fakeClient({ wrongDayAt: 2 }); const m4 = mkM(); const r4 = await placeWeek(f4, m4, save);
  check("TP сохранил вторую сессию не на тот день: итоговая проверка ловит, откат всей постановки", !r4.ok && (r4.stopped ?? "").includes("день") && r4.rolledBack === true && f4.store.size === 0, JSON.stringify({ s: r4.stopped, left: f4.store.size }));

  const f5 = fakeClient({ failFromCreate: 2, deleteNoop: true }); const r5 = await placeWeek(f5, mkM(), save);
  check("откат сам не удался (DELETE не удаляет): rolledBack=false и названы оставшиеся id для ручной уборки", !r5.ok && r5.rolledBack === false && r5.leftover.length >= 1, JSON.stringify({ rb: r5.rolledBack, left: r5.leftover }));

  const f6 = fakeClient({}); const m6 = mkM(); await placeWeek(f6, m6, save);
  f6.edit(m6.items[0].workoutId!, { isHidden: false });
  const v6 = await verifyPlaced(f6, m6);
  check("итоговая проверка видит открытую ученику тренировку", !v6.ok && v6.problems.some((x) => x.includes("ученику видна")), JSON.stringify(v6.problems));
  const f7 = fakeClient({}); const m7 = mkM(); await placeWeek(f7, m7, save); f7.seed({ workoutId: 99, athleteId: A, workoutDay: "2026-10-24T00:00:00", title: "лишнее", minutes: 30 });
  const v7 = await verifyPlaced(f7, m7);
  check("итоговая проверка видит лишнее в календаре недели", !v7.ok && v7.problems.some((x) => x.includes("чужое")));

  // — снести —
  const { fc: s1, m: sm1 } = await placedOk(); s1.seed({ workoutId: 55, athleteId: A, workoutDay: "2026-10-22T00:00:00", title: "добавил Игорь", minutes: 45 });
  const before = s1.store.size; const dry = await runSnesti(s1, sm1, { dryRun: true });
  check("сухое «снести»: ТОЛЬКО чтение — ни одного DELETE/PUT/POST, в хранилище всё как было", s1.count("DELETE") === 0 && s1.count("PUT") === 0 && s1.store.size === before && dry.wouldDelete.length === 3, JSON.stringify({ d: s1.count("DELETE"), n: dry.wouldDelete.length }));
  check("сухое «снести» называет, что останется нетронутым (тренировка Игоря на неделе)", dry.othersBefore.join() === "55" && dry.lines.some((l) => l.includes("(останутся нетронутыми): 1")), JSON.stringify(dry.othersBefore));
  const real = await runSnesti(s1, sm1, { dryRun: false });
  check("реальное «снести»: удалены ровно три из манифеста, тренировка Игоря на месте, доказано повторным чтением", real.deleted.length === 3 && real.ok && s1.store.size === 1 && s1.store.has(55) && real.othersAfter?.join() === "55", JSON.stringify({ d: real.deleted, left: [...s1.store.keys()] }));
  const { fc: s2, m: sm2 } = await placedOk(); s2.edit(sm2.items[0].workoutId!, { isHidden: false }); sm2.published.push(sm2.items[1].workoutId!);
  const r_s2 = await runSnesti(s2, sm2, { dryRun: false });
  check("открытые ученику (по манифесту и по isHidden=false) НЕ удаляются без --include-published", r_s2.skippedPublished.length === 2 && r_s2.deleted.length === 1 && s2.store.size === 2, JSON.stringify({ sk: r_s2.skippedPublished, del: r_s2.deleted }));
  const { fc: s3, m: sm3 } = await placedOk(); s3.edit(sm3.items[2].workoutId!, { totalTimePlanned: 100 / 60, title: "Игорь переименовал" });
  const d3 = await runSnesti(s3, sm3, { dryRun: true });
  check("«снести» показывает, что тренер изменил поставленное (название, длительность)", d3.changedByCoach.length === 1 && d3.changedByCoach[0].includes("название") && d3.changedByCoach[0].includes("длительность"), JSON.stringify(d3.changedByCoach));
  const { fc: s4, m: sm4 } = await placedOk(); const otherAth = fakeClient({}); void otherAth;
  s4.seed({ workoutId: 66, athleteId: 5475652, workoutDay: "2026-10-23T00:00:00", title: "другой атлет", minutes: 50 });
  await runSnesti(s4, sm4, { dryRun: false });
  check("«снести» не трогает тренировки другого атлета", s4.store.has(66));

  // — публикуй —
  const prep = async (): Promise<{ fc: ReturnType<typeof fakeClient>; m: Manifest }> => {
    const { fc, m } = await placedOk();
    fc.edit(m.items[0].workoutId!, { totalTimePlanned: 55 / 60, title: "Бег по темпу (Игорь поправил)" }); // тренер изменил длительность и название
    fc.remove(m.items[1].workoutId!);                                                                         // тренер удалил
    fc.seed({ workoutId: 31, athleteId: A, workoutDay: "2026-10-22T00:00:00", title: "добавил Игорь", minutes: 45 }); // и добавил свою
    return { fc, m };
  };
  const { fc: p1, m: pm1 } = await prep(); let inserted = 0; const p1logLen = p1.log.length;
  const pd = await runPublikuy(p1, pm1, { dryRun: true, insertEdits: async (rows) => { inserted += rows.length; } });
  check("сухое «публикуй»: ТОЛЬКО чтение — ни PUT, ни DELETE, ни POST, ни вставки правок в базу", p1.log.length === p1logLen && inserted === 0 && pm1.published.length === 0, JSON.stringify({ log: p1.log.slice(p1logLen), ins: inserted }));
  const fields = pd.edits.map((e) => e.field).sort().join();
  check("сухое «публикуй» показывает правки Игоря: длительность и формат (название), удаление, добавление", fields === "длительность,добавление,удаление,формат", fields);
  check("в плане публикации — только живые: удалённая Игорем в список не попала, откроются две", pd.wouldPublish.length === 2 && pd.goneByCoach.length === 1, JSON.stringify({ w: pd.wouldPublish, g: pd.goneByCoach }));
  const postsBefore = p1.count("POST");
  const pr = await runPublikuy(p1, pm1, { dryRun: false, insertEdits: async (rows) => { inserted += rows.length; }, save });
  const edited = p1.store.get(pm1.items[0].workoutId!)!;
  check("реальное «публикуй»: открыта ЕГО версия — правки названия и длительности сохранены, isHidden=false", pr.published.length === 2 && edited.isHidden === false && edited.title === "Бег по темпу (Игорь поправил)" && Math.round(Number(edited.totalTimePlanned) * 60) === 55, JSON.stringify(edited));
  check("удалённая Игорем тренировка не возвращена (новых POST нет, её нет в хранилище)", p1.count("POST") === postsBefore && !p1.store.has(pm1.items[1].workoutId!));
  check("правки записаны в базу построчно (4) и тренировка Игоря (добавленная) не тронута", inserted === 4 && p1.store.get(31)!.isHidden === false && p1.store.get(31)!.title === "добавил Игорь", String(inserted));
  const putsBefore = p1.count("PUT"); await runPublikuy(p1, pm1, { dryRun: false, insertEdits: async () => {}, save });
  check("повторное «публикуй» уже открытое не трогает (идемпотентно)", p1.count("PUT") === putsBefore);

  const { fc: s5, m: sm5 } = await placedOk(); s5.seed({ workoutId: 55, athleteId: A, workoutDay: "2026-10-22T00:00:00", title: "добавил Игорь", minutes: 45 });
  const fcBad = fakeClient({ deleteAlsoRemoves: 55 }); void fcBad;
  const s6 = fakeClient({ deleteAlsoRemoves: 55 }); const sm6 = mkM(); await placeWeek(s6, sm6, save); s6.seed({ workoutId: 55, athleteId: A, workoutDay: "2026-10-22T00:00:00", title: "добавил Игорь", minutes: 45 });
  const r6 = await runSnesti(s6, sm6, { dryRun: false });
  check("если при сносе пропало что-то ЧУЖОЕ, итог это показывает (ok=false) — «чужое не тронуто» не берётся на веру", r6.ok === false && (r6.othersAfter ?? []).length === 0, JSON.stringify({ ok: r6.ok, after: r6.othersAfter }));
  void s5; void sm5;

  const { fc: o1, m: om1 } = await placedOk(); o1.edit(om1.items[0].workoutId!, { isHidden: false }); // Игорь сам открыл одну в TP
  const pOpen = await runPublikuy(o1, om1, { dryRun: false, insertEdits: async () => {}, save });
  check("тренировку, которую Игорь сам открыл в TP, «публикуй» не трогает повторно (нет PUT на неё), остальные две открывает", !o1.log.some((l) => l.startsWith(`PUT ${om1.items[0].workoutId} `)) && pOpen.published.length === 2, JSON.stringify({ pub: pOpen.published.length, puts: o1.log.filter((l) => l.startsWith("PUT")) }));

  // — решение «писать или нет» —
  check("isDry: любые закрытые ворота → сухой прогон; открытые → нет", isDry("нет --execute-real") === true && isDry(null) === false);
  check("mayPlace: пишем только при открытых воротах и непустом списке", mayPlace(null, 3) === true && mayPlace("закрыто", 3) === false && mayPlace(null, 0) === false);

  // — ворота: первая живая постановка — один человек —
  const okG = { executeReal: true, confirm: CONFIRM.raskidat, realEnv: "true", proof: { ok: true, why: "" }, corpusAgeMin: 5 };
  check("ворота: один человек разрешён, группа из двух — отказ (MAX_REAL_ATHLETES)", realGate("raskidat", [GROUP12[0]], okG) === null && realGate("raskidat", [GROUP12[0], GROUP12[1]], okG)?.includes("не больше") === true && MAX_REAL_ATHLETES === 1);
  check("ворота: все двенадцать без --athletes — отказ", realGate("raskidat", GROUP12, okG) != null);
}

console.log(`\nИТОГ: ${failures === 0 ? `все ${total} проверок прошли` : `ПАДЕНИЙ ${failures} из ${total}`}`);
process.exit(failures === 0 ? 0 : 1);
