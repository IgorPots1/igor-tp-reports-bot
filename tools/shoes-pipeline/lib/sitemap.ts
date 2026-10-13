import { fetchPage } from "./fetch";
import type { SourceId } from "./sources";

/**
 * Обход карт сайта.
 *
 * Карта сайта — единственный честный способ узнать, какие страницы у источника
 * есть. Угадывание адресов каталога уже дважды обошлось впустую: выдуманные
 * «/us/en-us/running-shoes/» и «/catalog/beg/» отдали 404 и 302, то есть
 * проверяли не сайт, а фантазию.
 *
 * Карта объявляется в robots.txt. Если там её нет, пробуем стандартные адреса —
 * но именно пробуем, а не считаем найденной: отсутствие карты это нормальный
 * ответ, с которым дальше работает другой проход.
 */

const STANDARD = ["/sitemap.xml", "/sitemap_index.xml", "/sitemaps/index.xml"];

/** Адреса карт, объявленные в robots.txt источника. */
export async function sitemapsFromRobots(sourceId: SourceId, origin: string): Promise<string[]> {
  const res = await fetchPage(sourceId, `${origin}/robots.txt`);
  if (!res.ok) return [];
  return [...res.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1].trim());
}

export type SitemapWalk = {
  /** Все адреса страниц, найденные в картах. */
  urls: string[];
  /** Сколько карт реально прочитано — для отчёта о полноте обхода. */
  mapsRead: number;
  /** Карты, до которых не дошли: лимит глубины или отказ загрузки. */
  skipped: { url: string; reason: string }[];
};

/**
 * Разворачивает карту сайта, включая вложенные индексы.
 *
 * `maxMaps` ограничивает число прочитанных карт: у крупных магазинов их бывают
 * сотни, и проход за ними уходит в часы. Предел — это не потеря данных, а
 * ЗАЯВЛЕННАЯ неполнота: всё непрочитанное попадает в skipped и видно в отчёте.
 */
export async function walkSitemaps(
  sourceId: SourceId,
  roots: string[],
  opts: { maxMaps?: number; urlFilter?: RegExp } = {}
): Promise<SitemapWalk> {
  const maxMaps = opts.maxMaps ?? 40;
  const seen = new Set<string>();
  const queue = [...roots];
  const urls = new Set<string>();
  const skipped: { url: string; reason: string }[] = [];
  let mapsRead = 0;

  while (queue.length > 0) {
    const url = queue.shift() as string;
    if (seen.has(url)) continue;
    seen.add(url);

    if (mapsRead >= maxMaps) {
      skipped.push({ url, reason: `предел ${maxMaps} карт` });
      continue;
    }

    const res = await fetchPage(sourceId, url);
    if (!res.ok) {
      skipped.push({ url, reason: res.reason });
      continue;
    }
    mapsRead += 1;

    const locs = [...res.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    // Индекс карт отличается от карты страниц тегом <sitemapindex>, но у части
    // сайтов он соврал; надёжнее смотреть на сам адрес.
    for (const loc of locs) {
      if (/\.xml(\.gz)?(\?|$)/i.test(loc)) queue.push(loc);
      else if (!opts.urlFilter || opts.urlFilter.test(loc)) urls.add(loc);
    }
  }

  return { urls: [...urls], mapsRead, skipped };
}

/**
 * Группирует адреса по ФОРМЕ пути: числа и слаги заменяются на заполнители.
 *
 * Нужно, чтобы не угадывать, где у сайта карточки товара, а увидеть это: самая
 * многочисленная форма с осмысленным сегментом и есть каталог. Решение
 * принимается по фактической структуре, а не по догадке о ней.
 */
export function clusterByShape(urls: string[]): { shape: string; count: number; sample: string }[] {
  const groups = new Map<string, { count: number; sample: string }>();
  for (const u of urls) {
    let path: string;
    try {
      path = new URL(u).pathname;
    } catch {
      continue;
    }
    const shape = path
      .split("/")
      .map((seg) => {
        if (seg === "") return "";
        if (/^\d+$/.test(seg)) return "<num>";
        if (seg.length > 18 || /-/.test(seg)) return "<slug>";
        return seg;
      })
      .join("/");
    const g = groups.get(shape) ?? { count: 0, sample: u };
    g.count += 1;
    groups.set(shape, g);
  }
  return [...groups]
    .map(([shape, g]) => ({ shape, count: g.count, sample: g.sample }))
    .sort((a, b) => b.count - a.count);
}
