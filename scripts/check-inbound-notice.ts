/**
 * Когда тренеру звякать про входящее от ученицы.
 *
 * ЧТО СТЕРЕЖЁТ. 23.09.2026 ответ ученицы про боль в пятке пролежал два дня
 * невидимым. Лечение — уведомление, и у него ровно две опасности: молчать,
 * когда надо сказать, и звонить пять раз про один разговор. Проверка держит
 * обе границы.
 *
 *   npm run check:inbound-notice
 */

import assert from "node:assert/strict";

import {
  NOTICE_COOLDOWN_MIN,
  decideInboundNotice,
  inboundNoticeTextRu,
  isQuietHour,
} from "@/features/intervals/loop/inbound-notice";

const NOW = "2026-09-25T12:00:00Z";

// ── Тихие часы ───────────────────────────────────────────────────────────────
assert.equal(isQuietHour(23), true, "23:00 уже тихо");
assert.equal(isQuietHour(2), true, "ночь");
assert.equal(isQuietHour(7), true, "7 утра ещё тихо");
assert.equal(isQuietHour(8), false, "8 утра — уже можно");
assert.equal(isQuietHour(12), false);
assert.equal(isQuietHour(22), false, "22:00 ещё рабочее время");

// ── Обычный случай: сказать сразу ────────────────────────────────────────────
assert.deepEqual(
  decideInboundNotice({ coachHour: 12, lastNotifiedAt: null, nowIso: NOW }),
  { kind: "send" },
  "первое сообщение днём — звякаем"
);

// ── Очередь сообщений — один разговор ────────────────────────────────────────
const justNow = decideInboundNotice({
  coachHour: 12,
  lastNotifiedAt: "2026-09-25T11:55:00Z",
  nowIso: NOW,
});
assert.equal(justNow.kind, "skip", "пять минут назад уже звякали");

const longAgo = decideInboundNotice({
  coachHour: 12,
  lastNotifiedAt: "2026-09-25T11:30:00Z",
  nowIso: NOW,
});
assert.equal(longAgo.kind, "send", `через ${NOTICE_COOLDOWN_MIN}+ минут это новый повод`);

// ── Ночь: откладываем, НЕ теряем ─────────────────────────────────────────────
const night = decideInboundNotice({ coachHour: 2, lastNotifiedAt: null, nowIso: NOW });
assert.equal(night.kind, "defer", "ночью не звоним");

/**
 * ОСТЫВАНИЕ СИЛЬНЕЕ ТИХИХ ЧАСОВ. Три сообщения подряд в полночь не должны
 * превратиться в три отложенных: утром это один разговор и один повод открыть
 * карточку.
 */
const nightBurst = decideInboundNotice({
  coachHour: 2,
  lastNotifiedAt: "2026-09-25T11:58:00Z",
  nowIso: NOW,
});
assert.equal(nightBurst.kind, "skip", "ночная очередь не плодит отложенные");

// ── Текст ────────────────────────────────────────────────────────────────────
assert.equal(
  inboundNoticeTextRu({ studentName: "Валентина", preview: "Про пятку: не болит", count: 1, deferred: false }),
  "Валентина написала.\n\n«Про пятку: не болит»"
);
assert.equal(
  inboundNoticeTextRu({ studentName: "Валентина", preview: null, count: 1, deferred: false }),
  "Валентина написала.",
  "без текста (голосовое, фото) — просто факт, без пустых кавычек"
);
assert.equal(
  inboundNoticeTextRu({ studentName: "Валентина", preview: "утром", count: 3, deferred: true }),
  "Валентина написала (3 сообщения) ночью.\n\n«утром»",
  "отложенное прямо называет, что пролежало ночь"
);

// Длинное сообщение режется, а не уезжает в телеграм целиком.
const long = inboundNoticeTextRu({
  studentName: "Валентина",
  preview: "я".repeat(400),
  count: 1,
  deferred: false,
});
assert.ok(long.length < 260, `уведомление должно быть коротким, вышло ${long.length}`);

console.log("check:inbound-notice — все проверки пройдены");
