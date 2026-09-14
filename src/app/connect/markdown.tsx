import type { CSSProperties, ReactNode } from "react";

import { parseBlocks } from "@/features/intervals/markdown-blocks";

/**
 * Маленький разметчик для текста страницы /connect.
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

const INK = "#16150F";
const INK_2 = "#4D483F";
const ACCENT = "#E5480E";

const S: Record<string, CSSProperties> = {
  h2: { margin: "32px 0 0", fontSize: 22, fontWeight: 700, letterSpacing: "-.01em", color: INK },
  h3: { margin: "22px 0 0", fontSize: 18, fontWeight: 700, color: INK },
  p: { margin: "14px 0 0", color: INK_2 },
  ul: { margin: "12px 0 0", paddingLeft: 20, color: INK_2 },
  ol: { margin: "12px 0 0", paddingLeft: 22, color: INK_2 },
  li: { marginTop: 7, lineHeight: 1.55 },
  link: { color: ACCENT, fontWeight: 600, textDecoration: "none" },
};

/** Жирный, ссылки и обычный текст внутри одной строки. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Одним проходом, чтобы **жирный** и [ссылка](адрес) не мешали друг другу.
  const pattern = /(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={`${keyPrefix}-b${index}`} style={{ color: INK }}>
          {token.slice(2, -2)}
        </strong>
      );
    } else {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      nodes.push(
        <a key={`${keyPrefix}-a${index}`} href={href} style={S.link}>
          {label}
        </a>
      );
    }
    lastIndex = match.index + token.length;
    index += 1;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/** Разметить текст слота. Пустой текст даёт пустой массив: блок не покажется. */
export function renderMarkdown(markdown: string, keyPrefix: string): ReactNode[] {
  if (!markdown.trim()) return [];
  return parseBlocks(markdown).map((block, index) => {
    const key = `${keyPrefix}-${index}`;
    // switch по kind, а не цепочка if: только он сужает размеченный union
    // надёжно, и текстовые блоки не путаются со списочными.
    switch (block.kind) {
      case "ul":
      case "ol": {
        const items = block.items.map((item, itemIndex) => (
          <li key={`${key}-${itemIndex}`} style={S.li}>
            {renderInline(item, `${key}-${itemIndex}`)}
          </li>
        ));
        return block.kind === "ul" ? (
          <ul key={key} style={S.ul}>{items}</ul>
        ) : (
          <ol key={key} style={S.ol}>{items}</ol>
        );
      }
      case "h2":
        return (
          <h2 key={key} style={S.h2}>
            {renderInline(block.text, key)}
          </h2>
        );
      case "h3":
        return (
          <h3 key={key} style={S.h3}>
            {renderInline(block.text, key)}
          </h3>
        );
      default:
        return (
          <p key={key} style={S.p}>
            {renderInline(block.text, key)}
          </p>
        );
    }
  });
}
