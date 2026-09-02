/**
 * Чек методики начинающего: лестница, правила перехода, учёт объёма.
 *
 * Эти числа — не настройки, а методика тренера. Тихо сползшая граница RPE или
 * переставленная ступень означают, что новичок получит нагрузку, которую
 * методика ему не назначала, и заметить это по коду будет нельзя.
 *
 *   npx tsx scripts/check-beginner-methodology.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BEGINNER_LADDER, BEGINNER_MAX_RUNS_PER_WEEK, BEGINNER_METHODOLOGY_ID,
  BEGINNER_METHODOLOGY_VERSION, BEGINNER_RPE_CAP, BEGINNER_RPE_TARGET,
  CAREFUL_EXTRA_SESSIONS, decideNextStep, diagnosticSession, envelopeMinutes,
  LAST_STEP, MIN_SESSIONS_PER_STEP, rpeBand, stepByIndex, stepDescriptionRu,
  weeklyRunningMinutes, type SessionFeedback,
} from "@/features/methodology/beginner";

// ── Версия и рамка ───────────────────────────────────────────────────────────
assert.equal(BEGINNER_METHODOLOGY_ID, "coach_igor_true_beginner");
assert.equal(BEGINNER_METHODOLOGY_VERSION, "true_beginner_v2", "версия поднята: содержимое отличается от перенесённого v1");
assert.equal(BEGINNER_MAX_RUNS_PER_WEEK, 3, "потолок беговых дней — жёсткий");
assert.equal(BEGINNER_RPE_TARGET, 2);
assert.equal(BEGINNER_RPE_CAP, 4, "RPE 2–4, а не 4–5 как в каталожных пресетах");

// ── Лестница ─────────────────────────────────────────────────────────────────
assert.equal(BEGINNER_LADDER.length, 7, "семь ступеней: пять шаг-бег + два непрерывных");
assert.equal(LAST_STEP, 7);
assert.deepEqual(
  BEGINNER_LADDER.map((step) => step.index),
  [1, 2, 3, 4, 5, 6, 7],
  "номера ступеней непрерывны — на них ссылается состояние прогрессии"
);
assert.deepEqual(
  BEGINNER_LADDER.map((step) => step.labelRu),
  [
    "5 x 4 мин бег / 2 мин шаг",
    "5 x 5 мин бег / 2 мин шаг",
    "5 x 5 мин бег / 1:30 шаг",
    "5 x 5 мин бег / 1 мин шаг",
    "5-6 x 5 мин бег / 1 мин шаг",
    "25 мин лёгкого непрерывного бега",
    "30 мин лёгкого непрерывного бега",
  ],
  "лестница — вариант A: сначала сокращается отдых, потом добавляется повтор"
);

// Логика роста проверяется числами, а не названиями.
const walk = BEGINNER_LADDER.slice(0, 5);
assert.deepEqual(walk.map((s) => s.runMin), [4, 5, 5, 5, 5], "работа растёт один раз, на второй ступени");
assert.deepEqual(walk.map((s) => s.walkMin), [2, 2, 1.5, 1, 1], "отдых сокращается 2 → 1:30 → 1");
assert.deepEqual(walk.map((s) => s.reps), [5, 5, 5, 5, 6], "повтор добавляется последним, на пятой ступени");
assert.equal(BEGINNER_LADDER[5].kind, "continuous", "шаг убирается на шестой ступени");
assert.equal(BEGINNER_LADDER[5].continuousMin, 25);
assert.equal(BEGINNER_LADDER[6].continuousMin, 30, "непрерывный растёт 25 → 30");

// ── Учёт объёма: в конверт идут только минуты бега ──────────────────────────
assert.deepEqual(
  BEGINNER_LADDER.map((step) => step.totalMinutes),
  [30, 35, 32.5, 30, 36, 25, 30],
  "полная длительность сессии по ступеням НЕ монотонна"
);
assert.deepEqual(
  BEGINNER_LADDER.map(envelopeMinutes),
  [20, 25, 25, 25, 30, 25, 30],
  "в конверт идут минуты бега — по ступеням шаг-бега они не убывают ни разу"
);
// Именно ради этого правило и выбрано: полная длительность падает там, где
// человек прогрессирует (третья ступень короче второй, четвёртая — третьей).
assert.ok(BEGINNER_LADDER[2].totalMinutes < BEGINNER_LADDER[1].totalMinutes);
assert.ok(envelopeMinutes(BEGINNER_LADDER[2]) >= envelopeMinutes(BEGINNER_LADDER[1]));
assert.equal(weeklyRunningMinutes(stepByIndex(1), 3), 60, "три сессии первой ступени — 60 беговых минут в неделю");

// ── Полосы RPE: границы закрыты сверху ──────────────────────────────────────
assert.equal(rpeBand(2), "may_progress");
assert.equal(rpeBand(3), "may_progress", "тройка попадает в «можно прогрессировать»");
assert.equal(rpeBand(3.5), "careful");
assert.equal(rpeBand(4), "careful", "четвёрка — «аккуратно», а не «повторить»");
assert.equal(rpeBand(5), "repeat");
assert.equal(rpeBand(6), "simplify");

// ── Правила перехода ─────────────────────────────────────────────────────────
const clean = (rpe: number): SessionFeedback => ({ date: "2026-09-01", rpe, pain: false });

// Одной удачной сессии мало — ровно то, на чём настаивал тренер.
assert.equal(
  decideNextStep({ currentStep: 1, sessionsAtStep: 1, recent: [clean(2)] }).action,
  "repeat",
  "RPE 2 после ОДНОЙ сессии не даёт перехода"
);
const progressed = decideNextStep({ currentStep: 1, sessionsAtStep: 2, recent: [clean(2), clean(3)] });
assert.equal(progressed.action, "progress");
assert.equal(progressed.nextStep, 2);

// «Аккуратно» требует лишней сессии.
assert.equal(
  decideNextStep({ currentStep: 2, sessionsAtStep: 2, recent: [clean(4), clean(4)] }).action,
  "repeat",
  "RPE 4 при двух сессиях — ещё рано"
);
assert.equal(
  decideNextStep({ currentStep: 2, sessionsAtStep: MIN_SESSIONS_PER_STEP + CAREFUL_EXTRA_SESSIONS, recent: [clean(4), clean(4), clean(4)] }).action,
  "progress",
  "RPE 4 на трёх сессиях — аккуратный переход"
);

// Тяжёлая сессия в окне подтверждения перехода не даёт.
assert.equal(
  decideNextStep({ currentStep: 3, sessionsAtStep: 4, recent: [clean(2), clean(5)] }).action,
  "repeat",
  "предыдущая тяжёлая сессия отменяет подтверждение"
);

assert.equal(decideNextStep({ currentStep: 3, sessionsAtStep: 5, recent: [clean(5)] }).action, "repeat");

const back = decideNextStep({ currentStep: 4, sessionsAtStep: 3, recent: [clean(7), clean(6)] });
assert.equal(back.action, "step_back", "два тяжёлых подряд возвращают на предыдущую ступень");
assert.equal(back.nextStep, 3);
assert.equal(
  decideNextStep({ currentStep: 1, sessionsAtStep: 3, recent: [clean(7), clean(6)] }).nextStep,
  1,
  "ниже первой ступени не опускаемся"
);

const pain = decideNextStep({
  currentStep: 3, sessionsAtStep: 5,
  recent: [{ date: "2026-09-01", rpe: 2, pain: true }, clean(2)],
});
assert.equal(pain.action, "hold_for_coach", "боль блокирует прогрессию даже при низком RPE");
assert.equal(pain.nextStep, 3);

assert.equal(
  decideNextStep({ currentStep: 2, sessionsAtStep: 4, recent: [{ date: "2026-09-01", rpe: null, pain: false }] }).action,
  "repeat",
  "нет ответа — не двигаемся вслепую"
);

assert.equal(
  decideNextStep({ currentStep: LAST_STEP, sessionsAtStep: 9, recent: [clean(2), clean(2)] }).action,
  "repeat",
  "с последней ступени лестница дальше не ведёт"
);

// ── Диагностическая тренировка ───────────────────────────────────────────────
const rw = diagnosticSession(false);
assert.equal(rw.totalMinutes, 30, "ветка «не может непрерывно» — 30 минут 5x(4+2)");
assert.equal(rw.runningMinutes, 20);
assert.ok(rw.descriptionRu.includes("бег/шаг"));
assert.ok(!/темп[уоа]?\s|пульс[уоа]?\s/i.test(rw.descriptionRu.replace(/ни темпа, ни пульса/gi, "")), "в тексте нет предписаний по темпу и пульсу");

const cont = diagnosticSession(true);
assert.equal(cont.totalMinutes, 25, "ветка «может непрерывно» — 20–25 минут");
assert.ok(cont.descriptionRu.includes("непрерывного"));
assert.ok(!cont.descriptionRu.includes("5 x"), "в непрерывной ветке не должно быть разметки шаг-бега");

// ── Описания ступеней — настоящие тексты, не заглушки ───────────────────────
for (const step of BEGINNER_LADDER) {
  const text = stepDescriptionRu(step);
  assert.ok(text.length > 120, `описание ступени ${step.index} слишком короткое`);
  assert.ok(!/плейсхолдер|placeholder|будет добавлен позже/i.test(text), `описание ступени ${step.index} — заглушка`);
  assert.ok(text.includes("2–4"), `в описании ступени ${step.index} нет полосы усилия`);
}
assert.ok(stepDescriptionRu(stepByIndex(3)).includes("1 мин 30 сек"), "полторы минуты пишутся словами, а не «1.5 мин»");
assert.ok(stepDescriptionRu(stepByIndex(5)).includes("5–6"), "диапазон повторов виден ученику");

// ── Миграция каталога не должна разойтись с методикой ───────────────────────
//
// Тексты и числа в миграции ПОРОЖДЕНЫ из этого модуля. Если кто-то поправит
// лестницу здесь и забудет пересобрать миграцию, каталог тихо останется на
// старых числах, а сборщик будет ругаться «каталог разошёлся» у каждого ученика.
const migration = readFileSync(
  new URL("../supabase/migrations/20260929000000_beginner_run_walk_ladder_v2.sql", import.meta.url),
  "utf8"
);
for (const step of BEGINNER_LADDER) {
  assert.ok(
    migration.includes(step.presetCode),
    `в миграции каталога нет пресета ${step.presetCode}`
  );
  const escaped = stepDescriptionRu(step).replace(/'/g, "''");
  assert.ok(
    migration.includes(escaped),
    `описание ступени ${step.index} в миграции разошлось с методикой — пересоберите миграцию`
  );
}
assert.ok(
  migration.includes(`rpe_target, rpe_cap`) && migration.includes(`'rpe', ${BEGINNER_RPE_TARGET}, ${BEGINNER_RPE_CAP}`),
  "в миграции RPE не совпадает с методикой"
);
assert.ok(
  !migration.includes("desc_placeholder_beginner\', \'Плейсхолдер"),
  "заглушка описания не должна возвращаться в каталог"
);

console.log("check:beginner-methodology — все проверки пройдены");
