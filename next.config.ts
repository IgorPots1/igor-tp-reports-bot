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

// Старые Vercel-домены проекта. igorp.run, igorp-run.vercel.app и
// igor-tp-reports-bot.vercel.app — один и тот же Vercel-проект с тремя
// привязанными доменами, поэтому старые домены продолжают отвечать сами по
// себе, просто не на каноническом адресе. Кнопки в двух активных
// автоматизациях ChatPlace ("Калькулятор темпа", "Калькулятор питания")
// зашиты именно на igor-tp-reports-bot.vercel.app.
//
// Редирект — ТОЛЬКО для путей /tools/*, ТОЛЬКО по условию host, не для всего
// домена: на старых доменах может быть завязан внешний вебхук или callback
// (Telegram, TrainingPeaks OAuth), который редирект не пройдёт — такой запрос
// получил бы ошибку вместо ответа. Домен целиком не трогаем.
const LEGACY_HOSTS = ["igor-tp-reports-bot.vercel.app", "igorp-run.vercel.app"];
const TOOL_PATHS = ["/tools/plan", "/tools/nutrition", "/tools/shoes", "/tools/dress"];

const LEGACY_HOST_REDIRECTS = LEGACY_HOSTS.flatMap((host) =>
  TOOL_PATHS.map((path) => ({
    source: path,
    has: [{ type: "host" as const, value: host }],
    destination: `https://igorp.run${path}`,
    permanent: true,
  })),
);

// Локальная админка (com.igor.coachos.localadmin) собирается отдельно от Vercel
// в свою папку — .next-admin, а не .next, — чтобы `next build` там не сталкивался
// с параллельно работающим `next dev`/`next start` в той же WorkingDirectory.
// Vercel и обычный `npm run dev` эту переменную не задают, distDir остаётся ".next".
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  // Хвост запроса (utm_source и прочее) Next переносит на новый адрес сам, пока
  // в destination нет своей строки запроса. На этих метках держится вся
  // статистика по источникам, поэтому проверяется живым запросом, а не на веру.
  async redirects() {
    return [
      ...LEGACY_REDIRECTS.map((rule) => ({ ...rule, permanent: true })),
      ...LEGACY_HOST_REDIRECTS,
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: NUTRITION_SERVER_ACTION_BODY_SIZE_LIMIT,
    },
  },
};

export default nextConfig;
