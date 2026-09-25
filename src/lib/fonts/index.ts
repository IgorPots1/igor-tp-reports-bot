/* Шрифты сайта лежат в репозитории, а не подтягиваются с серверов Google.
 *
 * ПОЧЕМУ. `next/font/google` ходит за шрифтом в сеть НА СБОРКЕ. Когда Google
 * отвечает не так, как ждёт загрузчик, падает весь билд целиком, причём с
 * сообщением, по которому причину не угадать: «TypeError: Cannot read
 * properties of null (reading '1')» в недрах google/loader.js. Поймали это
 * 25.09.2026 на /tools/dress — файл, который в тот день никто не трогал; со
 * второй попытки собралось. То есть зелёная сборка зависела от чужого сервера
 * в момент деплоя, и в вечер перед стартом это неприемлемая ставка.
 *
 * Файлы в files/ — переменные шрифты (одна ось wght на всё семейство), срезаны
 * из апстрима google/fonts под latin, latin-ext, cyrillic и cyrillic-ext.
 * Расширенные диапазоны взяты намеренно: страницы просят latin+cyrillic, но в
 * текстах живут «ёлочки», длинное тире, №, ↑ и типографские пробелы.
 *
 * ИМЕНА ПЕРЕМЕННЫХ И ВЕСА МЕНЯТЬ НЕЛЬЗЯ. На --font-onest, --font-jetbrains,
 * --font-montserrat и --font-oswald завязаны все стили лендингов, калькуляторов
 * и мини-аппа. Одна переменная здесь — это шрифт на десятке страниц.
 *
 * Лицензии — files/OFL.txt, все четыре семейства под SIL Open Font License 1.1.
 */
import localFont from "next/font/local";

/* ЗАЧЕМ unicode-range, хотя файлы и так срезаны по этим диапазонам.
 *
 * Без него `next/font/local` объявляет лицо без unicode-range, то есть «этот
 * шрифт покрывает вообще всё». Браузер тогда выбирает наше лицо и для символов,
 * которых в файле нет (←, →, ↻, ✓, ▲, ⚡ и эмодзи — они все вне подмножеств
 * Google), и подменяет их по-своему. Видно это было на кнопке клуба: стрелка
 * «Оставить заявку →» стала заметно длиннее. С честным диапазоном символ просто
 * не совпадает с нашим лицом, и браузер уходит в системный шрифт ровно так же,
 * как уходил с Google.
 *
 * Строка повторена в каждом вызове, а не вынесена в константу, НАМЕРЕННО:
 * загрузчик шрифтов Next принимает только литералы и на переменную отвечает
 * «Font loader values must be explicitly written literals». Диапазоны — те же,
 * что Google раздаёт для latin + latin-ext + cyrillic + cyrillic-ext. */

export const onest = localFont({
  src: "./files/onest-variable.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-onest",
  display: "swap",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD,U+0100-02AF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF,U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116,U+0460-052F,U+1C80-1C88,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F" }],
  adjustFontFallback: false,
});

export const jetbrains = localFont({
  src: "./files/jetbrainsmono-variable.woff2",
  weight: "100 800",
  style: "normal",
  variable: "--font-jetbrains",
  display: "swap",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD,U+0100-02AF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF,U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116,U+0460-052F,U+1C80-1C88,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F" }],
  // Метрики Arial моноширинному шрифту не подходят: пока идёт загрузка, подмена
  // была бы заметнее самой загрузки. В стилях и так прописан ui-monospace.
  adjustFontFallback: false,
});

export const montserrat = localFont({
  src: "./files/montserrat-variable.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-montserrat",
  display: "swap",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD,U+0100-02AF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF,U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116,U+0460-052F,U+1C80-1C88,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F" }],
  adjustFontFallback: false,
});

export const oswald = localFont({
  src: "./files/oswald-variable.woff2",
  weight: "200 700",
  style: "normal",
  variable: "--font-oswald",
  display: "swap",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD,U+0100-02AF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF,U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116,U+0460-052F,U+1C80-1C88,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F" }],
  adjustFontFallback: false,
});
