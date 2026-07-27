/**
 * Наряд «вес из лога»: единый резолвер веса.
 * Правило тренера: новейший лог НА ДАТУ РАЗБОРА (независимо от confirmed_by_coach)
 * → профиль → null; мусорный лог не берём молча — берём профиль И помечаем тренеру.
 * Чистые вычисления, без БД и без AI-вызовов.
 */
import assert from "node:assert/strict";

import {
  allowedWeightChangePct,
  resolveNutritionWeight,
  WEIGHT_PROFILE_DIVERGENCE_PCT,
  type NutritionWeightLogInput,
} from "@/features/nutrition/weight-resolution";

function log(weightKg: number, loggedAt: string, confirmedByCoach = false): NutritionWeightLogInput {
  return { weightKg, loggedAt, confirmedByCoach };
}

function codes(result: ReturnType<typeof resolveNutritionWeight>): string[] {
  return result.notes.map((note) => note.code);
}

function run(): void {
  // 1. Лог свежее профиля → берётся ЛОГ, даже неподтверждённый (главное правило наряда).
  {
    const result = resolveNutritionWeight({
      weightLogs: [log(66.9, "2026-07-27T08:00:00Z"), log(67.2, "2026-07-21T08:00:00Z")],
      profileWeightKg: 70,
      asOfDate: "2026-07-27",
    });
    assert.equal(result.weightKg, 66.9, "новейший лог должен победить профиль");
    assert.equal(result.source, "log");
    assert.equal(result.logConfirmedByCoach, false, "неподтверждённый лог всё равно берётся");
  }

  // 2. Лога нет → профиль.
  {
    const result = resolveNutritionWeight({ weightLogs: [], profileWeightKg: 58, asOfDate: "2026-07-27" });
    assert.equal(result.weightKg, 58);
    assert.equal(result.source, "profile");
    assert.deepEqual(codes(result), [], "просто отсутствие лога — не повод для пометки");
  }

  // 3. Абсурдный лог (опечатка «5.6» вместо «56») → профиль + пометка.
  {
    const result = resolveNutritionWeight({
      weightLogs: [log(5.6, "2026-07-27T08:00:00Z")],
      profileWeightKg: 56,
      asOfDate: "2026-07-27",
    });
    assert.equal(result.weightKg, 56, "мусорный лог не должен уехать в расчёт");
    assert.equal(result.source, "profile");
    assert.deepEqual(codes(result), ["weight_log_out_of_range"]);
    assert.match(result.notes[0].textRu, /5\.6 кг/, "в пометке видно отвергнутое значение");
    assert.match(result.notes[0].textRu, /56 кг/, "и то, что взято взамен");
  }
  {
    // Верхняя граница: рост 165 вместо веса.
    const result = resolveNutritionWeight({
      weightLogs: [log(165, "2026-07-27T08:00:00Z")],
      profileWeightKg: 60,
      asOfDate: "2026-07-27",
    });
    assert.equal(result.weightKg, 60);
    assert.deepEqual(codes(result), ["weight_log_out_of_range"]);
  }

  // 4. Скачок в диапазоне (ввод в фунтах: 59 кг → «130») → профиль + пометка.
  {
    const result = resolveNutritionWeight({
      weightLogs: [log(130, "2026-07-27T08:00:00Z"), log(59, "2026-07-20T08:00:00Z")],
      profileWeightKg: 59,
      asOfDate: "2026-07-27",
    });
    assert.equal(result.weightKg, 59, "скачок не должен уехать в расчёт");
    assert.equal(result.source, "profile");
    assert.deepEqual(codes(result), ["weight_log_jump_rejected"]);
    assert.match(result.notes[0].textRu, /130 кг/);
    assert.match(result.notes[0].textRu, /59 кг/);
  }
  {
    // Сдвиг цифр: 60 → 66 за неделю = 10 % при допуске ~8 % → отвергаем.
    const result = resolveNutritionWeight({
      weightLogs: [log(66, "2026-07-27T08:00:00Z"), log(60, "2026-07-20T08:00:00Z")],
      profileWeightKg: 60,
      asOfDate: "2026-07-27",
    });
    assert.equal(result.source, "profile");
    assert.deepEqual(codes(result), ["weight_log_jump_rejected"]);
  }

  // 5. Веса нет нигде → null + пометка.
  {
    const result = resolveNutritionWeight({ weightLogs: [], profileWeightKg: null, asOfDate: "2026-07-27" });
    assert.equal(result.weightKg, null);
    assert.equal(result.source, "none");
    assert.deepEqual(codes(result), ["weight_missing_everywhere"]);
  }

  // 6. Лог ПОЗЖЕ week_to → берётся более ранний (числа недели не плавают во времени).
  {
    const result = resolveNutritionWeight({
      weightLogs: [
        log(64, "2026-07-27T08:00:00Z"), // уже после разбираемой недели
        log(67.2, "2026-07-13T08:00:00Z"),
        log(68, "2026-07-06T08:00:00Z"),
      ],
      profileWeightKg: 70,
      asOfDate: "2026-07-19",
    });
    assert.equal(result.weightKg, 67.2, "вес берётся на дату разбора, а не сегодняшний");
    assert.equal(result.logLoggedAt, "2026-07-13T08:00:00Z");
  }
  {
    // Лог, записанный В САМ день week_to позже полуночи, всё ещё «не позже».
    const result = resolveNutritionWeight({
      weightLogs: [log(59.2, "2026-07-19T21:30:00Z")],
      profileWeightKg: 60,
      asOfDate: "2026-07-19",
    });
    assert.equal(result.weightKg, 59.2);
  }
  {
    // Логов до даты нет вообще → откат к новейшему (лучше реальный вес, чем молча профиль).
    const result = resolveNutritionWeight({
      weightLogs: [log(59, "2026-07-27T08:00:00Z")],
      profileWeightKg: 62,
      asOfDate: "2026-06-01",
    });
    assert.equal(result.weightKg, 59);
    assert.equal(result.source, "log");
  }

  // 7. Расхождение лог/профиль → пометка (лог при этом принят).
  {
    const result = resolveNutritionWeight({
      weightLogs: [log(66.9, "2026-07-27T08:00:00Z")],
      profileWeightKg: 70, // реальный случай с замера: 4.4 %
      asOfDate: "2026-07-27",
    });
    assert.equal(result.weightKg, 66.9);
    assert.equal(result.source, "log");
    assert.deepEqual(codes(result), ["weight_log_differs_from_profile"]);
    assert.match(result.notes[0].textRu, /66\.9 кг/);
    assert.match(result.notes[0].textRu, /70 кг/);
  }
  {
    // Ниже порога — молчим (иначе пометка станет шумом).
    const result = resolveNutritionWeight({
      weightLogs: [log(59.5, "2026-07-21T08:00:00Z")],
      profileWeightKg: 59, // 0.8 % — реальный случай с замера
      asOfDate: "2026-07-21",
    });
    assert.equal(result.source, "log");
    assert.deepEqual(codes(result), [], `< ${WEIGHT_PROFILE_DIVERGENCE_PCT} % расхождения не помечаем`);
  }

  // 8. Неподтверждённый лог сам по себе пометки НЕ даёт: на замере новейший лог не
  //    подтверждён у 13 учениц из 13 — пометка на каждой была бы шумом.
  {
    const result = resolveNutritionWeight({
      weightLogs: [log(65, "2026-07-21T08:00:00Z", false)],
      profileWeightKg: 65,
      asOfDate: "2026-07-21",
    });
    assert.equal(result.source, "log");
    assert.equal(result.logConfirmedByCoach, false);
    assert.deepEqual(codes(result), []);
  }

  // 9. Два взвешивания в один день (утро/вечер) — не скачок: допуск включает суточный шум.
  {
    const result = resolveNutritionWeight({
      weightLogs: [log(60.8, "2026-07-21T20:00:00Z"), log(60, "2026-07-21T07:00:00Z")],
      profileWeightKg: 60,
      asOfDate: "2026-07-21",
    });
    assert.equal(result.weightKg, 60.8, "1.3 % за день — нормальные колебания, не мусор");
    assert.equal(result.source, "log");
  }

  // 10. Самый резкий РЕАЛЬНЫЙ шаг с замера (54.6 → 53.2 за 6.9 дн = 2.6 %/нед) проходит.
  {
    const result = resolveNutritionWeight({
      weightLogs: [log(53.2, "2026-07-06T08:00:00Z"), log(54.6, "2026-06-29T10:00:00Z")],
      profileWeightKg: 55,
      asOfDate: "2026-07-06",
    });
    assert.equal(result.weightKg, 53.2, "живые данные не должны попадать под гард");
    assert.equal(result.source, "log");
  }

  // 11. Гард отверг лог, а профиля нет → null + обе пометки (никакой тихой подмены).
  {
    const result = resolveNutritionWeight({
      weightLogs: [log(5.6, "2026-07-27T08:00:00Z")],
      profileWeightKg: null,
      asOfDate: "2026-07-27",
    });
    assert.equal(result.weightKg, null);
    assert.equal(result.source, "none");
    assert.deepEqual(codes(result), ["weight_log_out_of_range", "weight_missing_everywhere"]);
  }

  // 12. Допуск растёт со сроком, но не обнуляется при нулевом интервале.
  {
    assert.equal(allowedWeightChangePct(0), 3, "в один день — только суточный шум");
    assert.equal(allowedWeightChangePct(7), 8, "неделя = 3 % + 5 %");
    assert.equal(allowedWeightChangePct(14), 13);
    assert.ok(allowedWeightChangePct(7) > 2.62, "выше наблюдаемого максимума на реальных данных");
  }

  // 13. Одна мусорная запись в середине истории не должна браковать следующий нормальный
  //     вес: гард сравнивает с предыдущим ПРАВДОПОДОБНЫМ логом, а не просто с соседним.
  {
    const result = resolveNutritionWeight({
      weightLogs: [
        log(59.2, "2026-07-27T08:00:00Z"),
        log(3.5, "2026-07-20T08:00:00Z"), // мусор посередине
        log(59, "2026-07-13T08:00:00Z"),
      ],
      profileWeightKg: 62,
      asOfDate: "2026-07-27",
    });
    assert.equal(result.weightKg, 59.2, "хороший лог не должен страдать из-за мусорного соседа");
    assert.equal(result.source, "log");
  }

  // 14. Мусор в самих строках лога (NaN/пустая дата) не роняет резолв.
  {
    const result = resolveNutritionWeight({
      weightLogs: [
        { weightKg: Number.NaN, loggedAt: "2026-07-27T08:00:00Z" },
        { weightKg: 60, loggedAt: "не дата" },
        log(59.4, "2026-07-20T08:00:00Z"),
      ],
      profileWeightKg: 59,
      asOfDate: "2026-07-27",
    });
    assert.equal(result.weightKg, 59.4);
    assert.equal(result.source, "log");
  }

  console.log("PASS check-nutrition-weight-resolution");
}

run();
