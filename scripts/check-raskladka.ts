/**
 * Раскладка Московского марафона: полный прогон расчёта.
 *
 * ЧТО СТЕРЕЖЁТ. Калькулятор отдаёт бегуну цифры, по которым он поедет на часах,
 * поэтому арифметика обязана сходиться без оговорок:
 *   — сумма времени по километрам равна цели, а не «почти» цели. Раньше промах
 *     был просто слагаемым в цене варианта, и решатель разменивал секунды цели
 *     на красоту полос: 50:00 «Ровный» давал 49:55, 3:15:00 не добирал 20 с;
 *   — контрольные точки сверки совпадают с накопленным временем в таблице;
 *   — средний темп равен цели, делённой на дистанцию;
 *   — каждый темп кратен пяти секундам;
 *   — на крайних кнопках нет нулей, минусов и абсурда;
 *   — километры пунктов питания совпадают с официальной схемой трассы 2026.
 *
 *   npm run check:raskladka
 *   npm run check:raskladka -- --table   (печатает таблицу прогонов)
 */

import assert from "node:assert/strict";

import {
  COURSES,
  buildPlan,
  formatDec,
  formatKm,
  formatPace,
  formatTime,
  parseTime,
  type Course,
  type Finish,
} from "@/app/tools/raskladka/pacing-logic";

const SHOW_TABLE = process.argv.includes("--table");
const rows: string[] = [];
let runs = 0;

function check(course: Course, label: string, target: number, finish: Finish) {
  const plan = buildPlan(course, target, finish);
  runs += 1;
  const what = `${course.name} ${label} ${finish === "even" ? "Ровный" : "С разгоном"}`;

  // ── 1. Сумма по километрам сходится с целью ───────────────────────────────
  // Допуск: четверть секунды на километр, опоздание считается вдвое. На десятке
  // это означает «только точно» и проверяется как точное равенство. На марафоне
  // последняя полоса 10,2 км, точное попадание там достижимо не для каждой цели,
  // и требовать его значит требовать кривую форму (см. missAllowance в логике).
  const allowance = Math.max(1, Math.round(course.total / 3));
  const sumSegs = plan.segs.reduce((a, s) => a + s.pace * s.len, 0);
  assert.ok(
    Math.abs(sumSegs - plan.total) < 0.01,
    `${what}: сумма по километрам ${sumSegs} не равна показанному финишу ${plan.total}`,
  );
  assert.ok(
    Math.abs(plan.diff - (target - plan.total)) < 0.01,
    `${what}: промах посчитан не от цели`,
  );
  if (Number.isInteger(course.total)) {
    assert.ok(
      Math.abs(plan.total - target) < 0.01,
      `${what}: цельнокилометровая дистанция обязана сходиться ровно, а вышло ${formatTime(plan.total)}`,
    );
    assert.equal(
      formatTime(plan.total),
      formatTime(target),
      `${what}: на экране финиш не совпадает с целью`,
    );
  } else {
    assert.ok(
      Math.abs(plan.diff) <= allowance + 0.01,
      `${what}: промах ${plan.diff} с больше допуска ${allowance} с`,
    );
    // НИКОГДА ПОЗЖЕ ЦЕЛИ: цель на часах это обещание успеть.
    assert.ok(
      plan.diff >= -0.01,
      `${what}: план финиширует ПОЗЖЕ цели на ${(-plan.diff).toFixed(0)} с`,
    );
  }

  // Последняя строка таблицы это и есть финиш.
  const lastCum = plan.segs[plan.segs.length - 1].cum;
  assert.ok(
    Math.abs(lastCum - plan.total) < 0.01,
    `${what}: последняя строка таблицы ${lastCum} не равна финишу ${plan.total}`,
  );

  // ── 2. Контрольные точки совпадают с накопленным временем таблицы ──────────
  plan.checks.forEach((ch) => {
    // считаем заново, по строкам таблицы, а не тем же кодом что в buildPlan
    let t = 0;
    for (const s of plan.segs) {
      if (s.to <= ch.km + 1e-9) {
        t = s.cum;
        continue;
      }
      if (s.from < ch.km) t = s.cum - s.pace * (s.to - ch.km);
      break;
    }
    assert.ok(
      Math.abs(t - ch.time) < 0.01,
      `${what}: сверка на ${ch.km} км даёт ${formatTime(ch.time)}, таблица ${formatTime(t)}`,
    );
    assert.ok(ch.time > 0, `${what}: сверка на ${ch.km} км неположительна`);
    assert.ok(ch.time < plan.total, `${what}: сверка на ${ch.km} км не раньше финиша`);
  });
  // Сверка идёт по возрастанию, без повторов.
  for (let i = 1; i < plan.checks.length; i += 1) {
    assert.ok(
      plan.checks[i].time > plan.checks[i - 1].time,
      `${what}: сверка не возрастает на ${plan.checks[i].km} км`,
    );
  }

  // ── 3. Средний темп равен цели, делённой на дистанцию ──────────────────────
  // Средний темп на экране считается от ПОКАЗАННОГО финиша, иначе он противоречил
  // бы собственной таблице страницы. На цельнокилометровой дистанции финиш равен
  // цели, поэтому это ровно «цель, делённая на дистанцию». На марафоне остаточный
  // промах до 11 с может сдвинуть округление на одну секунду: 4:59:54 на 42,2 км
  // это 7:06, а 5:00:00 это 7:07. Держим расхождение в пределах секунды.
  if (Number.isInteger(course.total)) {
    assert.equal(
      formatPace(plan.total / course.total),
      formatPace(target / course.total),
      `${what}: средний темп не равен цели, делённой на дистанцию`,
    );
  } else {
    assert.ok(
      Math.abs(plan.total / course.total - target / course.total) <= 1,
      `${what}: средний темп ушёл от цели больше чем на секунду`,
    );
  }

  // ── 4. Все темпы кратны пяти секундам ─────────────────────────────────────
  plan.bandPaces.forEach((p, i) => {
    assert.equal(p % 5, 0, `${what}: темп полосы ${i} (${p} с) не кратен пяти`);
  });
  plan.segs.forEach((s) => {
    assert.equal(s.pace % 5, 0, `${what}: темп километра ${s.to} не кратен пяти`);
  });

  // ── 5. Ни нулей, ни минусов, ни абсурда ───────────────────────────────────
  // Коридор человеческого бега: быстрее 2:00 и медленнее 12:00 на километр не
  // бывает ни у кого, кто вводит время в этот калькулятор.
  plan.segs.forEach((s) => {
    assert.ok(s.pace >= 120 && s.pace <= 720, `${what}: темп километра ${s.to} = ${s.pace} с, абсурд`);
    assert.ok(s.flatPace > 0, `${what}: ровный эквивалент на ${s.to} км неположителен`);
    assert.ok(s.flatPace >= 100 && s.flatPace <= 800, `${what}: ровный эквивалент на ${s.to} км абсурден`);
    assert.ok(s.len > 0, `${what}: нулевой километр ${s.to}`);
    assert.ok(s.cum > 0, `${what}: накопленное время на ${s.to} км неположительно`);
  });
  for (let i = 1; i < plan.segs.length; i += 1) {
    assert.ok(
      plan.segs[i].cum > plan.segs[i - 1].cum,
      `${what}: накопленное время не растёт на ${plan.segs[i].to} км`,
    );
  }
  plan.bandKm.forEach((km, i) => assert.ok(km > 0, `${what}: полоса ${i} нулевой длины`));
  assert.ok(
    Math.abs(plan.bandKm.reduce((a, b) => a + b, 0) - course.total) < 1e-6,
    `${what}: полосы в сумме не дают дистанцию`,
  );
  assert.equal(plan.bandPaces.length, course.bands.length, `${what}: полос и темпов разное число`);
  assert.ok(Number.isFinite(plan.shift), `${what}: сдвиг усилия не число`);
  assert.ok(Math.abs(plan.shift) < 12, `${what}: сдвиг усилия ${plan.shift} % вне здравого смысла`);

  // Спуск не бежится медленнее рабочей полосы: это был бы совет наоборот.
  assert.ok(
    plan.bandPaces[0] <= plan.bandPaces[1],
    `${what}: спуск (${formatPace(plan.bandPaces[0])}) медленнее рабочей полосы`,
  );

  const n = plan.bandPaces.length;
  assert.equal(plan.kick, finish === "kick", `${what}: стрелка разгона не совпадает с режимом`);
  if (finish === "kick") {
    assert.ok(
      plan.bandPaces[n - 1] <= plan.bandPaces[n - 2] - 5,
      `${what}: «С разгоном», а финишная полоса не быстрее предыдущей`,
    );
    // РАЗГОН МЯГКИЙ: не больше 15 с против САМОЙ МЕДЛЕННОЙ рабочей полосы.
    // Считать по соседней нельзя — на марафоне между холмистой серединой и
    // финишем стоит ровная часть, и настоящий размах за ней прячется.
    const work = Math.max(...plan.bandPaces.slice(1, n - 1));
    const kick = work - plan.bandPaces[n - 1];
    assert.ok(
      kick <= 15,
      `${what}: разгон ${kick} с против рабочего темпа, предел 15`,
    );
    assert.ok(kick >= 5, `${what}: разгон ${kick} с, это не разгон`);
  } else {
    // «Ровный» — та же цифра до конца, плюс-минус один шаг решётки.
    assert.ok(
      Math.abs(plan.bandPaces[n - 1] - plan.bandPaces[n - 2]) <= 5,
      `${what}: «Ровный», а финишная полоса ушла от рабочей больше чем на пять секунд`,
    );
  }
  // После спуска темп не ползёт вверх от полосы к полосе.
  for (let i = 2; i < n - 1; i += 1) {
    assert.ok(
      plan.bandPaces[i] <= plan.bandPaces[i - 1],
      `${what}: полоса ${i} медленнее предыдущей, хотя рельеф легче`,
    );
  }

  rows.push(
    [
      course.name,
      label,
      finish === "even" ? "Ровный" : "Разгон",
      plan.bandPaces.map(formatPace).join(" / "),
      formatTime(plan.total),
      Math.round(plan.diff) === 0 ? "в цель" : `на ${Math.round(plan.diff)} с раньше`,
      `${plan.shift >= 0 ? "+" : ""}${plan.shift.toFixed(1)} %`,
      plan.checks.map((ch) => formatTime(ch.time)).join(" · "),
    ].join(" | "),
  );
}

// ── Прогон: обе дистанции, все кнопки, оба режима финиша ─────────────────────
(["10", "42"] as const).forEach((id) => {
  const course = COURSES[id];
  course.presets.forEach((preset) => {
    const target = parseTime(preset);
    assert.ok(target !== null, `кнопка ${preset} не парсится`);
    (["even", "kick"] as Finish[]).forEach((finish) => check(course, preset, target as number, finish));
  });
});

// ── Значение по умолчанию обязано быть одной из кнопок ───────────────────────
(["10", "42"] as const).forEach((id) => {
  const course = COURSES[id];
  assert.ok(
    course.presets.includes(course.defaultTarget),
    `${course.name}: значение по умолчанию ${course.defaultTarget} не совпадает ни с одной кнопкой`,
  );
});

// ── Эталон тренера: 10 км, 50:00, «С разгоном» ───────────────────────────────
{
  const c = COURSES["10"];
  const p = buildPlan(c, parseTime("50:00") as number, "kick");
  assert.deepEqual(
    p.bandPaces.map(formatPace),
    ["4:55", "5:05", "4:55"],
    "эталон: темпы полос разошлись",
  );
  // км 1-3 по 4:55, км 4-8 по 5:05, км 9-10 по 4:55
  const paceAt = (km: number) => formatPace(p.segs.find((s) => s.to === km)?.pace ?? 0);
  [1, 2, 3].forEach((km) => assert.equal(paceAt(km), "4:55", `эталон: км ${km}`));
  [4, 5, 6, 7, 8].forEach((km) => assert.equal(paceAt(km), "5:05", `эталон: км ${km}`));
  [9, 10].forEach((km) => assert.equal(paceAt(km), "4:55", `эталон: км ${km}`));
  assert.deepEqual(
    p.checks.map((ch) => `${ch.km} ${formatTime(ch.time)}`),
    ["3 14:45", "5 24:55", "8 40:10"],
    "эталон: контрольные точки разошлись",
  );
  assert.equal(formatTime(p.total), "50:00", "эталон: финиш");
}

// ── Мягкий разгон: контрольные значения тренера ──────────────────────────────
// Заморожены 25.09.2026. Разгон считается от самой медленной рабочей полосы и
// не превышает 15 с; среди допустимых выбирается наименьший.
{
  const c = COURSES["10"];
  const expected: Record<string, string[]> = {
    "38:00": ["3:50", "3:50", "3:40"],
    "48:00": ["4:50", "4:50", "4:40"],
    "50:00": ["4:55", "5:05", "4:55"],
    "52:00": ["5:15", "5:15", "5:00"],
    "57:00": ["5:45", "5:45", "5:30"],
    "1:03:00": ["6:20", "6:20", "6:10"],
  };
  Object.entries(expected).forEach(([time, paces]) => {
    const p = buildPlan(c, parseTime(time) as number, "kick");
    assert.deepEqual(p.bandPaces.map(formatPace), paces, `мягкий разгон, 10 км ${time}`);
  });
}

// ── Кривой ввод не должен доходить до расчёта ────────────────────────────────
assert.equal(parseTime(""), null, "пустая строка");
assert.equal(parseTime("абв"), null, "буквы");
assert.equal(parseTime("50"), null, "одно число без двоеточия");
assert.equal(parseTime("50:00"), 3000, "минуты и секунды");
assert.equal(parseTime("4:00:00"), 14400, "часы, минуты, секунды");
assert.equal(parseTime("50,00"), 3000, "запятая вместо двоеточия");

// ── Пункты питания против официальной схемы трассы 2026 ──────────────────────
// Сверено 25.09.2026 с moscowmarathon.runc.run/trassa и
// moscowmarathon10km.runc.run. Организатор оговаривает, что расположение может
// измениться, поэтому список здесь заморожен вместе с датой сверки.
assert.deepEqual(
  COURSES["42"].stations.map((s) => s.km),
  [4.9, 8.3, 14.6, 16.3, 19.8, 23.8, 29.6, 33, 35.4, 37.2, 38.7],
  "марафон: километры пунктов разошлись с официальной схемой",
);
assert.deepEqual(
  COURSES["42"].stations.filter((s) => s.label.includes("гел")).map((s) => s.km),
  [19.8, 35.4],
  "марафон: гели только на 19,8 и 35,4 км",
);
assert.deepEqual(COURSES["10"].stations.map((s) => s.km), [4.7], "десятка: единственный пункт на 4,7 км");

// ── Расписание волн ─────────────────────────────────────────────────────────
assert.equal(COURSES["10"].start.first, "09:05", "десятка: первая массовая волна");
assert.equal(COURSES["10"].start.elite, "09:00", "десятка: элита");
assert.equal(COURSES["42"].start.first, "09:04", "марафон: первая массовая волна");
assert.equal(COURSES["42"].start.elite, "09:00", "марафон: элита");

// ── Десятичный разделитель: на странице всюду запятая ───────────────────────
assert.equal(formatDec(-2.5), "-2,5", "уклон со знаком");
assert.equal(formatDec(0), "0,0", "ноль");
assert.equal(formatDec(1.25, 2), "1,25", "два знака");
assert.equal(formatKm(42.2), "42,2", "дистанция");
assert.equal(formatKm(21.1), "21,1", "половина");
assert.equal(formatKm(10), "10", "целое без хвоста");
assert.ok(!formatDec(3.5).includes("."), "точка не пролезает");

if (SHOW_TABLE) {
  console.log("дистанция | цель | финиш | темпы полос | итог | промах | сдвиг | сверка");
  rows.forEach((r) => console.log(r));
}

console.log(`check:raskladka — ${runs} прогонов, все проверки пройдены`);
