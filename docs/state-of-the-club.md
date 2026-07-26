# State of the Club — инвентаризация (Фаза 0)

Дата: 2026-07-26. Составлено из фактов git + прод-БД (MCP), НЕ из документации.
Прод-проект Supabase: `igor-agent-hub` (`wlbswdnpqrcdaqwlfnoo`, Coach OS DB).
Базовый origin/main на момент среза: `f42d616`.

Назначение: единый факт-снимок для фаз 1–5. Всё ниже проверено фактически.

---

## 0.1 Ветки

| Ветка | Статус | Что внутри | Вливать? |
|---|---|---|---|
| `feature/club-admin` | **влита** (cherry пуст) | админка клуба за флагом | — уже в main |
| `feature/miniapp-club` | **влита** (cherry пуст) | мини-апп клуба | — уже в main |
| `feature/club-rollout` | **НЕ влита, база УСТАРЕЛА** | 5 коммитов Фазы 2: rename «Результаты», фильтр осмысленности A1, VDOT-фикс, источник TP-пиков (флаг ВЫКЛ), RLS/грант-миграции, смоук | **НЕ мёржить как есть** — контент пересоздать на свежем main |
| `feature/club-pagination-fix` | **НЕ влита, ГРЯЗНАЯ** | = club-rollout (5) + `ab11661` (клубная пагинация) | разобрать: контент в Фазу 1, ветку выкинуть |

**Почему club-rollout нельзя мёржить напрямую.** Двухточечный diff `origin/main..feature/club-rollout`
показывает **удаление ~15 physio-миграций и ряда скриптов (6234 удаления)**. Ветка отведена от
origin/main ДО влития physio-движка. `git push origin feature/club-rollout:main` либо отклонится
(non-ff), либо — форсом — **снесёт физио-работу**. Вывод: ценен только клубный контент этих коммитов,
и он пересоздаётся на свежем main в фазах 1–2. Ветки club-rollout / club-pagination-fix после переноса
контента — выбросить (не мёржить).

**Грязная `feature/club-pagination-fix` — разбор.** Единственная её добавка над club-rollout —
`ab11661 fix(club): пагинация объёмных чтений`:
- `src/features/club/paginate.ts` (+46) — **club-local дубликат** уже влитого общего
  `src/features/supabase/paginate.ts`. Не переносить дубликат; использовать общий helper.
- `src/features/club/service.ts` (~+53/−39) — `loadClubWorkoutRows` читал без `.range()` →
  PostgREST отдавал 1000 из ~20 609 строк окна (**клуб видел ~5 %**); лап-загрузки чанковали `.in()` по 60,
  но не листали чанк (интервалка >1000 лап-строк усекалась молча — источник «флейки» best-split).
  **Эта правка нужна** и переносится в Фазу 1 поверх общего `fetchAllRows`/`fetchAllInChunks`.

Итого по 0.1: наработку пагинации из `ab11661` сохранить (переписать на общий helper в Фазе 1),
грязную и устаревшую ветки — выбросить, а не мёржить.

---

## 0.2 Миграции (факт из БД, не из файлов)

**Клубные таблицы существуют в проде**, хотя в `supabase_migrations.schema_migrations` их НЕТ
(история прыгает `20260709 leads_service_role_grant` → `20260725 physio_engine_core_tables`).
То есть club-DDL применён вне migration-механизма (raw SQL). Урок «проверяй факт, а не доки» — сработал.

Существующие клубные таблицы (все RLS ON): `club_challenges, club_dayoff_requests, club_link_events,
club_races, club_reactions, club_records, club_tp_peaks, club_wishes`. Плюс `trainingpeaks_race_events`.

**Гранты / RLS (реальный блокер 42501):**
- `service_role` — полный DML (SELECT/INSERT/UPDATE/DELETE) на всех клубных таблицах ✅.
  Приложение ходит server-side через service_role → чтение/запись клубных таблиц уже работают.
- `anon` / `authenticated` — только REFERENCES/TRIGGER/TRUNCATE, **без SELECT/INSERT**.
- RLS **включён, но 0 policies** на всех club-таблицах → deny-by-default для не-service ролей.
  Для клиент-директа это «пусто», но мини-апп ходит через server-роуты (service_role), поэтому ОК.

**Вывод по грантам:** «грант-блокер» из наряда в проде уже снят вручную (service_role имеет DML).
Три pending миграции-файла из club-rollout — `20260726110000_add_club_tp_peaks.sql`,
`20260726120000_club_tables_rls.sql`, `20260726130000_club_tables_grants.sql` — описывают
**уже-применённое** состояние. Их роль: **file-of-record** (воспроизводимость схемы), а не изменение прода.
Порядок при воспроизведении с нуля: таблицы → **гранты (первыми среди прав)** → RLS-policies.
БД сейчас ОПЕРЕЖАЕТ migration-файлы main. Прод-миграции по-прежнему только файлами, не применять.

---

## 0.3 Флаги (все ВЫКЛ по умолчанию — включаются установкой `="true"`)

| Флаг | Где | Что включает | Деф |
|---|---|---|---|
| `MINIAPP_ENABLED` | miniapp-guard | базовый гейт мини-аппа | off |
| `CLUB_ENABLED` | miniapp-guard | клубный мини-апп (вместе с MINIAPP_ENABLED) | off |
| `CLUB_ADMIN_ENABLED` | AdminShell, club-admin/repo | админ-раздел «Клуб» | off |
| `CLUB_RECORDS_BEST_SPLIT` | constants:82 | best-split реконструкция (default **ON**, выкл только `="false"`) | on |
| `CLUB_CHALLENGE_GOAL_MODE` | constants:110 | режим цели челленджа (`auto`) | auto |
| `CLUB_REACTIONS_ENABLED` | constants:155 | реакции | off |
| `CLUB_PRIVACY_ENABLED` | constants:158 | opt-out приватности | off |
| `CLUB_STUBS_ENABLED` | constants:161 | демо-карточки | off |
| `CLUB_RACES_ENABLED` | constants:165 | заявки-старты учеников | off |
| `CLUB_WISHES_ENABLED` | constants:168 | пожелания | off |
| `CLUB_PREDICTION_ENABLED` | constants:174 | E-Predictor в кабинете | off |
| `CLUB_DAYOFF_ENABLED` | constants:177 | заявки-выходные | off |
| `CLUB_BILLING_ENABLED` | constants:171 | биллинг-раздел (Фаза 4) | off |

Добавятся в фазах: `CLUB_TP_EXECUTION_ENABLED` (Фаза 3, ВЫКЛ), возможный флаг источника TP-пиков (Фаза 1).

---

## 0.4 Артефакты, посчитанные на 5% срезе (НЕДЕЙСТВИТЕЛЬНЫ до пересчёта)

Причина: до влития клубной пагинации (`ab11661`, ещё НЕ в main) `loadClubWorkoutRows` возвращал
1000 из ~20 609 строк окна → всякая количественная статистика по рекордам считалась на ~5% данных.

Помечаются недействительными до Фазы 1.2 (пересчёт на полных данных):
- `docs/records-best-split.md`, `docs/records-root-cause.md`, `docs/records-diagnosis.md`,
  `docs/records-validation.md` — доли verified/preliminary/hidden, отбраковки, дельты best-split.
- В ветке club-rollout: `docs/tp-peaks-coverage.md` (знаменатель 123), `docs/records-meaningful-filter.md`
  (эффект фильтра A1), `docs/club-rollout-report.md` — все на срезе.
- Любые числа «покрытие TP-пиков / доля отбраковок / средняя дельта» из club-admin отчётов.

Пересчитываются в Фазе 1.2 → `docs/records-full-data.md` со сравнением «срез → полные».

---

## Сжатый вывод для фаз 1–5

1. **club_records / club_races / club_tp_peaks — 0 строк.** Ничего не материализовано; вкладка
   «Результаты» сейчас считает всё на лету (Фаза 1.1 — материализовать).
2. **trainingpeaks_race_events — 133 строки, 60 учеников, 2026-06-20…11-15, 78 будущих / 55 прошедших,**
   source scan(129)/manual(4). **Есть дата+название+дистанция, НЕТ финишного времени** → рекорд-гонка
   строится джойном прошедшего ивента с тренировкой того дня (Фаза 1.5).
3. **Гранты service_role есть**, клубные таблицы существуют, миграции-файлы отстают от прода
   (нужны как file-of-record).
4. **Устаревшие ветки** club-rollout / club-pagination-fix — контент переносится, ветки выбросить.
5. **Пагинация клуба (`ab11661`)** — нужна, переписать на общий `fetchAllRows`/`fetchAllInChunks`.
