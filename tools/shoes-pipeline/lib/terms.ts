/**
 * Прочтённые условия использования — третья проверка гейта (наряд 14.10.2026).
 *
 * Почему отдельный реестр. До 14.10 гейт ставил «разрешено» по двум признакам —
 * robots.txt и живая страница — и условия не читал вовсе. Так Doctors of Running
 * и Believe in the Run прошли как открытые, хотя их условия прямо запрещают
 * автоматический доступ и производные работы, и по ним успели прочитать 61
 * модель. robots.txt говорит, куда можно ходить роботу; можно ли использовать
 * взятое, говорят только условия.
 *
 * Чтение условий — суждение, а не регулярное выражение: «personal,
 * non-commercial use» и «you may not scrape» стоят в разных местах и разными
 * словами. Поэтому решение записывается здесь рукой, но ПРОВЕРЯЕМО: адрес
 * страницы условий и дословная цитата пункта, на котором решение основано.
 * Аудит сверяет цитату с сохранённым текстом условий — пересказ не пройдёт.
 *
 * Нет записи — источник «вручную», не «открыто». Условия не нашлись или не
 * читаются (страница рисуется скриптом) — тоже «вручную»: обходить это
 * браузером нельзя, браузер и есть обход.
 */

export type TermsReading =
  /** Условия прочитаны и не запрещают автоматический доступ, хранение и производные работы. */
  | "permits"
  /** Условия прямо запрещают одно из трёх. Источник закрыт. */
  | "forbids"
  /** Условия не найдены или не читаются без браузера. Решает человек. */
  | "unread";

export type TermsEntry = {
  reading: TermsReading;
  /** Страница условий, по которой принято решение. */
  url: string | null;
  /** Дословный пункт. Для permits — пункт о разрешённом использовании или лицензии. */
  quote: string | null;
  /** Когда прочитано. Условия меняются; решение старше 90 дней перечитывается. */
  readAt: string;
  note?: string;
};

export const TERMS_MAX_AGE_DAYS = 90;

import readings from "./terms-readings.json";

/**
 * Записи читателя условий (read/TERMS-READER.md) лежат в terms-readings.json:
 * их десятки, и в коде они бы утонули. Ручные записи ниже — источники, по
 * которым решение принято в разговоре с Игорем, — имеют приоритет.
 */
const HAND: Record<string, TermsEntry> = {
  doctorsofrunning: {
    reading: "forbids",
    url: "https://www.doctorsofrunning.com/terms-of-service/",
    quote:
      "you will not access the Services through automated or non-human means, whether through a bot, script or otherwise",
    readAt: "2026-10-14",
    note:
      "Там же: «Engage in any automated use of the system, such as using scripts to send comments or messages, or using any data mining, robots, or similar data gathering and extraction tools» и «for your personal, non-commercial use». Моделью успели прочитать 61 модель до того, как условия прочли; всё удалено по решению Игоря.",
  },
  believeintherun: {
    reading: "forbids",
    url: "https://believeintherun.com/terms-of-conditions-and-use/",
    quote:
      "publish, display, disclose, sell, rent, lease, modify, store, loan, distribute, publicly display or perform, co-brand, frame, permit third parties to link to, or create compilations or derivative works of the BR Platform, or any part thereof",
    readAt: "2026-10-14",
    note: "Там же: доступ «solely for your informational purposes and for your immediate, private, personal and non-commercial use».",
  },
  rtings: {
    reading: "unread",
    url: "https://www.rtings.com/company/terms-of-use",
    quote: null,
    readAt: "2026-10-14",
    note: "Страница условий существует, но текст рисуется скриптом: без браузера не читается, а браузер — обход.",
  },
};

export const TERMS: Record<string, TermsEntry> = {
  ...(readings as Record<string, TermsEntry>),
  ...HAND,
};
