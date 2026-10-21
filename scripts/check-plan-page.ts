/**
 * Страница плана ученицы (plan-page) и её связка с ботом. Только чистая
 * логика: без базы, без сети, без Telegram.
 *
 * ЧТО СТЕРЕЖЁТ [решения Игоря, 21.10.2026]:
 * - «Тренер ответил» несёт ПЕРВУЮ СОДЕРЖАТЕЛЬНУЮ строку, а не приветствие и
 *   не весь текст;
 * - каждая кнопка ведёт в нужное место страницы, а не на главную;
 * - отозванная ссылка и ссылка с чужим именем не открываются;
 * - страница не индексируется и не отдаёт адрес с токеном в Referer;
 * - отчёт без боли тренеру не звонит; боль звонит один раз;
 * - утром боль идёт первой, выше сообщений;
 * - «где бегала» решает, что спрашиваем: дорожка — скорость, улица — дистанция;
 * - текст боту передаётся тренеру только из личного чата с ботом: не из лички
 *   с тренером (бизнес), не из групп, не команды.
 *
 *   npm run check:plan-page
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { shouldAlertPain } from "@/features/intervals/plan-page/actions";
import { isRelayCandidate } from "@/features/intervals/plan-page/bot-relay";
import {
  PLAN_TOKEN_RE,
  coachReplyNoticeRu,
  defaultSurface,
  firstMeaningfulLine,
  newPlanToken,
  orderCoachAlerts,
  planPageUrl,
  reportAsks,
  slugFromStudentId,
} from "@/features/intervals/plan-page/core";
import { linkOpens } from "@/features/intervals/plan-page/links";
import { buildScheme, weekRangeLabel } from "@/features/intervals/plan-page/view";
import { reportDayFor } from "@/features/intervals/plan-page/report-day";
import { todayIsoInZone } from "@/features/intervals/loop/clock";
import { validateManualEntry } from "@/features/intervals/manual-entry";

// ── Первая содержательная строка ответа ──────────────────────────────────────
// Начала — дословно из её настоящих ответов тренера (intervals_coach_messages).
const real: [string, string][] = [
  ["Добрый день, Валентина.\n\nПро отрезки. То, что первые три дались тяжело, а дальше стало легче.", "Про отрезки. То, что первые три дались тяжело, а дальше стало легче."],
  ["Добрый день, Валентина.\n\nРазбор недели. Коротко: она сложилась, и сложилась хорошо.", "Разбор недели. Коротко: она сложилась, и сложилась хорошо."],
  ["Добрый день. Отвечаю с опозданием: вы болели, и это было важнее переписки.", "Отвечаю с опозданием: вы болели, и это было важнее переписки."],
  ["Добрый день. Разбор недели, первой полной после болезни.\n\nОтрезки в четверг.", "Разбор недели, первой полной после болезни."],
  ["Уточнение к разбору: неделю я пересобрал, она не легче, а чуть длиннее прошлой.", "Уточнение к разбору: неделю я пересобрал, она не легче, а чуть длиннее прошлой."],
];
for (const [body, want] of real) assert.equal(firstMeaningfulLine(body), want, `живой ответ: «${body.slice(0, 30)}…»`);

const greetings = [
  "Валентина, здравствуйте!\nПро пятку: напишите, болит ли утром.",
  "Здравствуйте, Валентина!\n\nПро пятку: напишите, болит ли утром.",
  "Добрый вечер.\nПро пятку: напишите, болит ли утром.",
  "Привет!\n\nПро пятку: напишите, болит ли утром.",
  "Доброе утро, Валентина. Про пятку: напишите, болит ли утром.",
  "Валентина,\n\nПро пятку: напишите, болит ли утром.",
];
for (const body of greetings) {
  assert.equal(firstMeaningfulLine(body), "Про пятку: напишите, болит ли утром.", `приветствие пропущено: «${body.split("\n")[0]}»`);
}
// Не приветствие — не трогаем, даже если начинается похоже.
assert.equal(firstMeaningfulLine("Добрый день прошёл в зале, и это хорошо."), "Добрый день прошёл в зале, и это хорошо.");
assert.ok(firstMeaningfulLine("А".repeat(400)).length <= 160, "в уведомлении одна строка, не простыня");

const notice = coachReplyNoticeRu(real[0][0]);
assert.ok(notice.startsWith("Тренер ответил:"), "уведомление называет, что это ответ тренера");
assert.ok(!notice.includes("Добрый день"), "приветствия в уведомлении нет");
assert.ok(!notice.includes("\n\n"), "в уведомлении не весь текст");

// ── Куда ведут кнопки ────────────────────────────────────────────────────────
const link = { slug: "valentina", token: "a".repeat(48) };
assert.ok(planPageUrl(link).endsWith("/plan/valentina/" + "a".repeat(48)));
assert.ok(planPageUrl(link, { kind: "session", sessionId: "s1" }).endsWith("?s=s1"), "ответ — карточка тренировки");
assert.ok(planPageUrl(link, { kind: "coach" }).endsWith("?tab=coach"), "разбор недели — вкладка «Тренер»");
assert.ok(planPageUrl(link, { kind: "week", weekStart: "2026-10-19" }).endsWith("?w=2026-10-19"), "«план готов» — неделя");
assert.ok(planPageUrl(link).startsWith("https://"), "кнопка-ссылка: только https");

// ── Ссылка: токен, отзыв, чужое имя ──────────────────────────────────────────
const t1 = newPlanToken();
assert.ok(PLAN_TOKEN_RE.test(t1) && t1.length === 48, "токен — 48 hex");
assert.notEqual(newPlanToken(), t1, "токены не повторяются");
assert.equal(slugFromStudentId("valentina-0798"), "valentina");
assert.equal(linkOpens({ slug: "valentina", revoked_at: null }, "valentina"), true, "живая ссылка открывается");
assert.equal(linkOpens({ slug: "valentina", revoked_at: "2026-10-21T10:00:00Z" }, "valentina"), false, "отозванная НЕ открывается");
assert.equal(linkOpens({ slug: "valentina", revoked_at: null }, "ilya"), false, "чужое имя при верном токене — 404");

const pageCode = readFileSync("src/app/plan/[slug]/[token]/page.tsx", "utf8");
assert.ok(pageCode.includes("robots: { index: false, follow: false }"), "страница не индексируется");
assert.ok(pageCode.includes('referrer: "no-referrer"'), "адрес с токеном не уходит в Referer");
assert.ok(pageCode.includes("isPlanPageEnabled()"), "без флага страница ученицы не открывается");

// ── Боль и утренняя очередь ──────────────────────────────────────────────────
assert.equal(shouldAlertPain("no_pain", null), false, "отчёт без боли тренеру не звонит");
assert.equal(shouldAlertPain("pain", null), true, "боль звонит");
assert.equal(shouldAlertPain("pain", "2026-10-21T08:00:00Z"), false, "правка того же отчёта второй раз не звонит");
const queue = orderCoachAlerts([
  { kind: "message" as const, at: "2026-10-21T01:00:00Z", id: "m1" },
  { kind: "pain" as const, at: "2026-10-21T05:00:00Z", id: "p1" },
  { kind: "message" as const, at: "2026-10-21T02:00:00Z", id: "m2" },
  { kind: "pain" as const, at: "2026-10-21T03:00:00Z", id: "p0" },
]);
assert.deepEqual(queue.map((x) => x.id), ["p0", "p1", "m1", "m2"], "утром боль первой, внутри вида — по времени");

// ── Где бегала → что спрашиваем ──────────────────────────────────────────────
assert.deepEqual(reportAsks("treadmill", false), ["speed"], "дорожка, ровный бег — скорость с панели");
assert.deepEqual(reportAsks("treadmill", true), ["workRestSpeed"], "дорожка, интервалы — работа и восстановление");
assert.deepEqual(reportAsks("street", false), ["distance"], "улица — дистанция");
assert.deepEqual(reportAsks("street", true), ["distance"], "улица, интервалы — только дистанция");
assert.equal(defaultSurface(["Улица / парк", "Дорожка"]), "treadmill", "в анкете оба — по умолчанию дорожка");
assert.equal(defaultSurface(["Улица / парк"]), "street");

// ── Текст боту → тренеру: только личный чат с ботом ──────────────────────────
const msg = { message_id: 1, text: "Заболела, температура", chat: { id: 7, type: "private" }, from: { id: 7 } };
const coach = (id: number) => id === 1;
assert.equal(isRelayCandidate(msg, coach), true, "её текст боту — тренеру");
assert.equal(isRelayCandidate({ ...msg, business_connection_id: "b" }, coach), false, "личку с тренером не трогаем");
assert.equal(isRelayCandidate({ ...msg, chat: { id: -100, type: "supergroup" } }, coach), false, "группы не трогаем");
assert.equal(isRelayCandidate({ ...msg, text: "/start" }, coach), false, "команды не перехватываем");
assert.equal(isRelayCandidate({ ...msg, chat: { id: 1, type: "private" }, from: { id: 1 } }, coach), false, "тренер сам себе не пересылается");
assert.equal(isRelayCandidate({ ...msg, text: "  " }, coach), false, "пустое не пересылаем");

// ── Схема и неделя ───────────────────────────────────────────────────────────
const handBuilt = buildScheme({
  steps: [
    { name: "Ходьба", detail: "5-6 км/ч.", target: { kind: "free", text: "шагом" }, minutes: 5 },
    { name: "Лёгкий бег", detail: "Скорость подобрать самой, разговорный темп.", target: { kind: "self_discovery" }, minutes: 30 },
  ],
  segments: null,
  description: null,
  minutes: 35,
  title: "Лёгкий бег",
});
assert.deepEqual(handBuilt.main.map((x) => x.v), ["5′", "30′"], "рукописная неделя: шаги тренера как есть");
const intervals = buildScheme({
  steps: null,
  segments: [
    { label: "Ходьба", minutes: 5, fastSec: null, slowSec: null, noPaceText: "Спокойный шаг." },
    { label: "Отрезок 1", minutes: 6, fastSec: null, slowSec: null, noPaceText: "усилие 6 из 10" },
    { label: "Шагом", minutes: 1.5, fastSec: null, slowSec: null, noPaceText: "Просто идти." },
    { label: "Отрезок 2", minutes: 6, fastSec: null, slowSec: null, noPaceText: "усилие 6 из 10" },
    { label: "Шагом", minutes: 1.5, fastSec: null, slowSec: null, noPaceText: "Просто идти." },
    { label: "Отрезок 3", minutes: 6, fastSec: null, slowSec: null, noPaceText: "усилие 6 из 10" },
    { label: "Заминка", minutes: 5, fastSec: null, slowSec: null, noPaceText: "Пока дыхание не вернётся." },
  ],
  description: null,
  minutes: 30,
  title: "3 x 6",
});
assert.equal(intervals.rep?.count, 3, "повторы схлопнуты в «× 3»");
assert.deepEqual(intervals.rep?.steps.map((x) => x.v), ["6′", "1:30"], "отрезок и отдых, 1.5 мин = 1:30");
assert.equal(intervals.warm.length, 1);
assert.equal(intervals.cool.length, 1);
assert.equal(weekRangeLabel("2026-10-19"), "19–25 октября", "вверху даты недели");
assert.equal(weekRangeLabel("2026-09-28"), "28 сентября – 4 октября", "через границу месяца");

// ── «Отметить» на каждой карточке текущей недели [решение Игоря, 21.10.2026] ─
// Раньше кнопка была только у прошедших и сегодняшних карточек: пробежку в
// среду вместо пятницы отметить было нечем. Сама пробежка в будущем быть не
// может, поэтому будущая тренировка отмечается СЕГОДНЯШНИМ днём и переезжает
// на сегодня. Неделя Валентины 19–25.10, сегодня ср 21.10.
const wk = "2026-10-19";
const today = "2026-10-21";
assert.deepEqual(reportDayFor({ sessionDate: "2026-10-22", weekStart: wk, todayIso: today }), { ok: true, reportDate: today, moveToToday: true },
  "чт 22.10 отмечается: отчёт сегодняшним днём, тренировка переезжает на сегодня");
assert.deepEqual(reportDayFor({ sessionDate: "2026-10-25", weekStart: wk, todayIso: today }), { ok: true, reportDate: today, moveToToday: true },
  "вс 25.10 отмечается так же");
assert.deepEqual(reportDayFor({ sessionDate: today, weekStart: wk, todayIso: today }), { ok: true, reportDate: today, moveToToday: false },
  "сегодняшняя — без переноса");
assert.deepEqual(reportDayFor({ sessionDate: "2026-10-19", weekStart: wk, todayIso: today }), { ok: true, reportDate: "2026-10-19", moveToToday: false },
  "прошедшая — своим днём, как было, никакого переноса");
for (const d of ["2026-10-22", "2026-10-25"]) {
  const r = reportDayFor({ sessionDate: d, weekStart: wk, todayIso: today });
  assert.ok(r.ok && r.reportDate <= today, `отчёт о ${d} никогда не ложится в будущее`);
}
assert.equal(reportDayFor({ sessionDate: "2026-10-28", weekStart: "2026-10-26", todayIso: today }).ok, false,
  "следующая неделя заранее не отмечается: перенос между неделями запрещён (move.ts)");

// ── «Сегодня» в ручном вводе — по её поясу, не по UTC [21.10.2026] ──────────
// БЫЛО: сравнение с new Date().toISOString() — с 00:00 до 03:00 по Москве UTC
// ещё «вчера», и сегодняшняя пробежка отбивалась как «дата в будущем». Держим
// строже, чем «не падает»: в 00:30 МСК её сегодняшний день ПРИНИМАЕТСЯ, а
// завтрашний по-прежнему ОТБИВАЕТСЯ.
const at0030msk = new Date("2026-10-21T21:30:00Z"); // 22.10, 00:30 по Москве; в UTC ещё 21.10
const todayMsk = todayIsoInZone("Europe/Moscow", at0030msk);
assert.equal(todayMsk, "2026-10-22", "в 00:30 по Москве у неё уже 22-е");
assert.equal(at0030msk.toISOString().slice(0, 10), "2026-10-21", "а UTC ещё живёт 21-м — ровно та ловушка");
const entryOn = (date: string) => ({
  sourceId: "x", date, durationMinutes: 35, distanceKm: null, averageHeartrate: null, averagePaceSecPerKm: null,
  planSessionId: null, effortCode: "simple_good", painCode: "no_pain", commentText: null,
});
assert.equal(validateManualEntry(entryOn("2026-10-22"), todayMsk), null, "в 00:30 МСК сегодняшняя пробежка (22.10) принимается");
assert.ok(validateManualEntry(entryOn("2026-10-23"), todayMsk)?.includes("будущем"), "завтрашняя (23.10) по-прежнему отбивается");
assert.equal(validateManualEntry(entryOn("2026-10-21"), todayMsk), null, "вчерашняя принимается");

console.log("check:plan-page — все проверки пройдены");
