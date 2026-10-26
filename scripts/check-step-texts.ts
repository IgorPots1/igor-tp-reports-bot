/**
 * Тексты шагов: ключи, эталоны, правка тренировки, «подобрать самой».
 * Только чистая логика и реальная сборка недели генератором; без базы и сети.
 *
 * ЧТО СТЕРЕЖЁТ [решения Игоря, 21.10.2026]:
 * - «подобрать / подберите сами» нет ни в одной строке генератора и ни в одной
 *   подписи интерфейса (в админке — «по ощущению», в мини-аппе плашки нет);
 * - каждый шаг генератора, у которого есть ключ, его несёт;
 * - эталон подставляется по ключу; у отрезка «усилие N из 10» остаётся
 *   генераторным — числа эталоном не становятся;
 * - диапазоны в эталоне отбиваются;
 * - описание у генератора и админки — одна функция, и с эталонами тренера оно
 *   разбирается обратно (verifyRoundTrip);
 * - правка из админки пишет «было → стало», ставит эталон только у текста
 *   с ключом, повторы правятся разом, описание и минуты пересобираются.
 *
 *   npm run check:step-texts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { renderSegmentsDescription } from "@/features/intervals/step-texts/describe";
import { applySessionEdit, editableRows, type EditableSession } from "@/features/intervals/step-texts/edit";
import { applyStepText, etalonTextFor, etalonTextProblem, guessStepKey, STEP_KEYS } from "@/features/intervals/step-texts/keys";
import { startingPointFromAnswers } from "@/features/intervals/onboarding/starting-point";
import type { OnboardingAnswers } from "@/features/intervals/onboarding/types";

const EASY = "Разговорный темп: можете говорить предложениями. Если тяжело дышать, сбавьте или перейдите на шаг.";
const LONG = "Спокойнее обычной лёгкой. Задача не быстрее, а ровно до конца: к концу должно оставаться ощущение, что можете ещё.";

// ── «Подобрать самой» — ни в одной строке генератора и интерфейса ────────────
// Комментарии (история решений) не в счёт: ищем только строковые литералы.
const SELF_PICK_IN_STRING = /["'`][^"'`\n]*(подобрать\s+сам|подберите\s+сам|подбирайте\s+сам)[^"'`\n]*["'`]/iu;
const LIB = "tools/trainingpeaks-export/scripts/lib";
const generatorFiles = readdirSync(LIB).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => join(LIB, f));
const uiFiles = ["src/app/m/run/page.tsx", "src/app/admin/coach-os/beginner/[studentUuid]/page.tsx", "src/app/plan/[slug]/[token]/RunPlanView.tsx"];
for (const file of [...generatorFiles, ...uiFiles]) {
  const hit = readFileSync(file, "utf8").split("\n").find((line) => SELF_PICK_IN_STRING.test(line) && !/^\s*(\/\/|\*)/.test(line));
  assert.equal(hit, undefined, `«подобрать самой» осталось в ${file}: ${hit?.trim()}`);
}
const admin = readFileSync("src/app/admin/coach-os/beginner/[studentUuid]/page.tsx", "utf8");
assert.ok(admin.includes('"по ощущению"'), "в админке шаг без цифры подписан «по ощущению»");
const miniApp = readFileSync("src/app/m/run/page.tsx", "utf8");
assert.ok(/self_discovery"\) return "";/.test(miniApp), "в мини-аппе плашки «подобрать» нет совсем");

// ── Эталон: подстановка по ключу, числа не трогает ───────────────────────────
const etalons = { easy_main_treadmill: EASY, interval_work: "держите ровно, последний не быстрее первого" };
assert.equal(applyStepText({ key: "easy_main_treadmill" as const, noPaceText: "старый" }, etalons).noPaceText, EASY, "лёгкая основная — текст из эталона");
assert.equal(
  applyStepText({ key: "interval_work" as const, noPaceText: "усилие 6 из 10, дышать заметно чаще" }, etalons).noPaceText,
  "усилие 6 из 10, держите ровно, последний не быстрее первого",
  "у отрезка «усилие N из 10» остаётся генераторным, эталон — после"
);
assert.equal(applyStepText({ noPaceText: "без ключа" }, etalons).noPaceText, "без ключа", "шаг без ключа эталоном не правится");
assert.equal(applyStepText({ key: "cooldown" as const, noPaceText: "свой" }, etalons).noPaceText, "свой", "нет эталона — текст генератора");
assert.equal(etalonTextFor("interval_work", "усилие 7 из 10, дышать тяжело"), "дышать тяжело", "в эталон отрезка число не попадает");

// ── Диапазоны отбиваются, тексты тренера проходят ────────────────────────────
assert.equal(etalonTextProblem("easy_main_treadmill", EASY), null);
assert.equal(etalonTextProblem("long_main_treadmill", LONG), null);
assert.ok(etalonTextProblem("easy_main_street", "держите 6:30–7:00 на километр"), "диапазон темпа отбит");
assert.ok(etalonTextProblem("warmup_walk", "Ходьба 5-6 км/ч."), "диапазон скорости отбит");
assert.ok(etalonTextProblem("cooldown", "   "), "пустое отбито");

// ── Догадка ключа у рукописных шагов ─────────────────────────────────────────
assert.equal(guessStepKey({ name: "Лёгкий бег", role: "easy", onTreadmill: true, index: 1, count: 2 }), "easy_main_treadmill");
assert.equal(guessStepKey({ name: "Ходьба", role: "easy", onTreadmill: true, index: 0, count: 2 }), "warmup_walk");
assert.equal(guessStepKey({ name: "Бег", role: "quality", onTreadmill: true, index: 0, count: 2 }), "interval_work");
assert.equal(guessStepKey({ name: "Заминка", role: "quality", onTreadmill: true, index: 5, count: 6 }), "cooldown");
assert.equal(guessStepKey({ name: "Равномерный бег", role: "long", onTreadmill: false, index: 1, count: 3 }), "long_main_street");

// ── Реальная неделя генератора на дорожке: ключи, тексты, эталоны ────────────
const { buildWeek, renderDescription, setStepTextEtalons, verifyRoundTrip } = await import(
  "../tools/trainingpeaks-export/scripts/lib/autoplanner-week.ts"
);
const { buildAnchors, buildEnvelope } = await import("../tools/trainingpeaks-export/scripts/lib/intervals-plan-adapter.ts");
const { stubCatalog } = await import("../tools/trainingpeaks-export/scripts/lib/cycle-check-stubs.ts");
const answers: OnboardingAnswers = {
  sourceId: "s", goalKind: "regular", raceDate: null, raceDistanceKm: null,
  daysPerWeek: 3, selfReportedWeeklyMinutes: 150, unavailableWeekdays: [], preferredLongWeekday: 6,
  canRunContinuously: true, runSurfaces: ["Дорожка"],
};
const start = startingPointFromAnswers(answers, { manualEasyPaceSec: 7 * 60 + 22 });
const anchors = { ...buildAnchors(start, null), runsOnTreadmill: true, qualityByEffort: true };
const env = buildEnvelope(start);

setStepTextEtalons({});
const plain = buildWeek(anchors, env, stubCatalog(), "2026-10-26", false);
const plainSegs = plain.sessions.flatMap((s: { segments: { key?: string; noPaceText?: string }[] }) => s.segments);
assert.ok(plainSegs.length > 0, "неделя собралась");
const easyMain = plainSegs.filter((s: { key?: string }) => s.key === "easy_main_treadmill" || s.key === "long_main_treadmill");
assert.ok(easyMain.length > 0, "основная часть лёгкой/длительной на дорожке несёт ключ");
for (const s of easyMain) assert.ok(s.noPaceText === EASY || s.noPaceText === LONG, `текст генератора по умолчанию — тренерский: «${s.noPaceText}»`);
for (const s of plainSegs) {
  assert.ok(!/подобрать\s+сам/iu.test(s.noPaceText ?? ""), `в шаге генератора «${s.noPaceText}»`);
  if (s.key) assert.ok((STEP_KEYS as readonly string[]).includes(s.key), `ключ из списка: ${s.key}`);
}
assert.ok(plainSegs.some((s: { key?: string }) => s.key === "warmup_walk"), "у ходьбы в начале есть ключ");
assert.ok(plainSegs.some((s: { key?: string }) => s.key === "cooldown"), "у заминки есть ключ");

setStepTextEtalons({ easy_main_treadmill: "ЭТАЛОН ЛЁГКОЙ", cooldown: "ЭТАЛОН ЗАМИНКИ" });
const withEtalon = buildWeek(anchors, env, stubCatalog(), "2026-10-26", false);
const etSegs = withEtalon.sessions.flatMap((s: { segments: { key?: string; noPaceText?: string }[] }) => s.segments);
assert.ok(etSegs.filter((s: { key?: string }) => s.key === "easy_main_treadmill").every((s: { noPaceText?: string }) => s.noPaceText === "ЭТАЛОН ЛЁГКОЙ"), "генератор берёт текст из эталона");
assert.ok(etSegs.filter((s: { key?: string }) => s.key === "cooldown").every((s: { noPaceText?: string }) => s.noPaceText === "ЭТАЛОН ЗАМИНКИ"), "заминка — из эталона");
for (const sess of withEtalon.sessions as { minutes: number; segments: { minutes: number }[] }[]) {
  const before = (plain.sessions as { minutes: number }[]).find((p, i) => i === withEtalon.sessions.indexOf(sess));
  if (before) assert.equal(sess.minutes, before.minutes, "эталон не меняет минуты");
}
setStepTextEtalons({});

// ── Описание: одна функция, с текстами тренера разбирается обратно ──────────
const segs = [
  { minutes: 5, label: "Ходьба", fastSec: null, slowSec: null, noPaceText: "Спокойный шаг, пять-шесть км/ч, разогреться." },
  { minutes: 32, label: "Ровный лёгкий бег", fastSec: null, slowSec: null, noPaceText: EASY, key: "easy_main_treadmill" as const },
  { minutes: 3, label: "Заминка, спокойный бег или шаг", fastSec: null, slowSec: null, noPaceText: "Пока дыхание не вернётся в норму." },
];
assert.equal(renderDescription(segs), renderSegmentsDescription(segs), "описание генератора и админки — одно");
assert.equal(verifyRoundTrip(renderDescription(segs), segs).ok, true, "текст тренера (с двоеточием) не ломает разбор описания");
const longSegs = [{ ...segs[1], noPaceText: LONG, label: "Длительный ровный бег" }];
assert.equal(verifyRoundTrip(renderDescription(longSegs), longSegs).ok, true, "текст длительной не ломает разбор");

// ── Правка из админки ────────────────────────────────────────────────────────
const generated: EditableSession = {
  id: "g1", role: "quality", title: "4 x 5 мин", minutes: 40, description: "старое",
  notes: [{ title: null, body: "старая заметка", audience: "student" }, { title: "Разбор", body: "служебное", audience: "coach" }],
  segments: [
    { minutes: 5, label: "Ходьба", fastSec: null, slowSec: null, noPaceText: "Спокойный шаг.", key: "warmup_walk" },
    { minutes: 5, label: "Отрезок 1", fastSec: null, slowSec: null, noPaceText: "усилие 6 из 10, дышать чаще", key: "interval_work" },
    { minutes: 1.5, label: "Шагом", fastSec: null, slowSec: null, noPaceText: "Просто идти.", key: "interval_rest" },
    { minutes: 5, label: "Отрезок 2", fastSec: null, slowSec: null, noPaceText: "усилие 6 из 10, дышать чаще", key: "interval_work" },
    { minutes: 3, label: "Заминка", fastSec: null, slowSec: null, noPaceText: "Пока дыхание не вернётся.", key: "cooldown" },
  ],
  steps: null,
};
const rows = editableRows(generated, true);
assert.deepEqual(rows.map((r) => r.path), ["s:0", "g:interval_work", "g:interval_rest", "s:4"], "повторы — одной строкой");
assert.equal(rows.find((r) => r.path === "g:interval_work")?.times, 2);

const res = applySessionEdit(
  generated,
  {
    title: "4 x 5 мин",
    note: "новая заметка",
    rows: [
      { path: "s:0", text: "Спокойный шаг.", minutes: 5, key: "warmup_walk" },
      { path: "g:interval_work", text: "усилие 6 из 10, ровно, последний не быстрее первого", minutes: 6, key: "interval_work" },
      { path: "g:interval_rest", text: "Шагом 5-6 км/ч", minutes: 1.5, key: "interval_rest" },
      { path: "s:4", text: "Пока дыхание не вернётся.", minutes: 3, key: "cooldown" },
    ],
  },
  true,
);
const work = res.patch.segments!.filter((s) => s.key === "interval_work");
assert.ok(work.every((s) => s.minutes === 6 && s.noPaceText === "усилие 6 из 10, ровно, последний не быстрее первого"), "правка отрезка легла на все повторы");
assert.equal(res.patch.minutes, 22, "минуты тренировки пересчитаны: 5 + 6 + 1,5 + 6 + 3 = 21,5 → 22");
assert.ok(res.patch.description?.includes("ровно, последний не быстрее первого"), "описание пересобрано из новых шагов");
assert.ok(res.patch.notes?.some((n) => n.audience === "coach" && n.body === "служебное"), "служебная заметка не потеряна");
assert.equal(res.patch.notes?.find((n) => n.audience === "student")?.body, "новая заметка");
const workChange = res.changes.find((c) => c.field === "step_text" && c.stepKey === "interval_work");
assert.deepEqual(workChange?.etalon, { key: "interval_work", text: "ровно, последний не быстрее первого" }, "эталон отрезка — без «усилие N из 10»");
const restChange = res.changes.find((c) => c.field === "step_text" && c.stepKey === "interval_rest");
assert.equal(restChange?.etalon, null, "текст с диапазоном эталоном не стал");
assert.ok(restChange?.etalonSkipped, "…и это названо");
assert.ok(res.changes.some((c) => c.field === "step_minutes" && c.before === "5" && c.after === "6" && c.etalon === null), "минуты — в историю, но не в эталон");
assert.ok(res.changes.some((c) => c.field === "note" && c.before === "старая заметка" && c.after === "новая заметка"), "заметка: было → стало");

// Рукописная неделя (как 22.10 у Валентины): ключ выбирает тренер.
const hand: EditableSession = {
  id: "h1", role: "easy", title: "Лёгкий бег", minutes: 35, description: null, notes: null, segments: null,
  steps: [
    { name: "Ходьба", detail: "5-6 км/ч.", minutes: 5, target: { kind: "free", text: "шагом" } },
    { name: "Лёгкий бег", detail: "старый текст", minutes: 30, target: { kind: "self_discovery" } },
  ],
};
const handRows = editableRows(hand, true);
assert.equal(handRows[1].key, null, "у рукописного шага ключа нет");
assert.equal(handRows[1].guessedKey, "easy_main_treadmill", "…но есть догадка");
const handRes = applySessionEdit(hand, { title: "Лёгкий бег", note: "", rows: [
  { path: "h:0", text: "5-6 км/ч.", minutes: 5, key: null },
  { path: "h:1", text: EASY, minutes: 30, key: "easy_main_treadmill" },
] }, true);
assert.deepEqual(handRes.changes.map((c) => c.field), ["step_text"], "изменился только текст шага");
assert.deepEqual(handRes.changes[0].etalon, { key: "easy_main_treadmill", text: EASY }, "текст с выбранным ключом — эталон");
assert.equal(handRes.patch.steps?.[1].key, "easy_main_treadmill", "ключ записан в шаг");
assert.equal(handRes.patch.description, undefined, "у рукописной описания нет — и не появляется");
const noKey = applySessionEdit(hand, { title: "Лёгкий бег", note: "", rows: [{ path: "h:1", text: "другое", minutes: 30, key: null }] }, true);
assert.equal(noKey.changes[0].etalon, null, "без ключа правка эталоном не становится");

// ── Догаданный ключ в нетронутый шаг НЕ пишется [наряд Игоря, 26.10.2026] ────
// БЫЛО: при сохранении ключ из выпадающего списка записывался в КАЖДЫЙ шаг, даже
// нетронутый, — догадка становилась ключом без выбора тренера (поймано на
// проверке 22.10: «Ходьба» тестовой карточки получила warmup_walk). Держим
// строже, чем «ключа нет»: нетронутый шаг возвращается ТЕМ ЖЕ объектом.
{
  const rowsHand = editableRows(hand, true);
  const shown = (i: number) => rowsHand[i].key ?? rowsHand[i].guessedKey;
  const r = applySessionEdit(hand, { title: "Лёгкий бег", note: "", rows: [
    { path: "h:0", text: "5-6 км/ч.", minutes: 5, key: shown(0), keyShown: shown(0) },
    { path: "h:1", text: EASY, minutes: 30, key: "easy_main_treadmill", keyShown: shown(1) },
  ] }, true);
  assert.equal(r.patch.steps?.[0], hand.steps![0], "нетронутый шаг — тот же объект: ни текста, ни минут, ни догаданного ключа");
  assert.equal(r.patch.steps?.[0].key, undefined, "догадка «Разминка: ходьба» в шаг не записана");
  assert.equal(r.patch.steps?.[1].key, "easy_main_treadmill", "у правленого шага ключ записан");

  const onlyKey = applySessionEdit(hand, { title: "Лёгкий бег", note: "", rows: [
    { path: "h:0", text: "5-6 км/ч.", minutes: 5, key: "warmup_easy", keyShown: shown(0) },
    { path: "h:1", text: "старый текст", minutes: 30, key: shown(1), keyShown: shown(1) },
  ] }, true);
  assert.equal(onlyKey.patch.steps?.[0].key, "warmup_easy", "ключ, ЯВНО сменённый тренером, записан");
  assert.equal(onlyKey.patch.steps?.[0].detail, "5-6 км/ч.", "…текст не тронут");
  assert.equal(onlyKey.patch.steps?.[0].minutes, 5, "…минуты не тронуты");
  assert.equal(onlyKey.patch.steps?.[1], hand.steps![1], "второй шаг не трогали — тот же объект");
  assert.equal(onlyKey.changes.length, 0, "смена одного ключа — не правка текста или минут, эталона нет");

  const nothing = applySessionEdit(hand, { title: "Лёгкий бег", note: "", rows: [
    { path: "h:0", text: "5-6 км/ч.", minutes: 5, key: shown(0), keyShown: shown(0) },
    { path: "h:1", text: "старый текст", minutes: 30, key: shown(1), keyShown: shown(1) },
  ] }, true);
  assert.equal(nothing.patch.steps, undefined, "ничего не меняли — строку тренировки не пишем вовсе");

  const keyed = applySessionEdit(generated, { title: generated.title, note: "старая заметка", rows: [
    { path: "s:4", text: "Новый текст заминки.", minutes: 3, key: null, keyShown: "cooldown" },
  ] }, true);
  const cool = keyed.changes.find((c) => c.field === "step_text");
  assert.equal(cool?.etalon, null, "«без ключа» при правке текста эталоном не делает");
  assert.equal(keyed.patch.segments?.[4].key, "cooldown", "…но свой ключ шага остаётся в шаге");
  assert.equal(keyed.patch.segments?.[0], generated.segments![0], "нетронутый сегмент — тот же объект");
}

console.log("check:step-texts — все проверки пройдены");
