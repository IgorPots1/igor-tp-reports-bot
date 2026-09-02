/**
 * Сопоставление одной и той же модели в разных источниках.
 *
 * RTINGS адресует модель парой «бренд/модель» (asics/novablast-4), RunRepeat —
 * одним куском (asics-novablast-4). Приводим оба к общему ключу.
 *
 * Сопоставление НАМЕРЕННО строгое, без нечёткого сходства. Ошибка здесь — это
 * не пропущенная пара, а склеенные разные кроссовки: Novablast 4 с Novablast 5
 * или мужская модель с женской. Тогда сверка получит два числа от РАЗНЫХ
 * кроссовок, увидит расхождение и отправит человеку разбирать несуществующий
 * конфликт — либо, хуже, не увидит и запишет чужой замер. Лучше недосопоставить
 * и честно показать это числом, чем угадать.
 */

/**
 * Общий ключ: только буквы, цифры и дефисы, нижним регистром.
 *
 * Два хвоста, на которых сопоставление уже давало ноль совпадений:
 *   • пустой бренд (RunRepeat держит всё одним куском) давал ведущий дефис —
 *     «-nike-vomero-plus» против «nike-vomero-plus»;
 *   • RTINGS дописывает к части адресов «-shoe» и «-running-shoe»
 *     («anta-c202-5-gt-shoe»), у RunRepeat такого хвоста нет.
 * Оба случая молчаливые: ключи выглядят правильными, просто не совпадают.
 */
export function modelKey(brand: string, model: string): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const strip = (s: string) => s.replace(/-(?:running-)?shoes?$/, "");
  const b = norm(brand);
  const m = strip(norm(model));
  if (!b) return m;
  // Модель часто уже содержит бренд («asics-novablast-5») — не дублируем.
  return m.startsWith(`${b}-`) ? m : `${b}-${m}`;
}

/** Известные расхождения в написании бренда между источниками. */
const BRAND_ALIASES: Record<string, string> = {
  "new-balance": "new-balance",
  nb: "new-balance",
  "li-ning": "li-ning",
  lining: "li-ning",
  "361": "361-degrees",
  "361-degrees": "361-degrees",
};

export function normalizeBrand(slug: string): string {
  const s = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return BRAND_ALIASES[s] ?? s;
}
