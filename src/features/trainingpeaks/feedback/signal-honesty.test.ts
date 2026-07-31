import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { robustFadeSecPerKm, endedSlower, hrClimbed, isHonestFade } from "./signal-honesty.ts";

// Olga 07-31: rolling start then a flat/faster body, last rep among her fastest → NOT a fade.
const OLGA = [380, 307, 301, 312, 317, 315, 306, 306, 307, 307, 302, 320, 298, 306, 310, 307];
// Genuine end-loaded fade: steady front, blows up at the end.
const REAL_FADE = [300, 300, 302, 305, 320, 340];
// Faded in the middle but RECOVERED by the end (last rep back to front pace).
const RECOVERED = [300, 300, 340, 300, 300];

describe("robustFadeSecPerKm — back half vs front half, rep 1 dropped", () => {
  test("Olga's series is not slower in the back half (≈0/negative)", () => {
    const f = robustFadeSecPerKm(OLGA);
    assert.ok(f !== null && f < 8, `expected <8, got ${f}`);
  });
  test("a genuine end fade is clearly positive", () => {
    const f = robustFadeSecPerKm(REAL_FADE);
    assert.ok(f !== null && f >= 8, `expected ≥8, got ${f}`);
  });
  test("too few reps → null", () => {
    assert.equal(robustFadeSecPerKm([300, 305, 310]), null); // 3 reps → after dropping rep1, <3 body
    assert.equal(robustFadeSecPerKm(null), null);
  });
});

describe("endedSlower — did the series end harder (not recover)", () => {
  test("Olga recovered (fastest reps in the back half) → false", () => {
    assert.equal(endedSlower(OLGA), false);
  });
  test("end-loaded fade → true", () => {
    assert.equal(endedSlower(REAL_FADE), true);
  });
  test("recovered by the end → false", () => {
    assert.equal(endedSlower(RECOVERED), false);
  });
});

describe("isHonestFade — sign + threshold + not recovered", () => {
  test("Olga (flagship false positive) → NOT a fade", () => {
    assert.equal(isHonestFade(OLGA), false);
  });
  test("genuine end fade → fade", () => {
    assert.equal(isHonestFade(REAL_FADE), true);
  });
  test("recovered-by-end → NOT a fade even if back-half mean is up", () => {
    assert.equal(isHonestFade(RECOVERED), false);
  });
  test("a small 5 s/km wobble under the 8 floor → NOT a fade", () => {
    assert.equal(isHonestFade([300, 300, 302, 300, 305, 306]), false);
  });
});

describe("hrClimbed — HR corroboration for «тяжелее»", () => {
  test("last peak-HR over first by ≥6 → true", () => {
    assert.equal(hrClimbed([170, 175, 178], true), true);
  });
  test("flat HR → false (held effort even, not fatigue)", () => {
    assert.equal(hrClimbed([180, 181, 179], true), false);
  });
  test("untrusted HR never corroborates", () => {
    assert.equal(hrClimbed([170, 178, 188], false), false);
  });
  test("too few HR points → false", () => {
    assert.equal(hrClimbed([170, 190], true), false);
  });
});
