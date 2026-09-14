/**
 * РАЗБОР MARKDOWN ОТДЕЛЁН ОТ ВЫВОДА, И ТЕПЕРЬ ЭТО ВАЖНО ВДВОЙНЕ. Один и тот же
 * текст показывают две поверхности с разной типографикой: страница на сайте и
 * мини-приложение в телеграме. Разбор у них обязан быть один, а стили свои:
 * заголовок на сайте 22px на светлом фоне, в приложении 17px в теме телеграма.
 * Поэтому здесь только разбор на блоки, без единого стиля и без React.
 *
 * Маленький разметчик для текста инструкции.
 *
 * ПОЧЕМУ НЕ БИБЛИОТЕКА. Страница намеренно собрана без внешних зависимостей и
 * с заинлайненными стилями, как /privacy: её открывают по ссылке из бота на
 * любом телефоне, и она обязана выглядеть одинаково независимо от того, что
 * происходит в globals.css. Тащить react-markdown ради шести конструкций
 * значит менять правила ради удобства одной страницы.
 *
 * ПОЧЕМУ НЕ «ПРОСТО АБЗАЦЫ». В тексте есть заголовки, списки и ЖИРНЫЙ ВНУТРИ
 * АБЗАЦА, и последнее несёт смысл: выделено то, на чём люди спотыкаются.
 * Отрендерить это простым текстом значит потерять ровно ту часть, ради которой
 * выделение и ставили.
 *
 * ГЛАВНОЕ ПРАВИЛО: ЧЕГО НЕ УМЕЕМ — О ТОМ ГОВОРИМ ВСЛУХ. Молча выбросить
 * таблицу или цитату страшнее, чем не поддержать их: текст уедет в прод
 * покалеченным, и никто не заметит. Поэтому рядом живёт findUnsupported, и
 * проверка падает, если в тексте появилось что-то за пределами этого списка.
 *
 * Поддерживается ровно:
 *   ## заголовок        ### подзаголовок
 *   - пункт списка      1. пункт нумерованного списка
 *   **жирный** внутри любого текста
 *   [ссылка](адрес)
 *   пустая строка разделяет абзацы
 */

/**
 * Конструкции, которых разметчик не понимает.
 *
 * Возвращает строки как есть, чтобы в отчёте было видно, ЧТО именно не влезло,
 * а не «где-то что-то». Пустой массив — текст раскладывается целиком.
 */
export function findUnsupported(markdown: string): string[] {
  const problems: string[] = [];
  const lines = markdown.split("\n");
  for (const [number, raw] of lines.entries()) {
    const line = raw.trimEnd();
    if (line.trim() === "") continue;
    if (/^#{1,6}\s/.test(line)) {
      if (!/^#{2,3}\s/.test(line)) {
        problems.push(`строка ${number + 1}: заголовок уровня ${line.match(/^#+/)?.[0].length} (умеем ## и ###)`);
      }
      continue;
    }
    if (/^[-*]\s/.test(line) || /^\d+\.\s/.test(line)) continue;
    if (/^>/.test(line)) problems.push(`строка ${number + 1}: цитата`);
    else if (/^```/.test(line)) problems.push(`строка ${number + 1}: блок кода`);
    else if (/^\|/.test(line)) problems.push(`строка ${number + 1}: таблица`);
    else if (/^!\[/.test(line)) problems.push(`строка ${number + 1}: картинка`);
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) problems.push(`строка ${number + 1}: разделитель`);
  }
  // Незакрытый жирный: текст уедет со звёздочками, и это видно только глазами.
  const boldMarks = (markdown.match(/\*\*/g) ?? []).length;
  if (boldMarks % 2 !== 0) problems.push("непарные ** (жирный не закрыт)");
  return problems;
}

type Block =
  | { kind: "h2" | "h3" | "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] };

/** Разбор в блоки. Отдельно от вывода, чтобы разбор можно было проверить. */
export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "p", text: paragraph.join(" ").trim() });
    paragraph = [];
  };
  const flushList = (): void => {
    if (!list) return;
    blocks.push(list);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{2,3})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: heading[1].length === 2 ? "h2" : "h3", text: heading[2] });
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      if (!list || list.kind !== "ul") {
        flushList();
        list = { kind: "ul", items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }
    const numbered = line.match(/^\d+\.\s+(.*)$/);
    if (numbered) {
      flushParagraph();
      if (!list || list.kind !== "ol") {
        flushList();
        list = { kind: "ol", items: [] };
      }
      list.items.push(numbered[1]);
      continue;
    }
    // Продолжение абзаца: список прерывается, иначе хвост прилипнет к пункту.
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}
