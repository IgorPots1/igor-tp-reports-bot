# TP Signals Phase 4 — Recovery evidence → close_candidate_review

Date: 2026-06-14
Branch: `tp-signals-pending-mutation-replay`
Scope: display/review-layer recovery promotion only. No DB / Telegram / TP writes. No auto-close.

## Summary

Class A / recovery-gap from the stale-visible audit: pain/illness signals must never
auto-close, but when there is explicit, confident recovery evidence (and no negative
evidence) the signal should surface as a **coach-reviewable close candidate** so the coach
can press `✅ Закрыть сигнал`.

The lifecycle engine and pain close-evidence path already existed. Two gaps remained:

1. **Illness recovery required a TP running completion.** Telegram-only positive recovery
   (e.g. "врач разрешил, лёгкая пробежка прошла нормально, самочувствие ок") could not
   promote an illness/health-pause signal in `monitoring_after_return`. This is exactly the
   Elena Vasileva case (TP completion missing → stuck at monitoring).
2. **No uncertainty guard.** Hedged recovery ("вроде лучше, но ещё не понятно") would count
   as positive and could promote, contrary to the conservative safety rule.

Additionally, a latent explain bug computed the display lifecycle state without evidence,
and `inferRecommendedState` had a loose pain branch that returned `close_candidate` whenever
any positive text existed (ignoring negatives/hedges). Both are fixed so the
evidence-driven display state is the single source of truth.

No status is mutated and nothing auto-resolves — promotion is display/review only.

## Files changed

- `src/features/trainingpeaks/service.ts`
  - New `hasOperationalRecoveryUncertaintyHedge` + `isConfidentOperationalRecoveryText`
    (recovery wording minus explicit uncertainty hedges).
  - New shared `hasFreshTelegramRecoveryCloseEvidence` (confident positive after open, no
    later/equal negative; no TP completion required). `hasFreshOperationalPainCloseEvidence`
    now delegates to it (so pain also respects the hedge guard).
  - `hasFreshIllnessCloseCandidateEvidence`: negative evidence blocks first; then promotes
    on **either** a reliable TP running completion (existing) **or** explicit Telegram
    recovery evidence (new). Still gated on `monitoring_after_return` + health + non-pain.
- `src/features/trainingpeaks/tp-signals-explain-helpers.ts`
  - Pass `evidence` into `resolveOperationalSignalDisplayLifecycleState` (was missing).
  - Remove the loose pain `close_candidate` branch in `inferRecommendedState`; rely on the
    evidence-driven `lifecycleDisplayState`.
- `scripts/check-tp-signals-recovery-close-candidates.ts` (new) — 7 deterministic fixtures.
- `package.json` — new `check:tp-signals-recovery-close-candidates` script.

## Fixtures added (`check:tp-signals-recovery-close-candidates`, 7/7 PASS)

| # | Scenario | Display state | Close candidate? |
|---|---|---|---|
| 1 | Pain clean recovery ("всё ок, не болит, бегал нормально") | `ready_for_coach_close` | yes |
| 2 | Pain negative ("снова болит и мешает бегу") | `active_problem` | no |
| 3 | Illness clean Telegram run ("врач разрешил… пробежка нормально… ок") | `ready_for_coach_close` | yes |
| 4 | Illness negative ("хватило на 20 минут, плохо, слабость") | `monitoring_after_return` | no |
| 5a | Ambiguous pain ("вроде лучше, но ещё не понятно") | `active_problem` | no |
| 5b | Ambiguous illness ("вроде лучше, но ещё не понятно") | `monitoring_after_return` | no |
| 6 | Pain positive then later negative ("опять заболело") | `active_problem` | no |

Each fixture also asserts the display layer never returns `resolved` and the signal
`status` stays `active` (no auto-resolve, no mutation).

## Pain recovery behavior

Confident positive recovery after open with no later/equal negative →
`ready_for_coach_close` → review bucket `close_candidate_review`. No lifecycle gate (pain can
promote from active). Negative or hedged evidence keeps it `active_problem`.

## Illness recovery behavior

For health/illness signals in `monitoring_after_return`: promotes to close candidate on a
reliable TP running completion **or** explicit confident Telegram recovery evidence, only
when no negative evidence is present. Never auto-resolves.

## Negative evidence protections

- Any negative-after-open evidence (temperature, кашель/горло, болит, "хватило на N минут",
  головокружение, плохо, слабость, musculoskeletal pain, etc.) blocks close candidacy.
- A later/equal negative after a positive blocks (fixture 6).
- Uncertainty hedges ("не понятно", "пока не ясно", "ещё не уверен", "не до конца",
  "время покажет") block (fixtures 5a/5b).
- Existing ongoing-illness cases (Rizatdinova / Taranec / Pamparaite) remain `needs_review`,
  not close candidates (live-verified).

## Live diagnostics (read-only, `--no-write`, as_of=2026-06-15)

`diagnose:tp-signals-review-queue` (Lavrentyev, Denisova, Elena, Chernysheva):
- `close_candidate_review: 1` (was 0).
- Elena Vasileva illness/pause card → "Состояние: Кандидат на закрытие".

`diagnose:tp-signals-explain` (+ Rizatdinova, Taranec, Pamparaite):
- Elena Vasileva: `recommended=close_candidate`.
- Alexander Lavrentyev / Anna Denisova / Anna Chernysheva: `active_problem` (ambiguous /
  no clean recovery — correctly NOT promoted).
- Rizatdinova / Taranec / Pamparaite: `needs_review` (ongoing illness — protected).
- No suspected bug classes.

### Per-target outcome
- **Alexander Lavrentyev** — source mixes "Все хорошо" with "побаливают… боль рабочая"
  (ambiguous); stays `active_problem`. Documented: ambiguous pain is kept for manual review.
- **Anna Denisova** — надкостница, no clean recovery evidence; stays `active_problem`.
- **Anna Chernysheva** — nail injury, no linked "ok" evidence; stays `active_problem`.
- **Elena Vasileva** — illness monitoring + doctor-cleared positive run feedback (Telegram,
  no TP completion); now `close_candidate` / "Кандидат на закрытие".

## Checks

- `npm run lint` → 0 errors (13 pre-existing warnings in unrelated `tools/`).
- `npm run build` → exit 0.
- `check:tp-signals-recovery-close-candidates` → PASS (7/7) [new]
- `check:tp-signals-review-queue` → PASS (20/20)
- `check:tp-signals-review-buckets` → PASS (9/9)
- `check:tp-signals-review-pending-mutations` → PASS (16/16)
- `check:tp-signals-schedule-expiry` → PASS (10/10)
- `check:tp-signals-nonrun-constraint-cleanup` → pass=13/0
- `check:tp-signals-regression-cases` (+ `--strict`) → pass=8/8
- `check:tp-signals-full-output` → PASS
- `check-coach-operational-signals` → all deterministic checks passed

## Remaining limitations

- Illness close-candidate promotion requires `lifecycleState = monitoring_after_return`
  (matches existing structure and the Elena case). An illness still in `active_problem` with
  clean recovery would not auto-promote without first moving to monitoring — kept
  conservative on purpose.
- Recovery/negative detection is deterministic pattern-based; unusual phrasing without a
  known recovery cue stays active/review (safe-by-default).
- No persisted lifecycle_state is written; promotion is display/review only. Coach action is
  still required to actually close the signal.
