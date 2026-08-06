#!/usr/bin/env node
/**
 * Рендер гоночных карточек в PDF + PNG.
 *
 *   node gen.js [папка-с-html]
 *
 * Берёт каждый *.html из папки (по умолчанию текущая), рендерит шириной
 * 470 px одной длинной страницей PDF и кладёт рядом PNG для проверки глазами.
 *
 * Имена выходных файлов можно задать в cards.json рядом с html:
 *   { "valentin-card.html": "Валентин_12_километров" }
 * Без cards.json имя файла берётся из имени html.
 *
 * Требуется puppeteer-core и Chromium в образе (/opt/pw-browsers/...).
 */
const path = require('path');
const fs = require('fs');

let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch (e) {
  console.error(
    'Не найден puppeteer-core. В репозитории его нет, ставится разово:\n' +
    '  mkdir -p ~/cards && cd ~/cards && npm init -y && npm i puppeteer-core\n' +
    'и запускать gen.cjs оттуда, либо прописать NODE_PATH на его node_modules.\n' +
    'Скачивать браузер не нужно: Chromium уже есть в /opt/pw-browsers.'
  );
  process.exit(1);
}

const DIR = path.resolve(process.argv[2] || '.');
const WIDTH = 470;

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const root = '/opt/pw-browsers';
  if (!fs.existsSync(root)) {
    throw new Error('Chromium не найден: нет /opt/pw-browsers. Задай CHROME_PATH.');
  }
  // версия каталога меняется от образа к образу, ищем любой chromium-*
  for (const entry of fs.readdirSync(root)) {
    if (!entry.startsWith('chromium')) continue;
    for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome']) {
      const candidate = path.join(root, entry, rel);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error('Chromium не найден в /opt/pw-browsers. Задай CHROME_PATH.');
}

function loadNames() {
  const p = path.join(DIR, 'cards.json');
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

(async () => {
  const names = loadNames();
  const files = fs.readdirSync(DIR)
    .filter(f => f.endsWith('.html') && f !== 'template.html');

  if (!files.length) {
    console.error('Нет html-файлов в ' + DIR);
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'],
  });

  for (const file of files) {
    const html = fs.readFileSync(path.join(DIR, file), 'utf8');
    if (html.includes('—')) {
      console.warn('ВНИМАНИЕ: длинное тире в ' + file + ', Игорь их не принимает');
    }
    if (html.includes('__STYLE__')) {
      console.warn('ВНИМАНИЕ: в ' + file + ' не подставлен _style.css');
    }

    const out = names[file] || path.basename(file, '.html');
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: 1200, deviceScaleFactor: 2 });
    await page.goto('file://' + path.join(DIR, file), { waitUntil: 'networkidle0' });

    const h = await page.evaluate(
      () => Math.ceil(document.body.getBoundingClientRect().height)
    );

    await page.screenshot({ path: path.join(DIR, out + '.png'), fullPage: true });
    await page.pdf({
      path: path.join(DIR, out + '.pdf'),
      width: WIDTH + 'px',
      height: (h + 4) + 'px',
      printBackground: true,
      pageRanges: '1',
    });

    console.log('готово: ' + out + ' (высота ' + h + ')');
    await page.close();
  }

  await browser.close();
  console.log('\nПосмотри PNG глазами перед отправкой Игорю.');
})().catch(e => { console.error(e); process.exit(1); });
