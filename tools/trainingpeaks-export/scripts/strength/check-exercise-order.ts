/**
 * Проверка порядка упражнений (решение Игоря 21.10): классы 0..5 из exercise-order.json, классика по возрастанию класса (внутри класса — прежний
 * порядок), круговая — класс 2 в начале круга; keepOrder не трогается; без класса — запись отказывает. Сети нет.
 * Запуск: tsx check-exercise-order.ts
 */
import { buildBody, loadPrograms, orderClass, orderViolations, orderWeek, type PlanWeek } from "./strength-body.ts";
let fails = 0; const check = (name: string, ok: boolean, detail = ""): void => { if (!ok) fails++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : " — " + detail}`); };
const progs = loadPrograms().programs;
let weeks = 0;
for (const p of progs) for (const [fmt, ws] of Object.entries(p.formats)) for (const w of ws) { weeks++; const v = orderViolations(orderWeek(w)); if (v.length) check(`${p.id}/${fmt}/w${w.week}`, false, v.join("; ")); }
check(`все недели всех программ после сортировки без нарушений порядка (${weeks} недель)`, fails === 0);
const P = (id: string, title = id) => ({ exerciseId: id, title, parameter: "Reps", libraryParameterId: null, sets: 3, prescribedValue: "10", coachNotes: null });
const S = (id: string) => ({ blockType: "SingleExercise" as const, coachNotes: null, prescriptions: [P(id)] });
const wk = (blocks: PlanWeek["blocks"], keepOrder = false): PlanWeek => ({ week: 1, phase: "t", workoutTitle: "т", instructions: null, blocks, keepOrder });
const ids = (w: PlanWeek): string => w.blocks.map((b) => b.prescriptions.map((p) => p.exerciseId).join("+")).join(",");
check("классика: корпус, икры, базовое, одна нога → одна нога, базовое, икры, корпус", ids(orderWeek(wk([S("571"), S("26"), S("81"), S("443")]))) === "443,81,26,571", ids(orderWeek(wk([S("571"), S("26"), S("81"), S("443")]))));
check("внутри класса порядок прежний (две одноногие и два корпуса не меняются местами)", ids(orderWeek(wk([S("528"), S("876"), S("571"), S("443")]))) === "876,443,528,571");
check("нарушение называется словами: «класс идёт после большего»", orderViolations(wk([S("571"), S("443")])).some((x) => /класс идёт после большего/.test(x)));
const circ = wk([{ blockType: "Circuit", coachNotes: "3 круга", prescriptions: [P("571"), P("26"), P("443"), P("81"), P("876")] }]);
check("круг: класс 2 в начале, остальные — в своём порядке", ids(orderWeek(circ)) === "443+876+571+26+81", ids(orderWeek(circ)));
check("круг без класса 2 не трогается", ids(orderWeek(wk([{ blockType: "Circuit", coachNotes: null, prescriptions: [P("571"), P("26"), P("81")] }]))) === "571+26+81");
check("keepOrder: порядок не меняется и нарушением не считается («Зал» недели 1–4)", ids(orderWeek(wk([S("571"), S("443")], true))) === "571,443" && orderViolations(wk([S("571"), S("443")], true)).length === 0);
const gym = progs.find((p) => p.id === "gym")!.formats.classic;
check("«Зал» недели 1–4: прежний порядок, жим ногами первым", gym.filter((w) => w.week <= 4).every((w) => w.keepOrder && w.blocks[0].prescriptions[0].exerciseId === "custom:leg_press"));
check("«Зал» с недели 5: болгарский перед жимом ногами, порядок по классам", gym.filter((w) => w.week >= 5).every((w) => !w.keepOrder && w.blocks[0].prescriptions[0].exerciseId === "500" && w.blocks[1].prescriptions[0].exerciseId === "custom:leg_press" && orderViolations(w).length === 0));
check("у каждого упражнения программ есть класс", progs.every((p) => Object.values(p.formats).every((ws) => ws.every((w) => w.blocks.every((b) => b.prescriptions.every((x) => orderClass(x.exerciseId) != null))))));
let refused = false; try { await buildBody(wk([S("999999")]), { athleteId: 1, date: "2026-01-01", hidden: true, forWrite: true }); } catch (e) { refused = /нет класса порядка/.test(String(e)); }
check("упражнение без класса — сборка для записи отказывает", refused);
console.log(fails ? `\nИТОГ: ПАДЕНИЙ ${fails}` : "\nИТОГ: все проверки порядка прошли"); if (fails) process.exit(1);
