import { SOURCES } from "./sources";

/**
 * Извлечение бренда и модели из адреса обзора.
 *
 * Адреса устроены по-разному, и это не косметика: у RTINGS бренд и модель
 * лежат отдельными сегментами, у блогов склеены в один слаг
 * («new-balance-supercomp-elite-v6-review»). Склеенный слаг нельзя разрезать по
 * первому дефису — «new-balance» и «li-ning» сами содержат дефис, — поэтому
 * бренд ищется САМЫМ ДЛИННЫМ совпадением из известного списка.
 *
 * Бренд не распознан — модель не выбрасывается, а помечается: это может быть
 * бренд, которого нет в нашем списке, и наряд велит такие добавлять, а не
 * терять.
 */

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Слаги известных брендов, от длинных к коротким. */
const BRAND_SLUGS = SOURCES.filter((s) => s.kind === "brand")
  .map((s) => ({ id: s.id, title: s.title, slug: slug(s.title) }))
  .concat([
    // Бренды кроссовок, встреченные в обзорах и отсутствовавшие в реестре.
    // Наряд велит такие добавлять, а не терять.
    { id: "mounttocoast", title: "Mount to Coast", slug: "mount-to-coast" },
    { id: "norda", title: "Norda", slug: "norda" },
    { id: "veja", title: "Veja", slug: "veja" },
    { id: "newton", title: "Newton", slug: "newton" },
    { id: "karhu", title: "Karhu", slug: "karhu" },
    { id: "brooks", title: "Brooks", slug: "brooks" },
    { id: "hoka", title: "HOKA", slug: "hoka" },
    // Написания, которых нет в названии источника, но которые встречаются в адресах.
    { id: "adidas", title: "adidas", slug: "adidas" },
    { id: "lining", title: "Li-Ning", slug: "li-ning" },
    { id: "lining", title: "Li-Ning", slug: "lining" },
    { id: "361", title: "361 Degrees", slug: "361" },
    { id: "decathlon", title: "Decathlon / Kiprun", slug: "kiprun" },
    { id: "newbalance", title: "New Balance", slug: "new-balance" },
    { id: "topo", title: "Topo Athletic", slug: "topo" },
    { id: "inov8", title: "Inov-8", slug: "inov-8" },
    { id: "inov8", title: "Inov-8", slug: "inov8" },
    { id: "underarmour", title: "Under Armour", slug: "under-armour" },
    { id: "lasportiva", title: "La Sportiva", slug: "la-sportiva" },
    { id: "nnormal", title: "NNormal", slug: "nnormal" },
  ])
  .sort((a, b) => b.slug.length - a.slug.length);

/**
 * Слова, по которым обзор — НЕ про кроссовки.
 *
 * Doctors of Running и Believe in the Run обозревают всю беговую экипировку:
 * одежду, очки, рюкзаки, часы, средства восстановления. Без этого фильтра они
 * попадают в счёт моделей и завышают потолок: среди «моделей» оказывались
 * «summer-running-shorts» и «roka-prescription-glasses».
 */
const NOT_SHOE = /\b(apparel|shorts|tee|t-shirt|shirt|singlet|jacket|vest|tights|socks?|glasses|sunglasses|watch|gps|headphones|earbuds|pack|backpack|vest|belt|bottle|hydration|gel|nutrition|recovery|massage|roller|treadmill|bike|elliptigo|insole|orthotic|lace|gaiter|hat|cap|gloves|bra|collection|guide|giveaway|interview|podcast|news)\b/i;

export function looksLikeShoe(modelSlug: string): boolean {
  return !NOT_SHOE.test(modelSlug);
}

export type ReviewModel = {
  /** Нормализованный ключ «бренд-модель» — по нему снимается пересечение. */
  key: string;
  brandId: string | null;
  brandTitle: string | null;
  model: string;
  url: string;
  lastmod: string | null;
  source: string;
};

/** Чистит слаг модели от служебных хвостов обзора. */
function cleanModel(s: string): string {
  return s
    .replace(/-?\b(review|reviews|multi-tester|first-look|initial|impressions)\b-?/gi, "-")
    .replace(/-?\b(20\d\d)\b-?/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Разбирает склеенный слаг «бренд-модель» самым длинным совпадением бренда. */
function splitBrand(s: string): { brandId: string | null; brandTitle: string | null; model: string } {
  for (const b of BRAND_SLUGS) {
    if (s === b.slug || s.startsWith(`${b.slug}-`)) {
      return { brandId: b.id, brandTitle: b.title, model: cleanModel(s.slice(b.slug.length)) };
    }
  }
  return { brandId: null, brandTitle: null, model: cleanModel(s) };
}

export function parseReviewUrl(source: string, url: string, lastmod: string | null): ReviewModel | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const seg = path.split("/").filter(Boolean);
  if (seg.length === 0) return null;

  if (source === "rtings") {
    // /running-shoes/reviews/<brand>/<model>
    if (seg.length !== 4) return null;
    const brandSlug = slug(seg[2]);
    const found = BRAND_SLUGS.find((b) => b.slug === brandSlug);
    const model = cleanModel(slug(seg[3]));
    if (!model) return null;
    return {
      key: `${found?.id ?? brandSlug}-${model}`,
      brandId: found?.id ?? null,
      brandTitle: found?.title ?? seg[2],
      model,
      url,
      lastmod,
      source,
    };
  }

  // Блоги: последний сегмент — склеенный слаг «бренд-модель-review».
  const last = slug(seg[seg.length - 1]);
  const { brandId, brandTitle, model } = splitBrand(last);
  if (!model) return null;
  return { key: `${brandId ?? "unknown"}-${model}`, brandId, brandTitle, model, url, lastmod, source };
}
