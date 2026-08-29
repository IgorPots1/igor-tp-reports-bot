import type { Metadata, MetadataRoute } from "next";

// ЕДИНСТВЕННОЕ место, где записан адрес сайта. До этого его не было нигде:
// ни metadataBase, ни canonical, ни og:url — из-за чего превью ссылки в
// Telegram и Instagram собиралось из случайного текста страницы. Домен
// упоминался только в прозе README и доков, поэтому «вынести в константу»
// здесь означает завести её впервые, а не собрать разбросанное.
//
// Без завершающего слэша: пути ниже всегда начинаются со своего.
export const SITE_URL = "https://igorp.run";

/** Подпись владельца сайта: og:site_name и запасной заголовок карточки. */
export const SITE_NAME = "Игорь Поцелуев · Беговой клуб";

/** Описание по умолчанию — уходит в карточку страницы, у которой нет своего. */
export const SITE_DESCRIPTION =
  "Индивидуальный план тренировок, разбор техники и тренер на связи каждый день. От первых 5 км до марафона.";

// Путь, а не абсолютный адрес: metadataBase в корневом layout разворачивает
// относительные ссылки сам, и картинка не разъедется, если домен сменится.
export const OG_IMAGE_PATH = "/og-1200x630.png";
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

type SitemapEntry = MetadataRoute.Sitemap[number];

export type PublicPage = {
  path: string;
  changeFrequency: SitemapEntry["changeFrequency"];
  priority: number;
};

/**
 * Публичные страницы для sitemap.xml. Список ручной, и это НАМЕРЕННО: обход
 * файловой системы затащил бы сюда /admin, мини-аппы /m/* и формы, которые в
 * поиске не нужны. Появилась публичная страница — добавь строку.
 *
 * Чего здесь нет и почему:
 *   /camp/apply       — форма записи, самостоятельной ценности в выдаче нет
 *                       (у неё и своё noindex в метаданных);
 *   /start, /landing, /intensive — старые адреса, отдают 308 на новые;
 *                       в карте нужны цели, а не перевалочные пункты;
 *   /admin/*, /m/*    — закрытые разделы, они же закрыты в robots.
 */
export const PUBLIC_PAGES: PublicPage[] = [
  // Корень — страница-хаб, она же главная: отдаёт содержимое сама, без прыжка.
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/club", changeFrequency: "weekly", priority: 0.9 },
  { path: "/camp", changeFrequency: "weekly", priority: 0.9 },
  { path: "/tools/plan", changeFrequency: "monthly", priority: 0.7 },
  { path: "/tools/nutrition", changeFrequency: "monthly", priority: 0.7 },
  { path: "/tools/shoes", changeFrequency: "monthly", priority: 0.7 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
];

/**
 * Абсолютный адрес страницы сайта.
 *
 * Корень отдаётся БЕЗ завершающего слэша: Next именно так нормализует canonical
 * («https://igorp.run»), и карта сайта обязана называть главную ровно тем же
 * адресом. Иначе canonical и sitemap показывают на строку, различающуюся одним
 * символом, — формально это один и тот же адрес, но расхождение потом всплывает
 * предупреждением в панели вебмастера и заставляет разбираться на ровном месте.
 */
export function siteUrl(path: string): string {
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`;
}

type PublicPageMetadataInput = {
  /** Путь страницы, со слэша: «/landing». */
  path: string;
  title: string;
  description: string;
};

/**
 * Метаданные публичной страницы: canonical + карточки Open Graph и Twitter.
 *
 * Заводится ПОСТРАНИЧНО, а не только в корневом layout, из-за особенности
 * Next: страница, задавшая свой title, НЕ получает его автоматически в
 * og:title — там остаётся og:title родителя. Один helper на все страницы
 * держит это в одном месте и не даёт карточкам разъехаться с заголовками.
 */
export function publicPageMetadata({
  path,
  title,
  description,
}: PublicPageMetadataInput): Metadata {
  const url = siteUrl(path);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      locale: "ru_RU",
      siteName: SITE_NAME,
      url,
      title,
      description,
      images: [
        {
          url: OG_IMAGE_PATH,
          width: OG_IMAGE_WIDTH,
          height: OG_IMAGE_HEIGHT,
          alt: SITE_NAME,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [OG_IMAGE_PATH],
    },
  };
}
