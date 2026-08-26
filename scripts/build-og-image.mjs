// Собирает public/og-1200x630.png — карточку, которую Telegram, Instagram и
// поисковики показывают вместо ссылки на сайт.
//
// Картинка рисуется РАЗМЕТКОЙ, а не в редакторе, ровно по той же дизайн-системе,
// что и страницы (#F6F4EF, #16150F, #E5480E, Onest + JetBrains Mono). Поменялся
// текст или цвет — правится здесь и пересобирается, а не подгоняется руками в
// графическом файле, который потом никто не сможет повторить.
//
// Запуск из корня репозитория:  node scripts/build-og-image.mjs
//
// Playwright берётся из tools/trainingpeaks-export — единственное место в репо,
// где он уже стоит; отдельной зависимости в корневой package.json это не добавляет.

import { readFileSync, writeFileSync } from "node:fs";

// Playwright живёт только внутри tools/trainingpeaks-export и в корневой
// package.json не объявлен. Если его там нет (свежий worktree) — говорим прямо,
// чем ставить, а не падаем стеком про ERR_MODULE_NOT_FOUND.
let chromium;
try {
  ({ chromium } = await import(
    "../tools/trainingpeaks-export/node_modules/playwright-core/index.mjs"
  ));
} catch {
  console.error(
    "Не найден playwright-core. Поставь его: npm --prefix tools/trainingpeaks-export install"
  );
  process.exit(1);
}

const WIDTH = 1200;
const HEIGHT = 630;
const OUT = "public/og-1200x630.png";

const logo = readFileSync("public/logo-512.png").toString("base64");

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:${WIDTH}px;height:${HEIGHT}px;background:#F6F4EF;color:#16150F;
       font-family:'Onest',system-ui,sans-serif;-webkit-font-smoothing:antialiased;
       display:flex;align-items:center;gap:64px;padding:0 76px;overflow:hidden}
  .col{flex:1;min-width:0}
  .eyebrow{display:flex;align-items:center;gap:12px;font-family:'JetBrains Mono',monospace;
           font-size:20px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:#E5480E}
  .eyebrow .dot{width:12px;height:12px;border-radius:50%;background:#E5480E}
  h1{margin-top:26px;font-size:66px;font-weight:700;letter-spacing:-.025em;line-height:1.04}
  h1 .hl{color:#E5480E}
  p{margin-top:24px;font-size:27px;line-height:1.4;color:#4D483F;max-width:22ch}
  .foot{margin-top:38px;padding-top:26px;border-top:1px solid #E7E1D5;
        font-family:'JetBrains Mono',monospace;font-size:18px;letter-spacing:.12em;
        text-transform:uppercase;color:#857F73}
  .mark{flex:0 0 auto;width:330px;height:330px;border-radius:44px;overflow:hidden;
        box-shadow:0 24px 60px -24px rgba(25,23,18,.45)}
  .mark img{width:100%;height:100%;display:block}
</style>
</head>
<body>
  <div class="col">
    <div class="eyebrow"><span class="dot"></span>igorp.run</div>
    <h1>Беговой клуб<br><span class="hl">Игоря Поцелуева</span></h1>
    <p>Индивидуальный план, разбор техники и тренер на связи каждый день</p>
    <div class="foot">план · разбор · сопровождение</div>
  </div>
  <div class="mark"><img src="data:image/png;base64,${logo}" alt=""></div>
</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const png = await page.screenshot({ type: "png" });
await browser.close();

writeFileSync(OUT, png);
console.log(`${OUT}: ${WIDTH}x${HEIGHT}, ${png.length} байт`);
