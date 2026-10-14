/**
 * Разбор трассы (scripts/race-course): чистая логика без сети.
 *
 * ЧТО СТЕРЕЖЁТ:
 *   — набор и сброс: сумма положительных/отрицательных разниц; по километрам сумма
 *     совпадает с общей, разница на границе км не считается дважды;
 *   — сглаживание по дистанции: ступенька размывается в окне, ровный ряд не меняется,
 *     одиночный выброс DEM гасится;
 *   — ветер: «дует ОТКУДА» (метеоконвенция); бежим туда, откуда дует, значит встречный
 *     (≤45°), спиной к нему попутный (≥135°), иначе боковой; переход через 0/360;
 *   — роза по 8 румбам и перцентили;
 *   — правило 30%: расхождение набора больше 30% с любым доступным эталоном снимает
 *     публикацию и пишет причину; эталона нет, значит публикации не мешает;
 *   — тактика: без цифр темпа, не больше 6 точек, есть финиш и старт.
 *
 *   npm run check:race-course
 */

import assert from "node:assert/strict";

import { checkGain } from "./race-course/checks";
import { bearing, haversine, resample, simplifyTo, type LatLon } from "./race-course/geo";
import { keyPoints } from "./race-course/key-points";
import { gainLoss, perKm, profileSeries, segments, smoothByDistance } from "./race-course/profile";
import { angleBetween, percentile, prevailing, windSide, windStats } from "./race-course/wind";

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`ok  ${name}`);
};

// Прямая на север от (55, 37): 0.009° широты ≈ 1 км.
const north = (km: number, step = 0.05): LatLon[] => {
  const out: LatLon[] = [];
  for (let d = 0; d <= km + 1e-9; d += step) out.push([55 + d * 0.0089932, 37]);
  return out;
};

ok("гео: расстояние и азимут", () => {
  assert.ok(Math.abs(haversine([55, 37], [55.0089932, 37]) - 1000) < 2);
  assert.ok(Math.abs(bearing([55, 37], [56, 37]) - 0) < 0.01);
  assert.ok(Math.abs(bearing([55, 37], [55, 38]) - 90) < 1);
  assert.ok(Math.abs(bearing([55, 37], [54, 37]) - 180) < 0.01);
});

ok("гео: передискретизация 50 м сохраняет длину и концы", () => {
  const line: LatLon[] = [[55, 37], [55.0089932, 37], [55.0179864, 37]];
  const rs = resample(line, 50);
  assert.ok(Math.abs(rs.distM.at(-1)! - 2000) < 5);
  assert.deepEqual(rs.points[0], line[0]);
  assert.deepEqual(rs.points.at(-1), line.at(-1));
  for (let i = 1; i < rs.distM.length - 1; i++) assert.ok(Math.abs(rs.distM[i] - rs.distM[i - 1] - 50) < 1e-6);
});

ok("гео: упрощение до лимита точек", () => {
  const zig: LatLon[] = Array.from({ length: 3000 }, (_, i) => [55 + i * 0.0001, 37 + (i % 2) * 0.0002]);
  const s = simplifyTo(zig, 600);
  assert.ok(s.length <= 600 && s.length >= 2);
  assert.deepEqual(s[0], zig[0]);
  assert.deepEqual(s.at(-1), zig.at(-1));
});

ok("профиль: набор и сброс", () => {
  assert.deepEqual(gainLoss([100, 110, 105, 120, 90]), { gain: 25, loss: 35 });
  assert.deepEqual(gainLoss([5, 5, 5]), { gain: 0, loss: 0 });
});

ok("профиль: по км сумма равна общей, граница км не считается дважды", () => {
  const pts = north(3);
  const dist = pts.map((_, i) => i * 50);
  // Подъём 20 м на первом км, ровно второй, спуск 10 м на третьем.
  const elev = dist.map((d) => (d <= 1000 ? 100 + d * 0.02 : d <= 2000 ? 120 : 120 - (d - 2000) * 0.01));
  const k = perKm(dist, elev, pts);
  assert.equal(k.length, 3);
  assert.ok(Math.abs(k[0].gain - 20) < 1e-9 && k[0].loss === 0);
  assert.ok(k[1].gain === 0 && k[1].loss === 0);
  assert.ok(Math.abs(k[2].loss - 10) < 1e-9);
  const total = gainLoss(elev);
  assert.ok(Math.abs(k.reduce((s, x) => s + x.gain, 0) - total.gain) < 1e-9);
  assert.ok(Math.abs(k.reduce((s, x) => s + x.loss, 0) - total.loss) < 1e-9);
  assert.ok(k.every((x) => x.bearing === 0), "трек на север: азимут 0");
});

ok("профиль: неполный последний км", () => {
  const pts = north(2.5);
  const dist = pts.map((_, i) => i * 50);
  const k = perKm(dist, dist.map(() => 10), pts);
  assert.equal(k.length, 3);
  assert.equal(k[2].km, 3);
});

ok("сглаживание: ровный ряд не меняется, выброс гасится, ступенька размывается", () => {
  const dist = Array.from({ length: 41 }, (_, i) => i * 50);
  assert.deepEqual(smoothByDistance(dist, dist.map(() => 7), 250), dist.map(() => 7));
  const spike = dist.map((_, i) => (i === 20 ? 160 : 100));
  const s = smoothByDistance(dist, spike, 250);
  assert.ok(s[20] < 115, "выброс 60 м в окне 250 м (5 точек) гасится до ~12 м");
  assert.ok(gainLoss(s).gain < gainLoss(spike).gain / 4);
  const step = dist.map((d) => (d < 1000 ? 100 : 110));
  const st = smoothByDistance(dist, step, 250);
  assert.ok(st[19] > 100 && st[19] < 110 && st[0] === 100 && st[40] === 110);
  assert.ok(Math.abs(gainLoss(st).gain - 10) < 1e-9, "общий набор ступеньки сохраняется");
});

ok("профиль: участки с гистерезисом и ряд для публикации", () => {
  const dist = Array.from({ length: 61 }, (_, i) => i * 50);
  // Подъём 30 м до 1000 м с рябью 1 м, потом спуск 20 м.
  const elev = dist.map((d, i) => (d <= 1000 ? d * 0.03 + (i % 2) : 30 - (d - 1000) * 0.01));
  const segs = segments(dist, elev, 3);
  assert.equal(segs.filter((s) => s.kind === "up").length, 1, "рябь 1 м не дробит подъём");
  assert.ok(segs[0].kind === "up" && segs[0].delta >= 29);
  assert.ok(segs.some((s) => s.kind === "down" && s.delta >= 19));
  const p = profileSeries(dist, elev, 100);
  assert.equal(p[0][0], 0);
  assert.equal(p.at(-1)![0], 3);
  assert.equal(p.length, 31);
});

ok("ветер: сторона по углу, переход через 0/360", () => {
  assert.equal(angleBetween(350, 10), 20);
  assert.equal(angleBetween(0, 180), 180);
  assert.equal(windSide(0, 0), "head", "бежим на север, дует с севера: в лицо");
  assert.equal(windSide(10, 350), "head");
  assert.equal(windSide(45, 0), "head", "ровно 45°: встречный");
  assert.equal(windSide(46, 0), "cross");
  assert.equal(windSide(134, 0), "cross");
  assert.equal(windSide(135, 0), "tail", "ровно 135°: попутный");
  assert.equal(windSide(180, 0), "tail", "бежим на юг, дует с севера: в спину");
  assert.equal(windSide(90, 0), "cross");
});

ok("ветер: роза по 8 румбам, штиль не голосует, перцентили", () => {
  const obs = [
    { speed: 3, dir: 225, gust: 6 }, { speed: 4, dir: 230, gust: 7 }, { speed: 5, dir: 200, gust: 9 },
    { speed: 2, dir: 90, gust: 4 }, { speed: 0.2, dir: 90, gust: 1 }, { speed: 0.3, dir: 90, gust: 1 },
  ];
  const p = prevailing(obs);
  assert.equal(p.dir, 225);
  assert.equal(p.dirLabel, "ЮЗ");
  assert.equal(p.rose[2], 1, "штиль < 0,5 м/с в розу не идёт");
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(percentile([1, 2, 3, 4, 5], 0.75), 4);
  const st = windStats(obs, 1);
  assert.equal(st.sample, 6);
  assert.equal(st.dirLabel, "ЮЗ");
  assert.equal(prevailing([{ speed: 3, dir: 350, gust: null }]).dirLabel, "С", "350° ближе к северу");
});

ok("правило 30%: эталоны организатора и ученика", () => {
  assert.deepEqual(checkGain(100, null, null), { ours: 100, organizer: null, student: null, publish: true, reason: null });
  assert.equal(checkGain(129, 100, null).publish, true, "29% в допуске");
  assert.equal(checkGain(130, 100, null).publish, true, "ровно 30% ещё в допуске");
  const bad = checkGain(131, 100, null);
  assert.equal(bad.publish, false);
  assert.match(bad.reason!, /организатора/);
  const badStudent = checkGain(100, 100, 60);
  assert.equal(badStudent.publish, false, "расхождение с ЛЮБЫМ эталоном снимает публикацию");
  assert.match(badStudent.reason!, /ученика/);
  assert.equal(checkGain(65, 100, null).publish, false, "меньше эталона на 35% тоже не публикуем");
  assert.equal(checkGain(100, 100, null, ["длина трека не та"]).publish, false);
});

ok("тактика: 5–6 точек, без цифр темпа, есть старт и финиш", () => {
  const pts = north(10);
  const dist = pts.map((_, i) => i * 50);
  const elev = dist.map((d) => (d < 3000 ? 100 : d < 5000 ? 100 + (d - 3000) * 0.02 : d < 6000 ? 140 - (d - 5000) * 0.03 : 110));
  const km = perKm(dist, elev, pts).map((k) => ({ ...k, wind: windSide(k.bearing, 0) }));
  const kp = keyPoints({ totalM: 10000, segments: segments(dist, elev, 3), perKm: km, wind: { dirLabel: "С", medianMs: 4 } });
  assert.ok(kp.length >= 5 && kp.length <= 6, `точек ${kp.length}`);
  assert.ok(kp.some((p) => p.type === "climb" && p.km >= 2.9 && p.km <= 3.1), "подъём с 3-го км");
  assert.ok(kp.some((p) => p.type === "descent"));
  assert.ok(kp.some((p) => p.type === "wind"), "на север при северном ветре: встречный отрезок");
  assert.ok(kp[0].km === 0 && /Старт/.test(kp[0].text));
  assert.ok(kp.some((p) => /Финиш/.test(p.text)));
  for (const p of kp) assert.doesNotMatch(p.text, /\d+[:.]\d{2}\s*(\/|мин|на км)|мин\/км|темп \d/i, "никаких цифр темпа");
  const sorted = [...kp].sort((a, b) => a.km - b.km);
  assert.deepEqual(kp, sorted);
});

ok("тактика: плоская трасса без ветра", () => {
  const pts = north(21);
  const dist = pts.map((_, i) => i * 50);
  const km = perKm(dist, dist.map(() => 50), pts).map((k) => ({ ...k, wind: "cross" as const }));
  const kp = keyPoints({ totalM: 21000, segments: [], perKm: km, wind: { dirLabel: "З", medianMs: 2 } });
  assert.ok(kp.length >= 5 && kp.length <= 6, `точек ${kp.length}`);
  assert.ok(kp.some((p) => /плоский/.test(p.text)));
  assert.ok(!kp.some((p) => p.type === "wind"), "слабый ветер не упоминаем");
  assert.ok(!kp.some((p) => p.type === "climb" || p.type === "descent"));
});

ok("тактика: финиш по последним 1000 м, а не по неполному последнему км", () => {
  const pts = north(10.2);
  const dist = pts.map((_, i) => i * 50);
  const km = perKm(dist, dist.map(() => 50), pts).map((k) => ({ ...k, wind: "cross" as const }));
  const kp = keyPoints({ totalM: 10200, segments: [], perKm: km, wind: null, finishStretch: { gain: 20, loss: 2 } });
  assert.ok(kp.some((p) => /Финишный километр в горку/.test(p.text)));
});

ok("тактика: один встречный км не повод, длинный попутный отрезок упоминаем", () => {
  const pts = north(10);
  const dist = pts.map((_, i) => i * 50);
  const base = perKm(dist, dist.map(() => 50), pts);
  const sides: ("head" | "tail" | "cross")[] = ["cross", "cross", "head", "cross", "tail", "tail", "tail", "tail", "cross", "cross"];
  const km = base.map((k, i) => ({ ...k, wind: sides[i] }));
  const kp = keyPoints({ totalM: 10000, segments: [], perKm: km, wind: { dirLabel: "З", medianMs: 4 } });
  const w = kp.filter((p) => p.type === "wind");
  assert.equal(w.length, 1);
  assert.match(w[0].text, /в спину/);
  assert.match(w[0].text, /С 5-го по 8-й км/);
});

console.log(`\ncheck:race-course: ${n} ok`);
