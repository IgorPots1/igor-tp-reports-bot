# Рекорды: лучший непрерывный отрезок vs вся тренировка

Сгенерировано `scripts/records-best-split-report.ts` (read-only). Без ФИО — только student_id.

## Итог (главное)

- Пар (рекорд есть в обоих методах): **35**
- Улучшено новым методом (время меньше): **22** из 35
- **Средняя дельta (новый − старый): -111с** (отрицательное = новый быстрее/точнее)
- Появилось только в новом методе (сплит нашёл отрезок, старый — нет): **51**
- Отбраковок по паузам (pause_gap): старый метод **19**, новый метод **154**. Рост — потому что best-split строит кандидатов из ЛЮБОЙ пробежки ≥ дистанции (пул кандидатов больше), включая лёгкие бега со стопами. На показываемые (быстрые непрерывные) рекорды это не влияет; разбор — docs/pause-gap-analysis.md (Блок 3), фильтр прогулок — Блок 4.

## Пер-ученик / дистанция

| student_id | дист | старое время | новое время | дельта | доверие | метод |
|---|---|---|---|---|---|---|
| f5f2c862 | 5k | 34:28 | 26:00 | -508с | preliminary | best_split |
| f5f2c862 | 10k | 53:23 | 50:05 | -198с | preliminary | whole_workout |
| f5f2c862 | 21k | 1:56:28 | 1:56:28 | 0с | preliminary | whole_workout |
| 050c2b3a | 5k | 40:06 | 39:59 | -7с | preliminary | best_split |
| 8383031a | 5k | 35:37 | 28:47 | -410с | preliminary | best_split |
| 8383031a | 10k | 1:00:00 | 1:00:00 | 0с | verified | whole_workout |
| ab959228 | 10k | 54:11 | 54:11 | 0с | preliminary | best_split |
| 4e83c525 | 5k | — | 27:00 | новый | preliminary | best_split |
| 4e83c525 | 10k | 59:04 | 59:00 | -4с | preliminary | best_split |
| 768ac3ec | 5k | — | 23:00 | новый | preliminary | best_split |
| 768ac3ec | 10k | 47:39 | 45:00 | -159с | preliminary | best_split |
| c0fdf186 | 5k | — | 32:04 | новый | preliminary | best_split |
| c0fdf186 | 10k | 1:06:36 | 1:04:38 | -118с | verified | best_split |
| 5d85b152 | 5k | 27:40 | 27:34 | -6с | preliminary | best_split |
| 5d85b152 | 10k | 55:14 | 55:14 | 0с | verified | best_split |
| 404d7528 | 5k | — | 24:47 | новый | preliminary | best_split |
| 404d7528 | 10k | 49:57 | 49:57 | 0с | verified | whole_workout |
| 7809fed1 | 5k | 26:29 | 26:25 | -4с | preliminary | best_split |
| 7809fed1 | 10k | 59:50 | 59:37 | -13с | verified | best_split |
| ab1ec79d | 5k | — | 25:58 | новый | preliminary | best_split |
| ab1ec79d | 10k | 1:09:35 | 52:20 | -1035с | verified | best_split |
| 5000888b | 5k | — | 30:00 | новый | preliminary | best_split |
| 5000888b | 10k | 1:01:07 | 1:01:07 | 0с | preliminary | best_split |
| f8b96028 | 5k | — | 30:13 | новый | preliminary | best_split |
| f8b96028 | 10k | 1:01:48 | 1:01:48 | 0с | verified | best_split |
| 536adfd0 | 5k | — | 26:46 | новый | preliminary | best_split |
| 536adfd0 | 10k | 55:25 | 55:07 | -18с | verified | best_split |
| 5f5d400d | 5k | — | 28:51 | новый | preliminary | best_split |
| 5f5d400d | 10k | — | 57:56 | новый | verified | best_split |
| 5f5d400d | 21k | 2:03:16 | 2:03:16 | 0с | verified | whole_workout |
| 55fb25a2 | 5k | — | 31:04 | новый | preliminary | best_split |
| 55fb25a2 | 10k | 1:04:47 | 1:04:47 | 0с | verified | best_split |
| 63a9be52 | 5k | — | 28:16 | новый | preliminary | best_split |
| 63a9be52 | 10k | 56:51 | 56:51 | 0с | verified | whole_workout |
| 45ba4e6d | 5k | 23:09 | 21:23 | -106с | preliminary | best_split |
| 45ba4e6d | 10k | 48:31 | 43:05 | -326с | verified | best_split |
| 98924047 | 5k | — | 34:51 | новый | preliminary | best_split |
| 763f98a3 | 5k | 30:30 | 27:30 | -180с | preliminary | best_split |
| 763f98a3 | 10k | 1:00:02 | 56:03 | -239с | preliminary | best_split |
| 3c75c972 | 5k | — | 36:00 | новый | preliminary | best_split |
| 647719e2 | 5k | 40:01 | 33:45 | -376с | preliminary | best_split |
| f079b0db | 5k | — | 32:29 | новый | preliminary | best_split |
| f079b0db | 10k | 1:00:18 | 1:00:18 | 0с | preliminary | whole_workout |
| 852aa78d | 5k | — | 29:42 | новый | preliminary | best_split |
| 852aa78d | 10k | 1:00:11 | 1:00:11 | 0с | verified | best_split |
| 0816aae8 | 5k | — | 30:00 | новый | preliminary | best_split |
| 0816aae8 | 10k | — | 1:00:30 | новый | preliminary | best_split |
| 18daeeb2 | 10k | 1:21:06 | 1:20:28 | -38с | preliminary | best_split |
| 515ce410 | 5k | — | 27:33 | новый | preliminary | best_split |
| 515ce410 | 10k | 56:41 | 56:41 | 0с | verified | whole_workout |
| 6c7062ff | 5k | 38:45 | 38:45 | 0с | preliminary | whole_workout |
| 4e76a1dc | 5k | 40:02 | 40:02 | 0с | preliminary | whole_workout |
| d70f254b | 5k | — | 22:33 | новый | preliminary | best_split |
| d70f254b | 10k | 46:18 | 45:33 | -45с | verified | best_split |
| 1af7d1cb | 5k | — | 25:49 | новый | preliminary | best_split |
| 1af7d1cb | 10k | — | 51:59 | новый | verified | best_split |
| 1af7d1cb | 21k | 1:52:26 | 1:51:00 | -86с | verified | best_split |
| ad95bdf9 | 5k | — | 37:58 | новый | preliminary | best_split |
| 2a10d457 | 5k | — | 32:54 | новый | preliminary | best_split |
| d0b88327 | 5k | — | 26:29 | новый | preliminary | best_split |
| d0b88327 | 10k | — | 57:47 | новый | verified | best_split |
| b4095414 | 5k | — | 36:00 | новый | preliminary | best_split |
| e2392539 | 5k | — | 27:16 | новый | preliminary | best_split |
| e2392539 | 10k | — | 55:07 | новый | verified | best_split |
| fe369bc9 | 5k | — | 29:58 | новый | preliminary | best_split |
| fe369bc9 | 10k | — | 1:03:37 | новый | verified | best_split |
| 0d05c6c9 | 5k | — | 34:29 | новый | preliminary | best_split |
| 234d0fcb | 21k | — | 1:10:32 | новый | preliminary | best_split |
| 02c0c9d4 | 5k | — | 32:05 | новый | preliminary | best_split |
| b5e7ad95 | 5k | — | 30:00 | новый | preliminary | best_split |
| 7aacbe93 | 5k | — | 34:00 | новый | preliminary | best_split |
| 7512230d | 5k | — | 32:03 | новый | preliminary | best_split |
| d64c29e4 | 5k | — | 29:23 | новый | preliminary | best_split |
| 6a380d8e | 5k | — | 34:02 | новый | preliminary | best_split |
| 9d3e1c0f | 5k | — | 24:45 | новый | preliminary | best_split |
| 9d3e1c0f | 10k | — | 51:02 | новый | preliminary | best_split |
| 0c0298d1 | 5k | — | 42:19 | новый | preliminary | best_split |
| 13b86a47 | 5k | — | 29:26 | новый | preliminary | best_split |
| 73e667e3 | 5k | — | 25:48 | новый | preliminary | best_split |
| 73e667e3 | 10k | — | 51:12 | новый | preliminary | best_split |
| 1fa853da | 5k | — | 31:30 | новый | preliminary | best_split |
| b3d25f76 | 5k | — | 35:16 | новый | preliminary | best_split |
| 0df6a439 | 5k | — | 27:00 | новый | preliminary | best_split |
| 0df6a439 | 10k | — | 1:02:13 | новый | preliminary | best_split |
| 3b57509b | 5k | — | 29:46 | новый | preliminary | best_split |
| 3b57509b | 10k | — | 1:06:49 | новый | verified | best_split |
