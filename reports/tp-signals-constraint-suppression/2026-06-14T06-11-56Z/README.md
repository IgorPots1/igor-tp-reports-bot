# TP Signals Phase 3 — Conservative non-run / question / errand constraint suppression

Date: 2026-06-14
Branch: `tp-signals-pending-mutation-replay`
Scope: forward classifier / candidate suppression only. No DB / Telegram / TP writes.

## Summary

Class C of the stale-visible audit (`AUDIT_tp_signals_2026-06-13.md`) flagged messages that
are **not** hard running-plan constraints but were surfaced in `/tp_signals` as
`plan_generation_constraint`:

- strength-only reshuffle without any running impact (Katerina);
- a soft "can I do an easy/ordinary session?" question without hard unavailability (Sofia);
- a non-training errand without training impact (grigori).

The fix adds three **narrow, conservative** suppressions inside the deterministic schedule
classifier so these shapes no longer produce a hard plan constraint, while every real
operational constraint (run unavailable, run reschedule, availability windows,
travel+unavailability, strength-blocks-run, illness/pain) is preserved.

Design note: all three positive controls resolve to their signals (`move_workout_candidate`
/ `pause_training`) **before** `buildScheduleCandidate` is reached, so the suppressions
cannot create false negatives for them. The suppressions live only in the schedule-candidate
branches that produced the false positives.

## Files changed

- `src/features/trainingpeaks/coach-operational-signals.ts`
  - New helpers above `buildScheduleCandidate`:
    - `hasHardTrainingConstraintCue` — shared "this is a real constraint" guard.
    - `isStrengthOnlyReshuffleWithoutRun` (Pattern 1).
    - `isSoftSessionQuestionWithoutHardConstraint` (Pattern 2).
    - `isNonTrainingErrandWithoutTrainingImpact` (Pattern 3).
    - Constants `NON_TRAINING_ERRAND_CUES`, `RUNNING_WORKOUT_REQUEST_CUES`.
  - Branch "date-based schedule constraint with logistics cue": returns `null` for a
    non-training errand without running mention / unavailability (Pattern 3).
  - Branch "week-scoped training availability without explicit weekdays": skipped when the
    message is a strength-only reshuffle (Pattern 1) or a soft easy-session question
    (Pattern 2).
- `scripts/check-coach-operational-signals.ts`
  - 8 new deterministic Phase-3 fixtures (3 negative + 1 real-text negative + 1 guard
    positive + 3 positive controls).

## Suppressions added

1. **Strength-only reshuffle** — `STRENGTH_CONTEXT_CUES` present, no training-unavailability
   cue, no explicit **running workout request/plan** (`RUNNING_WORKOUT_REQUEST_CUES`:
   бегать/побегать/пробежк/беговую/…), and no "strength blocks the run" cue
   (`не ставить интервалы`). A bare incidental mention of running ("к бегу привыкаю") does
   **not** block suppression; an actual running request/plan does.

2. **Soft preference/question** — contains `можно` + an easy/ordinary-session word
   (обычн/восстанов/лёгк/спокойн/полегче) and **no** hard cue
   (не могу/не смогу/не буду/не получится/перенес/уезжа/уеду, running cue, training
   unavailability).

3. **Non-training errand** — car/documents/shopping/admin errand cue
   (`NON_TRAINING_ERRAND_CUES`) with no running mention and no training-unavailability cue.

## Fixtures added (`check-coach-operational-signals`)

Negative (suppressed → `skip` / `signal_type: null`):
- `phase3-katerina-strength-only-reshuffle-suppressed` (audit paraphrase)
- `phase3-katerina-strength-only-with-incidental-run-mention-suppressed` (real persisted text)
- `phase3-vlasova-easy-session-question-suppressed`
- `phase3-grigori-car-errand-suppressed`

Positive controls (must stay captured):
- `phase3-positive-strength-plus-run-unavailable-captured` → `move_workout_candidate`
- `phase3-positive-errand-plus-run-unavailable-captured` → `pause_training`
- `phase3-positive-question-with-explicit-run-move-captured` → `move_workout_candidate`
- `phase3-strength-with-explicit-run-plan-stays-constraint`
  ("можно пробежку и силовые во вторник?") → `schedule_availability_window`

## Before / after (forward classifier, real source texts from live explain)

| Source text | Before | After |
|---|---|---|
| `…можно мне силовые на сегодня переставить, а то к бегу привыкаю…` (Katerina) | `plan_generation_constraint` | `skip` (no signal) |
| `а можно сегодня обычную тренировку? восстановиться` (Sofia) | `plan_generation_constraint` | `skip` (no signal) |
| `но я только в понедельник поеду за новой машиной` (grigori) | `plan_generation_constraint` | `skip` (no signal) |

## Positive controls preserved

- `силовую можно перенести, бег сегодня не смогу` → `move_workout_candidate` (unchanged).
- `в понедельник поеду за машиной, поэтому бегать не смогу` → `pause_training` (unchanged).
- `можно перенести беговую тренировку с сегодня на завтра?` → `move_workout_candidate` (unchanged).
- `можно пробежку и силовые во вторник?` → `schedule_availability_window` (running request kept).
- Live explain (`--date=2026-06-13`): legit rows remain visible — Aleksandra Tararova,
  Yulia Kuznetsova, plus the pain + plan-constraint rows for Anna Denisova and Alexander
  Lavrentyev (governed by Phase 2 expiry).
- `возможно 12 или 13 поеду в Москву` regression case (travel constraint) stays
  `plan_generation_constraint` — errand cues deliberately exclude travel-to-city.

## Existing live rows

The live `diagnose:tp-signals-explain` run (`--no-write`) still shows **active persisted**
`plan_generation_constraint` rows for Katerina, Sofia, and grigori
(e.g. Katerina `signal_id=29bcac43-…`, `valid_until=2026-06-14`). These are **pre-fix rows
written before this change** — the classifier fix is forward-only and this task performs no
DB mutation. They require a separate manual button-hide or a separate guarded cleanup; they
are **not** a failure of the forward classifier (newly arriving messages of these shapes no
longer create such rows, verified by deterministic fixtures and re-classification of the
real source texts).

## Checks run / results

- `npm run lint` → 0 errors (13 pre-existing warnings in unrelated `tools/` files).
- `npm run build` → exit 0.
- `npm run check:tp-signals-review-queue` → PASS (20/20)
- `npm run check:tp-signals-review-buckets` → PASS (9/9)
- `npm run check:tp-signals-review-pending-mutations` → PASS (16/16)
- `npm run check:tp-signals-schedule-expiry` → PASS (10/10)
- `npm run check:tp-signals-regression-cases` → pass=8/8
- `npm run check:tp-signals-regression-cases -- --strict` → pass=8/8
- `npm run check:tp-signals-full-output` → PASS
- `npm run check-coach-operational-signals` → all deterministic checks passed (incl. 8 new Phase-3)
- `npm run diagnose:tp-signals-explain -- --date=2026-06-13 --names="…" --no-write` →
  read-only; persisted pre-fix rows still visible (see above); legit rows preserved.

## Remaining limitations

- Suppression is intentionally deterministic and narrow. Strength-only suppression keys on
  the absence of an explicit running-workout request; an unusual phrasing that combines a
  genuine running constraint with no run-workout keyword and no unavailability cue would not
  be suppressed (kept visible = safe-by-default).
- Existing persisted false-positive rows are unchanged (forward-only fix). Hiding them is a
  separate, explicitly-authorized cleanup step.
