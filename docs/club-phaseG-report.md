# Club Phase G — закрытие вопросов #35 и #40 (отчёт)

Ветка `feature/club-coach-aggregates`, стек на `feature/club-no-longdash`. Оба вопроса ЗАКРЫТЫ ФАКТОМ;
кода приложения по существу не менял (только привёл тест-скрипты к истине + доки).

## #35 — тренер в агрегатных топах: уже работает (Фаза 3), не требовало правки приложения
- ФАКТ по коду: `materializeClubRecords` берёт `students.filter(isVisible)`, а `isVisible` уже уважает
  `clubIncludedServiceStudentIds()` (Фаза 3.1). И materialize, и потребители агрегатов (тоже через
  isVisible) включают тренера, как только он в `CLUB_INCLUDE_SERVICE_STUDENT_IDS`. Моя прошлая заметка
  (#35) ошибочно утверждала, что materialize фильтрует сервисные напрямую.
- ПРОВЕРЕНО ФАКТОМ (read-only, прод): с include-set участников `112 → 113`, тренер (Igor Potseluev,
  `7cb54839-…`) получает rank `#100` (0 км за неделю → низко, но УЧАСТВУЕТ).
- Правки: только 4 тест/measure-скрипта (`check-club-aggregates-parity`, `-realdb`,
  `check-club-week-rollup-parity`, `measure-club-tabs`) теперь тоже уважают include-set — чтобы
  «перегон parity» был верным (их сырой baseline совпал с app-isVisible). In-memory parity с включённым
  include-set = **0**.
- Операционно (в чеклист включения): `CLUB_INCLUDE_SERVICE_STUDENT_IDS=7cb54839-…` должен стоять в
  окружении, где крутится `materialize --all` (раннер), иначе таблица агрегатов не получит строк тренера
  до следующего полного пересчёта. Затем `CLUB_INCLUDE_SERVICE_STUDENT_IDS=<id> npm run
  check-club-aggregates-parity-realdb` → 0.

## #40 — координаты FIT: градусы (закрыто по источнику парсера)
- ФАКТ: fit-file-parser@3 (tools node_modules) конвертирует поля sint32 (семициклы) в градусы —
  `binary.js:99` `case 'sint32': return data * FIT.scConst;`, `scConst = 180 / 2^31` (fit.js:12).
  position_lat/position_long = sint32 → отдаются в ГРАДУСАХ.
- Значит `extractTrackPoints` + `simplifyTrack` (допущение «градусы», фильтр |lat|≤90/|lng|≤180, отсев
  0/0) КОРРЕКТНЫ. Правки не нужны. Живьём на первом треке всё равно можно глянуть, но код подтверждён
  источником, а не «по докам».

## Проверки
`eslint` (4 скрипта) 0, `tsc` 0, `check-initdata-auth` 8/8, `smoke-feedback-sweep` PASSED. `build`
не гоняю: изменены только `scripts/` и `docs/` — вне Next-графа сборки (на родительской ветке билд зелёный).
