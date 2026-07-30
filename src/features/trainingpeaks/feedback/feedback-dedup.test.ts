import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { reportNamedType, pickRunForReport } from "./feedback-enqueue.ts";

// Fix (в): a report that names its type must bind to a run of THAT type, not merely the latest run in
// the window (the bug that put an interval report's surge advice on a same-day easy run).
describe("reportNamedType — тип из текста отчёта", () => {
  test("интервальные маркеры → interval", () => {
    for (const t of ["сделал интервалы", "5 отрезков по 400", "5х400 бодро", "повторы 6 по 800", "по 1000 сегодня"]) {
      assert.equal(reportNamedType(t), "interval", t);
    }
  });
  test("лёгкие/темповые маркеры → non_interval", () => {
    for (const t of ["лёгкая готова", "восстановительный трусцой", "спокойный бег", "темповый час", "длительная 20к"]) {
      assert.equal(reportNamedType(t), "non_interval", t);
    }
  });
  test("нейтральный отчёт → null", () => {
    assert.equal(reportNamedType("всё ок, пробежал по плану"), null);
    assert.equal(reportNamedType(""), null);
  });
});

describe("pickRunForReport — тип-осведомлённый выбор тренировки", () => {
  const easy = { workout_cache_id: "easy", workout_date: "2026-07-29", updated_at: "2026-07-29T10:00:00Z", reps_detected_count: 0 };
  const interval = { workout_cache_id: "intv", workout_date: "2026-07-29", updated_at: "2026-07-29T09:00:00Z", reps_detected_count: 6 };

  test("интервальный отчёт при [лёгкая, интервалы] → интервалы (не последняя по времени)", () => {
    // easy is the later-updated one; without type-awareness the old latest-pick would wrongly choose easy.
    assert.equal(pickRunForReport([easy, interval], "сделал интервалы 6 по 800").workout_cache_id, "intv");
  });
  test("лёгкий отчёт при [интервалы, лёгкая] → лёгкая", () => {
    assert.equal(pickRunForReport([interval, easy], "лёгкая, всё спокойно").workout_cache_id, "easy");
  });
  test("тип не назван → последняя по дате (старое поведение, drop-in)", () => {
    const older = { workout_cache_id: "old", workout_date: "2026-07-28", updated_at: "2026-07-28T10:00:00Z", reps_detected_count: 0 };
    const newer = { workout_cache_id: "new", workout_date: "2026-07-29", updated_at: "2026-07-29T10:00:00Z", reps_detected_count: 0 };
    assert.equal(pickRunForReport([older, newer], "пробежал, норм").workout_cache_id, "new");
  });
  test("назван тип, но кандидата такого типа нет → откат ко всем (ничего не теряем)", () => {
    // interval report but only easy runs synced yet → fall back to latest easy, not empty.
    const easyA = { workout_cache_id: "a", workout_date: "2026-07-29", updated_at: "2026-07-29T08:00:00Z", reps_detected_count: 0 };
    const easyB = { workout_cache_id: "b", workout_date: "2026-07-29", updated_at: "2026-07-29T11:00:00Z", reps_detected_count: 0 };
    assert.equal(pickRunForReport([easyA, easyB], "сделал интервалы").workout_cache_id, "b");
  });
  test("одна дата — тай-брейк по updated_at (свежайшие метрики)", () => {
    const a = { workout_cache_id: "a", workout_date: "2026-07-29", updated_at: "2026-07-29T08:00:00Z", reps_detected_count: 0 };
    const b = { workout_cache_id: "b", workout_date: "2026-07-29", updated_at: "2026-07-29T12:00:00Z", reps_detected_count: 0 };
    assert.equal(pickRunForReport([a, b], "").workout_cache_id, "b");
  });
});
