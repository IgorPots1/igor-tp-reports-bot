import type { NextConfig } from "next";

import { NUTRITION_SERVER_ACTION_BODY_SIZE_LIMIT } from "@/features/nutrition/file-upload-limits";

// Старые адреса разделов. По ним разошёлся трафик из шапки Instagram, из
// сохранённых ссылок и переписок, поэтому они обязаны работать вечно.
//
// permanent: true — это 308, а не 307: адреса поменялись один раз и навсегда,
// и поисковик должен склеить их с новыми, а не считать временной подменой.
//
// Источники заданы ТОЧНЫМИ путями, без /:path*. Это важно для /landing:
// картинки лендинга лежат в public/landing/ и запрашиваются как
// /landing/01-hero.jpg. Правило-шаблон перехватило бы их (редиректы в Next
// срабатывают ДО отдачи файлов из public/) и вынесло бы весь визуал страницы.
const LEGACY_REDIRECTS = [
  { source: "/start", destination: "/" },
  { source: "/landing", destination: "/club" },
  { source: "/intensive/apply", destination: "/camp/apply" },
  { source: "/intensive", destination: "/camp" },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  // Хвост запроса (utm_source и прочее) Next переносит на новый адрес сам, пока
  // в destination нет своей строки запроса. На этих метках держится вся
  // статистика по источникам, поэтому проверяется живым запросом, а не на веру.
  async redirects() {
    return LEGACY_REDIRECTS.map((rule) => ({ ...rule, permanent: true }));
  },
  experimental: {
    serverActions: {
      bodySizeLimit: NUTRITION_SERVER_ACTION_BODY_SIZE_LIMIT,
    },
  },
};

export default nextConfig;
