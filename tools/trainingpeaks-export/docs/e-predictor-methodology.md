# E-Predictor Methodology

E-Predictor is an internal, coach-facing race prediction engine for TrainingPeaks athletes. It produces conservative / likely / optimistic finish-time ranges from race results, key workouts, segment evidence, and training load — not athlete-facing copy or automated coaching decisions.

Current implementation lives in `scripts/tp-race-prediction-probe.ts` (`deterministic_v2_segment_aware`). Methodology numbers are externalized in `config/e-predictor-constants.json` so tuning does not require editing prediction code.

## Why constants are externalized

Phase A adds a single config surface and validation script. The probe still uses inline constants today; Phase B will load this file without changing the intended model. Externalizing values makes it easier to:

- review and tune methodology as a team
- diff config changes separately from code changes
- validate invariants (weight sums, required distances, numeric thresholds) in CI

Run validation:

```bash
npm run check-e-predictor-constants
```

## Race anchor tiers

Anchors come from the race-results probe (`tp-probe-race-results`). Selection priority:

| Tier | Kind | Role |
|---|---|---|
| 1 | `official_best` | Best verified race on target distance |
| 2 | `official_flagged` | Official result with data-quality flags |
| 3 | `probable_best` | Strong non-official race signal |
| 4 | `clean_training_best` | Best clean training simulation on distance |
| — | `needs_coach_review` | Excluded unless `--include-review-anchors` |

Cross-distance anchors can be converted to the target distance via Riegels formula (`riegel.default_exponent`, default 1.06). Freshness windows (`freshness_windows_days`) limit how old an anchor may be before it loses weight.

## Training-implied anchors

When no official anchor exists on the target distance, E-Predictor can infer a pace anchor from training evidence. This is **specified in config but not wired yet** (Phase B).

Half-marathon implied anchor (`half_marathon.training_implied_anchor`) will require:

- minimum analysis window and threshold workouts
- long-run durability (count ≥14 km, longest run vs race distance)
- pace offset by finish band (`pace_offset_seconds_per_km_by_finish_band`)
- durability penalty when long-run gates are only partially met

Example gap today: Anna Kruglova half without an official anchor is underestimated because this path is not implemented.

## Distance-specific readiness weights

`distance_layer_weights` defines how much each readiness layer contributes to overall confidence by distance:

- **5k / 10k** — anchor + interval specificity dominate
- **half** — threshold readiness and endurance share weight with anchor
- **marathon** — endurance and consistency matter most; interval specificity is minor

Each distance row must sum to 1.0. Layers: `anchor_quality`, `interval_specificity`, `threshold_readiness`, `endurance`, `consistency`, `taper`, `data_quality`.

## Half marathon without official anchor

Planned logic (config only for now):

1. Build implied pace from usable threshold/tempo segment evidence
2. Apply finish-band pace offset (slower targets get larger offset per km)
3. Check long-run gates (`long_run_gates.half`: ≥70% of race distance, good long run ~15 km)
4. Apply durability penalty (`cleared` / `partial` / `weak`)
5. Cap confidence at `max_confidence_without_race_anchor` (`medium`)

Without step 1–4, the probe falls back to a generic pace baseline and marks insufficient data — wide range, low confidence.

## Segment vs whole-workout rules

Segment-aware evidence is preferred when planned segments parse and compare to actual FIT/lap data.

**Use segment evidence when:**

- completion ratio ≥ 0.75 and fade ≤ 6% → neutral/positive
- work reps are comparable in pace and duration

**Downgrade or exclude when** (`segment_quality`):

- completion ratio below 0.75
- pace spread across reps above 18%
- any rep >25% slower than fastest rep
- rep-to-rep fade above 6%
- critical data-quality flags (e.g. missing segments)

Warning/unusable segment workouts do not improve the prediction; they may widen the conservative spread.

Whole-workout average pace is a fallback only — never treated as strong interval/threshold evidence.

## Confidence and range philosophy

Three scenarios: **conservative**, **likely**, **optimistic**.

`range_spread` sets base spread by confidence band (`high` → `low`, plus `medium_low`). The engine widens conservative side further when data is thin, taper is poor, or segment warnings exist. Optimistic is capped by fastest usable segment evidence when available.

`refusal_thresholds` define when to refuse or emit a very wide orienting range: low data quality, too few weeks, or missing anchor and missing training-implied anchor.

Coach-facing output emphasizes ranges and limitations, not a single “predicted time.”

## Planned later (not in Phase A)

- **Coach target hint** — soft blend of coach `--target-time` (already partially supported in probe at 15% weight; config may formalize this)
- **Prediction accuracy log** — post-race comparison of predicted vs actual for calibration
- **Config wiring** — load `e-predictor-constants.json` into `tp-race-prediction-probe.ts` (Phase B)

## Audience

E-Predictor output is for coaches reviewing athlete readiness before a race. It is not sent to athletes via Telegram and does not write to Supabase or mutate TrainingPeaks data.
