/**
 * Пауза ученика: границы отрезка и слова на карточке.
 *
 * ЧТО СТЕРЕЖЁТ. 01.10.2026 ученица попросила приостановить напоминания, тренер
 * согласился, а на третий день болезни ей ушло «вы пропустили тренировку»:
 * механизма паузы не было. У новой функции ровно две опасности — промахнуться
 * на день по границе и тихо не сработать. Проверка держит обе.
 *
 *   npm run check:pause
 */
import assert from "node:assert/strict";
import { buildStudentView } from "@/features/intervals/loop/student-view";
import {
  daysInclusive, isPausedOn, openPause, pauseCovering, pauseLabelRu, type Pause,
} from "@/features/intervals/loop/pause";

const ill: Pause = { id: "p1", startedOn: "2026-10-01", endedOn: "2026-10-05", reason: "насморк" };
const open: Pause = { id: "p2", startedOn: "2026-10-20", endedOn: null, reason: "спина" };

// ── ГРАНИЦЫ ВКЛЮЧИТЕЛЬНО. «С первого по пятое» — оба дня внутри. ─────────────
assert.equal(isPausedOn("2026-09-30", [ill]), false, "день до паузы свободен");
assert.equal(isPausedOn("2026-10-01", [ill]), true, "первый день паузы ВНУТРИ");
assert.equal(isPausedOn("2026-10-03", [ill]), true);
assert.equal(isPausedOn("2026-10-05", [ill]), true, "последний день паузы ВНУТРИ");
assert.equal(isPausedOn("2026-10-06", [ill]), false, "день после паузы свободен");

// Ровно тот день, за который ей ушёл укор.
assert.equal(isPausedOn("2026-10-04", [ill]), true, "04.10 внутри болезни — укора быть не должно");

// ── Открытая пауза не кончается ──────────────────────────────────────────────
assert.equal(isPausedOn("2026-10-19", [open]), false);
assert.equal(isPausedOn("2026-10-20", [open]), true);
assert.equal(isPausedOn("2027-05-01", [open]), true, "открытая пауза накрывает всё будущее");

// ── Какая именно пауза накрыла ───────────────────────────────────────────────
assert.equal(pauseCovering("2026-10-03", [ill, open])?.reason, "насморк");
assert.equal(pauseCovering("2026-10-25", [ill, open])?.reason, "спина");
assert.equal(pauseCovering("2026-10-10", [ill, open]), null, "между паузами день свободен");
assert.equal(pauseCovering("2026-10-03", []), null, "без пауз накрывать нечем");

assert.equal(openPause([ill]), null, "закрытая пауза не считается открытой");
assert.equal(openPause([ill, open])?.id, "p2");
assert.equal(openPause([]), null);

// ── Сколько дней ─────────────────────────────────────────────────────────────
assert.equal(daysInclusive("2026-10-01", "2026-10-05"), 5, "с первого по пятое это пять дней, не четыре");
assert.equal(daysInclusive("2026-10-01", "2026-10-01"), 1, "один день это один день");
assert.equal(daysInclusive("2026-09-28", "2026-10-02"), 5, "через границу месяца");
assert.equal(daysInclusive("2026-10-05", "2026-10-01"), 0, "перевёрнутый отрезок не даёт отрицательных дней");

// ── Слова на карточке ────────────────────────────────────────────────────────
assert.equal(
  pauseLabelRu(ill, "2026-10-06"),
  "Пауза с 1 октября по 5 октября, 5 дней: насморк",
  "закрытая пауза называет отрезок и длину"
);
assert.equal(
  pauseLabelRu({ ...open, startedOn: "2026-10-01" }, "2026-10-06"),
  "На паузе с 1 октября, уже 6 дней: насморк".replace("насморк", "спина"),
  "открытая считает дни до сегодня — тренеру важно, сколько человек уже не бегает"
);
// Причина попадает в текст всегда: «пауза без причины» через месяц неотличима
// от забытой кнопки.
for (const p of [ill, open]) {
  assert.ok(pauseLabelRu(p, "2026-10-21").includes(p.reason), "причина обязана быть в тексте");
}
// Ни тире, ни внутренних слов в тексте для глаз тренера.
assert.ok(!/—|–/u.test(pauseLabelRu(ill, "2026-10-06")), "тире в тексте не используем");

/* ── Пауза на живом экране ученицы ──────────────────────────────────────────
 *
 * ЧИСТОЕ ПРАВИЛО ВЫШЕ УЖЕ ПРОВЕРЕНО, НО ОНО НИЧЕГО НЕ СТОИТ НЕПОДКЛЮЧЁННЫМ.
 * Ровно это и было дефектом: правила не существовало, и 4 октября укор ушёл.
 * Здесь проверяется сборка экрана целиком — что день внутри паузы из «не
 * отмечено» выпадает, а недельная форма молчит.
 */
const session = (dateIso: string, id: string) => ({
  id,
  cycleId: "c1",
  sessionDate: dateIso,
  weekStart: "2026-09-28",
  dayIdx: 0,
  role: "easy" as const,
  slotType: "easy" as const,
  title: "Лёгкий бег",
  minutes: 35,
  description: "Лёгкий бег 35 мин",
  segments: [],
  steps: [],
  notes: [],
  presetCode: null,
  targetPaceSecPerKm: null,
  movedFromDate: null,
  createdAt: "",
});

const paused = buildStudentView({
  todayIso: "2026-10-06",
  sessions: [session("2026-10-04", "s-04"), session("2026-10-02", "s-02")],
  checkinsBySessionId: new Map(),
  progression: null,
  unavailableWeekdays: [],
  hasUnplannedCheckinToday: false,
  weeklyFormWeekStart: "2026-09-28",
  pauses: [ill],
});
assert.equal(paused.state, "ready");
if (paused.state === "ready") {
  // 4 октября — ТОТ САМЫЙ ДЕНЬ, за который ушёл укор. Он обязан исчезнуть.
  assert.deepEqual(
    paused.overdue.map((card) => card.dateIso),
    [],
    "дни внутри паузы в «не отмечено» не попадают"
  );
  /* ПАУЗА ЗАКРЫТА — ЗНАЧИТ ЧЕЛОВЕК ВЕРНУЛСЯ, И ФОРМА СПРАШИВАЕТСЯ ЗАКОННО.
     Две вещи различаются намеренно: укор смотрит на ДЕНЬ ТРЕНИРОВКИ (дни
     болезни невиноваты навсегда), а форма — на СЕГОДНЯ (вернулся — расскажи,
     как прошла неделя; половина её прошла нормально). Сначала я написал в
     проверке обратное и поймал себя на том, что выключаю форму человеку,
     который уже бегает. */
  assert.equal(
    paused.weeklyFormWeekStart,
    "2026-09-28",
    "пауза закрыта: форма за прошедшую неделю спрашивается"
  );
  assert.equal(paused.pauseNoteRu, null, "пауза закрыта: заметки о паузе на экране нет");
}

/* ОТКРЫТАЯ ПАУЗА: ЭКРАН МОЛЧИТ ЦЕЛИКОМ. */
const pausedNow = buildStudentView({
  todayIso: "2026-10-22",
  sessions: [session("2026-10-21", "s-21")],
  checkinsBySessionId: new Map(),
  progression: null,
  unavailableWeekdays: [],
  hasUnplannedCheckinToday: false,
  weeklyFormWeekStart: "2026-10-12",
  pauses: [open],
});
if (pausedNow.state === "ready") {
  assert.deepEqual(pausedNow.overdue.map((card) => card.dateIso), [], "на паузе укоров нет");
  assert.equal(
    pausedNow.weeklyFormWeekStart,
    null,
    "на паузе форма не просится: «как прошла неделя» человеку, который лежит, не по адресу"
  );
  assert.ok(pausedNow.pauseNoteRu !== null, "на паузе экран объясняет, почему тихо");
  assert.ok(
    !/—|–/u.test(pausedNow.pauseNoteRu ?? ""),
    "тире нет и в тексте для ученицы"
  );
}

/* БЕЗ ПАУЗЫ ВСЁ ПО-ПРЕЖНЕМУ. Иначе правка могла бы просто выключить укоры
   всем — и дефект «система не замечает пропусков» заменил бы прежний. */
const normal = buildStudentView({
  todayIso: "2026-10-06",
  sessions: [session("2026-10-04", "s-04"), session("2026-10-02", "s-02")],
  checkinsBySessionId: new Map(),
  progression: null,
  unavailableWeekdays: [],
  hasUnplannedCheckinToday: false,
  weeklyFormWeekStart: "2026-09-28",
  pauses: [],
});
if (normal.state === "ready") {
  assert.ok(normal.overdue.length > 0, "без паузы неотмеченные дни остаются видны");
  assert.equal(normal.weeklyFormWeekStart, "2026-09-28", "без паузы форма просится как раньше");
  assert.equal(normal.pauseNoteRu, null, "без паузы заметки о паузе нет");
}

/* ПАУЗА СНЯТА, А ДНИ ВНУТРИ НЕЁ ОСТАЮТСЯ НЕВИНОВАТЫМИ. Фильтр идёт по дню
   тренировки, а не по «сейчас на паузе»: иначе укор вернулся бы ровно в день
   возвращения, когда он больнее всего. */
if (paused.state === "ready" && normal.state === "ready") {
  assert.ok(
    normal.overdue.length > paused.overdue.length,
    "разница между экранами даёт именно пауза, а не что-то ещё"
  );
}

console.log("check:pause — все проверки пройдены");
