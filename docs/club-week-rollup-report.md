# Club weekly rollups — Phase 1.4 follow-up report

Ветка `feature/club-week-rollup` (от `origin/main` 29c8578). Worktree `/Users/igor/wt-club-rollup`.
Всё за флагом **`CLUB_WEEK_ROLLUP_ENABLED` (ВЫКЛ)**, слоем поверх уже живого `CLUB_AGGREGATES_ENABLED`.

## Зачем
Замер daily-агрегатов в проде (флаг `CLUB_AGGREGATES_ENABLED=true`) показал, что цель НЕ достигнута:

| Вкладка | сырой | daily-агрегаты |
|---|---:|---:|
| Челлендж | 1016 | 877 ⚠️ |
| Статистика | 531 | 583 |
| Топы | 1331 | 1191 ⚠️ |

Редукция строк daily всего ×1.4 (ученики бегают ~ежедневно) → daily читает те же ~3 тыс строк. Нужна
понедельная свёртка.

## Что сделано
Две крошечные таблицы (миграция-файл `20260801000000_club_week_rollup.sql`, НЕ применена):
- **`club_week_rollup`** — одна строка на (student, ISO-неделя): running_km/completed/planned. Недельные
  метрики читаются одной страницей (≤~672 строк за 6 недель против ~3 тыс дневных).
- **`club_student_rollup`** — одна строка на ученика: current_streak (серия «как на момент materialize»).

Пересчёт — в `materializeClubRecords` тем же проходом (scoped DELETE+INSERT по затронутым), из
`computeWeekRollups`/`computeStudentStreaks` (единый источник; те же функции в parity-харнессе). Пишется
всегда, толерантно к неприменённой миграции.

Потребители за `CLUB_WEEK_ROLLUP_ENABLED` (внутри `CLUB_AGGREGATES_ENABLED`), с **фолбэком на daily**,
если rollup-таблицы пусты (не показывает нули в окно раскатки):
- статистика/челлендж/ранг профиля — недельные метрики из `club_week_rollup`;
- топы — объём/кол-во/completion из `club_week_rollup` (текущая неделя) + серии из `club_student_rollup`.

Детерминированный tie-break studentId в топах сохранён (общий хвост).

## Замер (ожидание — цель достигнута)
Прямую latency на живой таблице измерить нельзя (миграция не применена). Замерен **пол** rollup-пути
(мгновенный источник агрегатов → overhead loadClubStudents+freshness+редьюсеры):

| Вкладка | daily (прод) | rollup floor | ожидаемо (floor + 1 индексный fetch) |
|---|---:|---:|---:|
| Челлендж | 877 | 378 | ~400–550 |
| Статистика | 583 | 363 | ~400–550 |
| Топы | 1191 | 365 | ~400–550 |
| Профиль | 580 | 408 | ~450–580 |

Пол совпадает с вкладкой «Результаты» (385 мс) — тот же shape чтения (маленькая предвычисленная таблица).
Реальное чтение rollup = ОДНА страница (≤672 строк) → добавит ~50–150 мс. **Ожидаемо все вкладки в сотни мс.**
Точный замер — после применения миграции: `CLUB_WEEK_ROLLUP_ENABLED=true npm run check-club-aggregates-parity-realdb`
(и measure-club-tabs с обоими флагами).

## Сверка чисел — 0 расхождений
`check-club-week-rollup-parity` (in-memory, зеркалит materialize-окно + порядок БД): OLD=сырой,
NEW=rollup через реальный код потребителей (источник rollup из тех же строк). **stats/challenge/tops/
profile.rank — 0**. Плюс `check-club-aggregates-parity-realdb` (daily-путь на реальной таблице) — тоже **0**
после правки окна топов.

Найдено+починено (в источнике): сырой путь ТОПОВ читал окно `to: today` и не считал плановые на будущие
дни недели → byCompletion расходился с челленджем/статистикой (те читают до конца недели) и с rollup.
Привёл топы к чтению до конца недели (`toTops = max(today, конец_недели)`; плановые is_completed=false →
объём/серии не трогают). Теперь все пути согласованы. Это меняет flag-OFF поведение топов (completion теперь
за полную неделю, как в челлендже) — согласованность, не подгонка.

## Пробел с удалёнными из TP тренировками — закрыт суточным полным пересчётом
Удалённая из TP тренировка не бьёт `updated_at` (строки нет) → инкрементальный `--since-hours` её пропускает
→ устаревание до `--all`. Решение (самое простое рабочее): **суточный `materialize --all`**:
- `tools/trainingpeaks-export/scripts/run-club-materialize-full-daily.sh` (гейт CLUB_MATERIALIZE_ENABLED, `|| true`).
- `tools/trainingpeaks-export/scripts/com.igor.trainingpeaks.club-materialize-full.plist` (launchd, 04:20 ежедневно).
Кладётся в `~/Library/LaunchAgents/` (Игорь ставит). Полный проход затирает всех учеников заново → удаления
подхватываются в течение суток.

## Флаги / миграции / порядок раскатки
Флаг `CLUB_WEEK_ROLLUP_ENABLED` (ВЫКЛ). Миграция `20260801000000` (не применена).
1. Применить миграцию `20260801000000_club_week_rollup.sql`.
2. `npm run materialize-club-records -- --all` (пишет rollup-таблицы фиксным кодом).
3. `CLUB_WEEK_ROLLUP_ENABLED=true npm run check-club-aggregates-parity-realdb` → жди 0.
4. Только потом `CLUB_WEEK_ROLLUP_ENABLED=true` на Vercel + redeploy.
5. Установить launchd-plist суточного пересчёта.
Откат: выключить `CLUB_WEEK_ROLLUP_ENABLED` → мгновенно назад на daily-путь (фолбэк также ловит пустые таблицы).

## Проверки
`check-initdata-auth` 8/8, `check-club-week-rollup-parity` 0, `check-club-aggregates-parity-realdb` 0,
`smoke-feedback-sweep` PASSED, tsc 0, eslint 0, build 0. Общие модули (валидатор initData, резолверы desk/n) НЕ тронуты.
