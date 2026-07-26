# Club — итоговый отчёт финального наряда (Фаза 5)

Доведение клубного контура до рабочего состояния. Всё новое — за флагами ВЫКЛ, read-only где
можно, прод-миграции только файлами, в TP запись только через существующий пайплайн, ученикам
ничего не уходит автоматически. Прод-проект `wlbswdnpqrcdaqwlfnoo`.

## Что сделано по фазам

- **Фаза 0 — инвентаризация** (`docs/state-of-the-club.md`). Факт-снимок из git+БД: клубные
  таблицы существуют в проде (raw SQL, не в migration_history), service_role-гранты есть, RLS ON
  без policies; club_records/races/tp_peaks = 0 строк; race_events = 133; ветки club-rollout/
  club-pagination-fix на устаревшей базе (снесли бы physio) → контент перенесён, ветки выбросить.
- **Фаза 1 — перф+пересчёт** (`club-materialize`). Материализация рекордов в НОВУЮ
  `club_record_snapshots` (club_records оставлена под coach_confirmed). **62с → 0.44с на открытие
  вкладки (~140×)**. Пагинация трёх объёмных чтений на общий helper (снято усечение 5%→100%).
  Пересчёт инкрементальный по touched (cache+laps), хук в сканах за флагом. Пересчёт артефактов
  на полных данных: 11910 кандидатов (19.5% verified/65.8% prelim/14.8% hidden), pause_gap=74%
  отказов. VDOT «потолок 65» в коде НЕТ (относит. self-outlier маржа 8, 11 срабатываний).
- **Фаза 1.5 — гонки из race_events** (`club-race-events`). Подключён как источник race:
  **было 0 гонок → стало 24 у 15 учеников**. Приоритет coach>race_events>club_races>реконструкция.
  Провенанс в админ-ревизии. E-Predictor якорь наполняется автоматически. Ручной остаток 97/112.
- **Фаза 2 — готовность** (`club-rollout-final`). Громкая проверка доступа к таблицам (42501/42P01
  красным в /admin/club/manage, не «пусто»). Смоук клуба (7 сценариев, read-only) — SMOKE PASSED
  на проде. Чеклист включения + таблица готовности по 12 фичам.
- **Фаза 3 — исполнение заявок в TP** (`club-tp-execution`). PREPARE-ONLY, реальное исполнение НЕ
  запускалось. Старт → create_workout spec (run type=3, проверен) через существующий assisted-write
  пайплайн (dry-run→подтверждение→раннер→verify→откат). Выходной → ручной review-case (нет
  проверенного TP-представления). Флаг ВЫКЛ. Dry-run отчёт (0 заявок сейчас + пример).
- **Фаза 4 — биллинг** (`club-billing`). Read-only статус/история/срок из биллинг-модуля
  (проверено 39/40 учеников). Кнопка Т-Банк через Telegram openLink (ссылка из env). Черновики
  напоминаний (чистый расчёт+текст), автоотправки НЕТ. Разведка эквайринга — в docs/club-billing.md.
- **Фаза 5 — этот отчёт**.

## Полный список флагов (ВСЕ ВЫКЛ по умолчанию)

| Флаг | Дефолт | Что | Фаза |
|---|---|---|---|
| `MINIAPP_ENABLED` | off | базовый гейт мини-аппа | было |
| `CLUB_ENABLED` | off | клубный мини-апп | было |
| `CLUB_ADMIN_ENABLED` | off | админ-раздел «Клуб» | было |
| `CLUB_RECORDS_BEST_SPLIT` | **on** (выкл `="false"`) | best-split реконструкция | было |
| `CLUB_CHALLENGE_GOAL_MODE` | auto | режим цели челленджа | было |
| `CLUB_REACTIONS_ENABLED` | off | реакции | было |
| `CLUB_PRIVACY_ENABLED` | off | opt-out приватности | было |
| `CLUB_STUBS_ENABLED` | off | демо-карточки | было |
| `CLUB_RACES_ENABLED` | off | заявки-старты | было |
| `CLUB_WISHES_ENABLED` | off | пожелания | было |
| `CLUB_DAYOFF_ENABLED` | off | заявки-выходные | было |
| `CLUB_PREDICTION_ENABLED` | off | E-Predictor | было |
| `CLUB_BILLING_ENABLED` | off | вкладка оплаты | было |
| `CLUB_MATERIALIZE_ENABLED` | off | пересчёт снимков в скан-хуках | Фаза 1 |
| `CLUB_TP_EXECUTION_ENABLED` | off | исполнение заявок в TP (высокий риск) | Фаза 3 |
| `CLUB_TBANK_PAYMENT_URL` | (пусто) | ссылка на форму Т-Банка (env, `{label}`) | Фаза 4 |
| `CLUB_BILLING_REMINDERS_ENABLED` | off | экран черновиков напоминаний | Фаза 4 |
| `CLUB_BILLING_REMINDER_DAYS_BEFORE` | 3 | за сколько дней напоминать | Фаза 4 |
| `CLUB_BILLING_REMINDER_AUTOSEND_ENABLED` | off | будущая автоотправка (не подключена) | Фаза 4 |

## Миграции

| Файл | Статус | Действие |
|---|---|---|
| `20260727000000_club_record_snapshots.sql` | **НЕ применена** | применить (Фаза 1) — иначе вкладка «Результаты» пуста (42P01) |
| существующие `*club*` (visible_flag, reactions, challenges, records_schema, races, dayoff, wishes, link_events, coach_fields…) | применены в проде (raw SQL), НЕ в migration_history | file-of-record; применять только при воспроизведении с нуля (порядок: таблицы→гранты→RLS) |

БД опережает migration-файлы. service_role-гранты в проде уже есть.

## Замеры перфа

- Открытие вкладки «Результаты»: **61.9 с → 0.44 с** (~140×). Старый путь ловил бы таймаут serverless.
- Пересчёт (materialize): ~70 с раз на скан (инкрементально — только затронутые). Снимок ~262 строки.
- Биллинг read-only: мгновенно (проекция модуля), 39/40 учеников с данными.

## Что осталось за скобками (отдельными нарядами)

- Экран пакетного подтверждения напоминаний + лог-таблица отправки (данные-слой готов). Фаза 4.
- Эквайринг Т-Банка (форма внутри аппа + автосмена статуса по вебхуку) — секреты вне git.
- Авто-выходной в TP (нужен проверенный day-off тип/endpoint — реверс API). Фаза 3.
- Калибровка порога пауз 10% (pause_gap = 74% отказов) — отдельный наряд, пороги не менял.
- BLOCK 3: конверсия ~17 диагностических скриптов с `.limit(N>1000)` (часть намеренная).
- E-Predictor target из будущих race_events (нужен надёжный парс дистанции).
- Точная передача touched-id из сканов в materialize (сейчас окно `--since-hours`).

## Чеклист включения (одним списком)

1. Применить миграцию `20260727000000_club_record_snapshots.sql` (из папки с main).
2. `/admin/club/manage` → блок «Доступ к клубным таблицам» зелёный (все ОК).
3. `npm run materialize-club-records -- --all` (разовый полный пересчёт, ~70с; ~262 строки).
4. `CLUB_MATERIALIZE_ENABLED=true` → следующий скан держит снимки свежими.
5. `CLUB_ADMIN_ENABLED=true` → ревизия результатов показывает гонки (🏁) и происхождение.
6. `npm run smoke-club` → SMOKE PASSED.
7. `MINIAPP_ENABLED=true` + `CLUB_ENABLED=true`, привязать 2-3 тестовых ученика (/admin/club/links),
   проверить их кабинет вживую → затем расширить круг привязок на весь клуб.
8. Фичи по одной: RACES/WISHES/DAYOFF/PREDICTION/PRIVACY/REACTIONS — по таблице готовности.
9. Биллинг: `CLUB_TBANK_PAYMENT_URL=<ссылка>`, `CLUB_BILLING_ENABLED=true` (read-only статус +
   кнопка Т-Банк). Напоминания — позже, вместе с экраном подтверждения.
10. `CLUB_TP_EXECUTION_ENABLED` — НЕ включать без отдельного разбора (единственная запись в TP).

## Карта веток и порядок влития

- **Фаза 0** — `feature/club-state-inventory` (от origin/main). НЕЗАВИСИМА (только docs) — влить в любой момент.
- **Цепочка (строго по порядку, каждая на предыдущей):**
  `feature/club-materialize` (1) → `feature/club-race-events` (1.5) → `feature/club-rollout-final` (2)
  → `feature/club-tp-execution` (3) → `feature/club-billing` (4) → `feature/club-final-report` (5).
- Вливать по порядку. Не мёржить старые `feature/club-rollout` / `feature/club-pagination-fix`
  (устаревшая база — снесут physio; их контент перенесён).
