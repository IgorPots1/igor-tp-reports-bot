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
import { planRepeat, setRepeatParams } from "./repeat.ts";
import { validateWeek, type VSess } from "./validate.ts";
import { signalWindow, staleReason } from "../lib/signal-closure.ts";

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

const corpus = buildCorpus(rows, races, [], [], "2027-01-01");
const ix = indexCorpus(corpus);
const T = (aid: number, k: number): CWeek => corpus.find((w) => w.aid === aid && w.weekStart === wk(k))!;
const total_ = (ss: PSess[]): number => ss.reduce((s, x) => s + x.minutes, 0);
const W8: Weights = { phase: 2.5, dist: 1.4, vol: 0.9, prev: 0.5, prevDays: 0.2, prevQ: 0.2, ill: 0.3, post: 0.3, gap: 1.8, own: 0.6, recency: 0.7 };
setRepeatParams({ normal: 0.6, gap: 2, post: 0.67, skip: ["старт", "после старта", "провал объёма"], applyPost: true });

console.log("\n── форма: защита от наследования ──");
{
  const p = planRepeat(ix, T(1, 7), null);
  check("провальная неделя (78 мин при обычных 260) формой НЕ берётся — берётся прошлая нормальная",
    p.kind === "repeat" && p.base.weekStart === wk(5) && total_(p.sessions) === 260, JSON.stringify(p.kind === "repeat" ? { base: p.base.weekStart, t: total_(p.sessions) } : p));
  check("пропуск провала назван причиной", p.kind === "repeat" && p.skipped.some((s) => s.why === "провал объёма"));
}
{
  const p = planRepeat(ix, T(2, 7), null);
  check("неделя после старта: форма — неделя ДО старта, неделя старта пропущена",
    p.kind === "repeat" && p.base.weekStart === wk(5) && p.skipped.some((s) => s.why === "старт"), JSON.stringify(p.kind === "repeat" ? p.skipped : p));
  // ×0.67 ниже порога 0.75 → одна лёгкая снимается; оставшиеся: лёгкая 50→35, длительная 100→65
  check("неделя после старта: ×0.67 (замер), одна лёгкая снята, качественная не масштабируется",
    p.kind === "repeat" && p.sessions.length === 3 && p.sessions.find((s) => s.kind === "easy")?.minutes === 35
      && p.sessions.find((s) => s.kind === "long")?.minutes === 65 && p.sessions.find((s) => s.kind === "quality")?.minutes === 60,
    JSON.stringify(p.kind === "repeat" ? p.sessions.map((s) => [s.kind, s.minutes]) : p));
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

console.log(`\nИТОГ: ${failures === 0 ? `все ${total} проверок прошли` : `ПАДЕНИЙ ${failures} из ${total}`}`);
process.exit(failures === 0 ? 0 : 1);
