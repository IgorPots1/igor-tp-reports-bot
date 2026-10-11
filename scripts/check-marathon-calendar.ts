/**
 * Календарь до марафона: этапы, ключевые тренировки и плашка сроков.
 *
 * ЧТО СТЕРЕЖЁТ. Инструмент называет человеку конкретные даты, по которым тот
 * будет строить полгода жизни:
 *   — восемь контрольных случаев тренера (A-H), снятых с прототипа;
 *   — восстановление никогда не длиннее 4 недель;
 *   — дата последнего старта в будущем считается сегодняшней;
 *   — ДАТЫ СДВИГАЮТСЯ КАЛЕНДАРНЫМИ ДНЯМИ. Марафон в воскресенье значит все
 *     одиночные тренировки тоже в воскресенье, в том числе через переход на
 *     летнее и зимнее время. В первой версии прототипа сдвиг миллисекундами
 *     уронил длительную на субботу 30 января вместо воскресенья 31-го.
 *     Проверяется в нескольких часовых поясах, с переходами времени и без.
 *
 *   npm run check:marathon-calendar
 */

import assert from "node:assert/strict";

import {
  ERR_TOO_SOON,
  MAX_REC_WEEKS,
  NOTE_REC_NO_DATE,
  NOTE_REC_PAST,
  addDays,
  buildCalendar,
  dayMonth,
  defaultRaceDate,
  recoveryWeeks,
  toIsoDate,
  type CalendarInput,
  type CalendarResult,
  type CountId,
  type LastId,
} from "@/app/tools/calendar/calendar-logic";

type Ok = Extract<CalendarResult, { ok: true }>;

const BASE: CalendarInput = { race: "2027-04-11", km: "30p", last: "none", lastDate: "", count: "1to2" };

function run(over: Partial<CalendarInput>, today = new Date(2026, 9, 11)): CalendarResult {
  return buildCalendar({ ...BASE, ...over }, today);
}

function ok(r: CalendarResult, label: string): Ok {
  assert.ok(r.ok, `${label}: ожидался расчёт, а пришла ошибка ${r.ok ? "" : r.error}`);
  return r as Ok;
}

function iso(d: Date): string {
  return toIsoDate(d);
}

function phase(r: Ok, id: string) {
  return r.phases.find((p) => p.id === id && p.to > p.from);
}

function noLongDash(r: Ok, label: string) {
  const all = [r.phaseNow, r.weeksText, r.note, r.barLabel, ...r.timeline.flatMap((t) => [t.when, t.name, t.text])];
  for (const s of all) assert.ok(!/[—–]/.test(s), `${label}: длинное тире в «${s}»`);
}

function caseChecks() {
  // ── A: от 30 км, старта не было ─────────────────────────────────────────────
  {
    const r = ok(run({}), "A");
    assert.equal(r.phaseNow, "Межсезонье", "A: этап");
    assert.equal(r.fits, true, "A: плашка зелёная");
    assert.match(r.note, /у тебя 8 недель межсезонья/, "A: 8 недель межсезонья");
    assert.equal(r.weeksLeft, 26, "A: недель до марафона");
    const off = phase(r, "off")!;
    assert.equal(iso(off.to), "2026-12-06", "A: межсезонье по 6 декабря");
    const dev = phase(r, "dev")!;
    assert.equal(`${iso(dev.from)}..${iso(dev.to)}`, "2026-12-06..2027-02-14", "A: развитие 6 дек-14 фев");
    const mp = phase(r, "mp")!;
    assert.equal(`${iso(mp.from)}..${iso(mp.to)}`, "2027-02-14..2027-03-28", "A: МТ 14 фев-28 мар");
    const tp = phase(r, "taper")!;
    assert.equal(`${iso(tp.from)}..${iso(tp.to)}`, "2027-03-28..2027-04-11", "A: подводка 28 мар-11 апр");
    assert.equal(iso(r.dates.long25), "2027-01-31", "A: длительная 25 км 31 января");
    assert.equal(iso(r.dates.long30), "2027-02-28", "A: длительная 28-30 км 28 февраля");
    assert.equal(iso(r.dates.key), "2027-03-21", "A: главная 21 марта");
    assert.equal(phase(r, "rec"), undefined, "A: восстановления нет");
    // Одиночные тренировки показываются просто датой, без слова «неделя».
    const singles = r.timeline.filter((t) => ["long25", "long30", "key"].includes(t.kind));
    assert.deepEqual(singles.map((t) => t.when), ["31 января", "28 февраля", "21 марта"], "A: одиночные просто датой");
    for (const t of singles) assert.equal(t.date.getDay(), 0, `A: ${t.name} в воскресенье`);
    const cur = r.timeline.filter((t) => t.current);
    assert.equal(cur.length, 1, "A: метка «сейчас» ровно одна");
    assert.equal(cur[0].when, "с 11 октября по 6 декабря", "A: «сейчас» на межсезонье");
    noLongDash(r, "A");
  }

  // ── B: марафон 4 октября, 1-2 старта ────────────────────────────────────────
  {
    const r = ok(run({ last: "42", lastDate: "2026-10-04", count: "1to2" }), "B");
    assert.equal(r.phaseNow, "Восстановление", "B: этап");
    assert.equal(r.fits, true, "B: сходится");
    assert.match(r.note, /у тебя 6 недель межсезонья/, "B: 6 недель");
    const rec = phase(r, "rec")!;
    assert.equal(`${iso(rec.from)}..${iso(rec.to)}`, "2026-10-11..2026-10-25", "B: восстановление 11-25 октября");
    assert.ok(!r.note.includes(NOTE_REC_NO_DATE) && !r.note.includes(NOTE_REC_PAST), "B: без пометок про дату");
    noLongDash(r, "B");
  }

  // ── C: как B, но больше 5 стартов ───────────────────────────────────────────
  // 3 недели за марафон + 1 за число стартов = 4, предел. От 4 октября это
  // 1 ноября. В таблице наряда стоит «11-31 октября», но прототип, с которого
  // таблица снята, показывает «с 11 октября по 1 ноября»: конец этапа здесь
  // не включительно, ровно как «11-25 октября» в случае B (4 октября + 3 недели).
  // Расхождение передано тренеру, чек держит прототип.
  {
    const r = ok(run({ last: "42", lastDate: "2026-10-04", count: "6p" }), "C");
    assert.equal(r.phaseNow, "Восстановление", "C: этап");
    assert.equal(r.fits, true, "C: сходится");
    assert.match(r.note, /у тебя 5 недель межсезонья/, "C: 5 недель");
    const rec = phase(r, "rec")!;
    assert.equal(`${iso(rec.from)}..${iso(rec.to)}`, "2026-10-11..2026-11-01", "C: восстановление до 1 ноября (4 недели)");
    noLongDash(r, "C");
  }

  // ── D: 5-10 км 4 октября: неделя восстановления уже прошла ─────────────────
  {
    const r = ok(run({ last: "10", lastDate: "2026-10-04", count: "1to2" }), "D");
    assert.equal(r.phaseNow, "Межсезонье", "D: этап");
    assert.ok(r.note.startsWith(NOTE_REC_PAST), "D: «Восстановление после старта уже позади…»");
    assert.equal(r.fits, true, "D: сходится");
    assert.match(r.note, /у тебя 8 недель межсезонья/, "D: 8 недель");
    assert.equal(phase(r, "rec"), undefined, "D: этапа восстановления нет");
    assert.ok(!r.timeline.some((t) => t.kind === "rec"), "D: и в таймлайне его нет");
    noLongDash(r, "D");
  }

  // ── E: до 20 км, полумарафон 4 октября, 3-5 стартов ────────────────────────
  {
    const r = ok(run({ km: "lt20", last: "21", lastDate: "2026-10-04", count: "3to5" }), "E");
    assert.equal(r.phaseNow, "Восстановление", "E: этап");
    assert.equal(r.fits, false, "E: плашка оранжевая");
    assert.match(r.note, /^Времени на базу не хватает/, "E: не хватает базы");
    assert.match(r.note, /не раньше 18 апреля 2027\./, "E: не раньше 18 апреля 2027");
    const rec = phase(r, "rec")!;
    assert.equal(`${iso(rec.from)}..${iso(rec.to)}`, "2026-10-11..2026-10-18", "E: восстановление 11-18 октября");
    noLongDash(r, "E");
  }

  // ── F: от 30, марафон 17 января 2027 ───────────────────────────────────────
  {
    const r = ok(run({ race: "2027-01-17" }), "F");
    assert.equal(r.phaseNow, "Подготовка, развитие", "F: этап");
    assert.equal(r.fits, false, "F: оранжевая");
    assert.match(r.note, /^До марафона меньше 18 недель/, "F: меньше 18 недель");
    assert.match(r.note, /не раньше 14 февраля 2027, а на этом забеге пробежать полумарафон\./, "F: дата и полумарафон");
    assert.equal(phase(r, "off"), undefined, "F: без межсезонья");
    noLongDash(r, "F");
  }

  // ── G: до 20 км, марафон 7 марта 2027 ──────────────────────────────────────
  {
    const r = ok(run({ km: "lt20", race: "2027-03-07" }), "G");
    assert.equal(r.phaseNow, "Межсезонье", "G: этап");
    assert.equal(r.fits, false, "G: оранжевая");
    assert.match(r.note, /^Времени на базу не хватает: нужно ещё 8 недель/, "G: не хватает базы");
    assert.match(r.note, /не раньше 11 апреля 2027\./, "G: не раньше 11 апреля 2027");
    assert.match(phase(r, "off")!.text, /Сначала доведи объём хотя бы до 30 км в неделю\.$/, "G: про объём в межсезонье");
    noLongDash(r, "G");
  }

  // ── H: марафон 20 октября 2026 ─────────────────────────────────────────────
  {
    const r = run({ race: "2026-10-20" });
    assert.deepEqual(r, { ok: false, error: ERR_TOO_SOON }, "H: ошибка про 3 недели");
    // Граница: ровно через 21 день уже можно.
    assert.ok(run({ race: "2026-11-01" }).ok, "H: через 3 недели ровно считается");
    assert.equal(run({ race: "2028-10-12" }).ok, false, "H: дальше двух лет нельзя");
    assert.deepEqual(run({ race: "" }), { ok: false, error: null }, "H: пустая дата без ошибки");
  }
}

function ruleChecks() {
  // Восстановление никогда не больше 4 недель: перебор всех сочетаний.
  const lasts: LastId[] = ["none", "10", "21", "42"];
  const counts: CountId[] = ["1to2", "3to5", "6p"];
  for (const l of lasts) {
    for (const c of counts) {
      const w = recoveryWeeks(l, c);
      assert.ok(w <= MAX_REC_WEEKS, `восстановление ${l}/${c} = ${w} > 4`);
      const r = ok(run({ last: l, count: c, lastDate: "2026-10-11" }), `rec ${l}/${c}`);
      const rec = phase(r, "rec");
      if (rec) {
        const days = Math.round((Date.UTC(rec.to.getFullYear(), rec.to.getMonth(), rec.to.getDate()) - Date.UTC(rec.from.getFullYear(), rec.from.getMonth(), rec.from.getDate())) / 864e5);
        assert.ok(days <= 28, `этап восстановления ${l}/${c} длиннее 4 недель: ${days} дн.`);
      }
    }
  }
  assert.equal(recoveryWeeks("42", "6p"), 4, "марафон + больше 5 стартов = ровно 4");

  // Дата старта в будущем считается сегодняшней.
  {
    const r = ok(run({ last: "42", lastDate: "2026-10-20", count: "1to2" }), "будущий старт");
    const rec = phase(r, "rec")!;
    assert.equal(`${iso(rec.from)}..${iso(rec.to)}`, "2026-10-11..2026-11-01", "будущая дата = сегодня: 3 недели от 11 октября");
    assert.ok(!r.note.includes(NOTE_REC_NO_DATE), "будущая дата: это не «дата не указана»");
  }
  // Дата не указана: от сегодня и с подсказкой.
  {
    const r = ok(run({ last: "21", lastDate: "", count: "1to2" }), "без даты");
    assert.equal(iso(phase(r, "rec")!.to), "2026-10-25", "без даты: от сегодня");
    assert.ok(r.note.startsWith(NOTE_REC_NO_DATE), "без даты: подсказка указать дату");
  }
}

// Марафон в воскресенье: все одиночные тренировки и границы этапов в
// воскресенье. Перебор: каждое воскресенье на два года вперёд, сегодня в
// разные дни недели, включая дни перехода времени.
function sundayChecks(tz: string) {
  process.env.TZ = tz;
  const todays = [
    new Date(2026, 9, 11), new Date(2026, 9, 25, 3, 30), new Date(2027, 2, 14, 23, 59), new Date(2027, 2, 28, 0, 30),
    new Date(2026, 2, 29, 12), new Date(2026, 10, 1, 1, 15),
  ];
  let checked = 0;
  for (const today of todays) {
    // Значение по умолчанию тоже воскресенье, примерно через полгода.
    const def = defaultRaceDate(today);
    assert.equal(def.getDay(), 0, `${tz}: дата по умолчанию не воскресенье (${iso(def)})`);
    assert.ok(def.getHours() === 0, `${tz}: дата по умолчанию не в полночь`);

    let sunday = addDays(today, 21 + ((7 - addDays(today, 21).getDay()) % 7));
    const until = addDays(today, 730);
    while (sunday <= until) {
      const r = ok(buildCalendar({ ...BASE, race: iso(sunday) }, today), `${tz} ${iso(sunday)}`);
      for (const [name, d] of Object.entries(r.dates)) {
        if (name === "recEnd") continue;
        assert.equal(d.getDay(), 0, `${tz}, сегодня ${iso(today)}, марафон ${iso(sunday)}: ${name} = ${iso(d)} не воскресенье`);
        assert.equal(d.getHours(), 0, `${tz}: ${name} съехал с полуночи`);
      }
      for (const t of r.timeline) {
        if (["long25", "long30", "key", "race"].includes(t.kind)) {
          assert.equal(t.date.getDay(), 0, `${tz}: ${t.name} ${t.when} не воскресенье`);
          assert.equal(t.when.startsWith(dayMonth(t.date)), true, `${tz}: подпись ${t.when} не совпала с датой`);
        }
      }
      checked += 1;
      sunday = addDays(sunday, 7);
    }
  }
  return checked;
}

caseChecks();
ruleChecks();

// Пояса: Белград и Берлин (летнее время в Европе), Нью-Йорк (другие даты
// перехода), Сидней (южное полушарие), Москва и UTC (без переходов).
let total = 0;
for (const tz of ["Europe/Belgrade", "Europe/Berlin", "America/New_York", "Australia/Sydney", "Europe/Moscow", "UTC"]) {
  total += sundayChecks(tz);
  // Случаи A-H обязаны сходиться в любом поясе, а не только в поясе прогона.
  caseChecks();
  ruleChecks();
}

console.log(`check:marathon-calendar ok: 8 случаев A-H и правила в 6 поясах, ${total} марафонов по воскресеньям`);
