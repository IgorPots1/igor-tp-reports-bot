/**
 * Цифры тренировки на карточке: темп, пульс, пропуски.
 *
 * ЧТО ЭТО СТЕРЕЖЁТ. Для ученика без часов ручной ввод — единственный источник
 * данных, и каждое поле, которое он заполнил, обязано доехать до тренера.
 * 23.09.2026 темп не доезжал НИ У КОГО (колонки не было в select), а пульс
 * доезжал и нигде не рисовался. Проверка держит границу: что человек ввёл —
 * то видно; чего не ввёл — то не выдумывается.
 *
 *   npm run check:activity-numbers
 */

import process from "node:process";

import {
  activityNumbersRu,
  activityPaceSecPerKm,
  paceLabelRu,
} from "@/features/intervals/loop/activity-numbers";

let failures = 0;

function expect(what: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.error(`✗ ${what}\n    получили: ${JSON.stringify(actual)}\n    ждали:    ${JSON.stringify(expected)}`);
  } else {
    console.log(`✓ ${what}`);
  }
}

// ── Темп берётся из скорости, а не пересчитывается ───────────────────────────

// Живая строка Валентины за 20.09.2026: 62 мин, 8.03 км, пульс 126.
expect(
  "темп из средней скорости",
  paceLabelRu(
    activityPaceSecPerKm({
      movingTimeS: 3720,
      distanceM: 8030,
      averageHeartrate: 126,
      averageSpeedMps: 2.1586021505376345,
    })!
  ),
  "7:43"
);

/**
 * ГЛАВНЫЙ СЛУЧАЙ СЕГМЕНТА БЕЗ ЧАСОВ: дистанции нет, темп назван словами.
 * Пересчёт «дистанция / время» здесь дал бы null и молча потерял единственное,
 * что человек знал о своей пробежке.
 */
expect(
  "темп со слов, когда дистанции нет",
  paceLabelRu(
    activityPaceSecPerKm({
      movingTimeS: 2400,
      distanceM: null,
      averageHeartrate: null,
      averageSpeedMps: 1000 / 492, // 8:12 со слов
    })!
  ),
  "8:12"
);

expect(
  "запасной путь: старая строка без скорости",
  paceLabelRu(
    activityPaceSecPerKm({
      movingTimeS: 3600,
      distanceM: 9000,
      averageHeartrate: null,
      averageSpeedMps: null,
    })!
  ),
  "6:40"
);

expect(
  "ни скорости, ни дистанции — темпа нет, и выдумывать нечего",
  activityPaceSecPerKm({
    movingTimeS: 3000,
    distanceM: null,
    averageHeartrate: null,
    averageSpeedMps: null,
  }),
  null
);

expect(
  "нулевая скорость не даёт бесконечный темп",
  activityPaceSecPerKm({
    movingTimeS: 3000,
    distanceM: null,
    averageHeartrate: null,
    averageSpeedMps: 0,
  }),
  null
);

// ── Строка целиком ───────────────────────────────────────────────────────────

expect(
  "полный набор: всё, что она ввела",
  activityNumbersRu({
    movingTimeS: 3720,
    distanceM: 8030,
    averageHeartrate: 126,
    averageSpeedMps: 2.1586021505376345,
  }),
  "62 мин · 8.03 км · 7:43 /км · пульс 126"
);

expect(
  "без пульса — без места под пульс",
  activityNumbersRu({
    movingTimeS: 2400,
    distanceM: 6000,
    averageHeartrate: null,
    averageSpeedMps: 2.5,
  }),
  "40 мин · 6.00 км · 6:40 /км"
);

expect(
  "одно время — и это честная строка",
  activityNumbersRu({
    movingTimeS: 1800,
    distanceM: null,
    averageHeartrate: null,
    averageSpeedMps: null,
  }),
  "30 мин"
);

expect(
  "пустая строка говорит прямо",
  activityNumbersRu({
    movingTimeS: null,
    distanceM: null,
    averageHeartrate: null,
    averageSpeedMps: null,
  }),
  "цифр нет"
);

if (failures > 0) {
  console.error(`\n⛔ провалов: ${failures}`);
  process.exit(1);
}
console.log("\nВсё сошлось.");
