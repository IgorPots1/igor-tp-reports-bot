# TP Signals Review Queue — Card Context Polish

## Summary

Telegram Review Queue cards now always include a **Что произошло** block built from display summary, payload dates, or source observation preview. Selector behavior excludes hidden/superseded/stale display rows and generic plan constraints; close candidates sort first before `--limit`.

## Files changed

- `src/features/trainingpeaks/tp-signals-review-coach-labels.ts` — `resolveTpSignalReviewCardContext`, category-aware context builders, fallback
- `src/features/trainingpeaks/tp-signals-review-card.ts` — always render Что произошло; pass explainRecord/signalType
- `src/features/trainingpeaks/tp-signals-review-flow.ts` — pass full bucket item into card formatter
- `src/features/trainingpeaks/tp-signals-review-queue-helpers.ts` — selected diagnostics with `card_has_context` / `context_source`
- `scripts/diagnose-tp-signals-review-queue.ts` — print selected card context section
- `scripts/check-tp-signals-review-queue.ts` — selector + card context tests (48 cases)

## Before/after examples

### Alexander Lavrentyev (plan constraint — excluded from Telegram queue)

**Before (bad card when included):**

```text
🟡 Проверить сигнал
👤 Alexander Lavrentyev
Категория: учесть в плане
Почему в очереди: Стоит быстро проверить вручную.
```

**After:** excluded (`hidden_display_state`, `recommended=hidden`). Stays in `/tp_signals`, not sent as button card.

### Elena Vasileva (close candidate)

**After:**

```text
🔵 Можно закрыть после проверки
👤 Elena Vasileva
Категория: болезнь / пауза
Что произошло:
После болезни был лёгкий выход, новых жалоб нет — можно закрыть после проверки.
Почему в очереди:
Перед закрытием нужно убедиться, что самочувствие стабильное.
```

### Illness review (Ravil Urazov pattern)

```text
Что произошло:
Болеет, кашель — уточнить текущее самочувствие.
```

## Close candidate priority proof

`--date=2026-06-15 --all-active --limit=5`:

- `included_before_limit`: 5 (1 close_candidate + 4 review_required)
- `selected after limit`: Elena close_candidate first; health/pain review_required follow
- Stepan Trofimov close_candidate included before limit but may be `decision_suppressed` if coach already reviewed

## Hidden rows excluded proof

Excluded by reason (all-active scan):

- `hidden_display_state`: 24 (includes `auto_hidden_clean_recovery_run`, `superseded_signal_hidden`, `stale_generic_schedule_unavailability`, `recommended=hidden`)
- `generic_schedule_or_plan_constraint`: 1
- Close candidates bypass hidden exclusion via `close_candidate_review` bucket

## Card context coverage

All selected cards in live dry-run include `Что произошло`. Diagnostics expose:

- `card_has_context=true/false`
- `context_source`: `display_summary` | `payload` | `source_observation` | `fallback_missing`

## Checks

| Check | Result |
|-------|--------|
| `npm run lint` | PASS (warnings only, unrelated) |
| `npm run build` | PASS |
| `check:tp-signals-review-queue` | PASS (48/48) |
| `check:tp-signals-review-buckets` | PASS |
| `check:tp-signals-review-pending-mutations` | PASS |
| `check:tp-signals-schedule-expiry` | PASS |
| `check:tp-signals-nonrun-constraint-cleanup` | PASS |
| `check:tp-signals-recovery-close-candidates` | PASS |
| `check:tp-signals-regression-cases` | PASS |
| `check:tp-signals-regression-cases --strict` | PASS |
| `check:tp-signals-full-output` | PASS |
| `check-coach-operational-signals` | PASS |

## Remaining limitations

- Close candidate context still generic when preview is messy and no positive recovery snippet is available
- `fallback_missing` rare but possible for signals without preview or source snippets
- Plan/schedule cards only sent when strong review reason exists; regular constraints remain `/tp_signals` only
- Stepan Trofimov may not appear in selected send if prior review decision suppresses the card

## Safety

- No Telegram sends during implementation
- No TrainingPeaks writes
- No DB writes / apply / replay apply
- No status mutations
- No auto-close illness/pain
