/**
 * Тест готовности к марафону: логика вердикта, базы и прогноза.
 *
 * ЧТО СТЕРЕЖЁТ. Инструмент называет человеку дату старта и время на марафон,
 * и ошибка здесь не косметическая:
 *   — БАЗА ЭТО МАКСИМУМ, А НЕ СУММА. Нехватки стажа, объёма, частоты и
 *     длительной лечатся одними и теми же неделями спокойного бега. Сложить их
 *     значит назвать срок вчетверо больше настоящего и отпугнуть человека;
 *   — БОЛЬ ОБРЫВАЕТ РАСЧЁТ. Регулярная боль на марафонских объёмах усиливается,
 *     и дата старта поверх неё это приглашение в травму;
 *   — прогноз считается от степенной формулы и округляется до пяти минут, иначе
 *     «3:57:43» читается как обещание, которым он не является.
 *
 *   npm run check:marathon-ready
 */

import assert from "node:assert/strict";

import {
  PREP_WEEKS,
  buildPlan,
  formatTime,
  parseTime,
  plural,
  resultLooksReal,
  round5min,
  type Answers,
} from "@/app/tools/marathon/marathon-logic";
import { joinTime } from "@/components/time-parts";

const TODAY = new Date("2026-10-02T12:00:00Z");

// ── Пять контрольных прогонов тренера ────────────────────────────────────────
{
  const p = buildPlan(
    { exp: "2p", km: "30to45", runs: "4", long: "15to21", pain: "no" },
    TODAY,
  );
  assert.equal(p.verdict, "Можно начинать подготовку", "прогон 1: вердикт");
  assert.equal(p.base, 0, "прогон 1: база");
  assert.equal(p.stop, false, "прогон 1: боли нет");
}
{
  const p = buildPlan(
    { exp: "1to2", km: "20to30", runs: "3", long: "10to15", pain: "no" },
    TODAY,
  );
  assert.equal(p.verdict, "Почти можно", "прогон 2: вердикт");
  assert.equal(p.base, 3, "прогон 2: база");
}
{
  const p = buildPlan(
    { exp: "6to12", km: "lt20", runs: "1to2", long: "lt10", pain: "no" },
    TODAY,
  );
  assert.equal(p.verdict, "Пока рано", "прогон 3: вердикт");
  // МАКСИМУМ, А НЕ СУММА: 13 против 8 + 4 + 5 + 13 = 30.
  assert.equal(p.base, 13, "прогон 3: база это максимум из четырёх нехваток");
}
{
  // Боль перебивает ЛЮБЫЕ ответы, в том числе идеальные.
  const best: Answers = { exp: "2p", km: "45p", runs: "5p", long: "21p", pain: "often" };
  const worst: Answers = { exp: "lt6", km: "lt20", runs: "1to2", long: "lt10", pain: "often" };
  [best, worst].forEach((a, i) => {
    const p = buildPlan(a, TODAY);
    assert.equal(p.verdict, "Сначала разберись с болью", `прогон 4.${i + 1}: вердикт`);
    assert.equal(p.stop, true, `прогон 4.${i + 1}: расчёт оборван`);
    assert.equal(p.date, null, `прогон 4.${i + 1}: даты быть не должно`);
    assert.equal(p.raceNote, null, `прогон 4.${i + 1}: предупреждения о забеге быть не должно`);
  });
}
{
  // Полумарафон 1:53:00 → от 3:55 до 4:05.
  const p = buildPlan(
    { exp: "2p", km: "30to45", runs: "4", long: "15to21", pain: "no", resTime: 6780, resDist: 21.0975 },
    TODAY,
  );
  assert.ok(p.forecast, "прогон 5: прогноз посчитан");
  assert.equal(formatTime(p.forecast!.lo), "3:55:00", "прогон 5: нижняя граница");
  assert.equal(formatTime(p.forecast!.hi), "4:05:00", "прогон 5: верхняя граница");
}

// ── База: максимум, а не сумма, на каждой паре нехваток ──────────────────────
{
  const only = (a: Answers) => buildPlan({ exp: "2p", km: "30to45", runs: "4", long: "15to21", pain: "no", ...a }, TODAY).base;
  assert.equal(only({ exp: "lt6" }), 36, "стаж меньше полугода");
  assert.equal(only({ exp: "6to12" }), 13, "стаж полгода-год");
  assert.equal(only({ km: "lt20" }), 8, "объём до 20");
  assert.equal(only({ km: "20to30" }), 3, "объём 20-30");
  assert.equal(only({ runs: "1to2" }), 4, "1-2 тренировки");
  assert.equal(only({ long: "lt10" }), 5, "длинная до 10");
  assert.equal(only({ km: "lt20", runs: "1to2", long: "lt10" }), 8, "три нехватки сразу: максимум, не 17");
}

// ── Дата: сегодня + база + подготовка ────────────────────────────────────────
{
  const p = buildPlan({ exp: "1to2", km: "20to30", runs: "3", long: "10to15", pain: "no" }, TODAY);
  assert.equal(p.prep, PREP_WEEKS, "подготовка всегда 18 недель");
  assert.equal(p.total, p.base + p.prep, "итог это база плюс подготовка");
  const expected = new Date(TODAY.getTime() + (3 + 18) * 7 * 864e5);
  assert.equal(p.date?.toISOString().slice(0, 10), expected.toISOString().slice(0, 10), "дата марафона");
  assert.equal(
    p.baseEnd?.toISOString().slice(0, 10),
    new Date(TODAY.getTime() + 3 * 7 * 864e5).toISOString().slice(0, 10),
    "конец базы",
  );
}
{
  const p = buildPlan({ exp: "2p", km: "45p", runs: "5p", long: "21p", pain: "no" }, TODAY);
  assert.equal(p.baseEnd, null, "базы нет — и конца базы нет");
}

// ── Предупреждение про выбранный забег ───────────────────────────────────────
{
  // база 13 + подготовка 18 = 31 неделя, любой выбранный срок раньше
  const late: Answers = { exp: "6to12", km: "lt20", runs: "1to2", long: "lt10", pain: "no" };
  (["lt3", "3to4", "4to6", "6p"] as const).forEach((race) => {
    const p = buildPlan({ ...late, race }, TODAY);
    assert.ok(p.raceNote?.startsWith("Твой марафон раньше"), `забег ${race}: ждём предупреждение`);
  });
  assert.equal(buildPlan({ ...late, race: "none" }, TODAY).raceNote, null, "забег не выбран — молчим");
}
{
  // база 0, подготовка 18: срок «больше полугода» (30 нед) с запасом покрывает
  const ready: Answers = { exp: "2p", km: "30to45", runs: "4", long: "15to21", pain: "no" };
  assert.ok(buildPlan({ ...ready, race: "6p" }, TODAY).raceNote?.startsWith("По срокам всё сходится"), "срок сходится");
  // а «меньше трёх месяцев» это 12 недель против нужных 18
  assert.ok(buildPlan({ ...ready, race: "lt3" }, TODAY).raceNote?.startsWith("Твой марафон раньше"), "12 недель мало даже с базой");
}

// ── Прогноз ──────────────────────────────────────────────────────────────────
{
  // 10 км за 50:00 — степень 1,06 и 1,12 от отношения дистанций
  const p = buildPlan(
    { exp: "2p", km: "30to45", runs: "4", long: "15to21", pain: "no", resTime: 3000, resDist: 10 },
    TODAY,
  );
  assert.ok(p.forecast!.lo % 300 === 0 && p.forecast!.hi % 300 === 0, "обе границы кратны пяти минутам");
  assert.ok(p.forecast!.lo < p.forecast!.hi, "нижняя граница быстрее верхней");
  assert.ok(p.forecast!.lo > 3000 * 4, "марафон не может быть быстрее четырёх десяток");
}
assert.equal(buildPlan({ exp: "2p", km: "45p", runs: "5p", long: "21p", pain: "no" }, TODAY).forecast, null, "без результата прогноза нет");
assert.equal(round5min(3 * 60 + 59), 300, "округление вверх до пяти минут");
assert.equal(round5min(149), 0, "округление вниз");

// ── Валидация ввода ──────────────────────────────────────────────────────────
assert.equal(parseTime("52:30"), 3150, "минуты и секунды");
assert.equal(parseTime("1:55:00"), 6900, "часы, минуты, секунды");
assert.equal(parseTime(""), null, "пусто");
assert.equal(parseTime("абв"), null, "буквы");
assert.equal(resultLooksReal(10, 27 * 60), true, "10 км: нижняя граница 27:00");
assert.equal(resultLooksReal(10, 95 * 60), true, "10 км: верхняя граница 1:35:00");
assert.equal(resultLooksReal(10, 26 * 60), false, "10 км: быстрее мирового рекорда");
assert.equal(resultLooksReal(10, 96 * 60), false, "10 км: за гранью");
assert.equal(resultLooksReal(21.0975, 60 * 60), true, "полумарафон: нижняя граница");
assert.equal(resultLooksReal(21.0975, 210 * 60), true, "полумарафон: верхняя граница");
assert.equal(resultLooksReal(21.0975, 59 * 60), false, "полумарафон: быстрее рекорда");

// ── Ввод тремя полями ────────────────────────────────────────────────────────
// На айфоне цифровая клавиатура без двоеточия, поэтому время набирается тремя
// полями. Собранная строка обязана разбираться в то же число секунд, что и
// набранная руками, иначе валидация диапазонов начнёт врать.
assert.equal(parseTime(joinTime({ h: "", m: "52", s: "30" })), 52 * 60 + 30, "52:30 на десятке");
assert.equal(parseTime(joinTime({ h: "1", m: "55", s: "00" })), 6900, "1:55:00 на полумарафоне");
assert.equal(parseTime(joinTime({ h: "1", m: "53", s: "00" })), 6780, "1:53:00, контрольный прогноз");
assert.equal(joinTime({ h: "", m: "", s: "" }), "", "все три пустые — прогноза не будет");
// Секунды без ведущего нуля человек наберёт как «5», а не «05».
assert.equal(parseTime(joinTime({ h: "", m: "52", s: "5" })), 52 * 60 + 5, "секунды в одну цифру");
assert.equal(parseTime(joinTime({ h: "1", m: "5", s: "0" })), 3900, "минуты в одну цифру при часах");

// ── Склонение недель в подзаголовке ──────────────────────────────────────────
assert.equal(plural(1, "неделя", "недели", "недель"), "неделя");
assert.equal(plural(3, "неделя", "недели", "недель"), "недели");
assert.equal(plural(5, "неделя", "недели", "недель"), "недель");
assert.equal(plural(11, "неделя", "недели", "недель"), "недель");
assert.ok(buildPlan({ exp: "2p", km: "20to30", runs: "4", long: "15to21", pain: "no" }, TODAY).sub.includes("3 недели"));

// ── Ни одного длинного тире в текстах, которые увидит человек ────────────────
{
  const p = buildPlan(
    { exp: "6to12", km: "20to30", runs: "1to2", long: "lt10", pain: "some", race: "lt3", resTime: 6780, resDist: 21.0975 },
    TODAY,
  );
  const texts = [
    p.verdict, p.sub, p.nextStep, p.shareText, p.raceNote ?? "",
    ...p.checks.flatMap((c) => [c.title, c.text]),
  ];
  texts.forEach((t) => assert.ok(!/[—–]/.test(t), `длинное тире в тексте: «${t}»`));
}

console.log("check:marathon-ready — все проверки пройдены");
