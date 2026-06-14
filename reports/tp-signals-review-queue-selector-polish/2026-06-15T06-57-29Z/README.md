# TP Signals Review Queue Selector Polish (Phase 5b)

- Generated at: 2026-06-15T06:57:29Z
- As-of date: 2026-06-15
- Scope: review queue inclusion + priority fix

## Problem (before)

Live smoke with `--all-active --limit=5 --send` showed:

- `close_candidate_review: 0` in selected counts despite Elena Vasileva and Stepan Trofimov being `included=true` close candidates in diagnostics.
- Root cause: sort put `review_required` before `close_candidate_review`; limit sliced review cards first.
- Hidden rows (`recommended=hidden`, `hidden=auto_hidden_clean_recovery_run`, `hidden=superseded_signal_hidden`, `hidden=stale_generic_schedule_unavailability`) were included as normal review cards because health/pain types bypassed hidden checks.

## Fix summary

1. **Hidden exclusion**: `resolveHiddenDisplayQueueExclusion` excludes `recommended=hidden`, any `hidden=...` reason, or non-visible rows with `hidden_display_state` — except `close_candidate_review` bucket (always first-class).
2. **Priority sort**: close candidates → health/pain with `latest_negative_evidence` → other health/pain → moves → other.
3. **Diagnostics**: split counts into *before limit* vs *selected after limit*, plus category and exclusion reason breakdowns.

## After — `--all-active --limit=5 --no-write`

```
Queue candidates before limit:
- included_before_limit: 5
- excluded_from_queue: 28
- review_required: 4
- close_candidate_review: 1

Selected for send after limit:
- total_selected: 5
- review_required: 4
- close_candidate_review: 1

Excluded by reason:
- hidden_display_state: 24
- decision_suppressed: 3
- generic_schedule_or_plan_constraint: 1
```

**Selected first 5 (cards):**

1. Elena Vasileva — `close_candidate_review` (🔵 Можно закрыть)
2. Rizatdinova Elvira — `review_required` / latest negative evidence
3. slava Taranec — `review_required` / latest negative evidence
4. Ravil Urazov — `review_required`
5. Svetlana Nesterova — `review_required`

Stepan Trofimov remains a close candidate at inclusion level but is **decision-suppressed** (prior coach review decision) — correctly excluded from send set.

## Hidden rows excluded (named subset proof)

| Athlete | Before | After |
|---|---|---|
| Darya Khmelkova | included, `hidden=auto_hidden_clean_recovery_run` | excluded `hidden_display_state` |
| Larionova | included, `hidden=auto_hidden_clean_recovery_run` | excluded `hidden_display_state` |
| slava Taranec (superseded) | included, `hidden=superseded_signal_hidden` | excluded `hidden_display_state` |
| Sofia Vlasova | included, `hidden=stale_generic_schedule_unavailability` | excluded `hidden_display_state` |
| Viktoria Sergeeva | included, `hidden=superseded_signal_hidden` | excluded `hidden_display_state` |

Health/pain with real decision need still included: Kristina Pamparaite, Rizatdinova Elvira, slava Taranec (active negative evidence).

## Checks

| Check | Result |
|---|---|
| `npm run lint` | PASS (pre-existing warnings only) |
| `npm run build` | PASS |
| `npm run check:tp-signals-review-queue` | PASS (37/37) |
| `npm run check:tp-signals-review-buckets` | PASS (9/9) |
| `npm run check:tp-signals-review-pending-mutations` | PASS (16/16) |
| `npm run check:tp-signals-schedule-expiry` | PASS (10/10) |
| `npm run check:tp-signals-nonrun-constraint-cleanup` | PASS (13/13) |
| `npm run check:tp-signals-recovery-close-candidates` | PASS (7/7) |
| `npm run check:tp-signals-regression-cases` | PASS (8/8) |
| `npm run check:tp-signals-regression-cases -- --strict` | PASS (8/8) |
| `npm run check:tp-signals-full-output` | PASS |
| `npm run check-coach-operational-signals` | PASS |

## Safety

- No Telegram sends during implementation (`--no-write` diagnostics only).
- No TP writes, DB writes, status mutations, or auto-close illness/pain.
- Classifier/lifecycle behavior unchanged.
