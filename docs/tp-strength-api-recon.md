# TP structured strength — API recon (2026-10-18, read-only)

Обезличено. Имена/ids атлетов и сырые ответы — только в `reports/strength/` (gitignored).
В TP за всю разведку не отправлено ни одного POST/PUT/PATCH/DELETE.

Легенда источника: **LIVE** — подтверждено живым GET в этой разведке; **CODE** — из бандла
веб-клиента TP (`app.trainingpeaks.com/release-20261016-83ae3fe/modules-23bb80da.js`, data source
`activity`) и/или из `tp-api-client.ts`; **PR1** — живой цикл create→GET→DELETE на тестовом атлете
3102415 (июль 2026, `docs/tp-api-capability-matrix.md`), сейчас НЕ повторялся.

## 1. Хост, авторизация

- Хост: `https://api.peakswaresb.com`, корень `ACTIVITY_ROOT = /rx/activity`, версия `v1/`
  (из `environment.js` клиента; там же `RX_ROOT=/rx`, `RECURRING_ROOT=/rx/recurring`).
- Авторизация: тот же `Authorization: Bearer` что и для `tpapi.trainingpeaks.com`
  (кука `Production_tpAuth` → `GET tpapi /users/v3/token`). Отдельного токена НЕ нужно — LIVE
  (все GET ниже прошли через `getTpApiJsonRaw`, т.е. обычный bearer клиента).
- Срок жизни: bearer ~1 ч (`expires_in`, клиент обновляет сам за 60 с до конца). Кука в
  снимке `~/.tp-reports-bot/session-snapshot.json`: снята 2026-08-21, браузер сообщил срок
  2026-09-20 — но на 2026-10-18 обмен на bearer ВСЁ ЕЩЁ работает (LIVE). То есть «срок»
  куки из браузера не совпадает с серверным сроком сессии; клиент только предупреждает.

## 2. Эндпоинты (все относительно `https://api.peakswaresb.com/rx/activity/v1/`)

### Чтение
| Метод | Путь | Что | Источник |
|---|---|---|---|
| GET | `workouts/calendar/{athleteId}/{from}/{to}` | список силовых атлета за диапазон (полные объекты) | LIVE, CODE |
| GET | `workouts/{id}` | одна силовая (`{data:{…}, errors:{}}`) | LIVE (PR1), CODE |
| GET | `workouts/{id}/summary` | краткая сводка | CODE |
| GET | `libraryContent` | вся библиотека упражнений + типы блоков + группы мышц | LIVE |
| GET | `parameters/exercise` | 15 параметров подхода | LIVE |
| GET | `parameters/block` | 6 параметров блока | LIVE |
| GET | `exercises/{id}` | одно упражнение (параметры, видео, инструкция) | CODE |
| GET | `libraryContent/workoutLibrary/{libraryId}` | силовые шаблоны в библиотеке тренера | LIVE |
| GET | `libraryContent/workoutLibrary/items/{itemId}` | один шаблон | CODE |
| GET | `workouts/{id}/privateWorkoutNote` | приватная заметка | CODE |
| GET | `analytics/{athleteId}/exercise/{exerciseId}?limit=10[&centerDate=]` | история упражнения у атлета | CODE (React-бандл) |
| GET | `plans/{planId}/workouts/{from}/{to}` | силовые в тренировочном плане | CODE |
| GET | tpapi `/exerciselibrary/v2/libraries` | список библиотек тренера (id для строки выше) | LIVE |

Силовые НЕ приходят в tpapi `/fitness/v6/athletes/{id}/workouts/{from}/{to}` (уже отмечено в
`trainingpeaks-workout-normalization.ts`, orderOnDay-дыры). Веб-клиент календаря грузит оба
списка параллельно (записанный сетевой лог 2026-06-05, `reports/trainingpeaks-export-flow-diagnostic/`).

### Запись (НЕ выполнялась — только контракт из кода клиента)
| Метод | Путь | Что | Источник |
|---|---|---|---|
| POST | `workouts` body `{date, calendarId, workoutType:"StructuredStrength", prescribedDate, prescribedStartTime:null}` | получить ПУСТУЮ модель-черновик (UUID, не сохраняется) | CODE |
| POST | `workouts/save` body = полный объект тренировки | **создать/сохранить** (единственный персистящий вызов) | CODE, PR1 (id числовой, `NoCompletion`) |
| PUT | `workouts` | валидация view-model (без сохранения) | CODE |
| POST | `workouts/add/libraryContent`, `workouts/blocks/add/libraryContent`, `workouts/blocks/prescriptions/add/libraryContent`, `workouts/blocks/add/prescription` | серверные «добавить блок/упражнение» к черновику — возвращают черновик целиком | CODE |
| PUT | `workouts/blocks/prescriptions/sets`, `workouts/blocks/prescriptions/parameters`; PATCH `…/parameters/remove` | подходы/параметры в черновике | CODE |
| DELETE | `workouts/{id}` | удалить | CODE, PR1 (200, затем GET 404) |
| PUT | `workouts/updateHidden` body `{…, workoutId, isHidden}` | скрыть/показать атлету | CODE |
| PUT | `workouts/updateLocked` | заблокировать | CODE |
| POST/PUT | `workouts/calendar` | копировать / перенести (cut-paste) | CODE |
| POST | `workouts/calendar/shift` | сдвиг пачки | CODE |
| PUT | `workouts/completeAsPlanned` | отметить выполненной по плану | CODE |
| PUT | `workouts/{id}/privateWorkoutNote` | приватная заметка | CODE |
| POST | `libraryContent/workoutLibrary/applyToCalendar` | **поставить шаблон из библиотеки в календарь** | CODE |
| POST | `libraryContent/workoutLibrary/save` body `{id, libraryId, title, workout, workoutLibraryItemType}` | сохранить шаблон | CODE |
| POST | `LibraryContent/workoutLibrary/createFromWorkout` | шаблон из тренировки календаря | CODE |
| DELETE | `libraryContent/workoutLibrary/items/{id}` | удалить шаблон | CODE |
| POST→PUT / DELETE | `exercises` / `exercises/{id}` | создать своё упражнение / удалить | CODE |

Вывод по записи: черновик собирается на клиенте (или серверными `add/*`, которые только
эхо-возвращают черновик), а в базу ложится только `POST workouts/save` с полным объектом.
Это совпадает с PR1 (многошаговый поток «никогда не персистил»).

## 3. Модель данных (LIVE, из шаблонов и PR1)

```
workout {id(string, числовой после save), workoutType:"StructuredStrength", title, instructions,
  calendarId(=athleteId), prescribedDate, prescribedStartTime, orderOnDay, isHidden, isLocked,
  complianceState(NoCompletion|…), compliancePercent, snapshot{totalBlocks,totalSets,
  totalPrescriptions,completed*}, files[], rpe, feel, completedDateTime, executedDurationInSeconds,
  blocks[]}
block {id, title, blockType: SingleExercise|Circuit|Superset|WarmUp|CoolDown, coachNotes,
  parameters[] (параметры блока: WeightLb/WeightKg/Reps/TimeSeconds/TimeMin/DistanceMeters),
  prescriptions[]}
prescription {id, exercise{id, ownerId, title, videoUrl, instructions, parameters[],
  primary/secondaryMuscleGroups, canEdit}, parameters[] (что задаётся в подходе), coachNotes,
  setSummaryTemplate (напр. "{RepsPerSide} @ {WeightLb} lb"), sets[]}
set {id, setOrigin:"Prescribed", isComplete, parameterValues[{parameter, inputFormat
  (Integer|Time|…), prescribedValue(string|null), executedValue}]}
```

Параметры подхода (15): WeightLb, WeightKg, WeightPerSideLb, WeightPerSideKg, Reps, RepsPerSide,
Duration, DistanceMeters/Km/Ft/Yd/Miles, HeightIn, RPE, RIR. **Параметра «отдых» нет** — ни на
уровне подхода, ни среди 6 параметров блока. Отдых, если и пишется, то текстом в coachNotes.

Библиотека упражнений (`libraryContent`): 946 упражнений, из них 944 системных (`canEdit:false`,
в этом списке `ownerId:null`, в объекте упражнения внутри тренировки — `ownerId:2000301`) и
2 собственных упражнения тренера (`ownerId` = аккаунт тренера). Элемент списка — только
`{exerciseId, title, ownerId, canEdit, isGarminSupported, searchText, searchAttributes}`;
параметры/видео — через `exercises/{id}`. Поиск в UI — клиентский фильтр по этому списку
(+ фильтры «владелец» и «группа мышц», 12 групп); серверного поиска нет.

Библиотеки тренера (tpapi): 7 (1 своя «My Library» + 6 системных/дефолтных). Силовых шаблонов
(`workoutLibraryItemType: ActivityWorkoutTemplate`) — 3, все в своей библиотеке; в остальных 0.
В шаблонах `prescribedValue` пустые (null) — шаблон задаёт упражнения и число подходов, но не цифры.
