# Threshold pace / threshold HR estimation — method

READ-ONLY analysis. No TrainingPeaks calls, no writes anywhere. Source:
`tools/trainingpeaks-export/scripts/tp-threshold-estimation.ts` (+ renderer
`render-threshold-table.ts`). Output: `action-artifacts/threshold-estimation/`
(gitignored — regenerate by re-running the script; results are a point-in-time
snapshot, not stored data).

Never prints/stores athlete names — athlete_id only.

## What it estimates

For each roster athlete, over the last ~6 months of ingested FIT-derived
workouts: an estimated **threshold pace** (sec/km) and **threshold HR** (bpm),
compared against the athlete's *current* TP zone-setting threshold (from
`tp_zone_snapshots`, the `workoutTypeId: 0` set — see `docs/tp-write-payloads.md`
§1 for that shape; speed threshold is stored in m/s, converted here via
`1000 / threshold_mps`).

## Evidence tiers

| Tier | Source | What's measured |
|---|---|---|
| **A** | 10km races (`trainingpeaks_race_events`, distance 9.5–10.5km) | pace + avg HR of the **second half**, split by cumulative distance at the 50% mark (ported from `feedback/split-half.ts`'s `computeSplitHalf`) |
| **B** | Other race distances (5k, half, marathon, unclassified) | same second-half split; distance bucketed as `B_5k` (4.5–5.5km), `B_half` (20–21.6km), `B_marathon` (41.5–43km), else `B_other` |
| **C** | Continuous tempo runs, `steady_duration_s >= 1200` (20min), `reps_detected_count = 0`, **AND title-matched as an intentional tempo effort** | pace + avg HR of the **last 2/3** by cumulative distance (same split logic, cut at the 33% mark) |
| **D** | Long interval reps ≥6min each | per-rep pace/peak-HR, already computed and HR-cleaned by the ingest pipeline (`derived_metrics.rep_paces` / `rep_peak_hrs`); only reps whose reconstructed lap-block duration is ≥360s qualify |

### Why tier C requires a title match (important correction made during this analysis)

There is no persisted intensity classifier in this codebase — `workout_type` is
sport-family only (`run`/`bike`/…), `time_in_zones` is relative to max HR (no
threshold profile exists to base it on), and `planned_target` is unpopulated.
A first version of this script flagged **any** steady (non-interval) run
≥20min as "tempo evidence." That silently included ordinary easy and long
runs — verified by the result: it produced a 20–48% pace "gap" for most of the
roster, a systematic bias, not a real finding.

Fix: tier C additionally requires the workout **title** to match an explicit
tempo/threshold label. Bare Russian "темп" was tried first and rejected — it's
a false friend (it just means "pace" and appears in titles like "Легкий бег по
темпу" = *easy* run, or "в темпе марафона" = marathon pace). The final filter:

- **Positive:** `темпов` stem (Темповый/темповая бег), or `tempo`/`threshold`/`порог`.
- **Negative (any of these vetoes the match):** an easy marker (`легк`/`easy`),
  a marathon-pace marker (`марафон`/`marathon`), or an interval-repetition
  pattern (`8 x 1000`, `3 х 16`) — guards against a disguised interval slipping
  through when lap-based rep detection didn't find laps to mark tempo run as intervals structured (i.e., reps_detected_count read 0 anyway).

Consequence: tier C evidence is now rare (1 workout roster-wide in the last run)
— precision over recall, matching "round down on ambiguity." Most athletes'
estimates now rest on tier A/B (races) or tier D (long reps) instead.

## Threshold-conversion offsets

Each tier's raw measurement is converted with `threshold_estimate = evidence_value + offset`.
Offsets are literature-grounded coaching heuristics (Daniels/Friel-style
race-pace-to-LT-pace and RPE-to-LTHR relationships) — **not** derived from this
roster's own data. Treat estimates as directional, not clinical.

| Tier | Pace offset (sec/km) | HR offset (bpm) | Rationale |
|---|---|---|---|
| A (10k) | 0 | 0 | 10k race pace/HR is the classic direct proxy for threshold (~40–55min effort) |
| C (tempo, last 2/3) | 0 | 0 | This *is* the textbook LT field-test definition (20–60min steady effort) |
| B (half) | −6 | +3 | Half-marathon is run slightly faster than pure threshold for most sub-elite runners (HM duration usually well over the ~60min LT-effort window) |
| B (5k) | +14 | −4 | 5k is run meaningfully faster/harder than threshold |
| B (marathon) | −32 | +8 | Marathon pace/HR is meaningfully below threshold for recreational marathoners |
| B (other/unclassified distance) | 0 | 0 | No distance-specific adjustment — lowest-confidence bucket |
| D (intervals ≥6min) | +10 | −3 | Reps of this duration, run with recovery between them, are typically a bit faster/harder than sustainable threshold pace |

Sign convention: **positive offset = evidence was run faster/easier than true
threshold** (add seconds to slow down, or add bpm to raise the HR estimate);
negative = evidence was harder/slower than threshold (subtract to correct).

## Picking the estimate when an athlete has multiple tiers

Priority order (most direct proxy first): **A → C → B_half → B_5k →
B_marathon → B_other → D**. The athlete's highest-priority tier with usable
data wins; pace and HR are chosen independently (an athlete can have a pace
estimate from one tier and no usable HR from that same tier, e.g. if HR was
untrusted for those specific workouts — the table's `n` column always reflects
whichever tier was actually used).

## Combining multiple workouts within the chosen tier ("round down on ambiguity")

- **≥3 evidence points:** use the **median**.
- **<3 evidence points** (too little to trust a median): use the **more
  conservative** single value — the *slowest* pace / *lowest* HR among what's
  available, rather than risk overestimating from one favorable data point.

Final pace is rounded **up** (slower, `Math.ceil`) and final HR rounded **down**
(`Math.floor`) — i.e. rounding always resolves toward the less-aggressive
threshold, per the "round down on ambiguity" instruction.

**Caveat on `n`:** a handful of athletes rest on a single race (n=1). One
observed case swung to a +72% pace discrepancy from a single race match —
almost certainly a bad single data point (e.g. a partial/short race day), not
a real 72% zone miscalibration. Treat any `n=1` or `n=2` row as a hint to
re-verify manually, not a standalone verdict.

## HR quality gate

Two layers, both must pass for an HR data point to be used:

1. **`derived_metrics.hr_trusted`** (already computed at ingest): `hr_quality`
   is `good`/`degraded` (not `unreliable`/absent) AND no rep's peak HR is
   outside a 130–205bpm sanity band. This catches spikes, cadence-lock
   (HR tracking cadence×2 — a common footpod/optical artifact), and
   implausible peaks.
2. **Suspiciously-flat check (added here):** the existing pipeline has no
   stuck/flat-line detector. This script adds one: if avg HR barely varies
   (<3bpm range) across laps whose **pace** varies meaningfully (>10%), the HR
   sensor almost certainly stuck (a known wrist-optical failure mode) —
   discarded regardless of `hr_trusted`.

Filtered counts are reported in the aggregates (not silently dropped).

## Distance/pace sanity

Any computed segment pace outside 3:00–9:30/km (matching the existing
whole-workout sanity bounds in `fit-data-sanity.ts`) is discarded, not just
flagged — a wildly implausible pace means the underlying lap distance/time is
corrupted, not that the athlete ran that fast/slow.

## Known limitations

- No per-second time-series is persisted (only lap-level detail) — "last 2/3"
  and "second half" are computed at lap granularity: a lap is assigned whole
  to whichever segment its own midpoint falls in, never split.
- Tier D's rep-pace/rep-HR values are the ingest pipeline's own (already
  distance-weighted, HR-cleaned) numbers; this script only reconstructs
  **block durations** from laps to filter for ≥6min reps, and discards a
  workout entirely (639 in the last run) if the reconstructed block count
  doesn't match `rep_paces.length` — i.e. if lap data is incomplete/inconsistent
  for that workout, rather than guessing at index alignment.
- Race matching requires an **exact** `workout_date` match between
  `trainingpeaks_race_events` and the corresponding `derived_metrics` row —
  a race logged under a different date (rare) would be missed rather than
  fuzzy-matched.
- Coefficients are generic heuristics, not calibrated per-athlete or
  per-experience-level (a very well-trained runner's HM-to-threshold gap is
  smaller than the table above assumes; a novice's is often larger).
