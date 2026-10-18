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

Дополнительно (CODE): комментарии к силовой — `GET/POST workouts/{id}/comments` (тот же хост);
список календаря отдаёт только сводку (`sequenceSummary` = порядок A/B/C + название упражнения,
`totalBlocks/Sets/Prescriptions`, `complianceState`, `hasPrescribedData`, `hasFileData`,
`totalComments`) — повторы/веса только через `workouts/{id}` (LIVE).

## 4. Что Игорь реально ставит (LIVE, 2026-10-18; окно 2025-10-18..2026-10-18)

Прочитано: ростер 122 атлета → `workouts/calendar` по 90-дневным кускам (последовательно,
пауза 0,7 с) → 1221 объект → каждый `workouts/{id}` (1221/1221 = 200, 0 ошибок, **0 ответов 403**).

- Из 1220 в окне **331 — не тренерские**: `complianceState: Unplanned`, `hasPrescribedData:false`,
  0 подходов, title «Strength»/«Yoga» — это файлы с часов, которые силовой сервис тоже листает
  (35 атлетов). Исключены.
- **Тренерских силовых: 889 у 56 атлетов** (из 122). На атлета: медиана ~10, максимум 90;
  распределение 90, 53, 53, 45, 42, 41, 41, 39 … хвост из 7 атлетов по 1.
- Из них 109 — «Развлечение с роллом» (4 упражнения МФР по 3×30 с) и 9 — «Растяжка»;
  собственно силовых ~771.
- Частота: в неделю, когда силовая есть, — 1 (315 атлето-недель), 2 (213), 3 (44), 4 (4).
  Медиана по активному периоду атлета — 1,0/нед. По всей команде: медиана 16 силовых и
  10 атлетов в неделю (максимум 34 и 21). Пики — декабрь (111) и сентябрь (112).
- Отметили выполнение в TP: 323 (Compliant 313, SemiCompliant 8, NonCompliant 2);
  566 — `NoCompletion` (не отмечены). Скрытых (`isHidden`) — 3, заблокированных — 0,
  с комментариями — 3.
- Названия: «Strength Workout» (дефолт TP) 597, «Cиловая» 169 (с латинской «C»), «Развлечение
  с роллом» 109, «Растяжка» 9.

Типовая тренировка:
- 6 упражнений (медиана; 4–8 у 87 %), **все блоки `SingleExercise`** (ни одного Circuit/
  Superset/WarmUp/CoolDown на 5227 блоков), 3 подхода (4953 из 5227; 4 — 262; 2 — 12).
- Параметры: RepsPerSide (на сторону) — доминирует; Reps; Duration (сек). Частые наборы:
  [RepsPerSide] 2807, [Duration] 755, [RepsPerSide+Duration] 618, [Reps+Duration] 300.
- Значения: RepsPerSide медиана 15 (15 — 53 %, 20, 12, 10, 25, 30; диапазон 8–30); Reps медиана 15
  (5–25); Duration 30 с (45 %), 45, 40, 50, 20 (диапазон 20–50 с).
- **Вес не задаётся числом никогда**: параметр веса стоит у 521 упражнения (WeightLb 382,
  WeightPerSideLb 101, WeightKg 38), но все 1740 значений пустые; в заметках «без веса» ~316 раз.
  Атлеты сами вписывают выполненное (`executedValue`): повторы 4300, длительность 1713, вес 153.
- **Отдыха нет**: ни поля (его нет в модели TP), ни упоминаний в 826 заметках к упражнениям.
  Заметки — техника/уточнения («без веса», «1й разминочный», «в тренажёре», «поясница не
  прогибается»; 41 уникальный текст). `instructions` у 129 тренировок (3 уникальных текста).

Упражнения: использовано 78 различных из 946. Топ: Single Leg Glute Bridge (575 раз / 43 атлета),
Single Leg Calf Raise (540/42), Body Weight Bulgarian Split Squat (432/38), Side Plank (365/32),
DB Single Leg Deadlift (295/28), Forearm Plank (292/31), Step Up with Knee Raise (273/27),
Wall Sit (269/18), Single Leg Box Squat (178/15), DeadBug (160/7), Arm Climb (136/11),
4×Foam Roll (109–119/10–11), Banded Clam Shell (95/13), Band Crab Walk (70/8). Своих
упражнений тренера 2 (Anterior Tibialis Raise 46 раз, Leg curl machine 38) — итого 84 использования.

Шаблоны и повторы:
- В библиотеке тренера 3 силовых шаблона (значения в них пустые). Провенанса «поставлено из
  шаблона» в объекте нет — отличить apply от копии нельзя.
- 97 различных последовательностей упражнений; 16 из них даны ≥2 атлетам и покрывают 37 %
  тренировок. Одинаковых вплоть до цифр у ≥2 атлетов — 13 вариантов; самый частый — МФР-ролл
  (109 раз, 10 атлетов); силовые «7 упражнений» — 30 раз у 5 атлетов, «5 упражнений» — 28 у 5.
- **84 % (703 из 833) силовых — точная копия предыдущей силовой того же атлета** (те же
  упражнения, подходы и цифры).

Прогрессия (3 самых частых атлета, обезличено):
- A01 (90): 82 раза один и тот же МФР-ролл 3×30 с — без изменений за год.
- A02 (53): почти одна тренировка весь год; изменения цифр 1–2 раза: икры 15→20/сторону
  (через неделю после старта), подтягивания с резиной 3×10→4×15 и ТА-подъёмы 15→20 (через месяц),
  DeadBug 16→20→30/сторону (дек., июнь).
- A03 (53): одна смена в конце декабря (ягодичный мост 25→15/сторону — снижение, вместе со
  сменой набора упражнений), дальше без изменений.
- Вывод: прогрессия по цифрам в TP почти не ведётся; меняется набор упражнений редкими
  «блоками», а неделя к неделе — копия.

## 5. Границы

API (с тренерским bearer) отдаёт всё, что видно в конструкторе: структуру, назначенные и
выполненные значения, compliance, заметки, библиотеку упражнений, шаблоны, комментарии
(CODE), историю упражнения у атлета (CODE). Чего нет нигде, включая интерфейс: поля отдыха,
провенанса шаблона, автора тренировки. Видео — только ссылка YouTube в объекте упражнения.

Отличия от прочих данных системы:
- tpapi-лента `/workouts` силовых не содержит; в Supabase-кэш (`trainingpeaks_workout_cache`)
  тренерские силовые не попадают вообще: там 1611 строк type 9 — это файлы с часов
  (1607 completed, 4 planned, 0 со структурой). 566 запланированных силовых за год системе
  невидимы (клуб, питание, автопланировщик, переносы).

Для программного создания:
- Есть: контракт `POST workouts/save` (полный объект, UUID клиента → числовой id) и
  `DELETE workouts/{id}` — проверены живьём в PR1 (июль, тестовый атлет), обёрнуты в
  `createStrengthWorkout`/`deleteWorkout("strength")` и executor `strength_workout` с откатом.
- Не хватает / не проверено:
  1. Повторная живая проверка save на текущем релизе (последняя — июль). Нужна запись →
     в этой разведке не делалась. Вариант: 1 throwaway на 3102415 → GET → DELETE, по «да» Игоря.
  2. Справочник упражнение→id + параметры: `libraryContent` (946, LIVE) даёт id/названия,
     но параметры упражнения (их id нужны в prescription) — только `exercises/{id}` (CODE,
     живьём не читался; 78 реально используемых — 78 GET).
  3. Правка существующей (повторный `save` с числовым id?) — в коде клиента отдельного
     update нет, только save; не проверено.
  4. `applyToCalendar` (поставить шаблон из библиотеки), `updateHidden`, `workouts/calendar`
     (копия/перенос) — только из кода, тела запросов не записаны.
  5. Вес: TP хранит фунты в WeightLb, есть WeightKg — Игорь веса не ставит, но генератору
     надо выбрать единицу.
- Доступ: на силовом хосте 403 не встретилось ни разу на 122 атлетах. Атлеты, которые раньше
  давали 403 на tpapi, в текущем ростере отсутствуют — проверить на них не получилось.
