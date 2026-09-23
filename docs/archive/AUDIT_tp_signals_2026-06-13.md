# TP Signals — Production-Readiness Audit (read-only)

- Date: 2026-06-13
- Branch: `main` — HEAD `1a5f401`
- Scope: read-only architecture + safety review of the Coach OS / TrainingPeaks TP Signals subsystem after Phases 0–4D.
- Constraints honored: no DB writes, no Telegram, no TP mutations, no push, no apply/cleanup. Only read-only diagnostics + report files generated.

---

## 1. Executive summary

The current TP Signals system is **production-safe enough to deploy**, with two non-blocking caveats and one stale-code cleanup recommendation.

- All 5 verification gates reproduce green locally (regression 8/8, strict 8/8, full-output PASS, coach-operational-signals PASS incl. the Polyakova parser fixture, lint 0 errors, build OK).
- Live read-only explain on the 7 target students: 7 matched, 14 active, 9 visible, **every visible row `bug=none`**, Polyakova not visible. Confirmed first-hand.
- The known production failure classes (F1–F13) are now (a) prevented for *new* messages by deterministic classifier gates, and (b) re-checked at display time by an F1–F13 bug detector, and (c) protected by regression fixtures.
- The one confirmed bad live row (Polyakova `b1d8ae8f…`) was remediated to `expired` with 13 hard guards, no delete.

Working conclusion in the task prompt is **validated**, with these refinements:
1. The classifier fix is *forward-looking*. Persisted pre-fix false positives are only remediated by opt-in tooling — and at least one student (Tararova) still shows 2 persisted `plan_generation_constraint` rows live. They report `bug=none`, but the bug detector keys partly off *display text*, not *source text*, so a persisted row with a normalized summary could evade it. Spot-check before deploy (these rows are active, so source-trace works on them).
2. The hard-coded Polyakova remediation is now **inert** (its first guard requires `status === "active"`; the row is already expired). It should be removed or generalized — keeping it is dead-code liability, not a live risk.
3. The source-trace tool's "active-only" query is a real limitation: the remediated Polyakova row can no longer be traced (confirmed: returns `no matching active signals`).

---

## 2. Current behavior map (from code)

| Scenario | Behavior | Source |
|---|---|---|
| Illness after return run + **negative** feedback | Negative-after-completion is gated and blocks close; row stays `needs_review`/monitoring, never close copy. | regression case 1; `findOperationalSignalNegativeAfterCompletion`; lifecycle `buildWhyNotClosed` |
| Illness after **clean** return run (silence) | confirmed_illness → `monitoring_after_return` + `requiresCoachClose=true`, displayed as **coach-close candidate** ("закрыть после проверки"), not auto-resolved, not infinite "check after run". | lifecycle L606–628; regression case 2 |
| Pain/injury + fresh "всё ок" | Stays `pain_injury`; display = **ready_for_coach_close** (close candidate). **Never auto-resolves.** Even explicit recovery → monitoring + coach close. | lifecycle L467–474; regression cases 3/4 |
| Billing/admin ("оплачу как зп придёт") | `isNonTrainingAdministrativeIntentText` gate → `skip`; no operational signal. Excludes if text also has explicit training-unavailability/pain. | `coach-operational-signals.ts` L463–501; regression case 7 |
| Weather / free-time ("завтра 34, я свободна, побегу") | `isWeatherOrTemperatureSoftContextText` → not a schedule constraint (`buildScheduleCandidate` returns null). Excludes explicit weather *restriction*. | L2012–2045, L2352; regression case 6 |
| Stale weekday schedule ("среда не может") | Habitual weekday without concrete `valid_until`; Wednesday in the past as-of → hidden/expired in display. | `isExpiredScheduleOperationalSignal` / `isStaleGenericScheduleUnavailabilitySignal`; regression case 5 |
| Mixed past+future schedule payload | Display filters out past dates, keeps future actionable dates. Whole-row consume blocked; flagged `partial_only` in cleanup. | `operational-schedule-display.ts`; `hasPartialStaleScheduleDates`; regression case 8 |
| Polyakova "в пн был нужен / сегодня не побегу" | `isPastWeekdayNeedReflection` suppresses weekday→future-date; `hasPositiveUnnegatedCue` ensures "не побегу" cannot create a plan. Result: `planned=[]`, `unavailable=[2026-06-10]`. | L561–565, L538–559, L2124–2143; fixture `polyakova-past-weekday-need-not-future-plan` |

---

## 3. Safety audit

| Could it accidentally… | Verdict | Evidence |
|---|---|---|
| Auto-resolve pain/injury | **No.** `injury_pain` never → `resolved`; explicit recovery only → monitoring + `requiresCoachClose`. | lifecycle L467–474, L583 |
| Hide illness with negative evidence | **No.** Negative-after-completion gate blocks close; `latestNegative` → `needs_review`. | case 1; explain `inferRecommendedState` L135 |
| Dismiss ambiguous schedule rows | **No.** Mixed past+future → `partial_only` (report-only), not consumed. Ambiguous non-matching rows → `not_safe`. | `tp-signals-persisted-cleanup.ts` L258–277, L344–350 |
| Mutate DB without confirmation | **No.** Dry-run default; apply needs `--apply --confirm "APPLY TP SIGNALS CLEANUP"`; update guarded `.eq("status","active")`; no deletes. | `cleanup-tp-signals-persisted.ts` L193–201, L353–359 |
| Re-classify billing/admin as constraint | **No** for new msgs (skip gate). **Residual** for persisted pre-fix rows (only opt-in cleanup remediates). | L489–501; see §7 |
| Treat "не побегу" as planning | **No.** Negation-safe `hasPositiveUnnegatedCue`; `EXPLICIT_FUTURE_TRAINING_UNAVAILABILITY_CUES` includes "не побегу". | L538–559, L418 |

**Noted-by-design (not a bug, but record it):** `confirmed_illness` *can* auto-resolve on an explicit athlete recovery message; `ambiguous_illness`/`schedule_pause` can auto-resolve on a clean completion. These are intentional low-risk transitions, but they are the only auto-resolve paths in the engine and deserve a dedicated regression fixture guarding against a *negative* message being mistaken for recovery.

---

## 4. Regression audit

**Coverage:** The 8 fixtures + the `check-coach-operational-signals` deterministic suite together cover every known failure class F1–F13. The parser-overread root cause (the real Polyakova bug) is correctly covered in `check-coach-operational-signals` (`polyakova-past-weekday-need-not-future-plan`, asserting `planned_training_dates: []`).

**Quality / overfitting notes:**
- **Case 1** final pass-clause `/(?:голова\s+круж|сон\s+клонит)/.test(message)` tests the *constant fixture string* against itself — tautological. The *meaningful* assertions in the same case (`hasNegativeText`, `gatedNegative !== null`, `!isCloseCandidate`, `!saysNoNewComplaints`) are real, so the case still protects F4; the tautological clause should be dropped to avoid false confidence.
- **Case 8** tests *display filtering* on a hand-built **legitimate** future date (`2026-06-15` baked into payload). It does **not** test the parser overread that produced the false `15.06`. That separation is fine but should be documented so nobody assumes case 8 guards the parser.
- Cases 2/3/4 assert `ready_for_coach_close` (close *candidate*) — correct, meaningful, not overfit.

**Missing high-value fixtures (recommended, not blocking):**
1. Persisted pre-fix false-positive (billing/weather) row → cleanup classifies `eligible/hide` (lock in the sweep behavior).
2. `confirmed_illness` + explicit *negative* message ≠ recovery (guard the only illness auto-resolve path).
3. Source-trace inactive lookup (once `--include-inactive` exists).
4. Multi-day habitual weekday unavailability expiry (only single weekday covered today).
5. Mixed payload where the future date is itself a parser overread (combines case 8 + parser test).

---

## 5. Cleanup / tooling audit

**`cleanup:tp-signals-persisted` — safe.**
- Dry-run default; `--apply` requires exact confirm string; targeted apply additionally asserts `would_write===1`. ✓
- No deletes — only `status → expired` (schedule/stale) or `dismissed` (billing/weather), with `valid_until` clamp. ✓
- `--signal-id` requires `--reason`, and `--reason` requires `--signal-id`; targeted mode requires exactly one active signal. ✓
- Protected health types (`pain_injury`, `health_*`, `resume_training`) hard-blocked; negative source text → `not_safe`; resolved rows never touched. ✓

**Hard-coded Polyakova remediation — remove or generalize now.**
- 13 guards (signal_id, student_name, source_observation_id, exact planned-dates, unavailable contains `2026-06-10`, 4 source-preview markers, 2 parser-simulation checks, past-unavailability, no-future-actionable). Extremely tight — effectively unrepeatable.
- It is **already inert**: the function returns `not_eligible` for any non-active row, and the target row is now `expired`. It can never fire again on the real row.
- **Recommendation:** delete `classifyStalePayloadParserOverreadWeekdayContextRemediation` + `POLYAKOVA_PARSER_OVERREAD_REMEDIATION` + the `--reason=parser_overread_weekday_context` CLI path. If a reusable capability is wanted, generalize into a non-PII rule: "schedule row whose parser re-simulation yields only past dates → eligible for expiry," guarded by the same parser-resimulation + no-future-actionable checks, without the hard-coded id/name/markers.

---

## 6. Explain / source-trace tooling

**Explain (`diagnose:tp-signals-explain`)** — good for ongoing debugging. `bug=none` is a *meaningful* re-check: `inferSuspectedBugClass` re-tests the rendered item + payload against F1–F13 signatures. Caveat: several classes (F5/F6) key off **display text**, so a persisted false-positive row with a sanitized `display_summary` could read `bug=none` despite a bad source. Treat `bug=none` as necessary, not fully sufficient, for *persisted* rows.

**Source-trace (`diagnose:tp-signal-source-trace`)** — limitation **confirmed**: it queries `status: "active"` only (L793–797). The remediated Polyakova row now returns `FAIL: no matching active signals`. This is a tooling limitation, not a product bug.

**Recommended additions (small, high-value):**
- `--status=active|expired|dismissed|all` (default `active`) and/or `--include-inactive`.
- Full row lookup by `--signal-id` regardless of status (skip the student/active filter when an id is given).
- Optional `--source-observation-id` direct lookup.
- Minor: report filename is hard-coded `polyakova-source-trace.json` — make it generic. `--no-write` is parsed but never gates the report write (it only affects a log line); either honor it or rename it.

---

## 7. Production-readiness verdict

**Verdict: SAFE TO PUSH/DEPLOY**, conditioned on one pre-deploy spot-check.

Rationale: all gates green (reproduced), live explain clean for the target set, the one confirmed bad live row remediated, no auto-resolve on pain, negative evidence blocks close, deterministic gates for billing/weather/weekday.

**Pre-deploy spot-check (read-only, ~2 min):** source-trace Tararova's 2 visible `plan_generation_constraint` rows (they're active, so trace works). Confirm they are genuine constraints and not surviving weather/free-time false positives with normalized summaries. If they trace back to weather/free-time source text → run guarded cleanup (`hide`) before or right after deploy.

**Post-deploy smoke (read-only):**
```
npm run diagnose:tp-signals-explain -- --date=<today> \
  --names="Rizatdinova Elvira,Alexander Ivanov,Alexander Lavrentyev,Anna Chernysheva,Aleksandra Tararova,Elena Vasileva,Polyakova Anastasia" --no-write
```
- **Acceptable:** every visible row `bug=none`; Polyakova absent; pain rows `active_problem`/close-candidate (never `resolved` without coach action); illness clean-run rows show close-candidate not infinite check.
- **Rollback / manual review trigger:** any `bug=F*`; a pain/injury row showing `resolved`; Polyakova reappearing with a future planned date; a billing/weather phrase surfacing in `plan_constraints`.

---

## 8. Remaining risks

| Risk | Current mitigation | Remaining gap | Severity | Next action |
|---|---|---|---|---|
| Illness false close | Negative-after-completion gate; coach-close candidate vs resolve split | confirmed_illness auto-resolves on "explicit recovery" — no fixture guards a negative msg misread as recovery | Med | Add negative-vs-recovery fixture |
| Pain auto-resolve | Hard block: never `resolved`; coach close required | None material | Low | Keep fixtures |
| Stale schedule | Expiry + display past-date filtering | Multi-day habitual windows under-tested | Low | Add multi-day fixture |
| Billing/admin false positive | Skip gate (new msgs) | Persisted pre-fix rows not auto-swept | Med | Run/extend cleanup sweep |
| Weather false positive | Soft-context gate (new msgs) | Same persisted-row gap; Tararova has 2 live constraint rows | Med | Pre-deploy source-trace Tararova |
| Parser weekday overread | Negation-safe cues + past-weekday-reflection suppression; fixture | Only single Polyakova phrasing covered | Low | Add 1–2 phrasing variants |
| Persisted bad rows | Guarded cleanup tool (dry-run/confirm/no-delete) | Tool is manual; no scheduled lifecycle sweep | Med | Plan generalized sweeper |
| Source-trace gaps | Active-row trace + parser simulation | Cannot trace expired/dismissed rows | Med | Add `--status/--include-inactive` |
| State-model fragmentation | Works via overlays + display resolution | No canonical `episode_key`; multiple state vocabularies | Med (debt) | Schedule episode_key work separately |

---

## 9. Release checklist (for Igor)

**Before push (read-only):**
```
git status --short
npm run check:tp-signals-regression-cases
npm run check:tp-signals-regression-cases -- --strict
npm run check:tp-signals-full-output
npm run check-coach-operational-signals
npm run lint
npm run build
npm run diagnose:tp-signals-explain -- --date=<today> --names="<7 target students>" --no-write
# Spot-check: source-trace Tararova's 2 plan_generation_constraint rows (active)
```
Acceptable: 8/8 + 8/8 strict, full-output PASS, coach-signals PASS, lint 0 errors, build OK, explain all `bug=none` + Polyakova absent.

**Push/deploy:** standard repo push + your normal deploy path (only when you decide — not automated).

**Post-deploy diagnostics:** re-run the explain command above against production date.
- Acceptable: as in §7.
- Rollback/manual review: any `bug=F*`, any pain row `resolved`, Polyakova with future planned date, billing/weather text in plan constraints.

---

## 10. Proposed follow-up TASK prompts (not implemented)

1. **TASK: Remove inert Polyakova hard-coded remediation.** Delete `classifyStalePayloadParserOverreadWeekdayContextRemediation`, `POLYAKOVA_PARSER_OVERREAD_REMEDIATION`, and the `--reason=parser_overread_weekday_context` CLI branch; keep general cleanup intact; add a test asserting the targeted path is gone.
2. **TASK: Generalize parser-resimulation expiry rule.** Add a non-PII cleanup reason: schedule row whose parser re-simulation yields only past dates and no future actionable date → `eligible: consume`, guarded + dry-run default. Replace the deleted Polyakova path.
3. **TASK: Source-trace inactive support.** Add `--status` / `--include-inactive`, full `--signal-id` lookup regardless of status, optional `--source-observation-id`; generic report filename; honor `--no-write`.
4. **TASK: Persisted false-positive sweep fixtures + sweep run.** Fixture for billing/weather persisted rows → cleanup `eligible:hide`; then guarded apply on confirmed Tararova/other survivors.
5. **TASK: Illness recovery-vs-negative guard fixture.** confirmed_illness + explicit negative message must NOT auto-resolve.
6. **TASK (debt, separate track): canonical `episode_key` + single state vocabulary.** Replace overlay-based display resolution with one lifecycle state machine keyed by episode. Design-first; do not touch until the above land.

### Suggested ordering
- **Next week:** #1, #3, #4, #5 (low-risk, lock in safety; #4 finishes the one live residual).
- **Can wait:** #2 (only if the capability is actually needed again).
- **Do not touch yet:** #6 — plan it, but the system is shippable without it; rushing the state-machine rewrite is the highest-regret move.

---

### Safety confirmation
- No secrets touched. No push. No deploy. No Telegram sends. No TrainingPeaks mutations. No billing imports/allocations. No DB writes (all commands read-only / dry-run; no `--apply` run). Reports written to `reports/` and this file only.
