/**
 * Разбор страницы обзора RTINGS.
 *
 * RTINGS МЕРЯЕТ, а не переписывает у производителя, — это лучше, чем
 * заявленные характеристики, за которыми наряд посылал на сайты брендов.
 * Поэтому всё, что отсюда взято, помечается как measured, а не declared.
 *
 * ВАЖНОЕ РАЗЛИЧЕНИЕ. RTINGS даёт жёсткость как «Firmness At 550N» — прогиб под
 * нагрузкой в ньютонах. Схема просит midsole_durometer_ha — твёрдость по Шору,
 * прибор другой и шкала другая. Одинаково называется, одинаково не значит.
 * Поэтому число уезжает в ОТДЕЛЬНОЕ поле firmness_550n, а midsole_durometer_ha
 * остаётся пустым. Пересчёт одного в другое — решение человека, и до него
 * запись честно не проходит валидацию, вместо того чтобы проходить с выдумкой.
 */

export type ParsedSpec = {
  /** Значение. null — на странице поля нет. */
  value: number | string | null;
  /** measured — замер лаборатории, declared — со слов производителя. */
  kind: "measured" | "declared";
  /** Кусок страницы, откуда взято, — чтобы можно было проверить глазами. */
  evidence: string;
};

export type RtingsShoe = {
  url: string;
  brandSlug: string;
  modelSlug: string;
  title: string | null;
  specs: Record<string, ParsedSpec>;
};

/** Текст страницы без разметки и скриптов — по нему ищем подписи замеров. */
function plainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Достаёт число, идущее сразу за подписью.
 *
 * Ищем в ПОСЛЕДНЕМ вхождении подписи, а не в первом: первое почти всегда в
 * оглавлении страницы, где за подписью идёт следующий пункт оглавления, а не
 * значение. На этом парсер и ломался бы молча, подставляя соседнюю цифру.
 *
 * `notAfter` закрывает вторую ловушку, куда парсер уже попадал: подпись
 * «Heel-To-Toe Drop» целиком лежит внутри «Advertised Heel-To-Toe Drop», и
 * поиск последнего совпадения возвращал ЗАЯВЛЕННЫЙ перепад под видом
 * измеренного. Разница там не косметическая: у Li-Ning Chaoying Pro измерено
 * 10,1 мм против заявленных 6,0. Ошибка была бы невидимой — число правдоподобное.
 */
function numberAfter(text: string, label: string, unit: string, notAfter?: string): ParsedSpec {
  const guard = notAfter ? `(?<!${notAfter})` : "";
  const re = new RegExp(`${guard}${label}\\s*([\\d.]+)\\s*${unit}`, "gi");
  const hits = [...text.matchAll(re)];
  if (hits.length === 0) return { value: null, kind: "measured", evidence: `«${label}» не найдено` };
  const last = hits[hits.length - 1];
  const n = Number(last[1]);
  return {
    value: Number.isFinite(n) ? n : null,
    kind: "measured",
    evidence: last[0].trim(),
  };
}

function textAfter(text: string, label: string, words: string[]): ParsedSpec {
  const re = new RegExp(`${label}\\s+(${words.join("|")})`, "i");
  const m = text.match(re);
  return m
    ? { value: m[1], kind: "measured", evidence: m[0].trim() }
    : { value: null, kind: "measured", evidence: `«${label}» не найдено` };
}

export function parseRtings(html: string, url: string): RtingsShoe {
  const text = plainText(html);
  const parts = new URL(url).pathname.split("/");
  const brandSlug = parts[parts.length - 2] ?? "";
  const modelSlug = parts[parts.length - 1] ?? "";

  const titleMatch = html.match(/<title>([^<]+)<\/title>/);

  // Блок featured_item — самые надёжные значения: они в разметке, а не в прозе.
  const featured = new Map<string, string>();
  for (const [, k, v] of html.matchAll(
    /featured_item-label">([^<]+)<\/span>\s*<span class="featured_item-text">([^<]+)</g
  )) {
    featured.set(k.trim(), v.trim());
  }
  const fromFeatured = (label: string, unit: RegExp): ParsedSpec => {
    const raw = featured.get(label);
    if (!raw) return { value: null, kind: "measured", evidence: `«${label}» не найдено` };
    const m = raw.match(unit);
    return m
      ? { value: Number(m[1]), kind: "measured", evidence: `${label} = ${raw}` }
      : { value: null, kind: "measured", evidence: `${label} = ${raw} (не разобрано)` };
  };

  // Блок featured есть не на всех страницах, а в тексте замеры лежат всегда —
  // и там их БОЛЬШЕ: отдельно высота под носком и отдельно заявленный перепад.
  // Поэтому featured идёт запасным вариантом, а не основным.
  const pick = (a: ParsedSpec, b: ParsedSpec): ParsedSpec => (a.value !== null ? a : b);

  const specs: Record<string, ParsedSpec> = {
    weight_g: pick(numberAfter(text, "Weight", "g"), fromFeatured("Weight", /([\d.]+)\s*g/)),
    stack_heel_mm: pick(
      numberAfter(text, "Heel Stack Height", "mm"),
      fromFeatured("Heel Stack Height", /([\d.]+)\s*mm/)
    ),
    stack_fore_mm: numberAfter(text, "Forefoot Stack Height", "mm"),
    // Измеренный перепад — с защитой от подписи «Advertised …».
    drop_mm: pick(
      numberAfter(text, "Heel-To-Toe Drop", "mm", "Advertised "),
      fromFeatured("Heel-To-Toe Drop", /([\d.]+)\s*mm/)
    ),
    // Заявленный производителем. Наряд: пишем заявленный, помечаем заявленным.
    drop_declared_mm: {
      ...numberAfter(text, "Advertised Heel-To-Toe Drop", "mm"),
      kind: "declared",
    },
    plate: featured.has("Plate")
      ? { value: featured.get("Plate") as string, kind: "measured", evidence: `Plate = ${featured.get("Plate")}` }
      : { value: null, kind: "measured", evidence: "«Plate» не найдено" },
    platform_width_heel_mm: numberAfter(text, "Outsole Heel Width", "mm"),
    platform_width_fore_mm: numberAfter(text, "Outsole Forefoot Width", "mm"),
    // НЕ дюрометр: прогиб под 550 Н. Держим отдельно и не выдаём за Shore HA.
    firmness_550n_heel: numberAfter(text, "Heel Firmness Preview Graph Firmness At 550N", ""),
    wide_sizing_available: textAfter(text, "Wide Sizing Available", ["Yes", "No"]),
  };

  return {
    url,
    brandSlug,
    modelSlug,
    title: titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : null,
    specs,
  };
}
