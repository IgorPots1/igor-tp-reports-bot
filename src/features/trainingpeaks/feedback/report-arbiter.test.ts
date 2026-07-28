import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildArbiterPrompt, isReportCandidate, resolveArbiterDecision } from "./report-arbiter-ai.ts";

describe("isReportCandidate — generous prefilter", () => {
  test("report_like / weak labels always qualify", () => {
    assert.equal(isReportCandidate("что угодно", ["report_like"]), true);
    assert.equal(isReportCandidate("готово", ["weak_report_confirmation"]), true);
  });
  test("keyword-less real reports still forward (digit / done-word / ✅)", () => {
    assert.equal(isReportCandidate("55:55", []), true); // bare time
    assert.equal(isReportCandidate("Легкую сделала, все хорошо", []), true); // done-word
    assert.equal(isReportCandidate("Длительная ✅ отлично", []), true); // check-mark
    assert.equal(isReportCandidate("Нелегкая трасса но все отлично прошло", []), true); // «прошло»
  });
  test("obvious non-candidates skip Haiku", () => {
    assert.equal(isReportCandidate("Спасибо большое", []), false);
    assert.equal(isReportCandidate("👍", []), true); // emoji is cheap-forward; fine (Haiku will say not_report)
    assert.equal(isReportCandidate("", []), false);
    assert.equal(isReportCandidate("ок", []), false);
  });
});

describe("resolveArbiterDecision — verdict → sweep decision (with regex fallback)", () => {
  test("AI report → create card", () => {
    assert.deepEqual(resolveArbiterDecision({ aiLabel: "report", isReportLike: false, isWeak: false }), { kind: "report", weak: false });
  });
  test("AI clarification → enrichment", () => {
    assert.deepEqual(resolveArbiterDecision({ aiLabel: "clarification", isReportLike: true, isWeak: false }), { kind: "clarification", weak: false });
  });
  test("AI not_report → drop even if regex said report_like (cuts the false positive)", () => {
    assert.deepEqual(resolveArbiterDecision({ aiLabel: "not_report", isReportLike: true, isWeak: false }), { kind: "drop", weak: false });
  });
  test("null (arbiter off/errored) falls back to regex: report_like → report", () => {
    assert.deepEqual(resolveArbiterDecision({ aiLabel: null, isReportLike: true, isWeak: false }), { kind: "report", weak: false });
  });
  test("null fallback: weak → report with the weak start-time gate", () => {
    assert.deepEqual(resolveArbiterDecision({ aiLabel: null, isReportLike: false, isWeak: true }), { kind: "report", weak: true });
  });
  test("null fallback: neither → drop (unchanged pre-arbiter behaviour)", () => {
    assert.deepEqual(resolveArbiterDecision({ aiLabel: null, isReportLike: false, isWeak: false }), { kind: "drop", weak: false });
  });
});

describe("buildArbiterPrompt", () => {
  test("carries the run-context flag both ways", () => {
    assert.match(buildArbiterPrompt("x", true), /БЫЛА беговая тренировка/u);
    assert.match(buildArbiterPrompt("x", false), /НЕ БЫЛА беговая тренировка/u);
  });
  test("delayed-report clause is present (Voronina fix)", () => {
    const p = buildArbiterPrompt("забыла отписать про интервалы", false);
    assert.match(p, /ЗАПОЗДАЛЫЙ отчёт/u);
    assert.match(p, /Если прежнего отчёта не было — это report/u);
  });
});
