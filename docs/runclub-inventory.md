# Этап 0 — Инвентаризация Run Club (`/Users/igor/run-club-app`)

Дата: 2026-07-24. Источник: репозиторий `run-club-app` (Next.js 16 / React 19 / TS, Supabase, Capacitor iOS). Всё read-only, ничего не менялось.

Цель документа — понять, что переносим в Telegram Mini App `/m/club` внутри Coach OS. Реальные имена таблиц/полей/функций сверены с миграциями и кодом; там где базовая DDL отсутствует в репозитории, помечено «выведено из кода».

---

## 1. Полный список фич с оценкой ядро / вторично / выкинуть

Легенда: **[ЯДРО]** — нужно для v1 мини-аппа; **[ВТОР]** — вторично; **[ВЫКИНУТЬ]** — не переносим.

### Лента и социальное
| Фича | Файл | Оценка |
|---|---|---|
| Лента активности (бесконечный скролл, клубная) | `app/feed/page.tsx`, `components/InfiniteWorkoutFeed.tsx`, `components/WorkoutFeedCard.tsx` | **[ЯДРО]** |
| Карточка тренировки (аватар, имя, уровень, дистанция/темп/время, карта, фото, XP, лайки, комменты) | `components/WorkoutFeedCard.tsx` | **[ЯДРО]** (без карты/фото/XP в v1) |
| Лайки на тренировках | `components/RunLikeControl.tsx`, `app/api/run-likes/toggle/route.ts` | **[ВТОР]** (место под реакции — да, сами реакции — нет в v1) |
| Комментарии (треды, лайки коммента) | `app/runs/[id]/discussion/page.tsx`, `lib/run-comments.ts` | **[ВЫКИНУТЬ]** в v1 |
| Превью маршрута (Mapbox static) | `components/RunRouteMapPreview.tsx`, `lib/getStaticMapUrl.ts` | **[ВЫКИНУТЬ]** (в кэше TP нет GPS-полилинии) |

### Тренировки (runs)
| Фича | Файл | Оценка |
|---|---|---|
| Список + ручное добавление пробежки | `app/runs/page.tsx` | **[ВЫКИНУТЬ]** — источник данных у нас TP-кэш, не ручной ввод |
| Детали пробежки (графики, редактирование) | `app/runs/[id]/page.tsx` (2035 строк) | **[ВЫКИНУТЬ]** в v1 |

### Активность / личная статистика
| Фича | Файл | Оценка |
|---|---|---|
| Дашборд активности (период неделя/месяц/год, график дистанции, сводка) | `app/activity/page.tsx` | **[ЯДРО]** (в профиль) |
| Личные рекорды 5k/10k/21.1/42.2 (время, темп, дата) | `app/activity/records/page.tsx`, `lib/personal-records.ts` | **[ЯДРО]** |
| Достижения (бейджи) | `app/activity/achievements/page.tsx` | **[ВТОР]** |
| Обувь / износ | `app/activity/shoes/*` | **[ВЫКИНУТЬ]** |
| Инбокс уведомлений | `app/activity/inbox/page.tsx` | **[ВЫКИНУТЬ]** (ничего не шлём ученикам) |

### Дашборд / профиль
| Фича | Файл | Оценка |
|---|---|---|
| Дашборд (идентити, уровень/XP, км за месяц, превью челленджей и гонки) | `app/dashboard/DashboardPageClient.tsx` | **[ЯДРО]** (влить в профиль/челлендж) |
| Профиль (аватар, имя, уровень, ранг) | `app/profile/page.tsx` | **[ЯДРО]** |
| Публичный профиль (статы, PR, недельный объём, лента) | `app/users/[userId]/page.tsx` | **[ЯДРО]** |
| Настройки (аккаунт, тема, уведомления, Strava) | `app/profile/{account,appearance,notifications,strava}/*` | **[ВЫКИНУТЬ]** в v1 |

### Клуб
| Фича | Файл | Оценка |
|---|---|---|
| Клубный хаб (навигация) | `app/club/page.tsx` | **[ЯДРО]** (как набор вкладок) |
| Гонка недели / weekly race (live XP-лидерборд, проекция места) | `app/race/page.tsx`, `components/WeeklyLeaderboard.tsx`, `lib/weekly-xp.ts` | **[ЯДРО-адаптация]** → «красавчики недели» по % выполнения, не по XP |
| Челленджи (активные/прошедшие, прогресс-бары, бейджи) | `app/challenges/page.tsx`, `lib/dashboard-overview-server.ts` | **[ЯДРО-адаптация]** → клубный км к цели |
| Клубный лидерборд PR по дистанциям | `app/club/leaderboard/page.tsx`, `components/ClubPersonalRecordsLeaderboard.tsx` | **[ЯДРО]** |
| XP-лидерборд all-time | `app/leaderboard/page.tsx` | **[ВЫКИНУТЬ]** (у нас нет XP-модели) |
| Статистика клуба (недельные тоталы, вклад) | `app/club/statistics/page.tsx` | **[ВТОР]** → часть челленджа |

### Инфраструктура — целиком [ВЫКИНУТЬ] для v1
Auth email/пароль (`app/login`, `app/register`) → заменяется Telegram `initData`. Мессенджер/чат (`app/messages/*`, `app/chat`) → у Telegram свой. Web Push / PWA / Capacitor / Voice. Админка (`app/admin/*`). Strava OAuth/webhook — источник данных Run Club, у нас источник другой (TP-кэш).

---

## 2. Модель данных Run Club (для справки — НЕ переносим схему, только логику)

Базовые `runs` и `profiles` не имеют CREATE в миграциях (созданы вне git); поля выведены из ALTER-миграций и SELECT/INSERT в коде.

- **`profiles`** — атлеты: `id`(=auth.users), `nickname`/`first_name`/`last_name`/`name`, `avatar_url`, `total_xp`, `role`, `app_access_status`.
- **`runs`** — центральная: `user_id`, `distance_km`/`distance_meters`, `moving_time_seconds`/`elapsed_time_seconds`/`duration_seconds`, `average_pace_seconds`, `elevation_gain_meters`, `average_heartrate`, `map_polyline`, `sport_type`, `xp`, `xp_breakdown`, `external_source`+`external_id`(strava/manual), `raw_strava_payload` (в т.ч. `best_efforts`, `laps`), `shoe_id`, `created_at`.
- **`run_laps`**, **`run_detail_series`** (pace/hr/cadence/altitude points), **`run_photos`**.
- **`run_likes`** (PK `run_id,user_id`; запрет самолайков), **`run_comments`**.
- **`personal_records`** (канон, уник `user_id,distance_meters`) + **`personal_record_sources`** (кандидаты: `local_full_run` | `strava_best_effort` | `historical_strava_best_effort`).
- **`challenges`** (`goal_unit` distance_km|run_count, `period_type` lifetime|challenge|weekly|monthly, `goal_target`, `xp_reward`, `visibility`) + **`user_challenges`**.
- **`race_weeks`** → **`race_week_results`** (rank, run_xp/like_xp/challenge_xp/total_xp) + **`user_badge_awards`**.
- **`strava_connections`** (OAuth-токены).

**Ключевая архитектурная особенность:** нет таблиц `clubs`/`teams` — приложение это ОДИН неявный клуб; все рейтинги агрегируются по всем `profiles` (минус один захардкоженный исключённый `user_id`). Это удобно: у нас клуб = все ученики тренера.

### Как считаются агрегаты (логика, которую воспроизводим на данных Coach OS)

- **Личные рекорды по дистанции.** Поддерживаемые дистанции: `SUPPORTED_PERSONAL_RECORD_DISTANCES = [5000, 10000, 21097, 42195]` м (`lib/personal-records.ts`). Два слоя: кандидаты в `personal_record_sources`, канон — SQL `recompute_personal_record_for_user_distance` выбирает лучший по `order by duration_seconds asc, record_date asc nulls last, created_at asc`. Толеранс «полной пробежки» (`LOCAL_FULL_RUN_PERSONAL_RECORD_TOLERANCES`): 5000→25м, 10000→25м, 21097→30м, 42195→50м. Плюс Strava best_efforts как источник. **Урок для нас:** у нас нет best_efforts — рекорды строим только из «полной пробежки» (полоса дистанции), поэтому нужна полоса шире (±500 м по наряду) + проверка стабильности темпа.
- **Клубный лидерборд PR** (`lib/club-personal-records-server.ts`): запрос `personal_records` по `distance_meters`, сортировка `duration_seconds asc`, ранг = индекс+1.
- **Гонка недели / топ-исполнители** (`lib/weekly-xp.ts` + RPC `get_weekly_xp_leaderboard`): за окно активной недели на юзера `run_xp = sum(runs.xp)`, `like_xp = count(run_likes)*5`, `challenge_xp = sum(xp_reward)`, ранг по сумме. **У нас XP-модели нет** → заменяем метрику на «% выполнения тренировок» (см. наряд).
- **Прогресс челленджа** (`lib/dashboard-overview-server.ts`): окно периода через RPC, затем в JS `progressValue = goal_unit==='distance_km' ? sum(distance_km) : runCount`, `percent = min(progressValue/goalTarget*100,100)`. Это персональный вклад к персональной цели. **У нас** — клубный км к общей цели + личный вклад.
- **Недельный/месячный объём** (`lib/dashboard-overview-server.ts`): чистые JS-редьюсы по списку `runs` (`sum(distance_km)` где `created_at >= monthStart`). SQL-вьюх нет.
- **XP пробежки** (`lib/run-xp.ts`): база 40 + тиры км + бонус за набор + недельная консистентность. **Не переносим** — своей XP-модели у нас нет; «уровни/ранги» опускаем в v1.

---

## 3. Источники данных Run Club и что завязано на источник

- **Единственный внешний провайдер активности — Strava** (`lib/strava/*`): OAuth (`app/api/strava/connect|callback|disconnect|status|sync`), webhook (`app/api/strava/webhook`), клиент `strava-client.ts`, движок `strava-sync.ts` (134K). Принимаются только `Run`/`TrailRun`/`VirtualRun`.
- **Плюс ручной ввод** (форма `app/runs/page.tsx` → RPC `create_manual_run_if_not_duplicate`).
- **Завязка полей на источник:** GPS-полилиния, HR, elevation, best_efforts (→ рекорды по дистанции), фото, laps, streams — приходят ТОЛЬКО из Strava. Ручной ввод даёт лишь суммарные дистанцию/время → рекорд «по полной пробежке», без темповых деталей.
- Ни Garmin, ни TrainingPeaks, ни Apple Health в Run Club НЕТ (несмотря на множество `trainingpeaks`-worktree в окружении — это другой проект, Coach OS).

**Вывод для переноса:** у нас источник — TrainingPeaks-кэш (см. `docs/miniapp-club-plan.md` §1). Он ближе к «ручному вводу» Strava по гранулярности summary (дистанция/время), но плюс есть per-lap данные (FIT) → темповые детали для проверки стабильности рекорда.

---

## 4. Что из UI переиспользуемо, что переписать под мобильный Telegram

Общая оценка: Run Club UI и так одноколоночный мобильный (`max-w-xl`), с токен-системой и тёмной темой — концептуально ложится на Telegram Mini App. Но **код переиспользовать напрямую нельзя**: другой репозиторий, другой стек стилей (Run Club — Tailwind v4 + CSS-переменные + Geist; Coach OS `/m/*` — inline-style объекты + Montserrat). Переносим **паттерны/раскладку**, а не файлы.

| Экран Run Club | Что берём как образец | Как реализуем в `/m/club` |
|---|---|---|
| `WorkoutFeedCard` | Раскладка карточки: аватар+имя / строка статов / подпись | Инлайновая карточка в стиле `/m/desk`, поля из TP-кэша |
| `app/activity/records` (`RECORD_CARDS`) | 4 карточки-дистанции: время / темп / дата | Тот же макет, данные реконструируем из кэша |
| `WeeklyLeaderboard` (подиум, пин текущего) | Ранжированный список с выделением топ-3 и себя | «Красавчики недели» по % выполнения |
| `ChallengesSection` (прогресс-бары) | Прогресс-бар к цели | Клубный км к цели + личный вклад |
| `ClubPersonalRecordsLeaderboard` (табы дистанций, медали) | Табы 5k/10k/21/42 + медальные ранги | Клубные топы по дистанциям |
| Dashboard identity + stat-tiles | Шапка профиля + плитки | Вкладка «Профиль» |

**Что переписываем с нуля:** навигацию (у нас — фиксированный tab-bar `/m/desk`, не Navbar/MobileTabBar Run Club), стили (inline-объекты), auth (Telegram initData вместо email/пароль), убираем графики recharts (тяжело) или заменяем лёгким SVG. Карту/фото/комменты/лайки-XP не тянем в v1.

---

## 5. Итог: минимальный состав v1 (что реально переносим)

Ленту, реконструкцию личных рекордов по дистанциям, клубные топы по дистанциям, челлендж (клубный км + % выполнения + личный вклад), профиль ученика. Всё **read-only**, на данных Coach OS (TP-кэш), за фичефлагом, изолированно от `/m/desk` и `/m/n`. Детали маппинга и план — в `docs/miniapp-club-plan.md`.
