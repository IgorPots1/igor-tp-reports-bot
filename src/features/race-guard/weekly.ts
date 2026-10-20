/* Строки недельного итога по защите /races (наряд 20.10.2026). Чистые функции: без базы и сети,
 * их проверяет scripts/check-races-protect.ts. Блокировок здесь нет — только предложение Игорю. */

export type GuardLogRow = { kind: string; ip_masked: string; ua: string; path: string; n: number; minute: string };

/** Источник, который предлагаем заблокировать: за неделю столько отказов по частоте или хотя бы
 *  столько разных минут с отказом (то есть не один всплеск, а упорство). */
export const BLOCK_MIN_REFUSALS = 200;
export const BLOCK_MIN_MINUTES = 10;

const KIND_RU: Record<string, string> = {
  rate_limit: "429",
  no_init_data: "без initData",
  bad_init_data: "плохая или старая подпись",
  forbidden: "нет прав",
};

/** «1.2.3.x» → «1.2.3.0/24»: замаскированный адрес блокируется подсетью (правило в Vercel Firewall). */
export function subnetOf(ipMasked: string): string {
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.x$/.test(ipMasked)) return ipMasked.replace(/x$/, "0/24");
  if (ipMasked.endsWith("::x")) return `${ipMasked.slice(0, -3)}::/48`;
  return ipMasked;
}

function shortUa(ua: string): string {
  const t = ua.trim();
  if (!t) return "без user-agent";
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

export function guardSummary(rows: GuardLogRow[]): string {
  const total = rows.reduce((s, r) => s + r.n, 0);
  if (!total) return "Защита: отказов 0 за неделю, блокировать некого.";
  const byKind = new Map<string, number>();
  for (const r of rows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + r.n);
  const kinds = [...byKind.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${KIND_RU[k] ?? k} ${n}`).join(", ");
  // Источник — IP с маской и user-agent: один адрес с разными клиентами — разные источники.
  const bySrc = new Map<string, { ip: string; ua: string; n: number; rate: number; minutes: Set<string>; paths: Set<string> }>();
  for (const r of rows) {
    const key = `${r.ip_masked}|${r.ua}`;
    const s = bySrc.get(key) ?? { ip: r.ip_masked, ua: r.ua, n: 0, rate: 0, minutes: new Set<string>(), paths: new Set<string>() };
    s.n += r.n;
    if (r.kind === "rate_limit") {
      s.rate += r.n;
      s.minutes.add(r.minute);
    }
    s.paths.add(r.path);
    bySrc.set(key, s);
  }
  const top = [...bySrc.values()].sort((a, b) => b.n - a.n);
  const top5 = top.slice(0, 5).map((s) => `${s.ip} (${shortUa(s.ua)}) — ${s.n}`).join("; ");
  const block = [...new Set(top.filter((s) => s.rate >= BLOCK_MIN_REFUSALS || s.minutes.size >= BLOCK_MIN_MINUTES).map((s) => subnetOf(s.ip)))];
  return `Защита: отказов ${total} (${kinds}), топ-5 источников: ${top5}; предложить заблокировать: ${block.length ? block.join(", ") : "никого"}.`;
}

export type CopyHit = { url: string; phrase: string };

/** Свой ли адрес: igorp.run и его копии на Vercel, сам бот. Сравнение без схемы и www. */
export function isOwnUrl(url: string, own: string[]): boolean {
  const bare = url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").toLowerCase();
  return own.some((o) => bare === o || bare.startsWith(`${o}/`) || bare.startsWith(`${o}?`));
}

export function copyLines(hits: CopyHit[] | null, own: string[]): string[] {
  if (hits === null) return ["Поиск копий: не выполнен (нет итога поиска за неделю)."];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hits) {
    if (!/^https?:\/\//i.test(h.url) || isOwnUrl(h.url, own)) continue;
    const key = `${h.url}|${h.phrase}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`Возможная копия: ${h.url}, «${h.phrase}»`);
  }
  return out.length ? out : ["Поиск копий: совпадений на чужих сайтах не найдено."];
}
