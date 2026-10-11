/**
 * Превью ссылок (Open Graph): у каждой публичной страницы своя картинка.
 *
 * ЧТО СТЕРЕЖЁТ. До 11.10.2026 все страницы отдавали одну клубную картинку и
 * подпись «Игорь Поцелуев · Беговой клуб», и ссылка на календарь стартов в
 * Telegram выглядела как реклама клуба. Теперь:
 *   — у каждой страницы из sitemap (PUBLIC_PAGES), кроме главной и /club, есть
 *     свой opengraph-image.tsx и twitter-image.tsx. Новая страница без своей
 *     картинки молча получила бы клубную, поэтому чек требует файл;
 *   — og:site_name по умолчанию нейтральный «igorp.run», клубная подпись только
 *     у /club;
 *   — шрифты для картинок на месте и статические: next/og не читает ни woff2,
 *     ни переменные шрифты, и без них картинка падает или рисуется чужим шрифтом;
 *   — в текстах картинок нет длинных тире.
 *
 *   npm run check:og-images
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { OG_SITE_NAME, PUBLIC_PAGES, publicPageMetadata } from "@/lib/site";

const CLUB_IMAGE_PAGES = new Set(["/", "/club"]);
const pages = [...PUBLIC_PAGES.map((p) => p.path), "/connect"];

const missing: string[] = [];
for (const p of pages) {
  if (CLUB_IMAGE_PAGES.has(p)) continue;
  const dir = join("src/app", p);
  for (const f of ["opengraph-image.tsx", "twitter-image.tsx"]) {
    if (!existsSync(join(dir, f))) missing.push(`${p}/${f}`);
  }
  const og = join(dir, "opengraph-image.tsx");
  if (existsSync(og)) {
    const text = readFileSync(og, "utf8");
    assert.ok(text.includes("renderOgCard"), `${og}: картинка не через общий шаблон`);
    assert.ok(!/[—–]/.test(text), `${og}: длинное тире в тексте картинки`);
  }
}
assert.deepEqual(missing, [], `нет своей картинки превью: ${missing.join(", ")}`);

// Подпись сайта.
assert.equal(OG_SITE_NAME, "igorp.run");
const og = publicPageMetadata({ path: "/races", title: "t", description: "d" }).openGraph as { siteName?: string };
assert.equal(og.siteName, "igorp.run", "по умолчанию подпись нейтральная");
assert.ok(readFileSync("src/app/club/page.tsx", "utf8").includes("siteName: SITE_NAME"), "/club держит клубную подпись");

// Картинка из метаданных в Next ПОБЕЖДАЕТ файловую opengraph-image (так и было:
// своя картинка /races собиралась, а в HTML стояла клубная). Поэтому без
// clubImage в метаданных картинки быть не должно вовсе.
const plain = publicPageMetadata({ path: "/races", title: "t", description: "d" });
assert.equal((plain.openGraph as { images?: unknown }).images, undefined, "без clubImage og:image не задаётся метаданными");
assert.equal((plain.twitter as { images?: unknown }).images, undefined, "без clubImage twitter:image не задаётся метаданными");
const club = publicPageMetadata({ path: "/club", title: "t", description: "d", clubImage: true });
assert.ok((club.openGraph as { images?: unknown[] }).images?.length, "clubImage даёт клубную картинку");
for (const f of ["src/app/page.tsx", "src/app/club/page.tsx"]) {
  assert.ok(readFileSync(f, "utf8").includes("clubImage: true"), `${f}: клубная картинка у главной и /club`);
}
for (const p of pages) {
  if (CLUB_IMAGE_PAGES.has(p)) continue;
  const page = readFileSync(join("src/app", p, "page.tsx"), "utf8");
  assert.ok(!page.includes("clubImage: true"), `${p}: клубная картинка перекрыла бы свою`);
}
assert.ok(readFileSync("src/app/layout.tsx", "utf8").includes("siteName: OG_SITE_NAME"), "корень с нейтральной подписью");

// Шрифты картинок: на месте, не пустые, статические (без таблицы fvar).
for (const f of ["Onest-Regular.ttf", "Onest-ExtraBold.ttf", "JetBrainsMono-Bold.ttf"]) {
  const p = join("src/lib/og/fonts", f);
  assert.ok(existsSync(p), `нет шрифта ${p}`);
  assert.ok(statSync(p).size > 20_000, `шрифт ${p} подозрительно мал`);
  const head = readFileSync(p).subarray(0, 512).toString("latin1");
  assert.ok(!head.includes("fvar"), `шрифт ${p} переменный, next/og его не прочитает`);
}

console.log(`check:og-images ok: ${pages.length - CLUB_IMAGE_PAGES.size} страниц со своей картинкой`);
