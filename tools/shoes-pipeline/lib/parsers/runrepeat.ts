import type { ParsedSpec } from "./rtings";

/**
 * Разбор страницы модели RunRepeat.
 *
 * Здесь лежат ровно те замеры, которых нет больше нигде: твёрдость межподошвы
 * по Шору, жёсткость задника, износостойкость и толщина подошвы. Плюс стек и
 * дроп — измеренные, рядом с заявленными производителем.
 *
 * ЧИТАЕМ РАЗМЕТКУ ТАБЛИЦЫ, А НЕ ТЕКСТ СТРАНИЦЫ. Это не педантизм, а следствие
 * пойманной ошибки. Первая версия искала подпись в тексте и брала ближайшее
 * число — и приносила ось гистограммы «Compared to 464 running shoes» вместо
 * замера модели. Ошибка была идеально незаметной: числа правдоподобные, в
 * правильных единицах, — и одинаковые у разных кроссовок (50.1 мм стека и
 * 15.6 мм дропа у трёх моделей подряд). Поймалось только тем, что сведение с
 * RTINGS показало «расхождение 100 %» там, где его быть не могло.
 *
 * Структура строки замера: <th>подпись</th> <td>значение модели</td>
 * <td><span>среднее по базе</span></td>. Берём ПЕРВУЮ ячейку после подписи —
 * позиция в разметке, а не удача совпадения в тексте. Среднее кладём в
 * evidence, чтобы выбор столбца можно было проверить глазами.
 */

export type RunRepeatShoe = {
  url: string;
  slug: string;
  title: string | null;
  specs: Record<string, ParsedSpec>;
};

function plainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&rsquo;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Все строки таблиц замеров: подпись → [значение модели, среднее по базе].
 *
 * Подписи в таблице повторяются между разделами; берём ПЕРВУЮ встреченную,
 * потому что дальше по странице идут сравнительные блоки с теми же словами.
 */
function specRows(html: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  const re = /<th[^>]*>([^<]+?)\s*(?:<span[^>]*>\s*<\/span>\s*)?<\/th>\s*((?:<td[^>]*>[\s\S]*?<\/td>\s*)+)/g;
  for (const m of html.matchAll(re)) {
    const label = m[1].replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    if (rows.has(label)) continue;
    const cells = [...m[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) =>
      c[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
    );
    rows.set(label, cells);
  }
  return rows;
}

/** Число из первой ячейки строки замера. Единица проверяется, а не угадывается. */
function fromRow(
  rows: Map<string, string[]>,
  label: string,
  unit: RegExp,
  kind: ParsedSpec["kind"] = "measured"
): ParsedSpec {
  const cells = rows.get(label);
  if (!cells || cells.length === 0) {
    return { value: null, kind, evidence: `строки «${label}» в таблице нет` };
  }
  const m = cells[0].match(unit);
  if (!m) {
    return { value: null, kind, evidence: `«${label}» = «${cells[0]}» — не разобрано` };
  }
  const n = Number(m[1]);
  return {
    value: Number.isFinite(n) ? n : null,
    kind,
    evidence: `${label}: ${cells[0]}${cells[1] ? ` (среднее по базе ${cells[1]})` : ""}`,
  };
}

export function parseRunRepeat(html: string, url: string): RunRepeatShoe {
  const text = plainText(html);
  const rows = specRows(html);
  const slug = new URL(url).pathname.replace(/^\//, "");
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);

  const MM = /([\d.]+)\s*mm/i;
  const NUM = /([\d.]+)/;

  // Вес и ширины лежат не в таблице замеров, а в строке спецификации.
  const weightMen = text.match(/Weight:\s*Men:\s*[\d.]+\s*oz\s*\/\s*(\d+)\s*g/i);
  const weightWomen = text.match(/Women:\s*[\d.]+\s*oz\s*\/\s*(\d+)\s*g/i);
  const widthsLine = text.match(/Widths available:\s*(.{0,110})/i);

  const specs: Record<string, ParsedSpec> = {
    /**
     * ШКАЛА ТВЁРДОСТИ — НЕ HA. RunRepeat перешёл на Asker C: в таблице стоит
     * «Midsole softness 27.5 AC», а в HA осталось только измерение на холоде, и
     * оно прямо помечено «(old method)». Поле схемы называется
     * midsole_durometer_ha, то есть написано под старую шкалу, и формула
     * softnessFromHa в приложении откалибрована под неё же (14 HA → 10, 36 → 1).
     * Положить сюда AC — получить мягкость по чужой линейке. Имя честное,
     * перевод шкалы — отдельное решение.
     */
    midsole_softness_ac: fromRow(rows, "Midsole softness", /([\d.]+)\s*AC/i),
    midsole_softness_cold_old_ha: fromRow(rows, "Midsole softness in cold (old method)", /([\d.]+)\s*HA/i),
    midsole_softness_cold_pct: fromRow(rows, "Midsole softness in cold (%)", /([\d.]+)\s*%/),

    heel_counter_stiffness: fromRow(rows, "Heel counter stiffness", NUM),
    outsole_thickness_mm: fromRow(rows, "Outsole thickness", MM),
    outsole_hardness_hc: fromRow(rows, "Outsole hardness", /([\d.]+)\s*HC/i),
    // Износостойкость у RunRepeat — глубина выработки в мм после абразивного
    // теста: МЕНЬШЕ значит выносливее. Перевод в шкалу схемы 1–10 — отдельный
    // шаг, а не разбор страницы.
    outsole_wear_mm: fromRow(rows, "Outsole durability", MM),

    stack_heel_mm: fromRow(rows, "Heel stack", MM),
    stack_fore_mm: fromRow(rows, "Forefoot stack", MM),
    drop_mm: fromRow(rows, "Drop", MM),
    platform_width_heel_mm: fromRow(rows, "Midsole width - heel", MM),
    platform_width_fore_mm: fromRow(rows, "Midsole width - forefoot", MM),
    toebox_width_mm: fromRow(rows, "Toebox width", MM),
    insole_thickness_mm: fromRow(rows, "Insole thickness", MM),

    drop_declared_mm: (() => {
      const m = text.match(/Drop:\s*([\d.]+)\s*mm/i);
      return m
        ? { value: Number(m[1]), kind: "declared" as const, evidence: m[0].trim() }
        : { value: null, kind: "declared" as const, evidence: "заявленный дроп не найден" };
    })(),
    weight_men_g: weightMen
      ? { value: Number(weightMen[1]), kind: "declared", evidence: weightMen[0].trim() }
      : { value: null, kind: "declared", evidence: "мужской вес не найден" },
    weight_women_g: weightWomen
      ? { value: Number(weightWomen[1]), kind: "declared", evidence: weightWomen[0].trim() }
      : { value: null, kind: "declared", evidence: "женской версии на странице нет" },
    widths_available: widthsLine
      ? { value: widthsLine[1].trim(), kind: "declared", evidence: widthsLine[0].trim() }
      : { value: null, kind: "declared", evidence: "строка ширин не найдена" },
  };

  return {
    url,
    slug,
    title: titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : null,
    specs,
  };
}
