import type { ReviewBasis } from "./types";
import type { VerdictRecord } from "./verdict-types";

/**
 * Блок «на чём основано» в карточке (решение Игоря, 14.10.2026): названия
 * источников со ссылками на обзоры. Только ссылки — без цитат: цитата нужна
 * для проверки вердикта кодом и остаётся во внутреннем evidence.
 *
 * Один обзор — одна строка, даже если по нему поставлено несколько полей.
 */
export function basisLinks(record: VerdictRecord): ReviewBasis[] {
  const seen = new Set<string>();
  const out: ReviewBasis[] = [];
  for (const e of record.evidence) {
    if (!e.url || seen.has(e.url)) continue;
    seen.add(e.url);
    out.push({ title: e.source_title ?? e.source, url: e.url });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, "ru"));
}
