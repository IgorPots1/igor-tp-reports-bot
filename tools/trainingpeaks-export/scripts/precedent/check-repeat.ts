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
import { addedByCoach, diffPlaced, toPublish, type Placed } from "./plan-edits.ts";
import { buildRepeatWeek } from "./build-week.ts";
import { CONFIRM, GROUP12, hiddenProven, realGate } from "./week-ops.ts";
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

const corpus = buildCorpus(rows, races, [], [], "2027-01-01");
const ix = indexCorpus(corpus);
const T = (aid: number, k: number): CWeek => corpus.find((w) => w.aid === aid && w.weekStart === wk(k))!;
const total_ = (ss: PSess[]): number => ss.reduce((s, x) => s + x.minutes, 0);
const W8: Weights = { phase: 2.5, dist: 1.4, vol: 0.9, prev: 0.5, prevDays: 0.2, prevQ: 0.2, ill: 0.3, post: 0.3, gap: 1.8, own: 0.6, recency: 0.7 };
setRepeatParams({ normal: 0.6, gap: 2, post: 0.67, skip: ["старт", "после старта", "подводка", "провал объёма"], applyPost: true });

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
  check("1-я неделя после марафона: тренер получает предупреждение с типичной долей 0.39", !!b && b.warnings.some((w) => w.includes("после старта на 42.2 км") && w.includes("0.39")), JSON.stringify(b?.warnings.filter((w) => w.includes("старта"))));
  const none = buildRepeatWeek(ix, T(1, 7), W8, null, undefined, new Map());
  check("обычная неделя: предупреждения про восстановление нет", !!none && !none.warnings.some((w) => w.includes("после старта на")));
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

  const dir = mkdtempSync(path.join(tmpdir(), "proof-"));
  check("скрытие не доказано, пока нет живого отчёта пробника", hiddenProven(dir).ok === false);
  mkdirSync(path.join(dir, "a")); writeFileSync(path.join(dir, "a", "summary.md"), "hidden_verify_pass: true\nunhidden_verify_pass: null\n");
  check("доказано только скрытие, открытие нет — всё ещё не доказано", hiddenProven(dir).ok === false);
  mkdirSync(path.join(dir, "b")); writeFileSync(path.join(dir, "b", "summary.md"), "- hidden_verify_pass: `null`\n- unhidden_verify_pass: `true`\n");
  check("скрыть не удалось, открыть удалось — НЕ доказано (имя одного поля внутри другого)", hiddenProven(dir).ok === false);
  mkdirSync(path.join(dir, "c")); writeFileSync(path.join(dir, "c", "summary.md"), "- hidden_verify_pass: `true`\n- unhidden_verify_pass: `true`\n");
  check("оба PASS в формате пробника — доказано", hiddenProven(dir).ok === true);
  const ok = { executeReal: true, confirm: CONFIRM.raskidat, realEnv: "true", proof: { ok: true, why: "" }, corpusAgeMin: 5 };
  check("ворота открыты только при всех условиях", realGate("raskidat", [GROUP12[0]], ok) === null);
  check("без --execute-real — сухой прогон", realGate("raskidat", [GROUP12[0]], { ...ok, executeReal: false }) != null);
  check("не та фраза подтверждения — отказ", realGate("raskidat", [GROUP12[0]], { ...ok, confirm: "да" }) != null);
  check("без TP_ACTIONS_REAL_EXECUTION — отказ", realGate("raskidat", [GROUP12[0]], { ...ok, realEnv: undefined }) != null);
  check("атлет вне группы 12 — отказ", realGate("raskidat", [5058370], ok)?.includes("вне группы 12") === true);
  check("скрытие не доказано — отказ раскидать", realGate("raskidat", [GROUP12[0]], { ...ok, proof: { ok: false, why: "нет" } })?.includes("скрытие") === true);
  check("выгрузка кэша старше часа — отказ раскидать", realGate("raskidat", [GROUP12[0]], { ...ok, corpusAgeMin: 90 }) != null);
}

console.log(`\nИТОГ: ${failures === 0 ? `все ${total} проверок прошли` : `ПАДЕНИЙ ${failures} из ${total}`}`);
process.exit(failures === 0 ? 0 : 1);
