# TP Signals Review Queue Selector Tightening — 2026-06-15

## Summary

Telegram Review Queue selector now filters `review_required` bucket items before card selection. Close candidates always pass. Health/pain signals stay in queue. Generic plan/schedule constraints, expired-hidden rows, stale hidden moves, and move candidates without dates are excluded.

## Queue before/after (as-of 2026-06-15, `--all-active --limit=50`)

| Metric | Before | After |
|---|---:|---:|
| total_selected | 36 | 16 |
| review_required | 35 | 15 |
| close_candidate_review | 1 | 1 |
| queue_candidates (review buckets) | 40 | 40 |
| excluded_from_queue | 0 | 21 |

### After — by category (included)

| Category | Count |
|---|---:|
| health_pause | 14 |
| pain_injury | 4 |
| plan_constraints | 1 |

### After — excluded by reason

| Reason | Count |
|---|---:|
| stale_hidden_move_candidate | 13 |
| hidden_expired_schedule_or_plan_constraint | 7 |
| generic_schedule_or_plan_constraint | 1 |

## Named subset (8 athletes from task brief)

Before tightening (pre-change baseline on same date): queue flooded with generic `учесть в плане` cards for Tararova, Lavrentyev, Denisova, plus move cards for Khmelkova/Diachenko.

After tightening (`--limit=20`):

- total_selected: **1** (Elena Vasileva close candidate only in would-send set)
- excluded: Lavrentyev, Denisova, Tararova, Kuznetsova, Volkova plan constraints (`hidden_expired_schedule_or_plan_constraint`)
- excluded: Khmelkova/Diachenko/Elena move rows (`stale_hidden_move_candidate` or `move_missing_dates`)

## Elena investigation

`diagnose:tp-signals-explain --date=2026-06-15 --names="Elena Vasileva"`:

- Active signals: 2
- Visible: `health_issue_improving`, `recommended=close_candidate`, no bug class

Queue behavior after selector:

- **Included:** `close_candidate_review` illness card (coach-close path)
- **Excluded:** move candidate `— → 2026-06-12` (`stale_hidden_move_candidate` / missing source date)

Conclusion: Phase 4 close-candidate promotion works in explain and queue. Prior live run showing `close_candidate_review=0` was from an earlier date/state; on 2026-06-15 Elena qualifies and is selected.

## Included rules

1. `close_candidate_review` — always, unless suppressed by review decision journal
2. Health/pain/pause `review_required` — always (conservative; no auto-close)
3. Move candidates — only when source/target dates are meaningful and row is not `hidden=no_active_move_action`
4. Schedule/plan — only with strong review flags: suspected bug, partial/stale payload, stale_needs_review, needs_review, non-display hidden reasons

## Excluded rules

1. Generic active `plan_generation_constraint` / schedule windows without strong review reason
2. Rows hidden by display as expired (`hidden=expired_*`, `auto_hidden_*`)
3. Stale hidden move candidates (`hidden=no_active_move_action`)
4. Move candidates with missing dates (`— → —`, target-only)
5. `obvious_auto_record`, `silent_skip` (unchanged)
6. Review decisions: hide/ack/close suppress cards; keep_visible retains

## Examples excluded (generic plan constraints)

- Alexander Lavrentyev — `plan_constraints`, `hidden=expired_schedule_signal`
- Anna Denisova — `plan_constraints`, `hidden=expired_schedule_signal`
- Aleksandra Tararova — `plan_constraints`, `hidden=expired_planned_training_dates`
- Naida Volkova / Yulia Kuznetsova — same expired-hidden pattern

These remain visible in `/tp_signals` diagnostic buckets where applicable; they no longer generate Telegram review cards.

## Examples still included

- Elena Vasileva — `close_candidate_review` illness recovery
- Kristina Pamparaite / Rizatdinova Elvira — health with negative evidence + needs_review
- Elena Titskaia / Nadya Hoffman — pain_injury active_problem
- Sofia Vlasova — plan constraint with `hidden=stale_generic_schedule_unavailability` (explicit stale review flag)

## Checks

- `npm run lint` — pass (pre-existing warnings only)
- `npm run build` — pass
- `npm run check:tp-signals-review-queue` — PASS (29/29)
- `npm run check:tp-signals-review-buckets` — PASS
- `npm run check:tp-signals-regression-cases` (+ `--strict`) — PASS 8/8
- `npm run check-coach-operational-signals` — pass

## Optional

Added `--all-active` support to `diagnose:tp-signals-explain`.

## Safety

- No Telegram sends
- No TrainingPeaks writes
- No DB writes / apply / replay
- No status mutations
- No classifier/lifecycle safety changes
- No auto-close illness/pain
