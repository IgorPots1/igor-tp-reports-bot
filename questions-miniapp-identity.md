# Задача 2 — иконка и название на домашнем экране (ветка feature/club-miniapp-identity)

## 2.1 Откуда берётся имя/иконка — ВЫЯСНЕНО ФАКТОМ
В репозитории **нет ни манифеста, ни иконок**, а строки «TP report bot» в коде **нет вообще**
(grep по всему проекту — ноль). Для Telegram Mini App имя и иконка на домашнем экране приходят
**от самого Telegram** — от бота / мини-аппа, настроенного в BotFather, — а НЕ из кода. То есть
«TP report bot», который ты видишь, задан в BotFather, и основная правка — там.

## 2.2 Что починил в коде (вторично, но правильно)
Код-метаданные влияют только на прямое открытие по URL / iOS-Safari «На экран «Домой»» (PWA-путь),
не на Telegram-путь. Сделал строго **club-scoped** (в `src/app/m/club/layout.tsx`, родительский
`/m/layout` не тронут → **/m/n и /m/desk целы**, п. 2.4):
- `public/club.webmanifest` — name/short_name «XO Runners», scope `/m/club`, тема `#04342C`.
- club layout metadata: `applicationName: "XO Runners"`, `manifest`, `appleWebApp.title: "XO Runners"`,
  `icons` (apple-touch + PWA). Заголовок вкладки оставил «Клуб» (внутри аппа не важен).

## 2.2 НУЖНЫ ФАЙЛЫ от тебя (логотипа-ассета в проекте нет) → положи в `public/icons/`:
- `xo-runners-192.png` — 192×192 PNG
- `xo-runners-512.png` — 512×512 PNG
- `xo-runners-maskable-512.png` — 512×512 PNG, логотип с запасом по краям (maskable, Android)
- `xo-runners-apple-180.png` — 180×180 PNG (iOS apple-touch-icon)
До появления файлов манифест/иконки ссылаются на пустые пути (не ломает сборку, просто иконка не
покажется). Палитра бренда для фона иконки: тил `#04342C` / акцент `#1D9E75`.

## 2.3 BotFather — ГЛАВНАЯ правка (пошагово)
Мини-апп клуба открывается как `t.me/igorp_coach_bot/XOclub` (в коде так; комментарий упоминает
и `@igor_agent_hub_bot` как «клубного» — СНАЧАЛА подтверди в Telegram, у какого бота в /myapps есть
XOclub).
1. @BotFather → `/myapps` → выбери приложение **XOclub**.
2. **Edit App Title** → «XO Runners».
3. **Edit App Icon / Photo** → загрузи логотип (Telegram просит 640×360 для фото; отдельно — квадрат 512×512).
4. Меняется ТОЛЬКО XOclub. Мини-аппы питания/desk — это ДРУГИЕ short-name под тем же ботом, их не
   заденет. Значит /m/n и /m/desk на домашнем экране НЕ изменятся.
5. **НЕ используй** `/setname` и `/setuserpic` (это правит ВЕСЬ бот и заденет все мини-аппы —
   питание, desk). Только per-app через `/myapps` → XOclub.

Открытый вопрос: подтвердить, какой бот реально хостит XOclub (ссылка в коде — igorp_coach_bot).
