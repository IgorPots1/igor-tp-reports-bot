/**
 * Реестр источников базы кроссовок.
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

export type SourceId =
  | "runrepeat"
  | "asics"
  | "nike"
  | "hoka"
  | "newbalance"
  | "brooks"
  | "saucony"
  | "adidas"
  | "mizuno"
  | "puma"
  | "on"
  | "salomon"
  | "runningwarehouse"
  | "roadtrailrun"
  | "doctorsofrunning"
  | "rtings"
  | "xtep"
  | "lining"
  | "anta"
  | "361"
  | "peak"
  | "kailas";

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
  origin: string;
  /** Пути, которые конвейер реально обходил бы. Их и проверяет аудит. */
  probePaths: string[];
  /** Что берём отсюда — для отчёта о происхождении полей. */
  provides: string[];
  /** Проставляется аудитом; "manual" задаётся здесь и аудитом не меняется. */
  status: TermsStatus;
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

export const SOURCES: Source[] = [
  {
    id: "runrepeat",
    title: "RunRepeat",
    origin: "https://runrepeat.com",
    probePaths: ["/catalog/running-shoes", "/asics-novablast-5"],
    provides: ["midsole_durometer_ha", "heel_counter_stiffness", "outsole_durability", "image"],
    // Лицензия на данные — предмет переписки с владельцем, а не robots.txt.
    // Пока ответа нет, источник в конвейер не идёт, каким бы ни был robots.
    status: "manual",
    note: "Ждём ответ по лицензии и цене. До ответа не собираем даже то, что robots разрешает.",
  },
  { id: "asics", title: "ASICS", origin: "https://www.asics.com", probePaths: ["/us/en-us/running-shoes/c/aa10000000/"], provides: ["заявленные характеристики"], status: "unknown" },
  { id: "nike", title: "Nike", origin: "https://www.nike.com", probePaths: ["/w/mens-running-shoes-37v7jznik1zy7ok"], provides: ["заявленные характеристики"], status: "unknown" },
  { id: "hoka", title: "HOKA", origin: "https://www.hoka.com", probePaths: ["/en/us/mens-road/"], provides: ["заявленные характеристики"], status: "unknown" },
  { id: "newbalance", title: "New Balance", origin: "https://www.newbalance.com", probePaths: ["/men/shoes/running/"], provides: ["заявленные характеристики"], status: "unknown" },
  { id: "brooks", title: "Brooks", origin: "https://www.brooksrunning.com", probePaths: ["/en_us/mens-running-shoes/"], provides: ["заявленные характеристики"], status: "unknown" },
  { id: "saucony", title: "Saucony", origin: "https://www.saucony.com", probePaths: ["/en/mens-running-shoes/"], provides: ["заявленные характеристики"], status: "unknown" },
  { id: "adidas", title: "adidas", origin: "https://www.adidas.com", probePaths: ["/us/men-running-shoes"], provides: ["заявленные характеристики"], status: "unknown" },
  { id: "mizuno", title: "Mizuno", origin: "https://emea.mizuno.com", probePaths: ["/eu/en-gb/running/shoes"], provides: ["заявленные характеристики"], status: "unknown" },
  { id: "puma", title: "PUMA", origin: "https://us.puma.com", probePaths: ["/us/en/men/shoes/running-shoes"], provides: ["заявленные характеристики"], status: "unknown" },
  { id: "on", title: "On", origin: "https://www.on.com", probePaths: ["/en-us/shop/mens/running-shoes"], provides: ["заявленные характеристики"], status: "unknown" },
  { id: "salomon", title: "Salomon", origin: "https://www.salomon.com", probePaths: ["/en-us/shop/men/footwear/trail-running.html"], provides: ["заявленные характеристики"], status: "unknown" },
  { id: "runningwarehouse", title: "Running Warehouse", origin: "https://www.runningwarehouse.com", probePaths: ["/catpage-MRSHOES.html"], provides: ["вес, стек, дроп, цена, наличие"], status: "unknown" },
  { id: "roadtrailrun", title: "Road Trail Run", origin: "https://www.roadtrailrun.com", probePaths: ["/search/label/Running%20Shoe%20Reviews"], provides: ["формулировки мягкости", "китайские бренды"], status: "unknown" },
  { id: "doctorsofrunning", title: "Doctors of Running", origin: "https://www.doctorsofrunning.com", probePaths: ["/search/label/Shoe%20Review"], provides: ["формулировки мягкости", "китайские бренды"], status: "unknown" },
  { id: "rtings", title: "RTINGS", origin: "https://www.rtings.com", probePaths: ["/shoes"], provides: ["лабораторные замеры (публичные страницы)"], status: "unknown" },
  { id: "xtep", title: "Xtep", origin: "https://www.xtep.com", probePaths: ["/"], provides: ["заявленные характеристики"], status: "unknown" },
  { id: "lining", title: "Li-Ning", origin: "https://www.lining.com", probePaths: ["/"], provides: ["заявленные характеристики"], status: "unknown" },
  { id: "anta", title: "ANTA", origin: "https://www.anta.com", probePaths: ["/"], provides: ["заявленные характеристики"], status: "unknown" },
  { id: "361", title: "361 Degrees", origin: "https://www.361sport.com", probePaths: ["/"], provides: ["заявленные характеристики"], status: "unknown" },
  { id: "peak", title: "PEAK", origin: "https://www.peaksport.com", probePaths: ["/"], provides: ["заявленные характеристики"], status: "unknown" },
  { id: "kailas", title: "Kailas", origin: "https://www.kailas.com", probePaths: ["/"], provides: ["заявленные характеристики"], status: "unknown" },
];

export const sourceById = (id: SourceId): Source => {
  const s = SOURCES.find((x) => x.id === id);
  if (!s) throw new Error(`Неизвестный источник: ${id}`);
  return s;
};
