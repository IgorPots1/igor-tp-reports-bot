/**
 * Словарь тренера: названия тренировок и формулировки описаний. Нормализация убирает числа
 * (минуты, темпы, повторы), чтобы «6 х 4 мин» и «5 х 3 мин» считались одним шаблоном.
 */
import type { CSess, CWeek, Kind } from "./corpus.ts";

export const normTitle = (t: string): string => t.toLowerCase().replace(/ё/g, "е")
  .replace(/[0-9]+([.,:][0-9]+)?/g, "#").replace(/\s*[xх×]\s*/g, " x ").replace(/\s+/g, " ").trim();

/** Темп/время/числа → «#», чтобы фраза описания стала шаблоном. */
export const normSentence = (s: string): string => s.toLowerCase().replace(/ё/g, "е")
  .replace(/[0-9]{1,2}:[0-9]{2}(\s*[-–—]\s*[0-9]{1,2}:[0-9]{2})?/g, "#темп")
  .replace(/[0-9]+([.,][0-9]+)?/g, "#").replace(/\s+/g, " ").trim();

export function sentences(desc: string): string[] {
  return desc.replace(/\r/g, "").split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 12);
}

export type TitleStat = { title: string; n: number; kinds: Record<Kind, number>; medMin: number; athletes: number };
export type PhraseStat = { phrase: string; example: string; n: number; kinds: Record<Kind, number>; athletes: number };

const med = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export function titleStats(weeks: CWeek[], normalize: boolean): TitleStat[] {
  const m = new Map<string, { n: number; kinds: Record<Kind, number>; mins: number[]; ath: Set<number> }>();
  for (const w of weeks) for (const s of w.sessions) {
    const k = normalize ? normTitle(s.title) : s.title;
    const e = m.get(k) ?? m.set(k, { n: 0, kinds: { quality: 0, long: 0, easy: 0 }, mins: [], ath: new Set() }).get(k)!;
    e.n++; e.kinds[s.kind]++; e.mins.push(s.minutes); e.ath.add(w.aid);
  }
  return [...m.entries()].map(([title, e]) => ({ title, n: e.n, kinds: e.kinds, medMin: med(e.mins), athletes: e.ath.size })).sort((a, b) => b.n - a.n);
}

export function phraseStats(weeks: CWeek[]): PhraseStat[] {
  const m = new Map<string, { ex: string; n: number; kinds: Record<Kind, number>; ath: Set<number> }>();
  for (const w of weeks) for (const s of w.sessions) for (const sen of new Set(sentences(s.desc))) {
    const k = normSentence(sen);
    const e = m.get(k) ?? m.set(k, { ex: sen, n: 0, kinds: { quality: 0, long: 0, easy: 0 }, ath: new Set() }).get(k)!;
    e.n++; e.kinds[s.kind]++; e.ath.add(w.aid);
  }
  return [...m.entries()].map(([phrase, e]) => ({ phrase, example: e.ex, n: e.n, kinds: e.kinds, athletes: e.ath.size })).sort((a, b) => b.n - a.n);
}

/** Самый частый у ТРЕНЕРА заголовок-шаблон для данной роли сессии — для адаптации. */
export function dominantKind(k: Record<Kind, number>): Kind {
  return (Object.entries(k) as Array<[Kind, number]>).sort((a, b) => b[1] - a[1])[0][0];
}

export function sessionHasDesc(s: CSess): boolean { return s.desc.length > 0; }
