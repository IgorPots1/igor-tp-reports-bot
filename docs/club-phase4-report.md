# Club Phase 4 — GPS-треки новых тренировок (отчёт)

Ветка `feature/club-tracks`, **застекована на `feature/club-phase3`** (силуэт трека рисуется в
карточке ленты и детальном экране тренировки, которые появились в Фазе 3). Всё за флагом
`CLUB_TRACKS_ENABLED` (ВЫКЛ). Старые тренировки НЕ бэкфилятся по умолчанию (наряд).

## Решение по стеку веток
Наряд говорит «каждая фаза — ветка от свежего origin/main». Но фазы клуба СТЕКАЮТСЯ: трек Фазы 4
рендерится в UI Фазы 3. Ветка от origin/main дала бы конфликт page.tsx при мерже. Поэтому
`feature/club-tracks` ветвится от `feature/club-phase3` — линейный стек, Игорь вливает по порядку
(phase3 → tracks) fast-forward без конфликтов. Зафиксировано в questions.md.

## 4.1 Нормализатор — извлечение координат
`extractTrackPoints(rawRecords)` в `lib/fit-workout-normalization.ts` — отдельная функция, читает
`position_lat`/`position_long` из record-сообщений (fit-file-parser отдаёт их уже в ГРАДУСАХ),
сортирует по времени (порядок маршрута). **HR/pace-путь (`normalizeFitRecords`, `NormalizedFitRecord`)
не тронут** — нулевой риск для существующих метрик. Возвращает `[]` для тренировок без GPS
(дорожка/зал).

## 4.2 Таблица + упрощение
- Миграция `20260803000000_trainingpeaks_workout_tracks.sql` (НЕ применена): одна строка на
  `workout_cache_id` (unique), `polyline` (jsonb [[lat,lng]...]), `bbox`, `point_count`, `source='fit'`.
  RLS default-deny, grants `select/insert/update` service_role (без delete — каскад с кэшем). ~1–3 КБ/строка.
- `src/features/trainingpeaks/track-simplify.ts`: `simplifyTrack(points)` — dedupe + Дуглас-Пекер с
  бинарным поиском epsilon до диапазона 50–150 точек, округление 5 знаков. Защита от 0/0 и
  полусфер-семициклов (фильтр диапазона). `computeBbox`. Чистая геометрия в координатах (силуэт, не расстояние).

## 4.3 Сохранение при ингесте + добор
- В `tp-fit-ingest-scan.ts` (`ingestOneWorkoutFit`): после лапов, за `CLUB_TRACKS_ENABLED`, вызываем
  `simplifyTrack(extractTrackPoints(downloaded.records))`; `null` (нет GPS) → трек не пишется. Результат
  выносится через `IngestOneWorkoutResult.trackRow`.
- В `main()` после derived-upsert: `upsertTrainingPeaksWorkoutTrack(trackRow)` в **try/catch**
  (неприменённая/отсутствующая таблица не валит скан). Счётчик `tracksWritten` → лог
  `[fit-ingest] <ученик>: GPS-треков записано N`.
- Repository: тип `TrainingPeaksWorkoutTrackUpsertRow` + `upsertTrainingPeaksWorkoutTrack`
  (upsert on `workout_cache_id`, зеркалит derived-upsert; без delete — таблица его не грантит).
- Добор: `run-fit-tracks-backfill-60d.sh` — `CLUB_TRACKS_ENABLED=true PAST_DAYS=60` прогоняет
  существующий скан за 60 дней (идемпотентно). **НЕ запускается**, команда в шапке скрипта и ниже.

## 4.4 Отрисовка — SVG-силуэт
`TrackSilhouette` в page.tsx: нормализует полилинию в bbox, корректирует по широте (`cos(midLat)`),
рисует `polyline stroke` жёлтым (var акцент), без тайлов/ключей/внешних сервисов, `preserveAspectRatio`.
- Карточка ленты: маленький (72px) над названием тренировки.
- Детальный экран: крупный (180px) в карточке «Маршрут».
- Нет трека (`item.track == null`) → блок вообще не рисуется.
Клуб читает треки батчем `loadTracksForWorkouts(ids)` (в ленте — вместе с реакциями/пульсом,
без N+1; в детальном — одним чтением), терпит отсутствие таблицы.

## 4.5 Флаг + сколько получат трек
Флаг `CLUB_TRACKS_ENABLED` (ВЫКЛ). Пока флаг выключен — 0 треков (извлечение не запускается).
Сколько НОВЫХ тренировок получат трек за время работы — считается счётчиком `tracksWritten` и
пишется в лог скана; фактическое число появится только после включения флага и первых прогонов
(в песочнице скан не запускался: нет TP-сессии/Supabase-env). Ожидание: каждая уличная пробежка
с FIT+GPS → трек; дорожка/зал/без FIT → без трека.

## Координаты — оговорка (проверить фактом)
fit-file-parser@3 по докам отдаёт lat/long уже в градусах. Пакет физически не установлен в этом
чекауте, эмпирически (console.log записи) не подтверждал. Если вдруг вернёт сырые семициклы —
`simplifyTrack` отфильтрует их по диапазону (|lat|≤90) → пустой/нет трека, а не мусор в БД.
Рекомендация: на первом прогоне глянуть один трек в БД (координаты Белграда/города ученика).

## Проверки
`tsc` 0 (проект; tools/ исключён из tsconfig — там тип-стриппинг), `eslint` 0, `build` OK,
`check-initdata-auth` 8/8, `smoke-feedback-sweep` PASSED. Ингест-граф грузится: все импорты и
compat-гварды (`simplifyTrack`, `upsertTrainingPeaksWorkoutTrack`) резолвятся, доходит до `main()`
(падает только на отсутствии SUPABASE_URL в песочнице — ожидаемо). Общие модули не тронуты.

## Раскатка (Игорю, после мержа phase3+tracks)
1. Применить `20260803000000_trainingpeaks_workout_tracks.sql`.
2. Vercel env: `CLUB_TRACKS_ENABLED=true` + redeploy (клуб начнёт рисовать силуэты для тренировок,
   у которых есть трек).
3. Раннер: следующий обычный fit-ingest (5-дневное окно) начнёт писать треки для новых тренировок,
   если в окружении скана `CLUB_TRACKS_ENABLED=true` (добавить в plist/скрипт).
4. Разовый добор 60 дней (по желанию):
   `CLUB_TRACKS_ENABLED=true PAST_DAYS=60 ~/igor-tp-reports-bot/tools/trainingpeaks-export/scripts/run-fit-tracks-backfill-60d.sh`
   Откат: `CLUB_TRACKS_ENABLED=false` → треки не читаются/не пишутся (данные остаются, но не показываются).
