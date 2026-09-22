/**
 * Чек пола объёма работы. Ни сети, ни базы — только чистые функции.
 *
 * Случай, с которого начался: тренер дал рукой 7 × 4 мин через полторы минуты
 * шага (28 минут работы), а генератор на следующую неделю предложил 5 × 3
 * (15 минут). Шаг назад почти вдвое, потому что цель цикла была 20 и ближайшим
 * оказался МЕНЬШИЙ формат.
 *
 *   npx tsx scripts/check-released-work-floor.ts
 */
import assert from "node:assert/strict";

import { releasedWorkFloor, sessionWorkMinutes } from "@/features/intervals/loop/released-work-volume";
import type { PlanSession } from "@/features/intervals/loop/types";

function session(over: Partial<PlanSession>): PlanSession {
  return {
    id: "s", cycleId: "c", weekIndex: 1, weekStart: "2026-09-21", sessionDate: "2026-09-23",
    dayIdx: 2, role: "quality", title: "Интервальная", minutes: 64, presetCode: null,
    description: null, segments: null, steps: null, notes: null, targetMode: null, rpe: null,
    deferred: false, deferReason: null, originalSessionDate: null, movedAt: null,
    ...over,
  } as PlanSession;
}

// ── РУЧНАЯ СЕССИЯ: 7 × 4 через полторы минуты шагом ─────────────────────────
const handWritten = session({
  steps: [
    { minutes: 5, name: "Ходьба", target: { kind: "free", text: "шагом" } },
    { minutes: 10, name: "Лёгкий бег", target: { kind: "free", text: "лёгкий" } },
    { minutes: 3, name: "Перед работой", target: { kind: "free", text: "ускорение" } },
    { minutes: 3, name: "Спокойный бег", target: { kind: "free", text: "лёгкий" } },
    {
      minutes: 0, name: "Работа",
      repeat: {
        count: 7,
        steps: [
          { minutes: 4, name: "Бег", target: { kind: "self_discovery" } },
          { minutes: 1.5, name: "Восстановление", target: { kind: "free", text: "шагом" } },
        ],
      },
    },
    { minutes: 5, name: "Заминка", target: { kind: "free", text: "шагом" } },
  ],
});
assert.equal(sessionWorkMinutes(handWritten), 28, "7 × 4 = 28 минут работы, шаг восстановления не считается");

// ── МАШИННАЯ СЕССИЯ: работа — куски без темпа лёгкого ───────────────────────
const generated = session({
  steps: null,
  segments: [
    { minutes: 12, label: "Разминка, спокойно", fastSec: 427, slowSec: 457 },
    { minutes: 3, label: "Отрезок 1", fastSec: null, slowSec: null },
    { minutes: 1, label: "Шагом", fastSec: 427, slowSec: 457 },
    { minutes: 3, label: "Отрезок 2", fastSec: null, slowSec: null },
    { minutes: 4, label: "Заминка, свободно", fastSec: 427, slowSec: 457 },
  ],
});
assert.equal(sessionWorkMinutes(generated), 6, "работа машинной — только отрезки");

// ── АЭРОБНАЯ СЕССИЯ РАБОТЫ НЕ НЕСЁТ ─────────────────────────────────────────
//
// ЭТО ГЛАВНАЯ ГРАНИЦА. «Подобрать самой» вне повтора — это лёгкий бег, и если
// считать его работой, пол поднимется до пятидесяти минут от обычной пробежки,
// и следующая неделя окажется невыполнимой.
const easy = session({
  steps: [{ minutes: 50, name: "Равномерный лёгкий бег", target: { kind: "self_discovery" } }],
});
assert.equal(sessionWorkMinutes(easy), 0, "лёгкий бег по ощущению работой не является");

// Непрерывная работа, написанная рукой, несёт ЯВНОЕ усилие — вот она считается.
const tempoByHand = session({
  steps: [
    { minutes: 10, name: "Разминка", target: { kind: "free", text: "шагом" } },
    { minutes: 20, name: "Основная часть", target: { kind: "rpe", rpe: 6 } },
  ],
});
assert.equal(sessionWorkMinutes(tempoByHand), 20, "кусок с заданным усилием — работа");
const walkOnly = session({
  steps: [{ minutes: 5, name: "Разминка", target: { kind: "free", text: "шагом" } }],
});
assert.equal(sessionWorkMinutes(walkOnly), 0, "разминка работой не является");

// ── ПОЛ БЕРЁТСЯ ТОЛЬКО ИЗ ОТДАННЫХ НЕДЕЛЬ ───────────────────────────────────
const floor = releasedWorkFloor({
  sessions: [
    session({ weekStart: "2026-09-14", steps: easy.steps }),
    handWritten,
    session({ weekStart: "2026-09-28", segments: generated.segments, steps: null }),
  ],
  releasedWeekStarts: new Set(["2026-09-14", "2026-09-21"]),
});
assert.ok(floor, "пол должен посчитаться");
assert.equal(floor.weekStart, "2026-09-21", "берётся ПОСЛЕДНЯЯ отданная неделя");
assert.equal(floor.workMinutes, 28, "и максимум работы в ней");

const noneReleased = releasedWorkFloor({ sessions: [handWritten], releasedWeekStarts: new Set() });
assert.equal(noneReleased, null, "без отданных недель пола нет: черновики отправной точкой не бывают");

console.log("check:released-work-floor — все проверки пройдены");
