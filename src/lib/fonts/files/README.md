# Файлы шрифтов

Переменные шрифты (ось `wght`), срезанные из апстрима `google/fonts` под
latin, latin-ext, cyrillic и cyrillic-ext. Подключаются через
`next/font/local` в `../index.ts` — туда же смотреть, зачем это вообще.

| файл | семейство | ось wght | источник |
|---|---|---|---|
| `onest-variable.woff2` | Onest | 100–900 | `ofl/onest/Onest[wght].ttf` |
| `jetbrainsmono-variable.woff2` | JetBrains Mono | 100–800 | `ofl/jetbrainsmono/JetBrainsMono[wght].ttf` |
| `montserrat-variable.woff2` | Montserrat | 100–900 | `ofl/montserrat/Montserrat[wght].ttf` |
| `oswald-variable.woff2` | Oswald | 200–700 | `ofl/oswald/Oswald[wght].ttf` |

Все четыре под SIL Open Font License 1.1, тексты лицензий рядом (`OFL-*.txt`).

## Как пересобрать

Срезано 25.09.2026, `fonttools` 4.60.2:

```
pyftsubset <Family>[wght].ttf \
  --output-file=<family>-variable.woff2 --flavor=woff2 \
  --layout-features='*' --name-IDs='*' --notdef-outline --recalc-bounds \
  --unicodes='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD,U+0100-02AF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF,U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116,U+0460-052F,U+1C80-1C88,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F'
```

Диапазоны — те же, что раздаёт Google для подмножеств latin/latin-ext/
cyrillic/cyrillic-ext, слитые в один файл: `next/font/local` не умеет
`unicode-range` на запись в `src`, поэтому одному семейству — один файл.

У Oswald нет глифа `↑` (U+2191), его нет и в версии от Google. Стрелка
встречается только на /tools/raskladka, а там Onest, где она есть.
