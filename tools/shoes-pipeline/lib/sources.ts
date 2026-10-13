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
  /** Адрес условий, если известен заранее (иначе ищется по ссылкам с главной). */
  termsUrl?: string;
  /** Язык обзоров — для таблицы кандидатов. */
  lang?: "en" | "ru";
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
  provides: string[],
  extra: Partial<Pick<Source, "probePaths" | "termsUrl" | "lang">> = {}
): Source => ({
  id,
  title,
  kind,
  origin,
  provides,
  status: "unknown",
  ...extra,
  // Живая страница проверяется по последнему пути: у обзорных площадок это
  // реальный обзор, а не главная — главная бывает открыта при закрытых обзорах.
  probePaths: extra.probePaths ? [...PROBE, ...extra.probePaths] : PROBE,
});

const SPEC = ["заявленные характеристики", "названия моделей"];
const SHOP = ["названия моделей", "цена", "наличие"];
const REVIEW = ["вердикты из обзоров", "названия моделей", "перекрёстные ссылки"];

export const SOURCES: Source[] = [
  // ---------- Бренды, основные ----------
  src("nike", "Nike", "brand", "https://www.nike.com", SPEC, { termsUrl: "https://www.nike.com/help/a/terms-of-use" }),
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
  src("merrell", "Merrell", "brand", "https://www.merrell.com", SPEC, { termsUrl: "https://www.merrell.com/CA/en_CA/content?caid=terms" }),
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

  /* ---------- Кандидаты в обзорные источники (поиск 14.10.2026) ----------
   * Найдены веб-поиском, на сами сайты поиск не заходил. Статус «unknown» до
   * прогона гейта: загрузчик их не пускает, пока все три проверки не пройдены
   * и Игорь не посмотрел таблицу. Путь проверки — реальная страница обзора. */
  src("theruntesters", "theruntesters.com", "review", "https://theruntesters.com", REVIEW, { lang: "en", probePaths: ["/saucony-endorphin-speed-5-review/"] }),
  src("marathonhandbook", "marathonhandbook.com", "review", "https://marathonhandbook.com", REVIEW, { lang: "en", termsUrl: "https://marathonhandbook.com/terms-of-use/", probePaths: ["/saucony-endorphin-elite-2-review/"] }),
  src("runningwarehouse-blog", "www.runningwarehouse.com", "review", "https://www.runningwarehouse.com", REVIEW, { lang: "en", probePaths: ["/reviews/Saucony-Shoe-Reviews/saucony-endorphin-speed-5.html"] }),
  src("fleetfeet", "www.fleetfeet.com", "review", "https://www.fleetfeet.com", REVIEW, { lang: "en", probePaths: ["/blog/nike-pegasus-42-review-a-versatile-workhorse"] }),
  src("therunningchannel", "therunningchannel.com", "review", "https://therunningchannel.com", REVIEW, { lang: "en", probePaths: ["/new-balance-sc-elite-5/"] }),
  src("womensrunning", "www.womensrunning.co.uk", "review", "https://www.womensrunning.co.uk", REVIEW, { lang: "en", probePaths: ["/?p=52971"] }),
  src("irishrunner", "irishrunner.ie", "review", "https://irishrunner.ie", REVIEW, { lang: "en", probePaths: ["/saucony-endorphin-speed-5-review/"] }),
  src("sportsshoes", "www.sportsshoes.com", "review", "https://www.sportsshoes.com", REVIEW, { lang: "en", probePaths: ["/advice/running-hub/kit-gear/review-new-balance-sc-elite-v5"] }),
  src("blacktoerunning", "www.blacktoerunning.com", "review", "https://www.blacktoerunning.com", REVIEW, { lang: "en", probePaths: ["/blogs/education/asics-novablast-5-review"] }),
  src("runflagstaff", "runflagstaff.com", "review", "https://runflagstaff.com", REVIEW, { lang: "en", probePaths: ["/blogs/news/nike-pegasus-42-review"] }),
  src("marathonsports", "www.marathonsports.com", "review", "https://www.marathonsports.com", REVIEW, { lang: "en", probePaths: ["/blog/asics-superblast-2-review"] }),
  src("myracekit", "www.myracekit.com", "review", "https://www.myracekit.com", REVIEW, { lang: "en", probePaths: ["/blogs/news/hoka-clifton-10-review"] }),
  src("alexandrasports-blog", "blog.alexandrasports.com", "review", "https://blog.alexandrasports.com", REVIEW, { lang: "en", probePaths: ["/hoka-clifton-10-review-a-cushioned-and-smooth-daily-trainer/"] }),
  src("thesportsedit", "thesportsedit.com", "review", "https://thesportsedit.com", REVIEW, { lang: "en", probePaths: ["/blogs/news/hoka-mach-6-review"] }),
  src("altitudesports", "altitude-sports.com", "review", "https://altitude-sports.com", REVIEW, { lang: "en", probePaths: ["/a/blog/category/running"] }),
  src("treelinereview", "www.treelinereview.com", "review", "https://www.treelinereview.com", REVIEW, { lang: "en", probePaths: ["/gearreviews/hoka-mach-6-road-running-shoe-review"] }),
  src("flawlessshoereviews", "flawlessshoereviews.com", "review", "https://flawlessshoereviews.com", REVIEW, { lang: "en", probePaths: ["/nike-shoes/nike-vomero-18-review/"] }),
  src("findmyfootwear", "findmyfootwear.com", "review", "https://findmyfootwear.com", REVIEW, { lang: "en", probePaths: ["/?p=19305"] }),
  src("runtothefinish", "runtothefinish.com", "review", "https://runtothefinish.com", REVIEW, { lang: "en", probePaths: ["/?p=97624"] }),
  src("marathons", "www.marathons.com", "review", "https://www.marathons.com", REVIEW, { lang: "en", probePaths: ["/en/tips/nike-pegasus-42-review-after-100-km_0o23"] }),
  src("trailandkale", "trailandkale.com", "review", "https://trailandkale.com", REVIEW, { lang: "en", probePaths: ["/?p=101563"] }),
  src("tomsguide", "www.tomsguide.com", "review", "https://www.tomsguide.com", REVIEW, { lang: "en", probePaths: ["/wellness/running/nike-vomero-18-review"] }),
  src("t3", "www.t3.com", "review", "https://www.t3.com", REVIEW, { lang: "en", probePaths: ["/active/running/asics-superblast-2-review"] }),
  src("coachweb", "www.coachweb.com", "review", "https://www.coachweb.com", REVIEW, { lang: "en", probePaths: ["/gear/running-shoes/nike-alphafly-3-review"] }),
  src("advnture", "www.advnture.com", "review", "https://www.advnture.com", REVIEW, { lang: "en", probePaths: ["/reviews/hoka-speedgoat-6"] }),
  src("iancorless", "iancorless.org", "review", "https://iancorless.org", REVIEW, { lang: "en", probePaths: ["/tag/hokaspeedgoat/"] }),
  src("bettertrail", "bettertrail.com", "review", "https://bettertrail.com", REVIEW, { lang: "en", probePaths: ["/outdoor-gear/hoka-speedgoat-6-review"] }),
  src("sectionhiker", "sectionhiker.com", "review", "https://sectionhiker.com", REVIEW, { lang: "en", probePaths: ["/hoka-speedgoat-6-trail-runner-review/"] }),
  src("thebigoutside", "thebigoutside.com", "review", "https://thebigoutside.com", REVIEW, { lang: "en", probePaths: ["/review-hoka-one-one-speedgoat-6-trail-running-shoes/"] }),
  src("activegearreview", "www.activegearreview.com", "review", "https://www.activegearreview.com", REVIEW, { lang: "en", probePaths: ["/running-gear/trail-running-shoes/mens-trail-running-shoes/saucony-peregrine-15-review/"] }),
  src("runandbecome", "runandbecome.com", "review", "https://runandbecome.com", REVIEW, { lang: "en", probePaths: ["/running-product-reviews/shoes/saucony-peregrine-trail"] }),
  src("livefortheoutdoors", "livefortheoutdoors.com", "review", "https://livefortheoutdoors.com", REVIEW, { lang: "en", probePaths: ["/trail-running/shoes/nnormal-tomir-2-review"] }),
  src("ultrarunning", "ultrarunning.com", "review", "https://ultrarunning.com", REVIEW, { lang: "en", probePaths: ["/featured/review-nnormal-tomir-2-0/"] }),
  src("outdoorgearzine", "outdoorgearzine.com", "review", "https://outdoorgearzine.com", REVIEW, { lang: "en", probePaths: ["/en/review-salomon-genesis"] }),
  src("mensfitness", "mensfitness.co.uk", "review", "https://mensfitness.co.uk", REVIEW, { lang: "en", probePaths: ["/review/salomon-slab-genesis/"] }),
  src("menshealth", "menshealth.com.au", "review", "https://menshealth.com.au", REVIEW, { lang: "en", probePaths: ["/tried-tested-adidas-adizero-adios-pro-4/"] }),
  src("impactmagazine", "impactmagazine.ca", "review", "https://impactmagazine.ca", REVIEW, { lang: "en", probePaths: ["/category/gear/gear-reviews"] }),
  src("shuichirunning", "shuichi-running.com", "review", "https://shuichi-running.com", REVIEW, { lang: "en", probePaths: ["/en/asics-superblast-2-review/"] }),
  src("weeviews", "www.weeviews.com", "review", "https://www.weeviews.com", REVIEW, { lang: "en", probePaths: ["/reviews/4246/endorphin-elite-2"] }),
  src("solefeed", "solefeed.com", "review", "https://solefeed.com", REVIEW, { lang: "en", probePaths: ["/guide/saucony/endorphin-elite"] }),
  src("outsiderun", "run.outsideonline.com", "review", "https://run.outsideonline.com", REVIEW, { lang: "en", probePaths: ["/"] }),
  src("sportmarafon-blog", "sport-marafon.ru", "review", "https://sport-marafon.ru", REVIEW, { lang: "ru", probePaths: ["/article/luchshie-krossovki-dlya-bega-po-asfaltu-top-10/"] }),
  src("runlab-blog", "www.runlab.ru", "review", "https://www.runlab.ru", REVIEW, { lang: "ru", probePaths: ["/article/obzor-novinok-hoka-v-runlab/"] }),
  src("kant-blog", "www.kant.ru", "review", "https://www.kant.ru", REVIEW, { lang: "ru", probePaths: ["/articles/luchshie-krossovki-dlya-novichkov/"] }),
  src("sportmaster-blog", "www.sportmaster.ru", "review", "https://www.sportmaster.ru", REVIEW, { lang: "ru", probePaths: ["/media/articles/obzor-krossovok-hoka/"] }),
  src("sportkult-blog", "blog.sportkult.ru", "review", "https://blog.sportkult.ru", REVIEW, { lang: "ru", probePaths: ["/obzor-krossovok-brooks-ghost-16/"] }),
  src("professionalsport", "www.professionalsport.ru", "review", "https://www.professionalsport.ru", REVIEW, { lang: "ru", probePaths: ["/blog/2024/02/06/obzor-asics-gel-nimbus-26-izmeneniya-k-luchshemu"] }),
  src("alpindustria", "alpindustria.ru", "review", "https://alpindustria.ru", REVIEW, { lang: "ru", probePaths: ["/articles/luzina-o-altra-test-olympus-5.html"] }),
  src("kinash", "kinash.ru", "review", "https://kinash.ru", REVIEW, { lang: "ru", probePaths: ["/blog/obzor-topovykh-modeley-begovykh-krossovok-puma"] }),
  src("bps", "bps.express", "review", "https://bps.express", REVIEW, { lang: "ru", probePaths: ["/adidas-adizero-evo-sl-atr/"] }),
  src("marathonec", "marathonec.ru", "review", "https://marathonec.ru", REVIEW, { lang: "ru", probePaths: ["/puma-deviate-nitro-obzor/"] }),
  src("russiarunning", "life.russiarunning.com", "review", "https://life.russiarunning.com", REVIEW, { lang: "ru", probePaths: ["/news/ekipirovka-trenirovki/obzor-krossovki-anta-c202-6-vashi-200-grammov-dlia-lichnykh-rekordov"] }),
  src("mountainrace", "mountain-race.ru", "review", "https://mountain-race.ru", REVIEW, { lang: "ru", probePaths: ["/news/obzor-krossovok-altra-outroad/"] }),
  src("sports", "www.sports.ru", "review", "https://www.sports.ru", REVIEW, { lang: "ru", probePaths: ["/health/blogs/3399617.html"], termsUrl: "https://www.sports.ru/docs/agreement" }),
  src("tj", "t-j.ru", "review", "https://t-j.ru", REVIEW, { lang: "ru", probePaths: ["/beg-letom/"] }),
  src("championat", "www.championat.com", "review", "https://www.championat.com", REVIEW, { lang: "ru", probePaths: ["/lifestyle/article-6493190-begovye-krossovki-na-leto-obzor-specifiki-tehnologij-i-top-10-modelej.html"] }),
  src("sportmail", "sportmail.ru", "review", "https://sportmail.ru", REVIEW, { lang: "ru", probePaths: ["/article/others/66247605/"] }),
  src("ixbt", "www.ixbt.com", "review", "https://www.ixbt.com", REVIEW, { lang: "ru", probePaths: ["/live/topcompile/10-proverennyh-modeley-krossovok-na-vesnu-leto-2026-obuv-na-raznyy-byudzhet.html"] }),
  src("reminder", "reminder.media", "review", "https://reminder.media", REVIEW, { lang: "ru", probePaths: ["/post/10-luchshikh-luchshikh-begovykh-krossovok-2025-goda"] }),
  src("krossobzor", "krossobzor.ru", "review", "https://krossobzor.ru", REVIEW, { lang: "ru", probePaths: ["/reviews/nike-pegasus-41.html"] }),
  src("4beg", "4beg.ru", "review", "https://4beg.ru", REVIEW, { lang: "ru", probePaths: ["/obzor-krossovok-puma-deviate-nitro/"] }),
  src("academymarathon", "academymarathon.ru", "review", "https://academymarathon.ru", REVIEW, { lang: "ru", probePaths: ["/blog/krossovki-dlya-bega-vybor-akademikov"] }),
  src("anotherfinestep", "anotherfinestep.org", "review", "https://anotherfinestep.org", REVIEW, { lang: "ru", probePaths: ["/vybor-begovyh-krossovok-lichnyj-opyt/"] }),
  src("runners", "runners.ru", "review", "https://runners.ru", REVIEW, { lang: "ru", probePaths: ["/school/kak-vybrat-krossovki-dlya-bega/"] }),
  src("sneakers", "sneakers.by", "review", "https://sneakers.by", REVIEW, { lang: "ru", probePaths: ["/blog/community/novye-krossovki-dlya-bega-kotorye-vy-ne-dolzhny-propustit"] }),
  src("dtf", "dtf.ru", "review", "https://dtf.ru", REVIEW, { lang: "ru", termsUrl: "https://dtf.ru/terms", probePaths: ["/ruslan-titov/3983729-top-10-begovykh-krossovok-2025"] }),

];


export const sourceById = (id: SourceId): Source => {
  const s = SOURCES.find((x) => x.id === id);
  if (!s) throw new Error(`Неизвестный источник: ${id}`);
  return s;
};
