/**
 * Чек черновика отчёта. Ни DOM, ни сети — только чистые функции разбора.
 *
 * Случай, с которого он начался: ученица написала длинный рассказ, форма не
 * пропустила из-за темпа, текст исчез. Проверяем ровно то, что защищает этот
 * текст: он переживает разбор, не воскресает через неделю и не подставляется
 * в чужую тренировку.
 *
 *   npx tsx scripts/check-checkin-draft.ts
 */
import assert from "node:assert/strict";

import {
  DRAFT_TTL_MS,
  draftKey,
  isDraftEmpty,
  parseDraft,
  serializeDraft,
  type CheckinDraft,
} from "@/features/intervals/loop/checkin-draft";

const NOW = Date.parse("2026-09-19T12:00:00Z");

function draft(over: Partial<CheckinDraft> = {}): CheckinDraft {
  return {
    effort: null,
    pain: null,
    comment: "",
    date: "",
    durationMinutes: "",
    distanceKm: "",
    averageHeartrate: "",
    averagePace: "",
    savedAt: NOW,
    ...over,
  };
}

// ── Ключи: у каждой тренировки свой ──────────────────────────────────────────
assert.notEqual(draftKey("s1"), draftKey("s2"), "две тренировки не делят один черновик");
assert.equal(draftKey(null), draftKey(null), "внеплановая стабильна сама с собой");
assert.notEqual(draftKey(null), draftKey("s1"), "внеплановая не лезет в плановую");

// ── Пустой черновик не восстанавливаем ───────────────────────────────────────
assert.equal(isDraftEmpty(draft()), true);
assert.equal(isDraftEmpty(draft({ comment: "   " })), true, "пробелы — это пусто");
assert.equal(isDraftEmpty(draft({ effort: "simple_hard" })), false);
assert.equal(isDraftEmpty(draft({ averagePace: "812" })), false);
assert.equal(parseDraft(serializeDraft(draft()), NOW), null, "пустой не воскрешаем");

// ── ГЛАВНОЕ: длинный текст переживает круг ───────────────────────────────────
const herStory =
  "Закрыла тренировку и открыла заново, пробежала ещё восемь минут. " +
  "Не поняла, что происходит, поэтому написала так подробно.";
const saved = draft({ comment: herStory, effort: "simple_normal", pain: "no_pain", averagePace: "812" });
const restored = parseDraft(serializeDraft(saved), NOW);
assert.ok(restored, "черновик обязан восстановиться");
assert.equal(restored.comment, herStory, "текст не обрезается и не теряется");
assert.equal(restored.effort, "simple_normal");
assert.equal(restored.averagePace, "812", "то, что человек напечатал, хранится как есть");

// ── Срок жизни ───────────────────────────────────────────────────────────────
const old = draft({ comment: herStory, savedAt: NOW - DRAFT_TTL_MS - 1 });
assert.equal(parseDraft(serializeDraft(old), NOW), null, "черновик старше недели не всплывает");
const almost = draft({ comment: herStory, savedAt: NOW - DRAFT_TTL_MS + 60_000 });
assert.ok(parseDraft(serializeDraft(almost), NOW), "на границе недели ещё живой");

// ── Мусор в хранилище не роняет форму ────────────────────────────────────────
assert.equal(parseDraft(null, NOW), null, "пустое хранилище");
assert.equal(parseDraft("", NOW), null, "пустая строка");
assert.equal(parseDraft("не json", NOW), null, "мусор");
assert.equal(parseDraft("[1,2,3]", NOW), null, "массив вместо объекта");
assert.equal(parseDraft('{"comment":"есть текст"}', NOW), null, "без savedAt доверять нечему");
assert.equal(parseDraft('{"comment":123,"savedAt":' + NOW + "}", NOW), null,
  "число вместо текста не должно попасть в поле — и черновик выходит пустым");

console.log("check:checkin-draft — все проверки пройдены");
