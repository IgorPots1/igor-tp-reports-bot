# HANDOFF — nutrition / mini app (для новой сессии)

**Дата:** 2026-06-22 · **origin/main tip:** `744a3b4` · **Supabase (одна база, prod=preview):** `wlbswdnpqrcdaqwlfnoo`

> Это рабочий handoff-док для следующей сессии. Факт — из репо/прода, не по памяти.
> Перед действиями свериться: `git log origin/main -1`, статусы в админке, Vercel-логи.

---

## ПРИНЦИПЫ (соблюдать)
- **«Код считает — модель пишет»**: все числа/классификация — в коде, LLM только проза.
- **Не коммитить без «да» Игоря.** Работа слоями с чекпойнтом на каждый.
- **Прод-push и миграции — руки Игоря** (Claude готовит, ff-only без force, показывает команду).
- **hard-блок безопасности снят осознанно** — НЕ возвращать. (coach_override для blocked_safety не трогать.)
- Проверки: `npm run lint`, `npx tsc --noEmit`, `npm run build`, относящиеся `check-*`.

---

## СДЕЛАНО В ЭТОЙ СЕССИИ (всё в origin/main / прод)

- **Релиз `task10d → main`** — вся nutrition-pipeline (Tasks 1–10d) + mini app + калькулятор `/tools/nutrition`. Merge `e2af21c`.
- **Форма mini app (слой 1):** загрузка PDF (**multiple `File[]`**), автоопределение недели (snapping пн–вс), **автопривязка по `start_param`** (telegram_user_id), обкатана end-to-end (Касьяненко/Пономарева).
- **Доставка формы = ССЫЛКА В ТЕКСТЕ** (HTML `<a>Открыть форму</a>`, `link_preview_options.is_disabled`, через `business_connection_id`). **НЕ** inline-кнопка: `web_app`/`url`-кнопки на named mini app дают `BUTTON_TYPE_INVALID` в business.
- **Business-окно 24ч:** бейдж 🟢/🔴/⚪ в админке (список+карточка) по `last_seen_at` из `trainingpeaks_telegram_business_chats`. Окно открывает ТОЛЬКО входящее сообщение ученицы; холодных рассылок нет; целевой поток — всё в одной активной сессии.
- **Экран разбора Mini App `/m/r`** (ветвление в `/m/n` по `start_param=r_<uuid>`, БЕЗ правки BotFather). Дизайн «беговой» (бирюза `#E1F5EE/#04342C`, фокус, КБЖУ-карточки с soft-маркером ok/low_energy/unknown + тип дня, план). **Whitelist athlete-safe**, coach-only исключены; только `approved_for_copy`; доступ по resolved `student.id`.
- **Кнопка «Одобрить разбор»** (`draft_generated`/`needs_review` → `approved_for_copy`, гард в UI + SQL; **blocked_safety не одобряется**). **Кнопка «Отправить разбор»** (business + бейдж окна, deep-link `r_`).
- **История разборов переключается** — колонка «Открыть» в таблице истории → любая прошлая неделя.
- **Разбор без приветствия** (форма с «Привет/Здравствуйте») — убран двойной привет в сессии форма→разбор.
- **Уведомление коучу — только при `macros>0`** (пустые 0-дневные саве не шлют нотификацию; отчёт всё равно сохраняется и виден в админке).
- **Роль `race`** в `KEY_ROLE_PRIORITY` (топ): забег = ключевая работа недели, интервалы (5×3) не перебивают. Забег Нади **28.06 «Угличский полумарафон» 21.1 км** подтянут сканом.
- **Фикс падения карточки/списка** — `try/catch` на window-фетч бейджа (карточка + `listNutritionDashboardRows`); сбой некритичного бейджа не роняет серверный компонент.

### Ключевые файлы сессии
- `src/features/nutrition/send-nutrition-form.ts` — доставка формы И разбора (общий `sendMiniAppLinkToStudent`, mode form/review; greeting только у формы).
- `src/app/api/m/r/route.ts` — данные разбора (whitelist, soft-маркер, trainingLabel).
- `src/app/m/n/page.tsx` + `src/app/m/n/ReviewScreen.tsx` — форма + экран разбора (ветвление `r_`).
- `src/app/admin/coach-os/nutrition/[studentId]/page.tsx` — одобрить / отправить / бейдж окна / история / try-catch.
- `src/features/nutrition/narrative-composer.ts` — роль `race` (тип, KEY_ROLE_PRIORITY, рендер).
- `src/app/api/m/n/{upload,confirm}/route.ts` — резолв по `student.id` (UUID), multiple `getAll("file")`.
- `src/features/nutrition/repository.ts` — `getTrainingPeaksBusinessChatLastSeenByChatId` (бейдж) + `approveNutritionWeeklyAnalysis` (одобрение).
- `src/features/telegram/miniapp-student-resolver.ts` — резолв/автопривязка, strip `r_`.

---

## ОСТАЛОСЬ (по приоритету)

### 1. ⭐ Формула углеводной ЗАГРУЗКИ (спроектирована, кодить)
Сейчас `leadDays` (дни до старта) только **выключают дефицит**; углеводы НЕ поднимают. `computeRaceDayTarget` поднимает углеводы **только дню старта**. → дни загрузки на обычной формуле (расходятся текст «загрузка» и числа).
**Проект:** дни загрузки (leadDays до HM+) **и** день старта → цель углеводов =
`min(база + 20-30%, верх коридора)`, не ниже базы.
Коридор: HM 6-8 г/кг (2 дня) · марафон 7-9 (3) · ультра 8-10 (3) — из `computeNutritionRaceProtocol`.
**БАЗА** = верхняя граница/среднее углеводов ПРОШЛОЙ недели ученицы.
Проверка Нади (55 кг): база ~250→325; потолок 8 г/кг = 440; min = **325**.
Файлы: `weekly-plan-formulas.ts` (`buildNutritionNextWeekPlan` ~стр.1037-1069, `computeRaceDayTarget`).

### 2. Авто-скан плановой недели
Скан забегов job-driven, вручную: Telegram **`/tp_races YYYY-MM-DD YYYY-MM-DD`** (+ кнопки «след. неделя / 7 / 30 дней / до августа»), выполняет локальный Mac-runner. Cron'а нет. **Генерация плана НЕ триггерит скан своей недели** → старты на плановой неделе не подтягиваются.
**Системно:** при генерации плана авто-ставить `race_scan_events` job на неделю плана (`createTrainingPeaksRaceScanJob` с from/to плана).
Файлы: `weekly-plan-generator.ts`, `service.ts` (`createTrainingPeaksRaceScanJob`).

### 3. Редактируемый черновик ученику
Поле **`coach_edits`** (на `nutrition_weekly_analyses`) ЕСТЬ, но **спит** (ставится null, нигде не читается). Текст деривится из `combined-message` parts.
**Сделать:** textarea + save-action → `coach_edits`; читать `coach_edits` (при наличии) в: копи-блоке, **`/api/m/r`** (экран ученицы), `sendNutritionReviewLinkToStudent`.

### 4. Вход в админку
- Cookie **12ч → 30 дней** (`getAdminAccessCookieOptions` в `src/lib/admin-auth.ts`, `maxAge`).
- Корень `/` = заглушка (`src/app/page.tsx`) → редирект `/` → `/admin`.
- Защиту не ослаблять (cookie/токен остаётся). Правильный вход: **`/admin`** (или `/admin/login`).

### 5. ⚠️ Загрузки реальных учениц НЕ доходят (за ночь 0 строк в БД)
В `nutrition_reports` за 36ч — только тест (Касьяненко/Пономарева, днём). Реальных ночных — нет → обрыв **до сохранения**.
Гипотеза: **старая форма → протух/пустой initData → 401 молча** (валидация свежести в коде НЕ проверяется; пустой initData в старой webview-сессии). Игорь тестирует.
**Сделать:** (а) дружелюбный баннер «форма устарела — открой заново по свежей ссылке» при пустом initData / 401 в `m/n/page.tsx`; (б) проверить доставку нотификации коучу — `TELEGRAM_COACH_CHAT_IDS`, доходят ли уведомления при `macros>0`.
**Диагностика:** Vercel logs `/api/m/n/upload`+`/confirm` за ночь (`[miniapp.upload]`/`[miniapp.confirm]`, коды 401/403/503/422).

### 6. Multiple PDF — обкатать вживую (2+ файла за неделю).

---

## ENV / ПРЕДУСЛОВИЯ ПРОДА
- `MINIAPP_ENABLED=true`, `TELEGRAM_MINIAPP_SHORT_NAME=Report` (BotFather `/newapp` → Web App URL `https://igorp.run/m/n`).
- `TELEGRAM_BUSINESS_CONNECTION_ID` (активный; `BUSINESS_PEER_USAGE_MISSING` = окно закрыто / нет входящего от ученицы / права бота).
- `TELEGRAM_COACH_CHAT_IDS` (нотификации коучу), `ANTHROPIC_API_KEY` (генерация).
- Mac-runner должен быть запущен для job-очереди (скан забегов).
