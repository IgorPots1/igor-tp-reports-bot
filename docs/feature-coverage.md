# Покрытие фич Run Club в /m/club — три корзины

Дата: 2026-07-25. Проход по `docs/runclub-inventory.md`. Корзины:
- **BUILD** — данные в Coach OS есть (TP-кэш + laps + derived_metrics + students). Реализуем полноценно.
- **STUB** — каркас интересен, данных нет: экран/компонент на фикстуре, за отдельным флагом (ВЫКЛ), пометка «демо» в dev, 503/скрытие в проде. Цифры в проде не выдумываем.
- **SKIP** — данных физически нет, заглушка бессмысленна.

Источники: `cache` = trainingpeaks_workout_cache; `laps` = trainingpeaks_workout_laps; `derived` = trainingpeaks_workout_derived_metrics; `students` = trainingpeaks_students.

| Фича Run Club | Корзина | Источник | Флаг | Файл |
|---|---|---|---|---|
| Лента активности | BUILD | cache | CLUB_ENABLED | m/club/page (Лента) · club/service getClubFeed |
| Карточка тренировки (имя, тип, дистанция, темп, время, подпись) | BUILD | cache | CLUB_ENABLED | FeedCard |
| Лайки/реакции на тренировках | STUB | — (нет таблицы) | CLUB_REACTIONS_ENABLED | club_reactions.sql · /api/m/club/react · FeedCard react-row |
| Комментарии/треды | SKIP | нет данных, Telegram сам даёт чат | — | — |
| Превью маршрута (Mapbox) | SKIP | GPS-полилинии нет в кэше | — | — |
| Список/ручное добавление пробежки | SKIP | источник = TP-скан, не ручной ввод; в TP не пишем | — | — |
| Детали пробежки (графики HR/pace по секундам) | SKIP | потоковых серий (streams) нет; есть только per-lap | — | — |
| График дистанции по периодам | BUILD | cache | CLUB_ENABLED | ProfileTab SVG (lightweight) · getClubProfileDetail |
| Личные рекорды 5k/10k/21/42 | BUILD | cache + laps + derived | CLUB_ENABLED | RecordsTab · getClubRecords (hardened) |
| Клубный лидерборд PR по дистанциям | BUILD | cache + laps | CLUB_ENABLED | RecordsTab club tops (reliable-only) |
| XP-лидерборд / уровни / ранги | SKIP | XP-модели нет, придумывать нельзя | — | — |
| Достижения/бейджи (детерминированные) | BUILD | cache | CLUB_ENABLED | getClubAchievements · constants ACHIEVEMENT_RULES |
| Достижения, требующие отсутствующих данных | STUB | — | CLUB_STUBS_ENABLED | achievements stub cards |
| Дашборд (объём, серия, превью) | BUILD | cache | CLUB_ENABLED | ProfileTab |
| Профиль (аватар, имя) | BUILD (аватар→монограмма) | students | CLUB_ENABLED | ProfileTab |
| Публичный профиль ученика | BUILD | cache + students (приватность) | CLUB_ENABLED | PublicProfile overlay · getClubPublicProfile |
| Гонка недели (XP) | BUILD-адаптация | cache | CLUB_ENABLED | ChallengeTab «красавчики» по % |
| Челленджи с реальной целью | STUB→BUILD | cache (авто) / club_challenges (ручная) | CLUB_CHALLENGE_GOAL_MODE | getClubChallenge (auto/manual/fixture) · club_challenges.sql |
| Статистика клуба (тоталы, активные, вклад) | BUILD | cache | CLUB_ENABLED | ClubTab · getClubStatistics |
| Расширенные топы (объём/кол-во/%/серия) | BUILD | cache | CLUB_ENABLED | ClubTab · getClubExtendedTops |
| Индикатор свежести | BUILD | getTrainingPeaksWorkoutCacheFreshness | CLUB_ENABLED | header на каждом экране |
| Настройки видимости (опт-аут) | STUB | students.club_visible (миграция) | CLUB_PRIVACY_ENABLED | ProfileTab toggle · /api/m/club/privacy |
| Обувь/износ | SKIP | нет данных по обуви в Coach OS | — | — |
| Инбокс/уведомления/push/PWA/voice | SKIP | ученикам ничего не шлём | — | — |
| Мессенджер/чат | SKIP | Telegram сам | — | — |
| Strava OAuth/webhook | SKIP | источник у нас TP-скан | — | — |
| Админка / челлендж-CRUD | SKIP | это тренерская зона, не ученический клуб | — | — |
| Настройки аккаунта/темы | SKIP | Telegram-контекст | — | — |

## Сводка флагов (дефолты)
- `CLUB_ENABLED` — мастер-гейт клуба (ВЫКЛ). Внешний `MINIAPP_ENABLED` тоже нужен.
- `CLUB_REACTIONS_ENABLED` — реакции (ВЫКЛ).
- `CLUB_PRIVACY_ENABLED` — опт-аут видимости (ВЫКЛ, дефолт «участвует»).
- `CLUB_STUBS_ENABLED` — показ демо-заглушек в dev (ВЫКЛ; в проде заглушки скрыты/503).
- `CLUB_CHALLENGE_GOAL_MODE` — `auto` (дефолт: клубный км прошлой недели +10%) | `manual` (club_challenges) | `fixture` (крайний фолбэк 500).
