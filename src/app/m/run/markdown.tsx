import type { CSSProperties, ReactNode } from "react";

import { parseBlocks } from "@/features/intervals/markdown-blocks";

/**
 * Тот же текст инструкции, но в типографике мини-приложения.
 *
 * ПОЧЕМУ НЕ ПЕРЕИСПОЛЬЗУЕМ РАЗМЕТЧИК СТРАНИЦЫ. Разбор общий (markdown-blocks),
 * а стили разные, и это не вкусовщина: страницу открывают в браузере на светлом
 * фоне и читают целиком, а здесь экран телеграма, шрифт мельче и рядом кнопки.
 * Заголовок в 22px, уместный на странице, в приложении выглядит как крик.
 *
 * ЖИРНЫЙ ВНУТРИ АБЗАЦА СОХРАНЯЕТСЯ. В тексте выделено то, на чём люди
 * спотыкаются (не считайте пульс по формуле, отмечайте галочку скачивания);
 * отрендерить это ровным текстом значит потерять ровно ту часть, ради которой
 * выделение и ставили.
 */

const INK = "#16150F";
const MUTED = "#6C675A";
const ACCENT = "#E5480E";

const S: Record<string, CSSProperties> = {
  h2: { margin: "18px 0 0", fontSize: 17, fontWeight: 700, color: INK, lineHeight: 1.3 },
  h3: { margin: "14px 0 0", fontSize: 15, fontWeight: 700, color: INK },
  p: { margin: "8px 0 0", fontSize: 14, lineHeight: 1.55, color: MUTED },
  ul: { margin: "8px 0 0", paddingLeft: 18, fontSize: 14, color: MUTED },
  ol: { margin: "8px 0 0", paddingLeft: 20, fontSize: 14, color: MUTED },
  li: { marginTop: 5, lineHeight: 1.5 },
  link: { color: ACCENT, fontWeight: 600, textDecoration: "none" },
};

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
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
      nodes.push(
        <a
          key={`${keyPrefix}-a${index}`}
          href={token.slice(split + 2, -1)}
          style={S.link}
          target="_blank"
          rel="noreferrer"
        >
          {token.slice(1, split)}
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
export function renderMiniMarkdown(markdown: string, keyPrefix: string): ReactNode[] {
  if (!markdown.trim()) return [];
  return parseBlocks(markdown).map((block, index) => {
    const key = `${keyPrefix}-${index}`;
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
