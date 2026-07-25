# Отчёт v2 — расширение Mini App «Клуб» (максимальный перенос)

Дата: 2026-07-25. Ветка `feature/miniapp-club`, worktree `/Users/igor/wt-miniapp-club`. Продолжение v1 (лента/челлендж/рекорды/профиль).

## Корзины (что BUILD / STUB / SKIP)
Полная разбивка по каждой фиче Run Club — `docs/feature-coverage.md`. Коротко:
- **BUILD (реальные данные):** лента, темп, клубный км + красавчики, реконструкция рекордов (3 уровня доверия), клубные топы по дистанциям, профиль-детализация (нед/мес/год объём, SVG-график, серия, разбивка по типам, лучшая неделя), достижения (детерминированные), клубная статистика, расширенные топы (объём/кол-во/%/серия), публичный профиль, индикатор свежести на каждом экране.
- **STUB (за флагами, ВЫКЛ):** реакции (`CLUB_REACTIONS_ENABLED`), опт-аут видимости (`CLUB_PRIVACY_ENABLED`), ручная цель челленджа (`club_challenges`), достижения-заглушки (`CLUB_STUBS_ENABLED`).
- **SKIP:** GPS-полилиния/карта, потоковые серии (посекундные HR/pace), фото, комментарии, обувь, XP/уровни, Strava, push/PWA/чат — данных нет или бессмысленно.

## Новые флаги и дефолты
| Флаг | Дефолт | Что делает |
|---|---|---|
| `CLUB_ENABLED` | ВЫКЛ | мастер-гейт клуба (+ `MINIAPP_ENABLED`) |
| `CLUB_REACTIONS_ENABLED` | ВЫКЛ | реакции 👍/🔥 (нужна миграция `club_reactions`) |
| `CLUB_PRIVACY_ENABLED` | ВЫКЛ | опт-аут видимости (нужна миграция `club_visible`) |
| `CLUB_STUBS_ENABLED` | ВЫКЛ | показ демо-заглушек в dev |
| `CLUB_CHALLENGE_GOAL_MODE` | `auto` | цель: auto (прошлая неделя ×1.1) / manual (таблица) / fixture (500) |

## Валидация рекордов — итоги (ключевой артефакт)
Скрипт `scripts/validate-records.ts` прогнан по **реальным прод-данным** (read-only). Полный вывод — `docs/records-validation.md`. Плотность:
- Беговых завершённых тренировок в окне (365 дн): **564**
- Кандидатов в рекорды (полосы ±500 м): **95**
- Кандидатов с заполненными **laps: 94/95 (99%)** — плотность FIT отличная, GPS-проблема НЕ массовая.
- Показываемых рекордов: **36** → **verified 22 (61%)**, preliminary 14 (39%).
- Отбраковано (hidden): **23**. Причины: `pause_gap` 19 (паузы > 10%), `self_outlier` 3 (VDOT-выброс против себя), `lap_distance_mismatch` 1.

Вывод: данных на надёжные рекорды достаточно (laps 99%). Главный фильтр — паузы (город/светофоры). Порог пауз можно смягчить (`CLUB_RECORD_PAUSE_TOLERANCE`) — см. `docs/questions.md §10`.

## Стадия C — три уровня доверия (verified/preliminary/hidden)
- **verified** — laps с темпом, CV ≤ 0.08, прошёл ВСЕ проверки правдоподобия. Везде, включая клубные топы.
- **preliminary** — правдоподобно, но не подтверждается (нет темповых laps / CV неизвестен). Только на личной карточке, НЕ в топах.
- **hidden** — провалил проверку. Нигде не показывается, логируется с причиной.
- Проверки (любая → hidden): интервал/фартлек (`derived_metrics.reps_detected_count`+method), темп быстрее физического потолка, паузы (elapsed/moving по laps), расхождение суммы дистанций laps с итогом, self-outlier по VDOT.
- Путь «узкая полоса ±150м → надёжный» УБРАН. Нет laps → максимум preliminary.
- **E-Predictor** на джойне недоступен → fallback «против себя» (VDOT по другим дистанциям). См. `docs/questions.md §9`.
- **C3 (задел под протоколы):** миграция-файл `club_records` со схемой `source (reconstructed|official_protocol|coach_confirmed)` + `protocol_url`/`protocol_result_time_seconds`/`verified_at`. Политика перекрытия описана в SQL-комментарии: coach_confirmed > official_protocol > reconstructed; будущий probeg.org-матч апгрейдит строку, не переписывая схему. НЕ применена, в рантайме не используется.
- **C5 (свежесть/пайплайн):** рекорды считаются **на лету** при чтении (`getClubRecords` живьём из cache+laps), НЕ кэшируются → отдельный пересчёт после fit-ingest не нужен, второго источника истины нет. Зафиксировано.

## Файлы
- Логика: `src/features/club/{records,service,constants,types,fixtures}.ts`.
- Роуты: `src/app/api/m/club/{feed,challenge,records,profile,statistics,tops,public-profile,react,privacy}/route.ts`.
- UI: `src/app/m/club/page.tsx` (5 вкладок + публичный-профиль оверлей + SVG-график + бейджи доверия).
- Миграции (НЕ применены): `club_visible` (v1), `club_reactions`, `club_challenges`, `club_records`.
- Валидация: `scripts/validate-records.ts` (+ `scripts/_alias-loader.mjs` для запуска без tsx).

## Проверки
- **tsc --noEmit:** EXIT 0.
- **eslint** (`src/features/club src/app/m/club src/app/api/m/club scripts/validate-records.ts`): EXIT 0.
- **next build:** EXIT 0 — все 8 club-роутов + `/m/club` собрались (server/client-границы валидны).
- **validate-records.ts:** отработал по реальным данным (см. выше), записал `docs/records-validation.md`.
- **Превью:** `scratchpad/club-preview-v2.html` — 6 экранов как видит ученик.

## Осталось на фикстурах / отложено
- Цель челленджа в `fixture`-режиме — демо 500 (но дефолт `auto` = реальный).
- Реакции/приватность/ручная цель — за флагами ВЫКЛ, миграции не применены → в проде инертны (503).
- Достижения-заглушки — только под `CLUB_STUBS_ENABLED`.
- Аватары — монограммы (нет в схеме).

## Что нужно от тебя для включения на реальных данных
1. env: `MINIAPP_ENABLED=true`, `CLUB_ENABLED=true` (на превью, потом прод). Опционально `CLUB_CHALLENGE_GOAL_MODE=auto` (дефолт).
2. Проверить `/m/club` с реального ученического Telegram (резолвер привяжет `telegram_user_id`).
3. По желанию применить миграции (`club_visible`, `club_reactions`, `club_challenges`, `club_records`) и включить соответствующие флаги.
4. Решить по `docs/records-validation.md`: устраивает ли порог пауз (19 отбраковок) — при желании поднять `CLUB_RECORD_PAUSE_TOLERANCE`.
5. Решить, оставлять ли `records-validation.md` (с реальными ФИО) в git — см. `docs/questions.md §11`.

## Безопасность
Секретов не касался, `.env*` не менял (только читал `.env.local` для read-only прогона валидации). Push/деплой/прод-миграций нет. В TP не писал. Ученикам ничего не отправлял (реакции/приватность за флагами ВЫКЛ, инертны). Валидационный скрипт — только чтение cache/laps/derived.
