/**
 * Что получает ученица, когда тренер жмёт «Отдать ученице».
 *
 * ЧТО СТЕРЕЖЁТ. Текст был один, «План готов», и уходил в том числе на
 * дописанный в текущую неделю день: человек получал «план готов» про план,
 * который у него неделю как есть (живой случай 23.09.2026, одна пятница).
 * Проверка держит границу между «новая неделя», «добавил» и «поправил» — и
 * отдельно то, что «добавил» не говорится без доказательства.
 *
 *   npm run check:week-notice
 */

import assert from "node:assert/strict";

import { weekNoticeOf } from "@/features/intervals/loop/week-notice";

// ── Новая неделя ─────────────────────────────────────────────────────────────
const fresh = weekNoticeOf({ wasReleased: false, sessionsBefore: null, sessionsAfter: 3 });
assert.equal(fresh.kind, "plan_published");
assert.ok(fresh.textRu.startsWith("План готов."), "неотданная неделя — это «план готов»");

// Счётчик у новой недели не смотрим вовсе: сравнивать не с чем.
assert.equal(
  weekNoticeOf({ wasReleased: false, sessionsBefore: 9, sessionsAfter: 1 }).textRu,
  fresh.textRu,
  "для новой недели текст один, чем бы ни были числа"
);

// ── Дописан день в уже отданную неделю ───────────────────────────────────────
const added = weekNoticeOf({ wasReleased: true, sessionsBefore: 1, sessionsAfter: 2 });
assert.equal(added.kind, "week_updated", "вид отдельный, иначе дедуп съест второе сообщение за день");
assert.equal(added.textRu, "Добавил вам тренировку. Откройте приложение, она уже в плане.");

const addedTwo = weekNoticeOf({ wasReleased: true, sessionsBefore: 1, sessionsAfter: 3 });
assert.equal(addedTwo.textRu, "Добавил вам 2 тренировки. Откройте приложение, они уже в плане.");

const addedFive = weekNoticeOf({ wasReleased: true, sessionsBefore: 0, sessionsAfter: 5 });
assert.equal(addedFive.textRu, "Добавил вам 5 тренировок. Откройте приложение, они уже в плане.");

// ── Правка без добавления ────────────────────────────────────────────────────
const edited = weekNoticeOf({ wasReleased: true, sessionsBefore: 3, sessionsAfter: 3 });
assert.equal(edited.kind, "week_updated");
assert.equal(edited.textRu, "Поправил вашу неделю. Откройте приложение, там свежая версия.");

// Тренировку убрали — «добавил» говорить нельзя ни в коем случае.
assert.equal(
  weekNoticeOf({ wasReleased: true, sessionsBefore: 3, sessionsAfter: 2 }).textRu,
  edited.textRu,
  "убранная тренировка не превращается в «добавил»"
);

/**
 * НЕИЗВЕСТНО — ЗНАЧИТ «ПОПРАВИЛ». У недель, отданных до появления колонки,
 * числа нет. Догадка в сторону «добавил» была бы утверждением о факте, которого
 * у нас нет, — ровно та мелкая неправда, из которой уведомления становятся шумом.
 */
assert.equal(
  weekNoticeOf({ wasReleased: true, sessionsBefore: null, sessionsAfter: 7 }).textRu,
  edited.textRu,
  "без прошлого счётчика «добавил» не утверждаем"
);

// ── Ни один текст не обещает того, чего экран может не выполнить ─────────────
for (const notice of [fresh, added, addedTwo, addedFive, edited]) {
  assert.ok(
    !notice.textRu.includes("сегодня"),
    `«${notice.textRu}» обещает сегодняшний день: план мог начаться не сегодня`
  );
  assert.ok(notice.textRu.includes("приложение"), "в каждом тексте сказано, куда идти");
}

// ── Ученица на странице плана: «приложение» — указание в тупик ───────────────
//
// БЫЛО [до 21.10.2026]: утверждение выше держало «приложение» в КАЖДОМ тексте.
// ОТМЕНЕНО для учениц со ссылкой на страницу плана (plan-page): у них мини-апп
// показывает «План переехал», и «откройте приложение» отправляло бы в тупик.
// Для мини-аппа утверждение выше осталось как было. Здесь — строже, чем
// «не упоминает»: слова «приложени» нет НИ В ОДНОМ виде текста, и в каждом
// сказано, куда идти («план»), — кнопка ведёт прямо на неделю.
const onPage = [
  weekNoticeOf({ wasReleased: false, sessionsBefore: null, sessionsAfter: 3, onPage: true }),
  weekNoticeOf({ wasReleased: true, sessionsBefore: 3, sessionsAfter: 4, onPage: true }),
  weekNoticeOf({ wasReleased: true, sessionsBefore: 3, sessionsAfter: 5, onPage: true }),
  weekNoticeOf({ wasReleased: true, sessionsBefore: 3, sessionsAfter: 3, onPage: true }),
  weekNoticeOf({ wasReleased: true, sessionsBefore: null, sessionsAfter: 7, onPage: true }),
];
assert.deepEqual(
  onPage.map((n) => n.kind),
  ["plan_published", "week_updated", "week_updated", "week_updated", "week_updated"],
  "виды уведомлений у страницы те же, что у мини-аппа: меняются только слова"
);
assert.ok(onPage[0].textRu.startsWith("План готов."), "у страницы новая неделя — тоже «план готов»");
assert.ok(onPage[1].textRu.startsWith("Добавил вам тренировку."), "у страницы «добавил» — та же граница");
assert.ok(onPage[3].textRu.startsWith("Поправил"), "у страницы «поправил» — та же граница");
assert.equal(onPage[4].textRu, onPage[3].textRu, "у страницы без счётчика «добавил» тоже не утверждаем");
for (const notice of onPage) {
  assert.ok(!/приложени/iu.test(notice.textRu), `«${notice.textRu}» зовёт в приложение, которого у неё нет`);
  assert.ok(/план/iu.test(notice.textRu), `«${notice.textRu}» не говорит, куда идти`);
  assert.ok(!notice.textRu.includes("сегодня"), `«${notice.textRu}» обещает сегодняшний день`);
}

console.log("check:week-notice — все проверки пройдены");
