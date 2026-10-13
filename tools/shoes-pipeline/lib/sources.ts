/**
 * Реестр источников базы кроссовок.
 *
 * OZON И WILDBERRIES ИСКЛЮЧЕНЫ (13.10.2026): записи удалены целиком, а не
 * переведены в статус «запрещён», — по той же логике, что и RunRepeat. Вместе
 * с ними удалено правило «маркетплейс только китайским брендам»: без площадок
 * оно не охраняло ничего. Его заменила привязка officialFor, которая шире —
 * она защищает от подделки в ЛЮБОМ магазине, а не на двух площадках.
 *
 * RUNREPEAT ИСКЛЮЧЁН НАСОВСЕМ (13.10.2026): владелец отказал в использовании
 * данных. Отказ покрывает всё — сами замеры, цитаты из них и пересказ. Поэтому
 * источника нет не в статусе «запрещён», а нет в списке вовсе: статус можно
 * переключить, отсутствие записи переключить нельзя.
 *
 * Правило наряда: источник, запрещающий автоматический сбор, в конвейер не
 * включается. Поэтому реестр — не справочник, а ГЕЙТ: загрузчик спрашивает
 * его перед каждым запросом, и страница источника со статусом, отличным от
 * "allowed", не скачивается вовсе.
 *
 * Статус проставляется не на глаз, а прогоном audit-sources.ts: он читает
 * robots.txt каждого хоста и проверяет ИМЕННО те пути, которые мы бы обходили.
 * Ручной статус (manual) ставится там, где решение принимает человек:
 * лицензия, письмо, договорённость.
 */

export type SourceId = string;

/**
 * Что это за площадка. Проходы поиска моделей идут по типам, а не по списку
 * имён: каталог бренда, каталог магазина и подборка обзорщика дают РАЗНОЕ.
 * Бренд даёт полноту текущей линейки, магазин — то, что ещё продаётся (включая
 * прошлые поколения), обзорщик — то, по чему вообще существуют обзоры, то есть
 * реальный потолок каталога подбора.
 */
export type SourceKind = "brand" | "shop" | "review";

export type TermsStatus =
  /** robots.txt разрешает нужные пути, автоматический сбор не запрещён. */
  | "allowed"
  /** robots.txt или условия запрещают — в конвейер не берём. */
  | "forbidden"
  /** Решает человек: лицензия, письмо, договорённость. Пока не решено — не берём. */
  | "manual"
  /** Ещё не проверено. Загрузчик такой источник не пускает. */
  | "unknown";

export type Source = {
  id: SourceId;
  title: string;
  kind: SourceKind;
  origin: string;
  /** Пути, которые конвейер реально обходил бы. Их и проверяет аудит. */
  probePaths: string[];
  /** Что берём отсюда — для отчёта о происхождении полей. */
  provides: string[];
  /** Проставляется аудитом; "manual" задаётся здесь и аудитом не меняется. */
  status: TermsStatus;
  /**
   * Бренды, для которых магазин — ОФИЦИАЛЬНЫЙ продавец, по опубликованному
   * самим брендом списку. Только у магазинов.
   *
   * Пустой список означает «не установлено», и это ЗАПРЕТ, а не разрешение:
   * цена не записывается, пока нет доказательства. Признак оригинальности —
   * не мнение о магазине и не возраст сайта, а ссылка на страницу бренда, где
   * этот магазин назван.
   */
  officialFor?: string[];
  /** Ссылка на страницу бренда со списком продавцов — доказательство. */
  officialProof?: string;
  /** Почему статус такой. Заполняется аудитом или рукой. */
  note?: string;
};

/**
 * Наш User-Agent. Представляемся честно и оставляем контакт: анонимный обход
 * чужого сайта — то же самое, что обход без спроса.
 *
 * ТОЛЬКО ASCII. Заголовки HTTP — это ByteString (Latin-1), и кириллица в них
 * роняет сам запрос: первая версия строки была по-русски, и из-за неё ни один
 * robots.txt не прочитался — все двадцать источников молча ушли в «решает
 * человек», как будто сайты недоступны.
 */
export const USER_AGENT =
  "igorp-run-shoe-index/1.0 (+https://igorp.run; running shoe spec collection)";

/** Пауза между запросами к ОДНОМУ хосту. Наряд: без нагрузки на чужие сайты. */
export const HOST_DELAY_MS = 4000;

/**
 * Пути для проверки — КОРЕНЬ и КАРТА САЙТА, а не разделы каталога.
 *
 * Прежняя версия перечисляла выдуманные адреса вида «/us/en-us/running-shoes/»,
 * и они отдавали 404 и 302: угаданный путь проверяет не сайт, а фантазию. Разделы
 * каталога находятся потом, из карты сайта, а гейт спрашивается про то, что
 * существует наверняка.
 */
const PROBE = ["/", "/sitemap.xml"];

const src = (
  id: string,
  title: string,
  kind: SourceKind,
  origin: string,
  provides: string[]
): Source => ({ id, title, kind, origin, probePaths: PROBE, provides, status: "unknown" });

const SPEC = ["заявленные характеристики", "названия моделей"];
const SHOP = ["названия моделей", "цена", "наличие"];
const REVIEW = ["вердикты из обзоров", "названия моделей", "перекрёстные ссылки"];

export const SOURCES: Source[] = [
  // ---------- Бренды, основные ----------
  src("nike", "Nike", "brand", "https://www.nike.com", SPEC),
  src("adidas", "adidas", "brand", "https://www.adidas.com", SPEC),
  src("asics", "ASICS", "brand", "https://www.asics.com", SPEC),
  src("hoka", "HOKA", "brand", "https://www.hoka.com", SPEC),
  src("saucony", "Saucony", "brand", "https://www.saucony.com", SPEC),
  src("newbalance", "New Balance", "brand", "https://www.newbalance.com", SPEC),
  src("brooks", "Brooks", "brand", "https://www.brooksrunning.com", SPEC),
  src("puma", "PUMA", "brand", "https://us.puma.com", SPEC),
  src("mizuno", "Mizuno", "brand", "https://emea.mizuno.com", SPEC),
  src("on", "On", "brand", "https://www.on.com", SPEC),
  src("salomon", "Salomon", "brand", "https://www.salomon.com", SPEC),

  // ---------- Бренды, трейл и нишевые ----------
  src("lasportiva", "La Sportiva", "brand", "https://www.lasportiva.com", SPEC),
  src("scott", "Scott", "brand", "https://www.scott-sports.com", SPEC),
  src("altra", "Altra", "brand", "https://www.altrarunning.com", SPEC),
  src("topo", "Topo Athletic", "brand", "https://www.topoathletic.com", SPEC),
  src("inov8", "Inov-8", "brand", "https://www.inov8.com", SPEC),
  src("merrell", "Merrell", "brand", "https://www.merrell.com", SPEC),
  src("craft", "Craft", "brand", "https://www.craftsportswear.com", SPEC),
  src("dynafit", "Dynafit", "brand", "https://www.dynafit.com", SPEC),
  src("nnormal", "NNormal", "brand", "https://nnormal.com", SPEC),

  // ---------- Бренды, массовые и магазинные ----------
  src("decathlon", "Decathlon / Kiprun", "brand", "https://www.decathlon.com", SPEC),
  src("reebok", "Reebok", "brand", "https://www.reebok.com", SPEC),
  src("underarmour", "Under Armour", "brand", "https://www.underarmour.com", SPEC),
  src("skechers", "Skechers", "brand", "https://www.skechers.com", SPEC),
  src("diadora", "Diadora", "brand", "https://www.diadora.com", SPEC),

  /* ---------- Бренды китайские ----------
   * Отдельным проходом С САМОГО НАЧАЛА, а не по остаточному принципу: по ним
   * меньше источников, и оставленные на конец они не получат внимания вовсе. */
  src("lining", "Li-Ning", "brand", "https://www.lining.com", SPEC),
  src("anta", "ANTA", "brand", "https://www.anta.com", SPEC),
  src("xtep", "Xtep", "brand", "https://www.xtep.com", SPEC),
  src("361", "361 Degrees", "brand", "https://www.361sport.com", SPEC),
  src("peak", "PEAK", "brand", "https://www.peaksport.com", SPEC),
  src("kailas", "Kailas", "brand", "https://www.kailas.com", SPEC),
  src("bmai", "Bmai", "brand", "https://www.bmaisport.com", SPEC),

  /* ---------- Обзорные площадки ----------
   * Дают две вещи: вердикты и реальный ПОТОЛОК каталога подбора. Сколько
   * моделей обозрено — столько и может попасть в выдачу, сколько бы их ни
   * выпустили бренды. */
  src("roadtrailrun", "Road Trail Run", "review", "https://www.roadtrailrun.com", REVIEW),
  src("doctorsofrunning", "Doctors of Running", "review", "https://www.doctorsofrunning.com", REVIEW),
  src("believeintherun", "Believe in the Run", "review", "https://believeintherun.com", REVIEW),
  src("rtings", "RTINGS", "review", "https://www.rtings.com", REVIEW),

  /* ---------- Магазины ----------
   * Держат то, чего уже нет на сайте бренда, — прошлые поколения, на которых
   * держится ИНДЕКС. Российские отдельно: они показывают, что реально доступно
   * на том рынке, и только они дают рублёвую цену. */
  src("runningwarehouse", "Running Warehouse", "shop", "https://www.runningwarehouse.com", SHOP),
  src("sportmaster", "Спортмастер", "shop", "https://www.sportmaster.ru", SHOP),
  src("streetbeat", "Street Beat", "shop", "https://street-beat.ru", SHOP),
  src("kant", "Кант", "shop", "https://www.kant.ru", SHOP),
  src("runlab", "RunLab", "shop", "https://runlab.ru", SHOP),
  src("sportkult", "Спорткульт", "shop", "https://www.sportkult.ru", SHOP),
  src("sportmarafon", "Спортмарафон", "shop", "https://sport-marafon.ru", SHOP),
  src("lamoda", "Lamoda", "shop", "https://www.lamoda.ru", SHOP),

];


export const sourceById = (id: SourceId): Source => {
  const s = SOURCES.find((x) => x.id === id);
  if (!s) throw new Error(`Неизвестный источник: ${id}`);
  return s;
};
