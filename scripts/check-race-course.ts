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
 *   — тактика: без цифр темпа, не больше 6 точек, есть финиш и старт;
 *   — трейловый шаблон (15.10.2026): без «толпы», шаг на крутом, спуск «3-5 м вперёд», фонарь до
 *     рассвета и после заката по контрольному времени, питание от 20 км; без длинного тире;
 *   — шоссе без «толпы» у ультра и малых стартов; восход и закат по формуле;
 *   — высоты из GPX организатора (эталон набора, когда цифры в тексте нет): точки без <ele> пропускаются;
 *   — урезанный разбор (15.10.2026): только когда ЕДИНСТВЕННАЯ причина — нет эталона набора; не прошедшие
 *     сверку, без трека и по схемам не публикуются вовсе; у урезанного нет профиля, набора, сброса
 *     (и по км), мини-профиля, а в точках и сути ни слова о подъёмах, спусках и наборе; точки — по
 *     поворотам, покрытию, ветру. Последний тест держит это на настоящих данных src/data/race-courses.
 *
 *   npm run check:race-course
 */

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkGain } from "./race-course/checks";
import { bearing, haversine, resample, simplifyTo, type LatLon } from "./race-course/geo";
import { keyPoints, keyPointsTrail } from "./race-course/key-points";
import { gainLoss, perKm, profileSeries, segments, smoothByDistance } from "./race-course/profile";
import { readGpxEle } from "./race-course/sources";
import { findTurns, keyPointsLite, liteEligible, litePublishable, liteSummary, makeLite, NO_REF_REASON, surfaceOf, surfaceRuns, surfaceText, type OsmWay } from "./race-course/lite";
import { sunTimes } from "./race-course/sun";
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

ok("восход и закат: Железноводск 1 ноября, МСК", () => {
  const t = sunTimes(44.13, 43.05, "2026-11-01", 180)!;
  assert.ok(t.sunrise >= 6 * 60 + 30 && t.sunrise <= 7 * 60, `восход ${t.sunrise}`);
  assert.ok(t.sunset >= 16 * 60 + 45 && t.sunset <= 17 * 60 + 15, `закат ${t.sunset}`);
  assert.equal(sunTimes(78, 15, "2026-06-21", 120), null, "полярный день");
});

// Профиль трейла: подъём 300 м на 3–6 км, спуск 300 м на 6–8 км; 50 км, старт в 6:00 до рассвета.
const trailCase = (opts: { startMin: number | null; cutoffMin: number | null; aid: Parameters<typeof keyPointsTrail>[0]["aid"]; total?: number }) => {
  const total = opts.total ?? 49.4;
  const pts = north(total);
  const dist = pts.map((_, i) => i * 50);
  const elev = dist.map((d) => (d < 3000 ? 300 : d < 6000 ? 300 + (d - 3000) * 0.1 : d < 8000 ? 600 - (d - 6000) * 0.15 : 300));
  const km = perKm(dist, elev, pts).map((k) => ({ ...k, wind: "cross" as const }));
  return keyPointsTrail({
    totalM: total * 1000, segments: segments(dist, elev, 3), perKm: km, wind: null,
    distanceKm: total, startMin: opts.startMin, cutoffMin: opts.cutoffMin, sun: { sunrise: 6 * 60 + 45, sunset: 17 * 60 }, aid: opts.aid,
  });
};

ok("трейл: без толпы, шаг на крутом, спуск, без длинного тире", () => {
  const kp = trailCase({ startMin: 9 * 60 + 30, cutoffMin: 6 * 60, aid: null });
  const all = kp.map((p) => p.text).join(" | ");
  assert.doesNotMatch(all, /толп/i, "на трейле толпы нет");
  assert.doesNotMatch(all, /—/, "без длинного тире");
  assert.match(all, /шагом выгоднее, чем бегом; палки, если разрешены/);
  assert.match(all, /по дыханию и пульсу, не по часам/);
  assert.match(all, /короткий частый шаг, смотри на 3-5 м вперёд\. На техничном спуске не обгоняй/);
  assert.doesNotMatch(all, /фонарь/, "старт днём и финиш до заката");
  assert.ok(kp.length <= 6);
});

ok("трейл: старт до рассвета и финиш после заката по контрольному времени, значит фонарь", () => {
  const night = trailCase({ startMin: 6 * 60, cutoffMin: 10 * 60, aid: null });
  assert.match(night[0].text, /^Старт до рассвета: налобный фонарь и запасные батарейки/);
  const late = trailCase({ startMin: 9 * 60 + 30, cutoffMin: 10 * 60, aid: null });
  assert.ok(late.some((p) => /Если бежишь дольше 7,5 ч, где-то здесь стемнеет/.test(p.text)), late.map((p) => p.text).join(" | "));
});

ok("трейл: питание по положению; пунктов не знаем, значит воду и еду с собой", () => {
  const known = trailCase({ startMin: 6 * 60, cutoffMin: 10 * 60, aid: { count: 3, known: [{ km: 37, name: "Феррум" }] } });
  assert.ok(known.some((p) => p.text === "На трассе 3 пункта питания, Феррум на 37 км: между ними больше 10 км, бери воду с собой."), known.map((p) => p.text).join(" | "));
  const none = trailCase({ startMin: 9 * 60 + 30, cutoffMin: null, aid: null, total: 29 });
  assert.ok(none.some((p) => p.text === "Воду и еду бери с собой на всю дистанцию: где пункты питания, уточни в положении."));
  const short = trailCase({ startMin: 11 * 60, cutoffMin: 90, aid: null, total: 9.6 });
  assert.ok(!short.some((p) => /пункт/i.test(p.text)), "короткая дистанция: про питание молчим");
});

ok("трейл: главный спуск не вытесняется ветром на том же километре", () => {
  // Вершина на 6,2 км, встречный ветер с 7-го по 10-й (точка ветра на 6,5 км, ближе 0,5 км к спуску):
  // спуск важнее (FerrumFest 19, 15.10.2026: ветер на 11,5 км вытеснял спуск с вершины).
  const total = 12;
  const pts = north(total);
  const dist = pts.map((_, i) => i * 50);
  const elev = dist.map((d) => (d < 3000 ? 300 : d < 6200 ? 300 + (d - 3000) * 0.1 : d < 9200 ? 620 - (d - 6200) * 0.1 : 320));
  const sides: ("head" | "cross")[] = Array.from({ length: total }, (_, i) => (i >= 6 && i <= 9 ? "head" : "cross"));
  const km = perKm(dist, elev, pts).map((k, i) => ({ ...k, wind: sides[i] }));
  const kp = keyPointsTrail({
    totalM: total * 1000, segments: segments(dist, elev, 3), perKm: km, wind: { dirLabel: "В", medianMs: 5 },
    distanceKm: total, startMin: 9 * 60, cutoffMin: null, sun: null, aid: null,
  });
  assert.ok(kp.some((p) => p.type === "descent" && p.km >= 6.1 && p.km <= 6.3), kp.map((p) => `${p.km} ${p.type}`).join(", "));
});

ok("шоссе: у ультра и малых стартов без «толпы», у массовых как было", () => {
  const pts = north(10);
  const dist = pts.map((_, i) => i * 50);
  const km = perKm(dist, dist.map(() => 50), pts).map((k) => ({ ...k, wind: "cross" as const }));
  const crowd = keyPoints({ totalM: 10000, segments: [], perKm: km, wind: null });
  assert.match(crowd[0].text, /в толпе/, "по умолчанию массовый старт: толпа есть, как раньше");
  const small = keyPoints({ totalM: 10000, segments: [], perKm: km, wind: null, crowd: false });
  assert.doesNotMatch(small.map((p) => p.text).join(" "), /толп/i);
});

ok("высоты из GPX: с <ele> берутся, без — пропускаются", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gpx-ele-"));
  const file = path.join(dir, "t.gpx");
  writeFileSync(file, `<gpx><trk><trkseg>
<trkpt lat="55.0" lon="37.0"><ele>120.5</ele><time>x</time></trkpt>
<trkpt lat="55.001" lon="37.0"></trkpt>
<trkpt lat="55.002" lon="37.0"><ele>131</ele></trkpt>
</trkseg></trk></gpx>`);
  const g = readGpxEle(file);
  assert.deepEqual(g.ele, [120.5, 131]);
  assert.deepEqual(g.points, [[55, 37], [55.002, 37]]);
});

// ── урезанный разбор ─────────────────────────────────────────────────────────
// Слова про высоту, которых в урезанном разборе быть не должно ни в точках, ни в сути.
const HEIGHT_WORDS = /подъ[её]м|спуск|набор \d|сброс \d|в горку|под уклон|перепад/i;

ok("урезанный: кто публикуется урезанным, а кто никак", () => {
  const base = { track: [[55, 37], [55.01, 37]] as [number, number][], source: { kind: "gpx_organizer", url: null, note: null } };
  const no = (reason: string | null, publish = false, kind = "gpx_organizer", track = base.track) =>
    liteEligible({ ...base, track, source: { ...base.source, kind }, checks: { ours: 1, organizer: null, student: null, publish, reason } });
  assert.equal(no(NO_REF_REASON), true, "единственная причина — нет эталона");
  assert.equal(no("набор по DEM 234 м расходится с цифрой организатора (450 м) на 48%, допуск 30%"), false, "сверка не пройдена (Drift Cross)");
  assert.equal(no("набор по DEM 132 м расходится с цифрой организатора (31 м) на 327%, допуск 30%"), false, "Hard Trail");
  assert.equal(no(`длина трека 12.2 км против дистанции 10 км (22%); ${NO_REF_REASON}`), false, "и длина не та");
  assert.equal(no(NO_REF_REASON, false, "scheme_reconstructed"), false, "по схеме — никогда");
  assert.equal(no(NO_REF_REASON, false, "gpx_organizer", []), false, "без трека");
  assert.equal(no(null, true), false, "полный разбор уже опубликован — урезанным не становится");
});

ok("урезанный: разворот на «туда-обратно», серпантин, прямая без поворотов", () => {
  // 2 км на север и обратно: один разворот на 2 км
  const out: LatLon[] = Array.from({ length: 21 }, (_, i) => [55 + i * 0.0009, 37] as LatLon);
  const turns = findTurns([...out, ...out.slice(0, -1).reverse()]);
  assert.equal(turns.length, 1);
  assert.ok(turns[0].deg >= 150 && Math.abs(turns[0].m - 2000) < 100, JSON.stringify(turns));
  assert.deepEqual(findTurns(out), [], "прямая — без поворотов");
  // серпантин: колена по 150 м, направление попеременно 60° и 300° — поворот 120° на каждом колене
  const zig: LatLon[] = [[55, 37]];
  for (let i = 1; i < 12; i++) zig.push([zig[i - 1][0] + 0.000675, zig[i - 1][1] + (i % 2 ? 0.00203 : -0.00203)]);
  const z = findTurns(zig);
  assert.ok(z.length >= 3, `серпантин: ${z.length}`);
  const pts = keyPointsLite({ totalM: 3000, trail: true, turns: z, runs: [], perKm: [], wind: null });
  assert.ok(pts.some((p) => /серпантин/.test(p.text)), JSON.stringify(pts));
});

ok("урезанный: покрытие по тегам OSM и участки от 500 м", () => {
  assert.equal(surfaceOf({ highway: "residential" }), "асфальт");
  assert.equal(surfaceOf({ highway: "track" }), "грунт");
  assert.equal(surfaceOf({ highway: "path" }), "тропа");
  assert.equal(surfaceOf({ highway: "path", surface: "asphalt" }), "асфальт");
  assert.equal(surfaceOf({ highway: "footway" }), null, "тротуар без surface — не гадаем");
  const runs = surfaceRuns([
    ...Array.from({ length: 10 }, (_, i) => ({ m: i * 100, s: "асфальт" as const })),
    { m: 1000, s: null }, { m: 1100, s: "тропа" as const },
    ...Array.from({ length: 10 }, (_, i) => ({ m: 1200 + i * 100, s: "грунт" as const })),
  ]);
  assert.deepEqual(runs.map((r) => r.s), ["асфальт", "грунт"], "короткая вставка и неизвестное поглощены");
  const pts = keyPointsLite({ totalM: 2200, trail: false, turns: [], runs, perKm: [], wind: null });
  assert.ok(pts.some((p) => p.type === "surface" && /асфальт кончается, дальше грунт/.test(p.text)), JSON.stringify(pts));
  assert.equal(liteSummary({ асфальт: 48, грунт: 52 }, 90, []), "грунт 52%, асфальт 48%");
  assert.equal(liteSummary({ асфальт: 60, грунт: 40 }, 30, []), "", "покрытие определено меньше чем на половине — не говорим");
});

ok("урезанный: makeLite убирает профиль, набор и сброс везде, точки без слов о высоте", () => {
  const track: LatLon[] = Array.from({ length: 41 }, (_, i) => [55 + (i <= 20 ? i : 40 - i) * 0.0009, 37] as LatLon);
  const ways: OsmWay[] = [{ tags: { highway: "track" }, geometry: [{ lat: 54.999, lon: 37 }, { lat: 55.02, lon: 37 }] }];
  const full = {
    raceId: "x:1", name: "Трейл", date: "2026-11-01", distanceKm: 4, source: { kind: "gpx_organizer", url: null, note: null },
    summary: "2 подъёма до 120 м", track, elevation: [[0, 100], [4, 140]] as [number, number][], gain: 230, loss: 228,
    perKm: [1, 2, 3, 4].map((km) => ({ km, gain: 50, loss: 50, bearing: 0, wind: "head" as const })),
    checks: { ours: 230, organizer: null, student: null, publish: false, reason: NO_REF_REASON },
    wind: { dir: 0, dirLabel: "С", medianMs: 4, p75Ms: 6, gustP75Ms: 9, years: 5, sample: 100 }, forecast: null,
    keyPoints: [{ km: 1, type: "climb" as const, text: "Подъём 120 м" }],
  };
  const l = makeLite(full, ways, true);
  assert.equal(l.checks.publish, true);
  assert.equal(l.checks.lite, true);
  assert.deepEqual(l.elevation, []);
  assert.equal(l.gain + l.loss + l.checks.ours, 0);
  assert.ok(l.perKm.every((k) => k.gain === 0 && k.loss === 0), "и по км");
  assert.ok(!l.keyPoints.some((p) => p.type === "climb" || p.type === "descent" || HEIGHT_WORDS.test(p.text)), JSON.stringify(l.keyPoints));
  assert.doesNotMatch(l.summary ?? "", HEIGHT_WORDS);
  assert.ok(l.keyPoints.some((p) => /^Разворот/.test(p.text)), "разворот найден");
});

// Было до 16.10.2026: текст на смене покрытия зависел только от того, КУДА сменилось, и «тропа → грунт»
// (Borisovo, 3,3 км) подписывалось как усложнение. Теперь — по направлению на шкале асфальт → грунт → тропа.
ok("урезанный: подсказка на смене покрытия по направлению", () => {
  const harder = /шаг короче, смотри под ноги/;
  const easier = /можно вернуться в свой темп, без рывка/;
  for (const [a, b] of [["асфальт", "грунт"], ["грунт", "тропа"], ["асфальт", "тропа"]] as const) {
    assert.match(surfaceText(a, b, true), harder, `${a} → ${b} тяжелее`);
    assert.doesNotMatch(surfaceText(a, b, true), easier);
  }
  for (const [a, b] of [["тропа", "грунт"], ["грунт", "асфальт"], ["тропа", "асфальт"]] as const) {
    assert.match(surfaceText(a, b, true), easier, `${a} → ${b} легче`);
    assert.doesNotMatch(surfaceText(a, b, true), /под ноги/);
  }
  const pts = keyPointsLite({ totalM: 3000, trail: true, turns: [], runs: [{ from: 0, to: 1000, s: "тропа" }, { from: 1000, to: 3000, s: "грунт" }], perKm: [], wind: null });
  assert.ok(pts.some((x) => /тропа кончается, дальше грунт: можно вернуться в свой темп/.test(x.text)), JSON.stringify(pts));
});

// Решение 16.10.2026: бедный урезанный (покрытие известно меньше чем на половине или точек меньше 3) не выходит.
ok("урезанный: бедный не публикуется", () => {
  assert.equal(litePublishable({ keyPoints: [1, 2, 3], surface: { known: 50 } }), true);
  assert.equal(litePublishable({ keyPoints: [1, 2, 3], surface: { known: 49 } }), false, "покрытие меньше половины");
  assert.equal(litePublishable({ keyPoints: [1, 2], surface: { known: 90 } }), false, "точек меньше 3");
});

// Было до 15.10.2026: без эталона разбор не публиковался вовсе (index.json — только полные). Теперь
// он публикуется урезанным; стережём на настоящих данных, что урезанный ни в одном месте не выдаёт
// высоту, а не прошедшие сверку, без трека и по схемам в index.json не попали.
ok("данные: урезанные без высот, не прошедшие сверку не опубликованы", () => {
  const dir = path.join(process.cwd(), "src", "data", "race-courses");
  const index = JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8")) as { slug: string; lite?: boolean; gain?: number | null; loss?: number | null; mini?: string; summary?: string; points?: { text: string }[] }[];
  const published = new Set(index.map((x) => x.slug));
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json") && x !== "index.json")) {
    const slug = f.replace(/\.json$/, "");
    const c = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    if (!c.checks.publish) { assert.ok(!published.has(slug), `${slug}: не публикуется, а в index.json`); continue; }
    assert.ok(!/scheme|схем/i.test(c.source.kind), `${slug}: трасса по схеме опубликована`);
    if (!c.checks.lite) continue;
    assert.equal(c.checks.reason, NO_REF_REASON, `${slug}: урезанным — только «нет эталона»`);
    assert.ok(litePublishable(c), `${slug}: бедный урезанный опубликован (покрытие ${c.surface?.known}%, точек ${c.keyPoints.length})`);
    assert.ok(c.elevation.length === 0 && c.gain === 0 && c.loss === 0, `${slug}: профиль или набор`);
    assert.ok(!c.keyPoints.some((p: { text: string }) => HEIGHT_WORDS.test(p.text)), `${slug}: слова о высоте в точках`);
    assert.doesNotMatch(c.summary ?? "", HEIGHT_WORDS, slug);
    const e = index.find((x) => x.slug === slug)!;
    assert.ok(e.lite === true && e.gain === null && e.loss === null && !e.mini, `${slug}: в index.json цифры или мини-профиль`);
    assert.ok(!(e.points ?? []).some((p) => HEIGHT_WORDS.test(p.text)), slug);
  }
  for (const s of ["probeg_78437-9k", "probeg_73615-7k", "probeg_78465", "probeg_84558", "probeg_85642-10k",
    // бедные урезанные (16.10.2026)
    "probeg_83333-5k", "probeg_83333-14k", "probeg_83333-28k", "probeg_83333-50k", "regplace_autumn-exacerbation-20k"]) {
    assert.ok(!published.has(s), `${s} не прошёл сверку — не публикуем`);
  }
});

console.log(`\ncheck:race-course: ${n} ok`);
