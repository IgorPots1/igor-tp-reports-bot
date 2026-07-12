import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildBatchPreviewCard,
  buildWriteActionBlockedMessage,
  buildWriteActionDetailCard,
  buildWriteActionQueuedMessage,
  buildWriteActionResultMessage,
  buildWriteActionSummaryLine,
  formatCoachDateShort,
} from "./action-write-telegram-copy.ts";
import { computeBatchAggregate } from "./batch-preview.ts";

describe("formatCoachDateShort", () => {
  test("formats an ISO date to DD.MM.YYYY", () => {
    assert.equal(formatCoachDateShort("2026-12-05"), "05.12.2026");
  });
  test("passes through a non-ISO string unchanged", () => {
    assert.equal(formatCoachDateShort("garbage"), "garbage");
  });
  test("returns '?' for null", () => {
    assert.equal(formatCoachDateShort(null), "?");
  });
});

describe("buildWriteActionSummaryLine", () => {
  test("create_workout", () => {
    const line = buildWriteActionSummaryLine("create_workout", { title: "Long run", workoutDay: "2026-12-05" });
    assert.equal(line, "создать «Long run» на 05.12.2026");
  });
  test("strength_workout", () => {
    const line = buildWriteActionSummaryLine("strength_workout", { title: "Leg day", prescribedDate: "2026-12-06" });
    assert.equal(line, "создать силовую «Leg day» на 06.12.2026");
  });
  test("update_workout lists changed field names", () => {
    const line = buildWriteActionSummaryLine("update_workout", { workoutId: 123, fields: { title: "New", distancePlanned: 5000 } });
    assert.equal(line, "изменить тренировку 123: title, distancePlanned");
  });
  test("delete_workout", () => {
    assert.equal(buildWriteActionSummaryLine("delete_workout", { workoutId: 999 }), "удалить тренировку 999");
  });
  test("batch counts children", () => {
    const line = buildWriteActionSummaryLine("batch", { children: [{}, {}, {}] });
    assert.equal(line, "пакет из 3 действий");
  });
  test("never throws on a malformed payload -- falls back to the type label", () => {
    assert.doesNotThrow(() => buildWriteActionSummaryLine("create_workout", null));
    assert.doesNotThrow(() => buildWriteActionSummaryLine("create_workout", "garbage"));
    assert.doesNotThrow(() => buildWriteActionSummaryLine("create_workout", 42));
  });
});

describe("buildWriteActionDetailCard", () => {
  test("create_workout includes athlete, title, date, duration", () => {
    const card = buildWriteActionDetailCard(
      "create_workout",
      { athleteId: 3102415, title: "Long run", workoutDay: "2026-12-05", totalTimePlanned: 1.5 },
      "Nadia",
    );
    assert.match(card, /Атлет: Nadia/);
    assert.match(card, /Название: Long run/);
    assert.match(card, /Дата: 05\.12\.2026/);
    assert.match(card, /Длительность: 90 мин/);
  });

  test("create_workout falls back to athleteId when no student name is known", () => {
    const card = buildWriteActionDetailCard("create_workout", { athleteId: 3102415, title: "Run", workoutDay: "2026-12-05" }, null);
    assert.match(card, /Атлет ID: 3102415/);
  });

  test("create_workout summarizes cardio structure (steps + repetitions)", () => {
    const structure = {
      structure: [
        { type: "step", steps: [{ name: "Warmup", length: { value: 600 }, targets: [{ minValue: 60, maxValue: 70 }] }] },
        {
          type: "repetition",
          length: { value: 4 },
          steps: [{ name: "Hard", length: { value: 180 }, targets: [{ minValue: 90, maxValue: 100 }] }],
        },
      ],
    };
    const card = buildWriteActionDetailCard(
      "create_workout",
      { athleteId: 1, title: "Intervals", workoutDay: "2026-12-05", structure },
      null,
    );
    assert.match(card, /Warmup, 10 мин, 60-70%/);
    assert.match(card, /4× \[Hard, 3 мин, 90-100%\]/);
  });

  test("strength_workout lists exercises with set count and prescribed value", () => {
    const blocks = [
      {
        title: "Single Leg Calf Raise",
        prescriptions: [
          {
            sets: [{ parameterValues: [{ parameter: "RepsPerSide", prescribedValue: "12" }] }],
          },
        ],
      },
    ];
    const card = buildWriteActionDetailCard(
      "strength_workout",
      { athleteId: 1, title: "Leg day", prescribedDate: "2026-12-06", blocks },
      null,
    );
    assert.match(card, /1\. Single Leg Calf Raise — 1 подход\(ов\) — 12 RepsPerSide/);
  });

  test("update_workout lists each changed field", () => {
    const card = buildWriteActionDetailCard("update_workout", { workoutId: 123, fields: { title: "New title" } }, null);
    assert.match(card, /title → "New title"/);
  });

  test("delete_workout warns that rollback is unavailable", () => {
    const card = buildWriteActionDetailCard("delete_workout", { workoutId: 123 }, null);
    assert.match(card, /Откат недоступен/);
  });

  test("batch lists each child's label", () => {
    const card = buildWriteActionDetailCard(
      "batch",
      { children: [{ label: "Move #1" }, { label: 'Create "Long run"' }] },
      null,
    );
    assert.match(card, /1\. Move #1/);
    assert.match(card, /2\. Create "Long run"/);
  });
});

describe("buildWriteActionQueuedMessage / buildWriteActionBlockedMessage / buildWriteActionResultMessage", () => {
  test("queued message names the action type, never claims TrainingPeaks changed", () => {
    const message = buildWriteActionQueuedMessage("create_workout");
    assert.match(message, /Создание тренировки/);
    assert.match(message, /TrainingPeaks пока не изменён/);
  });
  test("blocked message includes the reason when given", () => {
    const message = buildWriteActionBlockedMessage("update_workout", "Payload changed since the dry-run was approved.");
    assert.match(message, /Payload changed since the dry-run was approved\./);
  });
  test("blocked message omits a reason line when none is given", () => {
    const message = buildWriteActionBlockedMessage("update_workout", null);
    assert.equal(message.split("\n").length, 1);
  });
  test("result message on success does not include an error", () => {
    const message = buildWriteActionResultMessage("delete_workout", { ok: true });
    assert.match(message, /✅/);
    assert.doesNotMatch(message, /❌/);
  });
  test("result message on failure includes the error text", () => {
    const message = buildWriteActionResultMessage("delete_workout", { ok: false, errorMessage: "HTTP 500" });
    assert.match(message, /❌/);
    assert.match(message, /HTTP 500/);
  });
});

describe("buildBatchPreviewCard", () => {
  const children = [
    { actionType: "create_workout" as const, payload: { athleteId: 1, workoutDay: "2026-12-05", totalTimePlanned: 1 }, label: 'Create "Long run" on 2026-12-05' },
    { actionType: "strength_workout" as const, payload: { athleteId: 2, prescribedDate: "2026-12-06", totalTimePlanned: 0.5 }, label: 'Create strength "Leg day" on 2026-12-06' },
  ];

  test("shows aggregate (athletes, action count, breakdown, volume) before anything else", () => {
    const card = buildBatchPreviewCard(computeBatchAggregate(children), [], children);
    assert.match(card, /Атлетов: 2/);
    assert.match(card, /Действий: 2/);
    assert.match(card, /создание × 1/);
    assert.match(card, /силовая × 1/);
    assert.match(card, /Суммарно: 1\.5 ч/);
  });

  test("says 'no anomalies' explicitly when there are none -- not just a blank section", () => {
    const card = buildBatchPreviewCard(computeBatchAggregate(children), [], children);
    assert.match(card, /Аномалий не обнаружено/);
  });

  test("anomalies render as their own block, naming the athlete and the reason", () => {
    const card = buildBatchPreviewCard(computeBatchAggregate(children), [
      { kind: "race_proximity", athleteId: 1, studentName: "Nadia", detail: "тренировка 2026-12-05 — за 3 дн. до старта 2026-12-08" },
    ], children);
    assert.match(card, /⚠️ Аномалии \(1\):/);
    assert.match(card, /Nadia — близко к старту/);
  });

  test("falls back to 'атлет N' when no student name is known", () => {
    const card = buildBatchPreviewCard(computeBatchAggregate(children), [
      { kind: "active_health_signal", athleteId: 42, studentName: null, detail: "есть активный health-сигнал" },
    ], children);
    assert.match(card, /атлет 42 — активный health-сигнал/);
  });

  test("caps the per-item list and says how many more there are", () => {
    const manyChildren = Array.from({ length: 15 }, (_, i) => ({
      actionType: "create_workout" as const,
      payload: { athleteId: 1 },
      label: `Item ${i + 1}`,
    }));
    const card = buildBatchPreviewCard(computeBatchAggregate(manyChildren), [], manyChildren);
    assert.match(card, /Item 10/);
    assert.doesNotMatch(card, /Item 11\b/);
    assert.match(card, /\.\.\.и ещё 5/);
  });

  test("empty batch never throws", () => {
    assert.doesNotThrow(() => buildBatchPreviewCard(computeBatchAggregate([]), [], []));
  });
});
