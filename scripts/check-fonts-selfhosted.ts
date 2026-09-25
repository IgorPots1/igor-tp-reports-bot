/**
 * Шрифты остаются своими.
 *
 * ЧТО СТЕРЕЖЁТ. `next/font/google` ходит за шрифтом в сеть НА СБОРКЕ, и когда
 * Google отвечает не так, как ждёт загрузчик, падает весь билд — с сообщением
 * «Cannot read properties of null (reading '1')», по которому причину не
 * угадать. Поймали 25.09.2026 на файле, который никто не трогал. Один
 * вернувшийся импорт снова ставит деплой в зависимость от чужого сервера.
 *
 * Второе, что стережёт: как семейство названо в стилях. На --font-onest,
 * --font-jetbrains, --font-montserrat и --font-oswald завязаны лендинги,
 * калькуляторы и мини-апп. Голая строка «JetBrains Mono» раньше работала,
 * потому что next/font/google регистрировал лицо под настоящим именем
 * семейства. Свои шрифты живут под сгенерированным именем, и такая строка
 * перестаёт находить хоть что-нибудь — МОЛЧА. Ровно так и случилось в
 * club.css: кириллица в футере уехала на системный моноширинный, ширина
 * «Калькуляторы» упала с 92 до 80 px, и заметно это было только по разнице
 * скриншотов.
 *
 *   npm run check:fonts-selfhosted
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = "src";
const FONT_DIR = "src/lib/fonts/files";
const MODULE = "src/lib/fonts/index.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);

// ── Ни одного импорта из next/font/google ────────────────────────────────────
const google = files.filter(
  (f) => f !== MODULE && /from\s+["']next\/font\/google["']/.test(readFileSync(f, "utf8")),
);
assert.deepEqual(google, [], `шрифты снова тянутся с серверов Google: ${google.join(", ")}`);

// ── Файлы шрифтов на месте и не пустые ───────────────────────────────────────
const expected = [
  "onest-variable.woff2",
  "jetbrainsmono-variable.woff2",
  "montserrat-variable.woff2",
  "oswald-variable.woff2",
];
expected.forEach((f) => {
  const p = join(FONT_DIR, f);
  assert.ok(existsSync(p), `нет файла шрифта ${p}`);
  assert.ok(statSync(p).size > 20_000, `файл ${f} подозрительно мал, ${statSync(p).size} байт`);
});

// ── Переменные не переименованы ──────────────────────────────────────────────
const mod = readFileSync(MODULE, "utf8");
["--font-onest", "--font-jetbrains", "--font-montserrat", "--font-oswald"].forEach((v) => {
  assert.ok(mod.includes(`"${v}"`), `пропала css-переменная ${v}`);
});

// ── Семейство задаётся переменной, а не голой строкой ────────────────────────
const bare: string[] = [];
files
  .filter((f) => f.endsWith(".css") || f.endsWith(".tsx"))
  .forEach((f) => {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(
      /font-family:\s*["']?(Onest|JetBrains Mono|Montserrat|Oswald)["']?/g,
    )) {
      const head = text.slice(Math.max(0, (m.index ?? 0) - 60), m.index);
      if (!head.includes("var(--font-")) bare.push(`${f}: ${m[0]}`);
    }
  });
assert.deepEqual(bare, [], `семейство прописано строкой без var(--font-*): ${bare.join(" | ")}`);

console.log(`check:fonts-selfhosted — ${files.length} файлов проверено, шрифты свои`);
